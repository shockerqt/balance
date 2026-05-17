use axum::{
    Extension, Router,
    extract::{Query, State},
    http::{HeaderMap, Response, StatusCode},
    response::{IntoResponse, Redirect},
    routing::get,
};
use oauth2::{
    AuthorizationCode, CsrfToken, PkceCodeChallenge, PkceCodeVerifier, Scope, TokenResponse,
    reqwest,
};
use reqwest::header::SET_COOKIE;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::{
    connectors::{
        db::Database,
        user::{NewUser, UpdateUser},
    },
    modules::auth::jwt::create_jwt_for_user,
};

use super::routes::GoogleOAuthClient;

#[derive(Clone)]
pub struct OAuthState {
    pub client: GoogleOAuthClient,
    /// Keyed by the CSRF state secret. One entry per in-flight OAuth flow.
    pub pending: Arc<Mutex<HashMap<String, PkceCodeVerifier>>>,
}

pub fn google_routes(state: OAuthState) -> Router {
    Router::new()
        .route("/logout", get(logout))
        .route("/google", get(login_with_google))
        .route("/google/callback", get(google_callback))
        .with_state(Arc::new(state))
}

// GET /auth/google
async fn login_with_google(State(state): State<Arc<OAuthState>>) -> impl IntoResponse {
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (auth_url, csrf_token) = state
        .client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("email".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    state
        .pending
        .lock()
        .unwrap()
        .insert(csrf_token.secret().clone(), pkce_verifier);

    Redirect::temporary(auth_url.as_ref())
}

// GET /auth/logout
async fn logout() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        "token=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0"
            .parse()
            .unwrap(),
    );
    (headers, StatusCode::NO_CONTENT)
}

// GET /auth/google/callback?code=...&state=...
#[derive(Debug, Deserialize)]
struct AuthRequest {
    code: String,
    state: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GoogleUserInfo {
    pub email: String,
    pub email_verified: bool,
    pub family_name: String,
    pub given_name: String,
    pub name: String,
    pub picture: String,
    pub sub: String,
}

type CallbackError = (StatusCode, &'static str);

async fn google_callback(
    Extension(db): Extension<Arc<Database>>,
    State(state): State<Arc<OAuthState>>,
    Query(query): Query<AuthRequest>,
) -> Result<impl IntoResponse, CallbackError> {
    // CSRF + race condition: look up verifier by the received state secret.
    // If it's not in the map, the state was forged or already consumed.
    let pkce_verifier = state
        .pending
        .lock()
        .unwrap()
        .remove(&query.state)
        .ok_or((StatusCode::BAD_REQUEST, "invalid or expired oauth state"))?;

    let http_client = reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "failed to build http client"))?;

    let token_result = state
        .client
        .exchange_code(AuthorizationCode::new(query.code))
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http_client)
        .await
        .map_err(|e| {
            tracing::error!(?e, "token exchange failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "login failed")
        })?;

    let access_token = token_result.access_token().secret();

    let user_info = http_client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(?e, "failed to fetch user info");
            (StatusCode::INTERNAL_SERVER_ERROR, "login failed")
        })?
        .json::<GoogleUserInfo>()
        .await
        .map_err(|e| {
            tracing::error!(?e, "failed to deserialize user info");
            (StatusCode::INTERNAL_SERVER_ERROR, "login failed")
        })?;

    let (user_id, email) = if let Some(existing_user) = db
        .user
        .get_by_email(user_info.email.as_str())
        .await
        .map_err(|e| {
            tracing::error!(?e, "db error looking up user");
            (StatusCode::INTERNAL_SERVER_ERROR, "login failed")
        })? {
        let needs_update = existing_user.name.as_deref() != Some(&user_info.name)
            || existing_user.given_name.as_deref() != Some(&user_info.given_name)
            || existing_user.family_name.as_deref() != Some(&user_info.family_name)
            || existing_user.picture.as_deref() != Some(&user_info.picture);

        if needs_update {
            let updated_user = UpdateUser {
                name: Some(user_info.name.clone()),
                given_name: Some(user_info.given_name.clone()),
                family_name: Some(user_info.family_name.clone()),
                picture: Some(user_info.picture.clone()),
            };
            db.user
                .update(existing_user.id, &updated_user)
                .await
                .map_err(|e| {
                    tracing::error!(?e, "db error updating user");
                    (StatusCode::INTERNAL_SERVER_ERROR, "login failed")
                })?;
        }
        (existing_user.id, existing_user.email)
    } else {
        let new_user = NewUser {
            email: user_info.email.clone(),
            name: Some(user_info.name.clone()),
            given_name: Some(user_info.given_name.clone()),
            family_name: Some(user_info.family_name.clone()),
            picture: Some(user_info.picture.clone()),
        };
        let user = db.user.create(&new_user).await.map_err(|e| {
            tracing::error!(?e, "db error creating user");
            (StatusCode::INTERNAL_SERVER_ERROR, "login failed")
        })?;
        (user.id, user.email)
    };

    let jwt = create_jwt_for_user(user_id, email).map_err(|e| {
        tracing::error!(?e, "failed to create jwt");
        (StatusCode::INTERNAL_SERVER_ERROR, "login failed")
    })?;

    let redirect_url = std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:3000/".to_string());
    let cookie = format!(
        "token={}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age={}",
        jwt,
        60 * 60 * 24 * 7
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        cookie.parse().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "login failed"))?,
    );

    let response = Redirect::to(&redirect_url).into_response();
    let (mut parts, body) = response.into_parts();
    parts.headers.extend(headers);

    Ok(Response::from_parts(parts, body))
}
