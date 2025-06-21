use axum::{Extension, Json, http::StatusCode};
use std::sync::Arc;

use crate::modules::user::dto::{GetMeResponse, UserDto};
use crate::shared::response::ApiResponse;
use crate::{connectors::db::Database, modules::auth::middleware::CurrentUser};

pub async fn get_me(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
) -> Result<Json<ApiResponse<GetMeResponse>>, StatusCode> {
    println!("GET ME");
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

    let response = ApiResponse {
        data: GetMeResponse { user: user_dto },
    };

    Ok(Json(response))
}
