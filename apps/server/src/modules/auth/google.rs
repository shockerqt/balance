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
use sqlx::types::JsonValue;
use std::{
    collections::HashMap,
    hash::Hash,
    sync::{Arc, Mutex},
};

use crate::{
    connectors::{
        db::Database,
        user::{self, NewUser, UpdateUser, User},
    },
    modules::auth::jwt::create_jwt_for_user,
};

use super::routes::GoogleOAuthClient;

#[derive(Clone)]
pub struct OAuthState {
    pub client: GoogleOAuthClient,
    pub verifier: Arc<Mutex<Option<(PkceCodeVerifier, CsrfToken)>>>,
}

pub fn google_routes(state: OAuthState) -> Router {
    Router::new()
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

    *state.verifier.lock().unwrap() = Some((pkce_verifier, csrf_token));

    Redirect::temporary(auth_url.as_ref())
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

async fn google_callback(
    Extension(db): Extension<Arc<Database>>,
    State(state): State<Arc<OAuthState>>,
    Query(query): Query<AuthRequest>,
) -> Result<impl IntoResponse, (StatusCode, &'static str)> {
    let code = AuthorizationCode::new(query.code);

    let (pkce_verifier, _) = state.verifier.lock().unwrap().take().unwrap();

    let http_client = reqwest::ClientBuilder::new()
        // Following redirects opens the client up to SSRF vulnerabilities.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("Client should build");

    let token_result = state
        .client
        .exchange_code(code)
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http_client)
        .await;

    match token_result {
        Ok(token) => {
            println!("Access token: {:?}", token.access_token().secret());
            let token = token.access_token().secret();

            let user_info = http_client
                .get("https://www.googleapis.com/oauth2/v3/userinfo")
                .bearer_auth(token)
                .send()
                .await
                .unwrap()
                .json::<GoogleUserInfo>()
                .await
                .unwrap();

            let user_id = if let Some(existing_user) = db
                .user
                .get_by_email(user_info.email.as_str())
                .await
                .unwrap()
            {
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
                        .unwrap();
                }
                existing_user.id
            } else {
                let new_user = NewUser {
                    email: user_info.email.clone(),
                    name: Some(user_info.name.clone()),
                    given_name: Some(user_info.given_name.clone()),
                    family_name: Some(user_info.family_name.clone()),
                    picture: Some(user_info.picture.clone()),
                };
                let user = db.user.create(&new_user).await.unwrap();
                user.id
            };

            let jwt = create_jwt_for_user(user_id).unwrap();

            let redirect_url = "http://localhost:3000/";
            let cookie = format!(
                "token={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
                jwt,
                60 * 60 * 24 * 7
            );

            let mut headers = HeaderMap::new();
            headers.insert(SET_COOKIE, cookie.parse().unwrap());

            let response = Redirect::to(redirect_url).into_response();
            let (mut parts, body) = response.into_parts();
            parts.headers.extend(headers);

            Ok(Response::from_parts(parts, body))
        }
        Err(err) => {
            eprintln!("Token exchange error: {:?}", err);
            Err((StatusCode::INTERNAL_SERVER_ERROR, "Login failed"))
        }
    }
}
