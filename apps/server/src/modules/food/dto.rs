use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::types::BigDecimal;

#[derive(Deserialize)]
pub struct CreateFoodDto {
    pub name: String,
    pub calories: BigDecimal,
    pub protein: BigDecimal,
    pub carbs: BigDecimal,
    pub fat: BigDecimal,
    pub sodium: Option<BigDecimal>,
    pub cholesterol: Option<BigDecimal>,
    pub user_id: Option<i32>,
    pub is_public: Option<bool>,
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
    pub user_id: Option<i32>,
    pub is_public: Option<bool>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct FoodResponse {
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
