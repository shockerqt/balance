use crate::{
    connectors::{db::Database, user::NewUser},
    modules::auth::oidc::{IdentityMode, OidcConfig},
};
use axum::{
    Extension,
    extract::Request,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

#[derive(Clone)]
pub struct CurrentUser {
    pub id: i32,
}

pub struct AuthError {
    status: StatusCode,
    expired: bool,
    challenge: Option<HeaderValue>,
}
impl AuthError {
    fn new(status: StatusCode) -> Self {
        Self {
            status,
            expired: false,
            challenge: None,
        }
    }
    pub fn is_expired(&self) -> bool {
        self.expired
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let mut headers = HeaderMap::new();
        if self.status == StatusCode::UNAUTHORIZED
            && let Some(challenge) = self.challenge
        {
            headers.insert(axum::http::header::WWW_AUTHENTICATE, challenge);
        }
        (self.status, headers).into_response()
    }
}

pub async fn auth(
    State(oidc): State<OidcConfig>,
    Extension(db): Extension<std::sync::Arc<Database>>,
    mut req: Request,
    next: Next,
) -> Result<Response, AuthError> {
    let token = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .or_else(|| {
            if oidc.identity_mode() == IdentityMode::IssuerSubject {
                return None;
            }
            req.headers()
                .get(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
                .and_then(|h| h.to_str().ok())
                .and_then(|protocols| {
                    protocols
                        .split(',')
                        .map(str::trim)
                        .find_map(|protocol| protocol.strip_prefix("balance.bearer."))
                })
        })
        .ok_or_else(|| AuthError {
            status: StatusCode::UNAUTHORIZED,
            expired: false,
            challenge: Some(oidc.challenge().clone()),
        })?;

    let (user, _) = authenticate_token(&oidc, &db, token)
        .await
        .map_err(|mut error| {
            error.challenge = Some(oidc.challenge().clone());
            error
        })?;

    req.extensions_mut().insert(user);

    Ok(next.run(req).await)
}

// One authoritative verifier and identity resolver for HTTP and application WSS.
pub async fn authenticate_token(
    oidc: &OidcConfig,
    db: &Database,
    token: &str,
) -> Result<(CurrentUser, usize), AuthError> {
    let claims = oidc.verify(token).await.map_err(|error| {
        if oidc.identity_mode() == IdentityMode::IssuerSubject {
            tracing::warn!("OIDC access token rejected");
        } else {
            tracing::warn!(?error, "OIDC access token rejected");
        }
        let expired = error
            .downcast_ref::<jsonwebtoken::errors::Error>()
            .is_some_and(|error| {
                error.kind() == &jsonwebtoken::errors::ErrorKind::ExpiredSignature
            })
            || error.to_string() == "access token expired";
        AuthError {
            status: StatusCode::UNAUTHORIZED,
            expired,
            challenge: None,
        }
    })?;
    let user_id = if oidc.identity_mode() == IdentityMode::IssuerSubject {
        resolve_subject_user(oidc, db, token, &claims)
            .await
            .map_err(|_| {
                tracing::warn!("OIDC identity resolution rejected");
                AuthError::new(StatusCode::UNAUTHORIZED)
            })?
    } else {
        let email = claims
            .email
            .as_ref()
            .filter(|email| !email.is_empty())
            .ok_or(AuthError::new(StatusCode::UNAUTHORIZED))?;
        let user = match db.user.get_by_email(email).await {
            Ok(Some(user)) => user,
            Ok(None) => db
                .user
                .create(&NewUser {
                    email: email.clone(),
                    name: claims.name.clone(),
                    family_name: claims.family_name.clone(),
                    given_name: claims.given_name.clone(),
                    picture: claims.picture.clone(),
                })
                .await
                .map_err(|error| {
                    tracing::error!(?error, "creating OIDC user");
                    AuthError::new(StatusCode::INTERNAL_SERVER_ERROR)
                })?,
            Err(error) => {
                tracing::error!(?error, "finding OIDC user");
                return Err(AuthError::new(StatusCode::INTERNAL_SERVER_ERROR));
            }
        };
        user.id
    };

    Ok((CurrentUser { id: user_id }, claims.exp))
}

async fn resolve_subject_user(
    oidc: &OidcConfig,
    db: &Database,
    token: &str,
    claims: &crate::modules::auth::oidc::OidcClaims,
) -> anyhow::Result<i32> {
    if let Some(user_id) = oidc.cached_identity(&claims.iss, &claims.sub) {
        return Ok(user_id);
    }
    let user = match db.user.get_by_identity(&claims.iss, &claims.sub).await? {
        Some(user) => user,
        None => {
            let profile = oidc.userinfo(token, claims).await?;
            db.user
                .provision_identity(
                    &claims.iss,
                    &claims.sub,
                    &NewUser {
                        email: profile.email,
                        name: profile.name,
                        family_name: profile.family_name,
                        given_name: profile.given_name,
                        picture: profile.picture,
                    },
                )
                .await?
        }
    };
    oidc.cache_identity(&claims.iss, &claims.sub, user.id);
    Ok(user.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::auth::oidc::OidcClaims;

    #[tokio::test]
    async fn stored_identity_does_not_call_provider() {
        let Some((db, schema)) = crate::connectors::user::isolated_identity_test_database().await
        else {
            return;
        };
        let subject = uuid::Uuid::new_v4().to_string();
        let issuer = "https://unreachable.example.invalid";
        let user = db
            .user
            .provision_identity(
                issuer,
                &subject,
                &NewUser {
                    email: format!("stored-{subject}@example.invalid"),
                    name: None,
                    family_name: None,
                    given_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();
        // A config with an unreachable provider must never perform a network
        // call when an already-verified identity is stored locally.
        let oidc = OidcConfig::test_subject_config(issuer);
        let claims = OidcClaims {
            sub: subject,
            iss: issuer.into(),
            exp: 4102444800,
            email: None,
            name: None,
            given_name: None,
            family_name: None,
            picture: None,
        };
        let resolved = resolve_subject_user(&oidc, &db, "not-a-network-token", &claims)
            .await
            .unwrap();
        assert_eq!(resolved, user.id);
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user.id)
            .execute(&db.user.pool)
            .await
            .unwrap();
        crate::connectors::user::cleanup_identity_test_database(&db, &schema).await;
    }
    #[tokio::test]
    async fn rejected_userinfo_and_rolled_back_provisioning_allow_retry() {
        use axum::{Router, body::Body, http::Request};
        use std::sync::{
            Arc,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        };
        use tower::ServiceExt;

        let Some((db, schema)) = crate::connectors::user::isolated_identity_test_database().await
        else {
            return;
        };
        let db = Arc::new(db);
        let oidc = OidcConfig::test_cached_subject_config();
        let subject = "provisioning-retry";
        let email = "provisioning-retry@example.invalid";
        let valid_profile = Arc::new(AtomicBool::new(false));
        let profile_calls = Arc::new(AtomicUsize::new(0));
        let valid = valid_profile.clone();
        let calls = profile_calls.clone();
        let provider = Router::new().route("/", axum::routing::get(move || {
            calls.fetch_add(1, Ordering::Relaxed);
            let reported_subject = if valid.load(Ordering::Relaxed) { subject } else { "wrong-subject" };
            async move { axum::Json(serde_json::json!({"sub":reported_subject,"email":email,"email_verified":true})) }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        oidc.test_userinfo_endpoint(format!("http://{}/", listener.local_addr().unwrap()));
        let provider = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });

        let app = Router::new()
            .route(
                "/",
                axum::routing::get(|Extension(user): Extension<CurrentUser>| async move {
                    user.id.to_string()
                }),
            )
            .route_layer(axum::middleware::from_fn_with_state(oidc.clone(), auth))
            .layer(Extension(db.clone()));
        let token = oidc.test_access_token(subject, chrono::Utc::now().timestamp() + 120);
        let request = || {
            Request::get("/")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap()
        };
        sqlx::query(
            "ALTER TABLE oidc_user_identities ADD CONSTRAINT reject_provision CHECK (false)",
        )
        .execute(&db.user.pool)
        .await
        .unwrap();

        for expected_profile_calls in 1..=2 {
            let response = app.clone().oneshot(request()).await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(
                response.headers()[axum::http::header::WWW_AUTHENTICATE],
                *oidc.challenge()
            );
            assert_eq!(
                profile_calls.load(Ordering::Relaxed),
                expected_profile_calls
            );
            assert!(db.user.get_by_email(email).await.unwrap().is_none());
            assert!(
                db.user
                    .get_by_identity(oidc.issuer(), subject)
                    .await
                    .unwrap()
                    .is_none()
            );
            assert!(oidc.cached_identity(oidc.issuer(), subject).is_none());
            valid_profile.store(true, Ordering::Relaxed);
        }

        sqlx::query("ALTER TABLE oidc_user_identities DROP CONSTRAINT reject_provision")
            .execute(&db.user.pool)
            .await
            .unwrap();
        assert_eq!(
            app.oneshot(request()).await.unwrap().status(),
            StatusCode::OK
        );
        assert_eq!(profile_calls.load(Ordering::Relaxed), 3);
        let user = db
            .user
            .get_by_identity(oidc.issuer(), subject)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            db.user.get_by_email(email).await.unwrap().unwrap().id,
            user.id
        );
        assert_eq!(oidc.cached_identity(oidc.issuer(), subject), Some(user.id));

        provider.abort();
        crate::connectors::user::cleanup_identity_test_database(&db, &schema).await;
    }

    #[tokio::test]
    async fn legacy_auth_resolves_and_provisions_by_email() {
        let Some((db, schema)) = crate::connectors::user::isolated_identity_test_database().await
        else {
            return;
        };
        let oidc = OidcConfig::test_cached_legacy_config();
        let email = "legacy-auth@example.invalid";
        let exp = chrono::Utc::now().timestamp() + 120;
        let token = |subject: &str| {
            OidcConfig::test_signed_claims(&serde_json::json!({
                "sub": subject,
                "iss": oidc.issuer(),
                "aud": "legacy-api",
                "email": email,
                "exp": exp,
            }))
        };

        let (first, first_exp) = authenticate_token(&oidc, &db, &token("first"))
            .await
            .ok()
            .unwrap();
        let (second, _) = authenticate_token(&oidc, &db, &token("second"))
            .await
            .ok()
            .unwrap();
        assert_eq!(first_exp, exp as usize);
        assert_eq!(first.id, second.id);
        assert_eq!(
            first.id,
            db.user.get_by_email(email).await.unwrap().unwrap().id
        );
        assert!(
            db.user
                .get_by_identity(oidc.issuer(), "first")
                .await
                .unwrap()
                .is_none()
        );
        assert!(oidc.cached_identity(oidc.issuer(), "first").is_none());
        crate::connectors::user::cleanup_identity_test_database(&db, &schema).await;
    }

    #[tokio::test]
    async fn actual_http_routes_separate_audiences_and_all_unauthorized_challenges() {
        use axum::{Router, body::Body, http::Request};
        use tower::ServiceExt;
        let Some((db, schema)) = crate::connectors::user::isolated_identity_test_database().await
        else {
            return;
        };
        let subject = "http-resource-subject";
        db.user
            .provision_identity(
                "https://issuer.example.invalid",
                subject,
                &NewUser {
                    email: "http-resource@example.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();
        let api = OidcConfig::test_cached_subject_config();
        let mcp = api.mcp_config();
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = calls.clone();
        let provider = Router::new().route("/",axum::routing::get(move || {
            observed.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
            async { axum::Json(serde_json::json!({"sub":"incorrect","email":"invalid@example.invalid","email_verified":false})) }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        api.test_userinfo_endpoint(format!("http://{}/", listener.local_addr().unwrap()));
        let provider = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let db = std::sync::Arc::new(db);
        let app = Router::new()
            .merge(crate::modules::mcp::mcp_metadata_routes(&api, &mcp))
            .nest(
                "/me",
                crate::modules::user::routes::user_routes()
                    .route_layer(axum::middleware::from_fn_with_state(api.clone(), auth)),
            )
            .merge(
                crate::modules::mcp::mcp_routes(crate::modules::mcp::AdmissionController::new(20))
                    .route_layer(axum::middleware::from_fn_with_state(mcp.clone(), auth)),
            )
            .layer(Extension(db.clone()))
            .layer(Extension(crate::modules::sync::hub::SyncHub::default()));
        let api_token = api.test_access_token(subject, chrono::Utc::now().timestamp() + 120);
        let mcp_token = mcp.test_access_token(subject, chrono::Utc::now().timestamp() + 120);
        for (path, method, token, expected, challenge) in [
            (
                "/me",
                "GET",
                Some(api_token.as_str()),
                StatusCode::OK,
                api.challenge(),
            ),
            (
                "/mcp",
                "POST",
                Some(api_token.as_str()),
                StatusCode::UNAUTHORIZED,
                mcp.challenge(),
            ),
            (
                "/mcp",
                "POST",
                Some(mcp_token.as_str()),
                StatusCode::OK,
                mcp.challenge(),
            ),
            (
                "/me",
                "GET",
                Some(mcp_token.as_str()),
                StatusCode::UNAUTHORIZED,
                api.challenge(),
            ),
            (
                "/me",
                "GET",
                None,
                StatusCode::UNAUTHORIZED,
                api.challenge(),
            ),
            (
                "/mcp",
                "POST",
                None,
                StatusCode::UNAUTHORIZED,
                mcp.challenge(),
            ),
            (
                "/me",
                "GET",
                Some("invalid"),
                StatusCode::UNAUTHORIZED,
                api.challenge(),
            ),
            (
                "/mcp",
                "POST",
                Some("invalid"),
                StatusCode::UNAUTHORIZED,
                mcp.challenge(),
            ),
        ] {
            let mut request = Request::builder()
                .method(method)
                .uri(path)
                .header("Host", "attacker.example.invalid")
                .header("Content-Type", "application/json");
            if let Some(token) = token {
                request = request.header("Authorization", format!("Bearer {token}"));
            }
            let body = if method == "POST" {
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"http-test","version":"1"}}}"#
            } else {
                ""
            };
            let response = app
                .clone()
                .oneshot(request.body(Body::from(body)).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "{method} {path}");
            if expected == StatusCode::UNAUTHORIZED {
                assert_eq!(
                    response.headers().get(axum::http::header::WWW_AUTHENTICATE),
                    Some(challenge)
                );
            }
        }
        let mut held = Vec::new();
        for _ in 0..db.user.pool.options().get_max_connections() {
            held.push(db.user.pool.acquire().await.unwrap());
        }
        let fresh_exp = chrono::Utc::now().timestamp() + 180;
        let fresh_mcp_token = mcp.test_access_token(subject, fresh_exp);
        let expired_mcp_token = mcp.test_access_token(subject, chrono::Utc::now().timestamp() - 1);
        let mut invalid_signature = fresh_mcp_token.clone();
        let signature_start = invalid_signature.rfind('.').unwrap() + 1;
        let first = if invalid_signature.as_bytes()[signature_start] == b'A' {
            "B"
        } else {
            "A"
        };
        invalid_signature.replace_range(signature_start..signature_start + 1, first);
        for (token, status) in [
            (&fresh_mcp_token, StatusCode::OK),
            (&invalid_signature, StatusCode::UNAUTHORIZED),
            (&expired_mcp_token, StatusCode::UNAUTHORIZED),
            (&api_token, StatusCode::UNAUTHORIZED),
        ] {
            let req = Request::post("/mcp")
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#))
                .unwrap();
            let response =
                tokio::time::timeout(std::time::Duration::from_secs(1), app.clone().oneshot(req))
                    .await
                    .unwrap()
                    .unwrap();
            assert_eq!(response.status(), status);
            if status == StatusCode::UNAUTHORIZED {
                assert_eq!(
                    response.headers()[axum::http::header::WWW_AUTHENTICATE],
                    *mcp.challenge()
                );
            }
        }
        let (_, exp) = authenticate_token(&mcp, &db, &fresh_mcp_token)
            .await
            .ok()
            .unwrap();
        assert_eq!(exp, fresh_exp as usize);
        drop(held);
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "persisted associations must not call UserInfo"
        );
        for (path, method, config) in [("/me", "GET", &api), ("/mcp", "POST", &mcp)] {
            let token =
                config.test_access_token("unknown-profile", chrono::Utc::now().timestamp() + 120);
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header("Authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(
                response.headers().get(axum::http::header::WWW_AUTHENTICATE),
                Some(config.challenge())
            );
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        assert!(
            db.user
                .get_by_identity("https://issuer.example.invalid", "unknown-profile")
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            api.challenge().to_str().unwrap(),
            "Bearer resource_metadata=\"https://api.example.invalid/.well-known/oauth-protected-resource/api\""
        );
        assert_eq!(
            mcp.challenge().to_str().unwrap(),
            "Bearer resource_metadata=\"https://api.example.invalid/.well-known/oauth-protected-resource/api/mcp\""
        );
        provider.abort();
        crate::connectors::user::cleanup_identity_test_database(&db, &schema).await;
    }
}
