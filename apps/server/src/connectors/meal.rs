use chrono::NaiveDateTime;
use sqlx::FromRow;
use sqlx::PgPool;

use crate::modules::meal::dto::CreateMealDto;
use crate::modules::meal::dto::UpdateMealDto;
use crate::shared::error::AppError;
use crate::shared::validate::Validate;

#[derive(FromRow, Debug, Clone)]
pub struct Meal {
    pub id: i32,
    pub user_id: i32,
    pub meal_type: String,
    pub eaten_at: NaiveDateTime,
}

#[derive(Debug, Clone)]
pub struct NewMeal {
    pub user_id: i32,
    pub meal_type: String,
    pub eaten_at: NaiveDateTime,
}

#[derive(Debug, Clone)]
pub struct UpdateMeal {
    pub id: i32,
    pub user_id: i32,
    pub meal_type: String,
    pub eaten_at: NaiveDateTime,
}

#[derive(Clone)]
pub struct MealDatasource {
    pub pool: PgPool,
}

impl MealDatasource {
    pub async fn get_by_id(&self, id: i32) -> Result<Meal, sqlx::Error> {
        let recs = sqlx::query_as!(
            Meal,
            r#"
                SELECT id, user_id, meal_type, eaten_at
                FROM meals
                WHERE user_id = $1
                ORDER BY eaten_at DESC, id
                "#,
            id
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(recs)
    }

    pub async fn get_all(&self, user_id: i32) -> Result<Vec<Meal>, sqlx::Error> {
        let recs = sqlx::query_as!(
            Meal,
            r#"
                SELECT id, user_id, meal_type, eaten_at
                FROM meals
                WHERE user_id = $1
                ORDER BY eaten_at DESC, id
                "#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(recs)
    }

    pub async fn create(&self, meal: &NewMeal) -> Result<Meal, sqlx::Error> {
        let rec = sqlx::query_as!(
            Meal,
            r#"
            INSERT INTO meals (user_id, eaten_at, meal_type)
            VALUES ($1, $2, $3)
            RETURNING id, user_id, meal_type, eaten_at
            "#,
            meal.user_id,
            meal.eaten_at,
            meal.meal_type
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(rec)
    }

    pub async fn update(&self, meal: &UpdateMeal) -> Result<Meal, sqlx::Error> {
        let rec = sqlx::query_as!(
            Meal,
            r#"
            UPDATE meals
            SET eaten_at = $1,
                meal_type = $2
            WHERE id = $3
            AND user_id = $4
            RETURNING id, user_id, meal_type, eaten_at
            "#,
            meal.eaten_at,
            meal.meal_type,
            meal.id,
            meal.user_id,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(rec)
    }
}

impl Validate for NewMeal {
    fn validate(&self) -> Result<(), AppError> {
        if self.meal_type.trim().is_empty() {
            return Err(AppError::BadRequest("Meal type cannot be empty".into()));
        }
        Ok(())
    }
}

impl Validate for UpdateMeal {
    fn validate(&self) -> Result<(), AppError> {
        if self.id <= 0 {
            return Err(AppError::BadRequest("Invalid meal ID".into()));
        }
        if self.meal_type.trim().is_empty() {
            return Err(AppError::BadRequest("Meal type cannot be empty".into()));
        }
        Ok(())
    }
}

impl NewMeal {
    pub fn from_dto(dto: CreateMealDto, user_id: i32) -> Result<Self, AppError> {
        Ok(NewMeal {
            user_id,
            meal_type: dto.meal_type,
            eaten_at: dto.eaten_at,
        })
    }
}

impl UpdateMeal {
    pub fn from_dto(dto: UpdateMealDto, user_id: i32) -> Result<Self, AppError> {
        Ok(UpdateMeal {
            id: dto.id,
            user_id,
            meal_type: dto.meal_type,
            eaten_at: dto.eaten_at,
        })
    }
}
