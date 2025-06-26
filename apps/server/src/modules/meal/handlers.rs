use std::sync::Arc;

use axum::{Extension, Json};

use crate::connectors::meal::{NewMeal, UpdateMeal};
use crate::shared::error::AppError;
use crate::shared::response::ApiResponse;
use crate::{connectors::db::Database, modules::auth::middleware::CurrentUser};

use super::dto::{CreateMealDto, GetMealsResponse, MealDto, UpdateMealDto};

pub async fn get_meals(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
) -> Result<Json<ApiResponse<GetMealsResponse>>, AppError> {
    let rows = db.meal.get_all(current_user.id).await?;

    let dtos: Vec<MealDto> = rows.into_iter().map(MealDto::from).collect();

    let response = ApiResponse {
        data: GetMealsResponse { meals: dtos },
    };

    Ok(Json(response))
}

pub async fn create_meal(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(dto): Json<CreateMealDto>,
) -> Result<Json<ApiResponse<MealDto>>, AppError> {
    let user_id = current_user.id;
    let new_record = NewMeal::from_dto(dto, user_id.clone())?;
    let row = db.meal.create(&new_record).await?;
    let response_dto = MealDto::from(row);
    Ok(Json(ApiResponse { data: response_dto }))
}

pub async fn update_meal(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(dto): Json<UpdateMealDto>,
) -> Result<Json<ApiResponse<MealDto>>, AppError> {
    let user_id = current_user.id;
    let update_record = UpdateMeal::from_dto(dto, user_id.clone())?;
    let row = db.meal.update(&update_record).await?;
    let response_dto = MealDto::from(row);
    Ok(Json(ApiResponse { data: response_dto }))
}
