use crate::{
    connectors::{db::Database, user::NewUser},
    modules::auth::oidc::OidcConfig,
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
    pub email: String,
}

pub struct AuthError(StatusCode);

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let mut headers = HeaderMap::new();
        if self.0 == StatusCode::UNAUTHORIZED {
            headers.insert(
                axum::http::header::WWW_AUTHENTICATE,
                HeaderValue::from_static(
                    "Bearer resource_metadata=\"https://balance.shocker.cl/api/.well-known/oauth-protected-resource/mcp\"",
                ),
            );
        }
        (self.0, headers).into_response()
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
        .ok_or(AuthError(StatusCode::UNAUTHORIZED))?;

    let claims = oidc.verify(token).await.map_err(|error| {
        tracing::warn!(?error, "OIDC access token rejected");
        AuthError(StatusCode::UNAUTHORIZED)
    })?;
    let user = match db.user.get_by_email(&claims.email).await {
        Ok(Some(user)) => user,
        Ok(None) => db
            .user
            .create(&NewUser {
                email: claims.email.clone(),
                name: claims.name.clone(),
                family_name: claims.family_name.clone(),
                given_name: claims.given_name.clone(),
                picture: claims.picture.clone(),
            })
            .await
            .map_err(|error| {
                tracing::error!(?error, "creating OIDC user");
                AuthError(StatusCode::INTERNAL_SERVER_ERROR)
            })?,
        Err(error) => {
            tracing::error!(?error, "finding OIDC user");
            return Err(AuthError(StatusCode::INTERNAL_SERVER_ERROR));
        }
    };

    req.extensions_mut().insert(CurrentUser {
        id: user.id,
        email: user.email,
    });

    Ok(next.run(req).await)
}
