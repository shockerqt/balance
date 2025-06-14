use std::sync::Arc;

use axum::{http::StatusCode, Extension, Json};

use crate::connectors::db::Database;
use crate::shared::response::ApiResponse;

use super::dto::{CreateMealDto, MealResponse, UpdateMealDto};
use super::model::Meal;

pub async fn get_meals(
    Extension(db): Extension<Arc<Database>>,
) -> Result<Json<ApiResponse<Vec<MealResponse>>>, StatusCode> {
    let meals = sqlx::query_as!(
        MealResponse,
        r#"
        SELECT id, user_id, name, eaten_at, created_at
        FROM meals
        "#
    )
    .fetch_all(&db.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse { data: meals }))
}

pub async fn create_meal(
    Extension(db): Extension<Arc<Database>>,
    Json(payload): Json<CreateMealDto>,
) -> Result<Json<ApiResponse<MealResponse>>, StatusCode> {
    let row = sqlx::query_as!(
        Meal,
        r#"
        INSERT INTO meals (user_id, name, eaten_at)
        VALUES ($1, $2, $3)
        RETURNING id, user_id, name, eaten_at, created_at
        "#,
        payload.user_id,
        payload.name,
        payload.eaten_at
    )
    .fetch_one(&db.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse {
        data: MealResponse {
            id: row.id,
            user_id: row.user_id,
            name: row.name,
            eaten_at: row.eaten_at,
            created_at: row.created_at,
        },
    }))
}
pub async fn update_meal(
    Extension(db): Extension<Arc<Database>>,
    Json(payload): Json<UpdateMealDto>,
) -> Result<Json<ApiResponse<MealResponse>>, StatusCode> {
    let row = sqlx::query_as!(
        Meal,
        r#"
        UPDATE meals
        SET name = $2, eaten_at = $3
        WHERE id = $1
        RETURNING id, user_id, name, eaten_at, created_at
        "#,
        payload.id,
        payload.name,
        payload.eaten_at
    )
    .fetch_one(&db.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse {
        data: MealResponse {
            id: row.id,
            user_id: row.user_id,
            name: row.name,
            eaten_at: row.eaten_at,
            created_at: row.created_at,
        },
    }))
}
