use bigdecimal::BigDecimal;
use bigdecimal::FromPrimitive;
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde::Serialize;
use sqlx::FromRow;
use sqlx::PgPool;
use sqlx::Type;
use utoipa::ToSchema;

use crate::modules::food::dto::CreateFoodDto;
use crate::modules::food::dto::UpdateFoodDto;
use crate::shared::error::AppError;
use crate::shared::validate::Validate;

#[derive(Debug, Clone, PartialEq, Eq, Type, Serialize, Deserialize, ToSchema)]
#[sqlx(type_name = "serving_unit_type")] // only for PostgreSQL to match a type definition
#[sqlx(rename_all = "lowercase")]
pub enum ServingUnitType {
    Weight,
    Volume,
}

#[derive(FromRow, Debug, Clone)]
pub struct Food {
    pub id: i32,
    pub name: String,
    pub created_by: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
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
    pub version: i32,
    pub serving_name: String,
    pub serving_quantity: BigDecimal,
    pub serving_unit_type: ServingUnitType,
    pub is_verified: bool,
}

#[derive(Debug, Clone)]
pub struct NewFood {
    pub created_by: i32,
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

#[derive(Debug, Clone)]
pub struct UpdateFood {
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
            SELECT
                f.id,
                fv.name,
                f.created_by,
                f.created_at,
                f.updated_at,
                fv.calories,
                fv.fat,
                fv.proteins,
                fv.carbs,
                fv.saturated_fat,
                fv.monounsaturated_fat,
                fv.polyunsaturated_fat,
                fv.trans_fat,
                fv.fiber,
                fv.sugars,
                fv.sodium,
                fv.cholesterol,
                fv.version,
                fv.serving_name,
                fv.serving_quantity,
                fv.serving_unit_type AS "serving_unit_type: ServingUnitType",
                fv.is_verified
            FROM foods f
            JOIN food_versions fv ON f.current_version_id = fv.id
            WHERE f.created_by = $1 OR f.created_by = 1
            ORDER BY f.id
            "#,
                uid
            )
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as!(
                Food,
                r#"
            SELECT
                f.id,
                fv.name,
                f.created_by,
                f.created_at,
                f.updated_at,
                fv.calories,
                fv.fat,
                fv.proteins,
                fv.carbs,
                fv.saturated_fat,
                fv.monounsaturated_fat,
                fv.polyunsaturated_fat,
                fv.trans_fat,
                fv.fiber,
                fv.sugars,
                fv.sodium,
                fv.cholesterol,
                fv.version,
                fv.serving_name,
                fv.serving_quantity,
                fv.serving_unit_type AS "serving_unit_type: ServingUnitType",
                fv.is_verified
            FROM foods f
            JOIN food_versions fv ON f.current_version_id = fv.id
            WHERE f.created_by = 1
            ORDER BY f.id
            "#
            )
            .fetch_all(&self.pool)
            .await?
        };
        Ok(foods)
    }

    pub async fn get_by_id(&self, food_id: i32) -> Result<Food, sqlx::Error> {
        let food = sqlx::query_as!(
            Food,
            r#"
            SELECT
                f.id,
                fv.name,
                f.created_by,
                f.created_at,
                f.updated_at,
                fv.calories,
                fv.fat,
                fv.proteins,
                fv.carbs,
                fv.saturated_fat,
                fv.monounsaturated_fat,
                fv.polyunsaturated_fat,
                fv.trans_fat,
                fv.fiber,
                fv.sugars,
                fv.sodium,
                fv.cholesterol,
                fv.version,
                fv.serving_name,
                fv.serving_quantity,
                fv.serving_unit_type AS "serving_unit_type: ServingUnitType",
                fv.is_verified
            FROM foods f
            JOIN food_versions fv ON f.current_version_id = fv.id
            WHERE f.id = $1
            "#,
            food_id
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(food)
    }

    pub async fn create(&self, new_food: &NewFood) -> Result<i32, sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        // 1. Insertar en food_versions
        let food_version_id: i32 = sqlx::query_scalar!(
            r#"
        INSERT INTO food_versions (
            calories, fat, proteins, carbs,
            saturated_fat, monounsaturated_fat, polyunsaturated_fat, trans_fat,
            fiber, sugars, sodium, cholesterol,
            version, created_by, serving_name, serving_quantity, serving_unit_type,
            is_verified
        )
        VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, $11, $12,
            1, $13, $14, $15, $16,
            false
        )
        RETURNING id
        "#,
            new_food.calories,
            new_food.fat,
            new_food.proteins,
            new_food.carbs,
            new_food.saturated_fat,
            new_food.monounsaturated_fat,
            new_food.polyunsaturated_fat,
            new_food.trans_fat,
            new_food.fiber,
            new_food.sugars,
            new_food.sodium,
            new_food.cholesterol,
            new_food.created_by,
            new_food.serving_name,
            new_food.serving_quantity,
            new_food.serving_unit_type.clone() as ServingUnitType,
        )
        .fetch_one(&mut *tx)
        .await?;

        // 2. Insertar en foods
        let food_id: i32 = sqlx::query_scalar!(
            r#"
        INSERT INTO foods (created_by, current_version_id)
        VALUES ($1, $2)
        RETURNING id
        "#,
            new_food.created_by,
            food_version_id
        )
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(food_id)
    }

    pub async fn update(&self, user_id: &i32, food: &UpdateFood) -> Result<Food, sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        let prev = sqlx::query!(
            "SELECT current_version_id FROM foods WHERE id = $1 AND created_by = $2",
            food.id,
            user_id
        )
        .fetch_one(&self.pool)
        .await?;

        let version = sqlx::query!(
        r#"
        INSERT INTO food_versions (
            name, calories, fat, proteins, carbs, saturated_fat, monounsaturated_fat, polyunsaturated_fat, trans_fat,
            fiber, sugars, sodium, cholesterol, version, previous_version_id, created_by, serving_name, serving_quantity, serving_unit_type, is_verified
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, false
        )
        RETURNING id
        "#,
        food.name,
        food.calories,
        food.fat,
        food.proteins,
        food.carbs,
        food.saturated_fat.clone(),
        food.monounsaturated_fat.clone(),
        food.polyunsaturated_fat.clone(),
        food.trans_fat.clone(),
        food.fiber.clone(),
        food.sugars.clone(),
        food.sodium,
        food.cholesterol,
        prev.current_version_id + 1, // version, puedes ajustar si tienes lógica de versionado
        prev.current_version_id,
        user_id,
        food.serving_name.clone(),
        food.serving_quantity.clone(),
        food.serving_unit_type.clone() as ServingUnitType
    )
        .fetch_one(&mut *tx)
    .await?;

        // 3. Actualizar foods.current_version_id
        sqlx::query!(
        "UPDATE foods SET current_version_id = $1, updated_at = now() WHERE id = $2 AND created_by = $3",
        version.id,
        food.id,
        user_id
    )
        .execute(&mut *tx)
    .await?;

        // 4. Retornar el nuevo estado del food
        let rec = sqlx::query_as!(
            Food,
            r#"
        SELECT
            f.id,
            fv.name,
            f.created_by,
            f.created_at,
            f.updated_at,
            fv.calories,
            fv.fat,
            fv.proteins,
            fv.carbs,
            fv.saturated_fat,
            fv.monounsaturated_fat,
            fv.polyunsaturated_fat,
            fv.trans_fat,
            fv.fiber,
            fv.sugars,
            fv.sodium,
            fv.cholesterol,
            fv.version,
            fv.serving_name,
            fv.serving_quantity,
            fv.serving_unit_type AS "serving_unit_type:ServingUnitType",
            fv.is_verified
        FROM foods f
        JOIN food_versions fv ON f.current_version_id = fv.id
        WHERE f.id = $1
        "#,
            food.id
        )
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(rec)
    }
}

impl Validate for NewFood {
    fn validate(&self) -> Result<(), AppError> {
        if self.name.trim().is_empty() {
            return Err(AppError::BadRequest("Name cannot be empty".into()));
        }

        if self.calories < 0 {
            return Err(AppError::BadRequest("Calories must be non-negative".into()));
        }

        if self.proteins < 0.into() {
            return Err(AppError::BadRequest("Proteins must be non-negative".into()));
        }

        if self.carbs < 0.into() {
            return Err(AppError::BadRequest("Carbs must be non-negative".into()));
        }

        if self.fat < 0.into() {
            return Err(AppError::BadRequest("Fat must be non-negative".into()));
        }

        if let Some(sodium) = &self.sodium {
            if *sodium < 0 {
                return Err(AppError::BadRequest("Sodium must be non-negative".into()));
            }
        }

        if let Some(cholesterol) = &self.cholesterol {
            if *cholesterol < 0 {
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

        if self.calories < 0 {
            return Err(AppError::BadRequest("Calories must be non-negative".into()));
        }

        if self.proteins < 0.into() {
            return Err(AppError::BadRequest("Proteins must be non-negative".into()));
        }

        if self.carbs < 0.into() {
            return Err(AppError::BadRequest("Carbs must be non-negative".into()));
        }

        if self.fat < 0.into() {
            return Err(AppError::BadRequest("Fat must be non-negative".into()));
        }

        if let Some(sodium) = &self.sodium {
            if *sodium < 0 {
                return Err(AppError::BadRequest("Sodium must be non-negative".into()));
            }
        }

        if let Some(cholesterol) = &self.cholesterol {
            if *cholesterol < 0 {
                return Err(AppError::BadRequest(
                    "Cholesterol must be non-negative".into(),
                ));
            }
        }

        Ok(())
    }
}

impl NewFood {
    pub fn from_dto(dto: CreateFoodDto, user_id: i32) -> Result<Self, AppError> {
        Ok(NewFood {
            created_by: user_id,
            name: dto.name,
            calories: dto.calories,
            fat: BigDecimal::from_f64(dto.fat).unwrap_or_default(),
            proteins: BigDecimal::from_f64(dto.proteins).unwrap_or_default(),
            carbs: BigDecimal::from_f64(dto.carbs).unwrap_or_default(),
            saturated_fat: dto.saturated_fat.and_then(BigDecimal::from_f64),
            monounsaturated_fat: dto.monounsaturated_fat.and_then(BigDecimal::from_f64),
            polyunsaturated_fat: dto.polyunsaturated_fat.and_then(BigDecimal::from_f64),
            trans_fat: dto.trans_fat.and_then(BigDecimal::from_f64),
            fiber: dto.fiber.and_then(BigDecimal::from_f64),
            sugars: dto.sugars.and_then(BigDecimal::from_f64),
            sodium: dto.sodium,
            cholesterol: dto.cholesterol,
            serving_name: dto.serving_name,
            serving_quantity: BigDecimal::from_f64(dto.serving_quantity).unwrap_or_default(),
            serving_unit_type: dto.serving_unit_type,
        })
    }
}

impl UpdateFood {
    pub fn from_dto(dto: UpdateFoodDto) -> Result<Self, AppError> {
        Ok(UpdateFood {
            id: dto.id,
            name: dto.name,
            calories: dto.calories,
            fat: BigDecimal::from_f64(dto.fat).unwrap_or_default(),
            proteins: BigDecimal::from_f64(dto.proteins).unwrap_or_default(),
            carbs: BigDecimal::from_f64(dto.carbs).unwrap_or_default(),
            saturated_fat: dto.saturated_fat.and_then(BigDecimal::from_f64),
            monounsaturated_fat: dto.monounsaturated_fat.and_then(BigDecimal::from_f64),
            polyunsaturated_fat: dto.polyunsaturated_fat.and_then(BigDecimal::from_f64),
            trans_fat: dto.trans_fat.and_then(BigDecimal::from_f64),
            fiber: dto.fiber.and_then(BigDecimal::from_f64),
            sugars: dto.sugars.and_then(BigDecimal::from_f64),
            sodium: dto.sodium,
            cholesterol: dto.cholesterol,
            serving_name: dto.serving_name,
            serving_quantity: BigDecimal::from_f64(dto.serving_quantity).unwrap_or_default(),
            serving_unit_type: dto.serving_unit_type,
        })
    }
}
