use std::sync::Arc;

use axum::extract::{Path, Query};
use axum::http::StatusCode;
use axum::{Extension, Json};

use crate::connectors::meal::{NewMeal, UpdateMeal};
use crate::shared::response::{ApiResponse, ApiResult, ApiResultWithCode};
use crate::{connectors::db::Database, modules::auth::middleware::CurrentUser};

use super::dto::{
    CompareSummaryQuery, CreateMealDto, CreateMealFoodDto, DailySummaryDto, DailySummaryQuery,
    DaySummaryItemDto, GetMealsResponse, MealDetailDto, MealDto, UpdateMealDto, UpdateMealFoodDto,
};

#[utoipa::path(
    get,
    path = "/meals",
    tag = "meal",
    responses(
        (status = 200, description = "List of meals", body = ApiResponse<GetMealsResponse>)
    ),
    security(("cookieAuth" = []))
)]
pub async fn get_meals(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
) -> ApiResult<GetMealsResponse> {
    let rows = db.meal.get_all(current_user.id).await?;
    let dtos: Vec<MealDto> = rows.into_iter().map(MealDto::from).collect();
    let response = GetMealsResponse { meals: dtos };
    Ok(Json(ApiResponse::success(response)))
}

#[utoipa::path(
    get,
    path = "/meals/{id}",
    tag = "meal",
    params(("id" = i32, Path, description = "Meal ID")),
    responses(
        (status = 200, description = "Meal details with calculated macros", body = ApiResponse<MealDetailDto>)
    ),
    security(("cookieAuth" = []))
)]
pub async fn get_meal_by_id(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Path(id): Path<i32>,
) -> ApiResult<MealDetailDto> {
    let detail = db.meal.get_by_id(current_user.id, id).await?;
    Ok(Json(ApiResponse::success(detail)))
}

#[utoipa::path(
    post,
    path = "/meals/create",
    tag = "meal",
    request_body = CreateMealDto,
    responses(
        (status = 201, description = "Meal created", body = ApiResponse<MealDto>)
    ),
    security(("cookieAuth" = []))
)]
pub async fn create_meal(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(dto): Json<CreateMealDto>,
) -> ApiResultWithCode<MealDto> {
    let user_id = current_user.id;
    let new_record = NewMeal::from_dto(dto, user_id)?;
    let row = db.meal.create(&new_record).await?;
    let response_dto = MealDto::from(row);

    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::success(response_dto)),
    ))
}

#[utoipa::path(
    post,
    path = "/meals/update",
    tag = "meal",
    request_body = UpdateMealDto,
    responses(
        (status = 200, description = "Meal updated", body = ApiResponse<MealDto>)
    ),
    security(("cookieAuth" = []))
)]
pub async fn update_meal(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(dto): Json<UpdateMealDto>,
) -> ApiResult<MealDto> {
    let user_id = current_user.id;
    let update_record = UpdateMeal::from_dto(dto, user_id)?;
    let row = db.meal.update(&update_record).await?;
    let response_dto = MealDto::from(row);
    Ok(Json(ApiResponse::success(response_dto)))
}

#[utoipa::path(
    delete,
    path = "/meals/{id}",
    tag = "meal",
    params(("id" = i32, Path, description = "Meal ID")),
    responses(
        (status = 200, description = "Meal deleted")
    ),
    security(("cookieAuth" = []))
)]
pub async fn delete_meal(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Path(id): Path<i32>,
) -> ApiResult<bool> {
    let res = db.meal.delete(current_user.id, id).await?;
    Ok(Json(ApiResponse::success(res)))
}

#[utoipa::path(
    post,
    path = "/meals/{meal_id}/items",
    tag = "meal",
    params(("meal_id" = i32, Path, description = "Meal ID")),
    request_body = CreateMealFoodDto,
    responses(
        (status = 201, description = "Food item added to meal")
    ),
    security(("cookieAuth" = []))
)]
pub async fn add_meal_food(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Path(meal_id): Path<i32>,
    Json(dto): Json<CreateMealFoodDto>,
) -> ApiResultWithCode<bool> {
    let res = db.meal.add_item(current_user.id, meal_id, dto).await?;
    Ok((StatusCode::CREATED, Json(ApiResponse::success(res))))
}

#[utoipa::path(
    put,
    path = "/meals/{meal_id}/items/{item_id}",
    tag = "meal",
    params(
        ("meal_id" = i32, Path, description = "Meal ID"),
        ("item_id" = i32, Path, description = "Item ID")
    ),
    request_body = UpdateMealFoodDto,
    responses(
        (status = 200, description = "Food item updated")
    ),
    security(("cookieAuth" = []))
)]
pub async fn update_meal_food(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Path((meal_id, item_id)): Path<(i32, i32)>,
    Json(dto): Json<UpdateMealFoodDto>,
) -> ApiResult<bool> {
    let res = db
        .meal
        .update_item(current_user.id, meal_id, item_id, dto)
        .await?;
    Ok(Json(ApiResponse::success(res)))
}

#[utoipa::path(
    delete,
    path = "/meals/{meal_id}/items/{item_id}",
    tag = "meal",
    params(
        ("meal_id" = i32, Path, description = "Meal ID"),
        ("item_id" = i32, Path, description = "Item ID")
    ),
    responses(
        (status = 200, description = "Food item deleted from meal")
    ),
    security(("cookieAuth" = []))
)]
pub async fn delete_meal_food(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Path((meal_id, item_id)): Path<(i32, i32)>,
) -> ApiResult<bool> {
    let res = db
        .meal
        .delete_item(current_user.id, meal_id, item_id)
        .await?;
    Ok(Json(ApiResponse::success(res)))
}

#[utoipa::path(
    get,
    path = "/meals/daily-summary",
    tag = "meal",
    params(("date" = String, Query, description = "Date YYYY-MM-DD")),
    responses(
        (status = 200, description = "Daily summary", body = ApiResponse<DailySummaryDto>)
    ),
    security(("cookieAuth" = []))
)]
pub async fn get_daily_summary(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Query(query): Query<DailySummaryQuery>,
) -> ApiResult<DailySummaryDto> {
    let summary = db
        .meal
        .get_daily_summary(current_user.id, &query.date)
        .await?;
    Ok(Json(ApiResponse::success(summary)))
}

#[utoipa::path(
    get,
    path = "/meals/compare-summary",
    tag = "meal",
    params(
        ("start_date" = String, Query, description = "Start date YYYY-MM-DD"),
        ("end_date" = String, Query, description = "End date YYYY-MM-DD")
    ),
    responses(
        (status = 200, description = "Compare summary across range", body = ApiResponse<Vec<DaySummaryItemDto>>)
    ),
    security(("cookieAuth" = []))
)]
pub async fn compare_summary(
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Query(query): Query<CompareSummaryQuery>,
) -> ApiResult<Vec<DaySummaryItemDto>> {
    let summary = db
        .meal
        .compare_summary(current_user.id, &query.start_date, &query.end_date)
        .await?;
    Ok(Json(ApiResponse::success(summary)))
}
