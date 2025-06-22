use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::types::BigDecimal;

use crate::connectors::food::Food;

#[derive(Deserialize)]
pub struct CreateFoodDto {
    pub name: String,
    pub calories: BigDecimal,
    pub protein: BigDecimal,
    pub carbs: BigDecimal,
    pub fat: BigDecimal,
    pub sodium: Option<BigDecimal>,
    pub cholesterol: Option<BigDecimal>,
}

#[derive(Deserialize)]
pub struct UpdateFoodDto {
    pub id: i32,
    pub name: String,
    pub calories: BigDecimal,
    pub protein: BigDecimal,
    pub carbs: BigDecimal,
    pub fat: BigDecimal,
    pub sodium: Option<BigDecimal>,
    pub cholesterol: Option<BigDecimal>,
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
    pub calories: BigDecimal,
    pub protein: BigDecimal,
    pub carbs: BigDecimal,
    pub fat: BigDecimal,
    pub sodium: Option<BigDecimal>,
    pub cholesterol: Option<BigDecimal>,
    pub user_id: Option<i32>,
    pub is_public: Option<bool>,
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
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            sodium: food.sodium,
            cholesterol: food.cholesterol,
            user_id: food.user_id,
            is_public: food.is_public,
            created_at: food.created_at,
        }
    }
}
