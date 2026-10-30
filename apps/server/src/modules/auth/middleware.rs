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
    let user = if oidc.identity_mode() == IdentityMode::IssuerSubject {
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
        match db.user.get_by_email(email).await {
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
        }
    };

    Ok((CurrentUser { id: user.id }, claims.exp))
}

async fn resolve_subject_user(
    oidc: &OidcConfig,
    db: &Database,
    token: &str,
    claims: &crate::modules::auth::oidc::OidcClaims,
) -> anyhow::Result<crate::connectors::user::User> {
    if let Some(user) = db.user.get_by_identity(&claims.iss, &claims.sub).await? {
        return Ok(user);
    }
    let profile = oidc.userinfo(token, claims).await?;
    Ok(db
        .user
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
        .await?)
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
        assert_eq!(resolved.id, user.id);
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user.id)
            .execute(&db.user.pool)
            .await
            .unwrap();
        crate::connectors::user::cleanup_identity_test_database(&db, &schema).await;
    }
    #[tokio::test]
    async fn rejected_userinfo_does_not_provision_rows() {
        let Some((db, schema)) = crate::connectors::user::isolated_identity_test_database().await
        else {
            return;
        };
        let subject = uuid::Uuid::new_v4().to_string();
        let email = format!("invalid-{subject}@example.invalid");
        let response =
            serde_json::json!({"sub":"wrong-subject","email":email,"email_verified":true})
                .to_string();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/", listener.local_addr().unwrap());
        let app = axum::Router::new().route(
            "/",
            axum::routing::get(move || {
                let body = response.clone();
                async move { body }
            }),
        );
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let issuer = "https://userinfo.example.invalid";
        let oidc = OidcConfig::test_subject_config(issuer);
        oidc.test_userinfo_endpoint(endpoint);
        let claims = OidcClaims {
            sub: subject.clone(),
            iss: issuer.into(),
            exp: 4102444800,
            email: None,
            name: None,
            given_name: None,
            family_name: None,
            picture: None,
        };
        assert!(
            resolve_subject_user(&oidc, &db, "synthetic-bearer", &claims)
                .await
                .is_err()
        );
        assert!(
            db.user
                .get_by_identity(issuer, &subject)
                .await
                .unwrap()
                .is_none()
        );
        assert!(db.user.get_by_email(&email).await.unwrap().is_none());
        task.abort();
        assert!(
            resolve_subject_user(&oidc, &db, "synthetic-bearer", &claims)
                .await
                .is_err()
        );
        assert!(db.user.get_by_email(&email).await.unwrap().is_none());
        crate::connectors::user::cleanup_identity_test_database(&db, &schema).await;
    }
    fn signed_resource_token(subject: &str, resource: &str) -> String {
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        header.typ = Some("at+jwt".into());
        header.kid = Some("public-test-only".into());
        jsonwebtoken::encode(
            &header,
            &serde_json::json!({
                "sub":subject,"iss":"https://issuer.example.invalid",
                // Eri openid access tokens also target UserInfo; that extra audience
                // must never substitute for the configured route's resource.
                "aud":["https://issuer.example.invalid/userinfo",resource],
                "exp":chrono::Utc::now().timestamp()+120
            }),
            &jsonwebtoken::EncodingKey::from_rsa_pem(include_bytes!(
                "fixtures/PUBLIC-TEST-ONLY-active-private.pem"
            ))
            .unwrap(),
        )
        .unwrap()
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
                crate::modules::mcp::mcp_routes()
                    .route_layer(axum::middleware::from_fn_with_state(mcp.clone(), auth)),
            )
            .layer(Extension(db.clone()))
            .layer(Extension(crate::modules::sync::hub::SyncHub::default()));
        let api_token = signed_resource_token(subject, api.resource().unwrap());
        let mcp_token = signed_resource_token(subject, mcp.resource().unwrap());
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
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#
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
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "persisted associations must not call UserInfo"
        );
        for (path, method, config) in [("/me", "GET", &api), ("/mcp", "POST", &mcp)] {
            let token = signed_resource_token("unknown-profile", config.resource().unwrap());
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
