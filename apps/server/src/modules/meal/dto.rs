use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::connectors::meal::Meal;

#[derive(Deserialize)]
pub struct CreateMealDto {
    pub meal_type: String,
    pub eaten_at: NaiveDateTime,
}

#[derive(Deserialize)]
pub struct UpdateMealDto {
    pub id: i32,
    pub meal_type: String,
    pub eaten_at: NaiveDateTime,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MealDto {
    pub id: i32,
    pub user_id: i32,
    pub meal_type: String,
    pub eaten_at: NaiveDateTime,
}

#[derive(Serialize, sqlx::FromRow)]
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
