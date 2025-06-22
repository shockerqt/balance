use std::sync::Arc;

use axum::{Extension, Json};

use crate::connectors::food::{NewFood, UpdateFood};
use crate::shared::error::AppError;
use crate::shared::response::ApiResponse;
use crate::{connectors::db::Database, modules::auth::middleware::CurrentUser};

use super::dto::{CreateFoodDto, FoodDto, GetFoodsDto, UpdateFoodDto};

pub async fn get_foods(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
) -> Result<Json<ApiResponse<GetFoodsDto>>, AppError> {
    let rows = db.food.get_all(Some(current_user.id)).await?;

    let food_dtos: Vec<FoodDto> = rows.into_iter().map(FoodDto::from).collect();

    let response = ApiResponse {
        data: GetFoodsDto { foods: food_dtos },
    };

    Ok(Json(response))
}

pub async fn create_food(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(dto): Json<CreateFoodDto>,
) -> Result<Json<ApiResponse<FoodDto>>, AppError> {
    let user_id = &current_user.id;
    let new_food = NewFood::try_from(dto)?;

    let row = db.food.create(user_id, &new_food).await?;

    let food_dto = FoodDto::from(row);

    Ok(Json(ApiResponse { data: food_dto }))
}

pub async fn update_food(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(dto): Json<UpdateFoodDto>,
) -> Result<Json<ApiResponse<FoodDto>>, AppError> {
    let user_id = &current_user.id;
    let update_food = UpdateFood::try_from(dto)?;

    let row = db.food.update(user_id, &update_food).await?;

    let food_dto = FoodDto::from(row);

    Ok(Json(ApiResponse { data: food_dto }))
}
