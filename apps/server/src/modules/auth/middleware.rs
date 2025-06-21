use axum::{
    extract::Request,
    http::{self, StatusCode},
    middleware::Next,
    response::Response,
};

use super::jwt::Claims;

#[derive(Clone)]
pub struct CurrentUser {
    pub id: i32,
    pub email: String,
}

pub async fn auth(mut req: Request, next: Next) -> Result<Response, StatusCode> {
    println!("AUTH MIDDLEWRAE INIT");
    let token_cookie = req
        .headers()
        .get(http::header::COOKIE)
        .and_then(|header| header.to_str().ok())
        .and_then(|cookie_header| {
            cookie_header.split(';').find_map(|cookie| {
                let mut parts = cookie.trim().splitn(2, '=');
                match (parts.next(), parts.next()) {
                    (Some("token"), Some(value)) => Some(value),
                    _ => None,
                }
            })
        });

    let auth_token = if let Some(token) = token_cookie {
        token
    } else {
        return Err(StatusCode::UNAUTHORIZED);
    };

    if let Some(current_user) = authorize_current_user(auth_token).await {
        // insert the current user into a request extension so the handler can
        // extract it
        req.extensions_mut().insert(current_user);
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn authorize_current_user(auth_token: &str) -> Option<CurrentUser> {
    let token_data = Claims::decode_jwt(auth_token).ok()?;
    let claims = token_data.claims;

    Some(CurrentUser {
        id: claims.user_id,
        email: claims.email,
    })
}
