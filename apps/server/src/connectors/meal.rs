use bigdecimal::BigDecimal;
use bigdecimal::FromPrimitive;
use chrono::NaiveDateTime;
use sqlx::FromRow;
use sqlx::PgPool;

use crate::modules::meal::dto::{
    bd_to_f64, CreateMealDto, CreateMealFoodDto, DailySummaryDto, DaySummaryItemDto, MealDetailDto,
    MealFoodDto, UpdateMealDto, UpdateMealFoodDto,
};
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
    pub async fn get_by_id(&self, user_id: i32, id: i32) -> Result<MealDetailDto, AppError> {
        let meal_header = sqlx::query_as!(
            Meal,
            r#"
                SELECT id, user_id, meal_type, eaten_at
                FROM meals
                WHERE id = $1 AND user_id = $2
                "#,
            id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound("Meal not found".into()))?;

        let items_rows = sqlx::query!(
            r#"
            SELECT 
                mf.id,
                mf.meal_id,
                mf.food_version_id,
                fv.name as food_name,
                mf.serving_name,
                mf.serving_quantity,
                fv.calories,
                fv.proteins,
                fv.carbs,
                fv.fat,
                fv.fiber,
                fv.sodium,
                fv.cholesterol,
                fv.serving_quantity as base_quantity
            FROM meal_foods mf
            JOIN food_versions fv ON mf.food_version_id = fv.id
            WHERE mf.meal_id = $1
            ORDER BY mf.id ASC
            "#,
            id
        )
        .fetch_all(&self.pool)
        .await?;

        let mut items = Vec::new();
        let mut total_calories = 0;
        let mut total_protein_bd = BigDecimal::from(0);
        let mut total_carbs_bd = BigDecimal::from(0);
        let mut total_fat_bd = BigDecimal::from(0);
        let mut total_fiber_bd = BigDecimal::from(0);

        for r in items_rows {
            let zero = BigDecimal::from(0);
            let base_qty = if r.base_quantity == zero {
                BigDecimal::from(1)
            } else {
                r.base_quantity
            };

            let ratio = &r.serving_quantity / &base_qty;
            let item_cal = ((r.calories as f64) * ratio.to_string().parse::<f64>().unwrap_or(1.0)) as i32;
            let item_protein = &r.proteins * &ratio;
            let item_carbs = &r.carbs * &ratio;
            let item_fat = &r.fat * &ratio;
            let item_fiber = r.fiber.as_ref().map(|f| f * &ratio);

            total_calories += item_cal;
            total_protein_bd += &item_protein;
            total_carbs_bd += &item_carbs;
            total_fat_bd += &item_fat;
            if let Some(ref fib) = item_fiber {
                total_fiber_bd += fib;
            }

            items.push(MealFoodDto {
                id: r.id,
                meal_id: r.meal_id.unwrap_or(id),
                food_version_id: r.food_version_id.unwrap_or(0),
                food_name: r.food_name,
                serving_name: r.serving_name,
                serving_quantity: bd_to_f64(&r.serving_quantity, "serving_quantity")?,
                calories: item_cal,
                protein: bd_to_f64(&item_protein, "item_protein")?,
                carbs: bd_to_f64(&item_carbs, "item_carbs")?,
                fat: bd_to_f64(&item_fat, "item_fat")?,
                fiber: item_fiber.as_ref().map(|f| bd_to_f64(f, "item_fiber")).transpose()?,
                sodium: r.sodium,
                cholesterol: r.cholesterol,
            });
        }

        Ok(MealDetailDto {
            id: meal_header.id,
            user_id: meal_header.user_id,
            meal_type: meal_header.meal_type,
            eaten_at: meal_header.eaten_at,
            total_calories,
            total_protein: bd_to_f64(&total_protein_bd, "total_protein")?,
            total_carbs: bd_to_f64(&total_carbs_bd, "total_carbs")?,
            total_fat: bd_to_f64(&total_fat_bd, "total_fat")?,
            total_fiber: bd_to_f64(&total_fiber_bd, "total_fiber")?,
            items,
        })
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

    pub async fn delete(&self, user_id: i32, id: i32) -> Result<bool, AppError> {
        let res = sqlx::query!("DELETE FROM meals WHERE id = $1 AND user_id = $2", id, user_id)
            .execute(&self.pool)
            .await?;

        if res.rows_affected() == 0 {
            Err(AppError::NotFound("Meal not found".into()))
        } else {
            Ok(true)
        }
    }

    pub async fn add_item(&self, user_id: i32, meal_id: i32, dto: CreateMealFoodDto) -> Result<bool, AppError> {
        let meal_exists = sqlx::query_scalar!(
            "SELECT id FROM meals WHERE id = $1 AND user_id = $2",
            meal_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;

        if meal_exists.is_none() {
            return Err(AppError::NotFound("Meal not found".into()));
        }

        let qty = BigDecimal::from_f64(dto.serving_quantity).unwrap_or_else(|| BigDecimal::from(1));

        sqlx::query!(
            r#"
            INSERT INTO meal_foods (meal_id, food_version_id, serving_name, serving_quantity)
            VALUES ($1, $2, $3, $4)
            "#,
            meal_id,
            dto.food_version_id,
            dto.serving_name,
            qty
        )
        .execute(&self.pool)
        .await?;

        Ok(true)
    }

    pub async fn update_item(
        &self,
        user_id: i32,
        meal_id: i32,
        item_id: i32,
        dto: UpdateMealFoodDto,
    ) -> Result<bool, AppError> {
        let qty = dto.serving_quantity.and_then(BigDecimal::from_f64);

        let res = sqlx::query!(
            r#"
            UPDATE meal_foods
            SET serving_name = COALESCE($3, serving_name),
                serving_quantity = COALESCE($4, serving_quantity)
            FROM meals m
            WHERE meal_foods.id = $1 AND meal_foods.meal_id = $2 AND m.id = meal_foods.meal_id AND m.user_id = $5
            "#,
            item_id,
            meal_id,
            dto.serving_name,
            qty,
            user_id
        )
        .execute(&self.pool)
        .await?;

        if res.rows_affected() == 0 {
            Err(AppError::NotFound("Meal item not found".into()))
        } else {
            Ok(true)
        }
    }

    pub async fn delete_item(&self, user_id: i32, meal_id: i32, item_id: i32) -> Result<bool, AppError> {
        let res = sqlx::query!(
            r#"
            DELETE FROM meal_foods
            USING meals m
            WHERE meal_foods.id = $1 AND meal_foods.meal_id = $2 AND m.id = meal_foods.meal_id AND m.user_id = $3
            "#,
            item_id,
            meal_id,
            user_id
        )
        .execute(&self.pool)
        .await?;

        if res.rows_affected() == 0 {
            Err(AppError::NotFound("Meal item not found".into()))
        } else {
            Ok(true)
        }
    }

    pub async fn get_daily_summary(&self, user_id: i32, date: &str) -> Result<DailySummaryDto, AppError> {
        let meal_ids = sqlx::query!(
            r#"
            SELECT id
            FROM meals
            WHERE user_id = $1 AND DATE(eaten_at) = $2::text::date
            ORDER BY eaten_at ASC
            "#,
            user_id,
            date
        )
        .fetch_all(&self.pool)
        .await?;

        let mut meals = Vec::new();
        let mut total_calories = 0;
        let mut total_protein = 0.0;
        let mut total_carbs = 0.0;
        let mut total_fat = 0.0;
        let mut total_fiber = 0.0;

        for m in meal_ids {
            if let Ok(detail) = self.get_by_id(user_id, m.id).await {
                total_calories += detail.total_calories;
                total_protein += detail.total_protein;
                total_carbs += detail.total_carbs;
                total_fat += detail.total_fat;
                total_fiber += detail.total_fiber;
                meals.push(detail);
            }
        }

        Ok(DailySummaryDto {
            user_id,
            date: date.to_string(),
            total_calories,
            total_protein,
            total_carbs,
            total_fat,
            total_fiber,
            meals,
        })
    }

    pub async fn compare_summary(
        &self,
        user_id: i32,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<DaySummaryItemDto>, AppError> {
        let days = sqlx::query!(
            r#"
            SELECT DISTINCT DATE(eaten_at)::text as "date!"
            FROM meals
            WHERE user_id = $1 AND DATE(eaten_at) BETWEEN $2::text::date AND $3::text::date
            ORDER BY "date!" ASC
            "#,
            user_id,
            start_date,
            end_date
        )
        .fetch_all(&self.pool)
        .await?;

        let mut result = Vec::new();
        for d in days {
            if let Ok(summary) = self.get_daily_summary(user_id, &d.date).await {
                result.push(DaySummaryItemDto {
                    date: d.date,
                    total_calories: summary.total_calories,
                    total_protein: summary.total_protein,
                    total_carbs: summary.total_carbs,
                    total_fat: summary.total_fat,
                    total_fiber: summary.total_fiber,
                });
            }
        }

        Ok(result)
    }
}

impl Validate for NewMeal {
    fn validate(&self) -> Result<(), AppError> {
        Ok(())
    }
}

impl Validate for UpdateMeal {
    fn validate(&self) -> Result<(), AppError> {
        if self.id <= 0 {
            return Err(AppError::BadRequest("Invalid meal ID".into()));
        }
        Ok(())
    }
}

impl NewMeal {
    pub fn from_dto(dto: CreateMealDto, user_id: i32) -> Result<Self, AppError> {
        Ok(NewMeal {
            user_id,
            meal_type: dto.meal_type.as_str().to_string(),
            eaten_at: dto.eaten_at,
        })
    }
}

impl UpdateMeal {
    pub fn from_dto(dto: UpdateMealDto, user_id: i32) -> Result<Self, AppError> {
        Ok(UpdateMeal {
            id: dto.id,
            user_id,
            meal_type: dto.meal_type.as_str().to_string(),
            eaten_at: dto.eaten_at,
        })
    }
}
