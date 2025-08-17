use std::sync::Arc;

use axum::http::StatusCode;
use axum::{Extension, Json};

use crate::connectors::food::{NewFood, UpdateFood};
use crate::shared::response::{ApiResponse, ApiResult, ApiResultWithCode};
use crate::{connectors::db::Database, modules::auth::middleware::CurrentUser};

use super::dto::{CreateFoodDto, FoodDto, GetFoodsResponse, UpdateFoodDto};

/// Gets all foods for the authenticated user.
///
/// Requires authentication via cookie.
#[utoipa::path(
    get,
    path = "/foods",
    tag = "food",
    responses(
        (status = 200, description = "List of foods", body = ApiResponse<GetFoodsResponse>)
    ),
    security(
        ("cookieAuth" = [])
    )
)]
pub async fn get_foods(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
) -> ApiResult<GetFoodsResponse> {
    let rows = db.food.get_all(Some(current_user.id)).await?;
    let food_dtos: Vec<FoodDto> = rows.into_iter().map(FoodDto::from).collect();
    let response = GetFoodsResponse { foods: food_dtos };
    Ok(Json(ApiResponse::success(response)))
}

/// Creates a new food for the authenticated user.
///
/// Requires authentication via cookie.
#[utoipa::path(
    post,
    path = "/foods/create",
    tag = "food",
    request_body = CreateFoodDto,
    responses(
        (status = 201, description = "Food created", body = ApiResponse<FoodDto>)
    ),
    security(
        ("cookieAuth" = [])
    )
)]
pub async fn create_food(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(dto): Json<CreateFoodDto>,
) -> ApiResultWithCode<FoodDto> {
    let user_id = current_user.id;
    let new_food = NewFood::from_dto(dto, user_id)?;
    let food_id = db.food.create(&new_food).await?;
    let row = db.food.get_by_id(food_id).await?;

    let food_dto = FoodDto::from(row);

    Ok((StatusCode::CREATED, Json(ApiResponse::success(food_dto))))
}

/// Updates an existing food for the authenticated user.
///
/// Requires authentication via cookie.
#[utoipa::path(
    post,
    path = "/foods/update",
    tag = "food",
    request_body = UpdateFoodDto,
    responses(
        (status = 200, description = "Food updated", body = ApiResponse<FoodDto>)
    ),
    security(
        ("cookieAuth" = [])
    )
)]
pub async fn update_food(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(dto): Json<UpdateFoodDto>,
) -> ApiResult<FoodDto> {
    let user_id = &current_user.id;
    let update_food = UpdateFood::from_dto(dto)?;
    let row = db.food.update(user_id, &update_food).await?;
    let food_dto = FoodDto::from(row);

    Ok(Json(ApiResponse::success(food_dto)))
}
