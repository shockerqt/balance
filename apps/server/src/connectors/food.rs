use bigdecimal::BigDecimal;
use chrono::NaiveDateTime;
use sqlx::FromRow;
use sqlx::PgPool;

use crate::modules::food::dto::CreateFoodDto;
use crate::modules::food::dto::UpdateFoodDto;
use crate::shared::error::AppError;
use crate::shared::validate::Validate;

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

#[derive(Debug, Clone)]
pub struct NewFood {
    pub name: String,
    pub calories: BigDecimal,
    pub protein: BigDecimal,
    pub carbs: BigDecimal,
    pub fat: BigDecimal,
    pub sodium: Option<BigDecimal>,
    pub cholesterol: Option<BigDecimal>,
    pub is_public: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct UpdateFood {
    pub id: i32,
    pub name: String,
    pub calories: BigDecimal,
    pub protein: BigDecimal,
    pub carbs: BigDecimal,
    pub fat: BigDecimal,
    pub sodium: Option<BigDecimal>,
    pub cholesterol: Option<BigDecimal>,
}

#[derive(Clone)]
pub struct FoodDatasource {
    pub pool: PgPool,
}

impl FoodDatasource {
    pub async fn get_all(&self, user_id: Option<i32>) -> Result<Vec<Food>, sqlx::Error> {
        let foods = if let Some(uid) = user_id {
            sqlx::query_as!(
                Food,
                r#"
                SELECT id, name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public, created_at
                FROM foods
                WHERE user_id = $1 OR is_public = true
                ORDER BY id
                "#,
                uid
            )
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as!(
                Food,
                r#"
                SELECT id, name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public, created_at
                FROM foods
                WHERE is_public = true
                ORDER BY id
                "#
            )
            .fetch_all(&self.pool)
            .await?
        };
        Ok(foods)
    }

    pub async fn create(&self, user_id: &i32, food: &NewFood) -> Result<Food, sqlx::Error> {
        let rec = sqlx::query_as!(
            Food,
            r#"
            INSERT INTO foods (name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public, created_at
            "#,
            food.name,
            &food.calories,
            &food.protein,
            &food.carbs,
            &food.fat,
            food.sodium.as_ref(),
            food.cholesterol.as_ref(),
            user_id,
            food.is_public
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(rec)
    }

    pub async fn update(&self, user_id: &i32, food: &UpdateFood) -> Result<Food, sqlx::Error> {
        let rec = sqlx::query_as!(
            Food,
            r#"
            UPDATE foods
            SET name = $1,
                calories = $2,
                protein = $3,
                carbs = $4,
                fat = $5,
                sodium = $6,
                cholesterol = $7
            WHERE id = $8
            AND user_id = $9
            RETURNING id, name, calories, protein, carbs, fat, sodium, cholesterol, user_id, is_public, created_at
            "#,
            food.name,
            &food.calories,
            &food.protein,
            &food.carbs,
            &food.fat,
            food.sodium.as_ref(),
            food.cholesterol.as_ref(),
            food.id,
            user_id,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(rec)
    }
}

impl Validate for NewFood {
    fn validate(&self) -> Result<(), AppError> {
        if self.name.trim().is_empty() {
            return Err(AppError::BadRequest("Name cannot be empty".into()));
        }

        if self.calories < 0.into() {
            return Err(AppError::BadRequest("Calories must be non-negative".into()));
        }

        if self.protein < 0.into() {
            return Err(AppError::BadRequest("Protein must be non-negative".into()));
        }

        if self.carbs < 0.into() {
            return Err(AppError::BadRequest("Carbs must be non-negative".into()));
        }

        if self.fat < 0.into() {
            return Err(AppError::BadRequest("Fat must be non-negative".into()));
        }

        if let Some(sodium) = &self.sodium {
            if *sodium < 0.into() {
                return Err(AppError::BadRequest("Sodium must be non-negative".into()));
            }
        }

        if let Some(cholesterol) = &self.cholesterol {
            if *cholesterol < 0.into() {
                return Err(AppError::BadRequest(
                    "Cholesterol must be non-negative".into(),
                ));
            }
        }

        Ok(())
    }
}

impl Validate for UpdateFood {
    fn validate(&self) -> Result<(), AppError> {
        if self.id <= 0 {
            return Err(AppError::BadRequest("Invalid food ID".into()));
        }

        if self.name.trim().is_empty() {
            return Err(AppError::BadRequest("Name cannot be empty".into()));
        }

        if self.calories < 0.into() {
            return Err(AppError::BadRequest("Calories must be non-negative".into()));
        }

        if self.protein < 0.into() {
            return Err(AppError::BadRequest("Protein must be non-negative".into()));
        }

        if self.carbs < 0.into() {
            return Err(AppError::BadRequest("Carbs must be non-negative".into()));
        }

        if self.fat < 0.into() {
            return Err(AppError::BadRequest("Fat must be non-negative".into()));
        }

        if let Some(sodium) = &self.sodium {
            if *sodium < 0.into() {
                return Err(AppError::BadRequest("Sodium must be non-negative".into()));
            }
        }

        if let Some(cholesterol) = &self.cholesterol {
            if *cholesterol < 0.into() {
                return Err(AppError::BadRequest(
                    "Cholesterol must be non-negative".into(),
                ));
            }
        }

        Ok(())
    }
}

impl TryFrom<CreateFoodDto> for NewFood {
    type Error = AppError;

    fn try_from(dto: CreateFoodDto) -> Result<Self, Self::Error> {
        let food = NewFood {
            name: dto.name,
            calories: dto.calories,
            protein: dto.protein,
            carbs: dto.carbs,
            fat: dto.fat,
            sodium: dto.sodium,
            cholesterol: dto.cholesterol,
            is_public: Some(false),
        };
        food.validate()?;
        Ok(food)
    }
}

impl TryFrom<UpdateFoodDto> for UpdateFood {
    type Error = AppError;

    fn try_from(dto: UpdateFoodDto) -> Result<Self, Self::Error> {
        let food = UpdateFood {
            id: dto.id,
            name: dto.name,
            calories: dto.calories,
            protein: dto.protein,
            carbs: dto.carbs,
            fat: dto.fat,
            sodium: dto.sodium,
            cholesterol: dto.cholesterol,
        };
        food.validate()?;
        Ok(food)
    }
}
