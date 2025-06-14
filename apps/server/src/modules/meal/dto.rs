use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct CreateMealDto {
    pub user_id: i32,
    pub name: Option<String>,
    pub eaten_at: NaiveDateTime,
}

#[derive(Deserialize)]
pub struct UpdateMealDto {
    pub id: i32,
    pub name: Option<String>,
    pub eaten_at: NaiveDateTime,
}

#[derive(Serialize)]
pub struct MealResponse {
    pub id: i32,
    pub user_id: i32,
    pub name: Option<String>,
    pub eaten_at: NaiveDateTime,
    pub created_at: Option<NaiveDateTime>,
}
