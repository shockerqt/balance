use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use axum_extra::extract::CookieJar;

use super::jwt::Claims;

#[derive(Clone)]
pub struct CurrentUser {
    pub id: i32,
    pub email: String,
}

pub async fn auth(
    jar: CookieJar,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let token = jar
        .get("token")
        .map(|c| c.value().to_string())
        .or_else(|| {
            req.headers()
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|h| h.to_str().ok())
                .and_then(|h| h.strip_prefix("Bearer "))
                .map(|s| s.to_string())
        })
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token_data = Claims::decode_jwt(&token).map_err(|_| StatusCode::UNAUTHORIZED)?;

    req.extensions_mut().insert(CurrentUser {
        id: token_data.claims.user_id,
        email: token_data.claims.email,
    });

    Ok(next.run(req).await)
}
