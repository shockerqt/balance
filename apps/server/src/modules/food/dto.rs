use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::types::BigDecimal;

use crate::connectors::food::{Food, ServingUnitType};

#[derive(Deserialize)]
pub struct CreateFoodDto {
    pub name: String,
    pub calories: i32,
    pub fat: BigDecimal,
    pub proteins: BigDecimal,
    pub carbs: BigDecimal,
    pub saturated_fat: Option<BigDecimal>,
    pub monounsaturated_fat: Option<BigDecimal>,
    pub polyunsaturated_fat: Option<BigDecimal>,
    pub trans_fat: Option<BigDecimal>,
    pub fiber: Option<BigDecimal>,
    pub sugars: Option<BigDecimal>,
    pub sodium: Option<i32>,
    pub cholesterol: Option<i32>,
    pub serving_name: String,
    pub serving_quantity: BigDecimal,
    pub serving_unit_type: ServingUnitType,
}

#[derive(Deserialize)]
pub struct UpdateFoodDto {
    pub id: i32,
    pub name: String,
    pub calories: i32,
    pub fat: BigDecimal,
    pub proteins: BigDecimal,
    pub carbs: BigDecimal,
    pub saturated_fat: Option<BigDecimal>,
    pub monounsaturated_fat: Option<BigDecimal>,
    pub polyunsaturated_fat: Option<BigDecimal>,
    pub trans_fat: Option<BigDecimal>,
    pub fiber: Option<BigDecimal>,
    pub sugars: Option<BigDecimal>,
    pub sodium: Option<i32>,
    pub cholesterol: Option<i32>,
    pub serving_name: String,
    pub serving_quantity: BigDecimal,
    pub serving_unit_type: ServingUnitType,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct GetFoodsDto {
    pub foods: Vec<FoodDto>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FoodDto {
    pub id: i32,
    pub name: String,
    pub calories: i32,
    pub fat: BigDecimal,
    pub proteins: BigDecimal,
    pub carbs: BigDecimal,
    pub saturated_fat: Option<BigDecimal>,
    pub monounsaturated_fat: Option<BigDecimal>,
    pub polyunsaturated_fat: Option<BigDecimal>,
    pub trans_fat: Option<BigDecimal>,
    pub fiber: Option<BigDecimal>,
    pub sugars: Option<BigDecimal>,
    pub sodium: Option<i32>,
    pub cholesterol: Option<i32>,
    pub serving_name: String,
    pub serving_quantity: BigDecimal,
    pub serving_unit_type: ServingUnitType,
    pub created_by: i32,
    pub is_verified: bool,
    pub created_at: Option<NaiveDateTime>,
}

#[derive(Serialize)]
pub struct FoodResponse {
    pub food: FoodDto,
}

#[derive(Serialize)]
pub struct FoodListResponse {
    pub foods: Vec<FoodDto>,
}

impl From<Food> for FoodDto {
    fn from(food: Food) -> Self {
        FoodDto {
            id: food.id,
            name: food.name,
            calories: food.calories,
            fat: food.fat,
            proteins: food.proteins,
            carbs: food.carbs,
            saturated_fat: food.saturated_fat,
            monounsaturated_fat: food.monounsaturated_fat,
            polyunsaturated_fat: food.polyunsaturated_fat,
            trans_fat: food.trans_fat,
            fiber: food.fiber,
            sugars: food.sugars,
            sodium: food.sodium,
            cholesterol: food.cholesterol,
            serving_name: food.serving_name,
            serving_quantity: food.serving_quantity,
            serving_unit_type: food.serving_unit_type,
            created_by: food.created_by,
            is_verified: food.is_verified,
            created_at: Some(food.created_at),
        }
    }
}
