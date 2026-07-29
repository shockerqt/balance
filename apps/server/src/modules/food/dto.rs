use bigdecimal::ToPrimitive;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::connectors::food::{Food, ServingUnitType};
use crate::shared::error::AppError;

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SearchFoodQuery {
    pub q: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateFoodDto {
    pub name: String,
    pub calories: i32,
    pub fat: f64,
    pub proteins: f64,
    pub carbs: f64,
    pub saturated_fat: Option<f64>,
    pub monounsaturated_fat: Option<f64>,
    pub polyunsaturated_fat: Option<f64>,
    pub trans_fat: Option<f64>,
    pub fiber: Option<f64>,
    pub sugars: Option<f64>,
    pub sodium: Option<i32>,
    pub cholesterol: Option<i32>,
    pub serving_name: String,
    pub serving_quantity: f64,
    pub serving_unit_type: ServingUnitType,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFoodDto {
    pub id: i32,
    #[serde(flatten)]
    pub data: CreateFoodDto,
}

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct GetFoodsResponse {
    pub foods: Vec<FoodDto>,
}

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoodDto {
    pub id: i32,
    pub name: String,
    pub calories: i32,
    pub fat: f64,
    pub proteins: f64,
    pub carbs: f64,
    pub saturated_fat: Option<f64>,
    pub monounsaturated_fat: Option<f64>,
    pub polyunsaturated_fat: Option<f64>,
    pub trans_fat: Option<f64>,
    pub fiber: Option<f64>,
    pub sugars: Option<f64>,
    pub sodium: Option<i32>,
    pub cholesterol: Option<i32>,
    pub serving_name: String,
    pub serving_quantity: f64,
    pub serving_unit_type: ServingUnitType,
    pub created_by: i32,
    pub is_verified: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

fn bd_to_f64(value: &bigdecimal::BigDecimal, field: &'static str) -> Result<f64, AppError> {
    value
        .to_f64()
        .ok_or_else(|| AppError::Internal(format!("failed to convert {field} to f64")))
}

fn bd_opt_to_f64(
    value: Option<bigdecimal::BigDecimal>,
    field: &'static str,
) -> Result<Option<f64>, AppError> {
    value.map(|v| bd_to_f64(&v, field)).transpose()
}

impl TryFrom<Food> for FoodDto {
    type Error = AppError;

    fn try_from(food: Food) -> Result<Self, Self::Error> {
        Ok(FoodDto {
            id: food.id,
            name: food.name,
            calories: food.calories,
            fat: bd_to_f64(&food.fat, "fat")?,
            proteins: bd_to_f64(&food.proteins, "proteins")?,
            carbs: bd_to_f64(&food.carbs, "carbs")?,
            saturated_fat: bd_opt_to_f64(food.saturated_fat, "saturated_fat")?,
            monounsaturated_fat: bd_opt_to_f64(food.monounsaturated_fat, "monounsaturated_fat")?,
            polyunsaturated_fat: bd_opt_to_f64(food.polyunsaturated_fat, "polyunsaturated_fat")?,
            trans_fat: bd_opt_to_f64(food.trans_fat, "trans_fat")?,
            fiber: bd_opt_to_f64(food.fiber, "fiber")?,
            sugars: bd_opt_to_f64(food.sugars, "sugars")?,
            sodium: food.sodium,
            cholesterol: food.cholesterol,
            serving_name: food.serving_name,
            serving_quantity: bd_to_f64(&food.serving_quantity, "serving_quantity")?,
            serving_unit_type: food.serving_unit_type,
            created_by: food.created_by,
            is_verified: food.is_verified,
            created_at: food.created_at,
            updated_at: food.updated_at,
        })
    }
}
