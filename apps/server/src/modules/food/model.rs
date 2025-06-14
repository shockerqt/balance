use bigdecimal::BigDecimal;
use chrono::NaiveDateTime;
use sqlx::FromRow;

#[derive(FromRow, Debug, Clone)]
pub struct Food {
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
