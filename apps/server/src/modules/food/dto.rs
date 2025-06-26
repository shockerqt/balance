use bigdecimal::ToPrimitive;
use serde::{Deserialize, Serialize};

use crate::connectors::food::{Food, ServingUnitType};

#[derive(Deserialize, utoipa::ToSchema)]
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
pub struct UpdateFoodDto {
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
    pub created_at: Option<String>,
}

impl From<Food> for FoodDto {
    fn from(food: Food) -> Self {
        FoodDto {
            id: food.id,
            name: food.name,
            calories: food.calories,
            fat: food.fat.to_f64().unwrap_or(0.0),
            proteins: food.proteins.to_f64().unwrap_or(0.0),
            carbs: food.carbs.to_f64().unwrap_or(0.0),
            saturated_fat: food.saturated_fat.map(|v| v.to_f64().unwrap_or(0.0)),
            monounsaturated_fat: food.monounsaturated_fat.map(|v| v.to_f64().unwrap_or(0.0)),
            polyunsaturated_fat: food.polyunsaturated_fat.map(|v| v.to_f64().unwrap_or(0.0)),
            trans_fat: food.trans_fat.map(|v| v.to_f64().unwrap_or(0.0)),
            fiber: food.fiber.map(|v| v.to_f64().unwrap_or(0.0)),
            sugars: food.sugars.map(|v| v.to_f64().unwrap_or(0.0)),
            sodium: food.sodium,
            cholesterol: food.cholesterol,
            serving_name: food.serving_name,
            serving_quantity: food.serving_quantity.to_f64().unwrap_or(0.0),
            serving_unit_type: food.serving_unit_type.clone(),
            created_by: food.created_by,
            is_verified: food.is_verified,
            created_at: Some(food.created_at.to_string()),
        }
    }
}
