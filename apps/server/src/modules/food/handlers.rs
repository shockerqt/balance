use std::sync::Arc;

use axum::{http::StatusCode, Extension, Json};

use crate::connectors::db::Database;
use crate::shared::response::ApiResponse;

use super::dto::{CreateFoodDto, FoodResponse, UpdateFoodDto};

pub async fn get_foods(
    Extension(db): Extension<Arc<Database>>,
) -> Result<Json<ApiResponse<Vec<FoodResponse>>>, StatusCode> {
    let foods = sqlx::query_as!(
        FoodResponse,
        r#"
        SELECT id, name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public, created_at
        FROM foods
        "#
    )
    .fetch_all(&db.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse { data: foods }))
}

pub async fn create_food(
    Extension(db): Extension<Arc<Database>>,
    Json(payload): Json<CreateFoodDto>,
) -> Result<Json<ApiResponse<FoodResponse>>, StatusCode> {
    let row = sqlx::query_as!(
        FoodResponse,
        r#"
        INSERT INTO foods (name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public, created_at
        "#,
        payload.name,
        payload.calories,
        payload.protein,
        payload.carbs,
        payload.fat,
        payload.sodium,
        payload.cholesterol,
        payload.user_id,
        payload.is_public.unwrap_or(true)
    )
    .fetch_one(&db.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse { data: row }))
}

pub async fn update_food(
    Extension(db): Extension<Arc<Database>>,
    Json(payload): Json<UpdateFoodDto>,
) -> Result<Json<ApiResponse<FoodResponse>>, StatusCode> {
    let row = sqlx::query_as!(
        FoodResponse,
        r#"
        UPDATE foods
        SET name = $2, calories = $3, protein = $4, carbs = $5, fat = $6, sodium = $7, cholesterol = $8, user_id = $9, is_public = COALESCE($10, is_public)
        WHERE id = $1
        RETURNING id, name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public, created_at
        "#,
        payload.id,
        payload.name,
        payload.calories,
        payload.protein,
        payload.carbs,
        payload.fat,
        payload.sodium,
        payload.cholesterol,
        payload.user_id,
        payload.is_public
    )
    .fetch_one(&db.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse { data: row }))
}
