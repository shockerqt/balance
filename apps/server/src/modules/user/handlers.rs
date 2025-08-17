use axum::{Extension, Json, http::StatusCode};
use std::sync::Arc;

use crate::modules::user::dto::UserDto;
use crate::shared::response::{ApiResponse, ApiResult};
use crate::{connectors::db::Database, modules::auth::middleware::CurrentUser};

/// Gets information about the authenticated user.
///
/// Requires authentication via cookie.
///
/// # Responses
/// - 200: Returns the authenticated user's data as a [`UserDto`].
///
/// # Security
/// Requires the `cookieAuth` authentication scheme.
#[utoipa::path(
    get,
    path = "/me",
    tag = "user",
    responses(
        (status = 200, description = "Authenticated user data", body = ApiResponse<UserDto>)
    ),
    security(
        ("cookieAuth" = [])
    )
)]
pub async fn get_me(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
) -> ApiResult<UserDto> {
    let user = db.user.get(current_user.id).await.unwrap();
    let user_dto = UserDto {
        id: user.id,
        email: user.email,
        name: user.name,
        family_name: user.family_name,
        given_name: user.given_name,
        picture: user.picture,
        created_at: user.created_at,
    };

    Ok(Json(ApiResponse::success(user_dto)))
}
