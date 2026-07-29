use bigdecimal::ToPrimitive;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::connectors::meal::Meal;
use crate::shared::error::AppError;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MealType {
    Breakfast,
    Lunch,
    Dinner,
    Snack,
}

impl MealType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Breakfast => "breakfast",
            Self::Lunch => "lunch",
            Self::Dinner => "dinner",
            Self::Snack => "snack",
        }
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateMealDto {
    pub meal_type: MealType,
    pub eaten_at: NaiveDateTime,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMealDto {
    pub id: i32,
    pub meal_type: MealType,
    pub eaten_at: NaiveDateTime,
}

#[derive(Serialize, sqlx::FromRow, ToSchema, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MealDto {
    pub id: i32,
    pub user_id: i32,
    pub meal_type: String,
    pub eaten_at: NaiveDateTime,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetMealsResponse {
    pub meals: Vec<MealDto>,
}

impl From<Meal> for MealDto {
    fn from(meal: Meal) -> Self {
        MealDto {
            id: meal.id,
            user_id: meal.user_id,
            meal_type: meal.meal_type,
            eaten_at: meal.eaten_at,
        }
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateMealFoodDto {
    pub food_version_id: i32,
    pub serving_name: String,
    pub serving_quantity: f64,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMealFoodDto {
    pub serving_name: Option<String>,
    pub serving_quantity: Option<f64>,
}

#[derive(Serialize, ToSchema, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MealFoodDto {
    pub id: i32,
    pub meal_id: i32,
    pub food_version_id: i32,
    pub food_name: String,
    pub serving_name: String,
    pub serving_quantity: f64,
    pub calories: i32,
    pub protein: f64,
    pub carbs: f64,
    pub fat: f64,
    pub fiber: Option<f64>,
    pub sodium: Option<i32>,
    pub cholesterol: Option<i32>,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MealDetailDto {
    pub id: i32,
    pub user_id: i32,
    pub meal_type: String,
    pub eaten_at: NaiveDateTime,
    pub total_calories: i32,
    pub total_protein: f64,
    pub total_carbs: f64,
    pub total_fat: f64,
    pub total_fiber: f64,
    pub items: Vec<MealFoodDto>,
}

#[derive(Deserialize, ToSchema)]
pub struct DailySummaryQuery {
    pub date: String, // YYYY-MM-DD
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DailySummaryDto {
    pub user_id: i32,
    pub date: String,
    pub total_calories: i32,
    pub total_protein: f64,
    pub total_carbs: f64,
    pub total_fat: f64,
    pub total_fiber: f64,
    pub meals: Vec<MealDetailDto>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompareSummaryQuery {
    pub start_date: String,
    pub end_date: String,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DaySummaryItemDto {
    pub date: String,
    pub total_calories: i32,
    pub total_protein: f64,
    pub total_carbs: f64,
    pub total_fat: f64,
    pub total_fiber: f64,
}

pub fn bd_to_f64(value: &bigdecimal::BigDecimal, field: &'static str) -> Result<f64, AppError> {
    value
        .to_f64()
        .ok_or_else(|| AppError::Internal(format!("failed to convert {field} to f64")))
}
