use chrono::NaiveDateTime;
use sqlx::FromRow;

#[derive(FromRow, Debug, Clone)]
pub struct Meal {
    pub id: i32,
    pub user_id: i32,
    pub name: Option<String>,
    pub eaten_at: NaiveDateTime,
    pub created_at: Option<NaiveDateTime>,
}
