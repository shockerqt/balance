use axum::{
    Router,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
};

/// Session revocation belongs to Keycloak. This endpoint only clears a legacy
/// browser cookie during the transition from the former in-process OAuth flow.
pub fn auth_routes() -> Router {
    Router::new().route("/logout", post(logout))
}

async fn logout() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::SET_COOKIE,
        "token=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0"
            .parse()
            .expect("valid cookie header"),
    );
    (headers, StatusCode::NO_CONTENT)
}
