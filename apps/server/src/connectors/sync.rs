use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserPreferencesRow {
    pub id: i32,
    pub preferences: Value,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MealTemplateRow {
    pub id: Uuid,
    pub user_id: Option<i32>,
    pub is_official: bool,
    pub name: String,
    pub details: Value,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MealLogRow {
    pub id: Uuid,
    pub user_id: i32,
    pub template_id: Option<Uuid>,
    pub name_snapshot: String,
    pub nutrition_snapshot: Value,
    pub quantity: f64,
    pub consumed_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Clone)]
pub struct SyncDatasource {
    pub pool: PgPool,
}

impl SyncDatasource {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // --- USER PREFERENCES ---
    pub async fn pull_user_preferences(
        &self,
        user_id: i32,
        checkpoint_updated_at: i64,
        limit: i64,
    ) -> Result<Vec<UserPreferencesRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, UserPreferencesRow>(
            r#"
            SELECT id, preferences, updated_at, deleted_at
            FROM user_preferences
            WHERE id = $1 AND updated_at > $2
            ORDER BY updated_at ASC
            LIMIT $3
            "#,
        )
        .bind(user_id)
        .bind(checkpoint_updated_at)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn push_user_preference(
        &self,
        user_id: i32,
        preferences: Value,
        updated_at: i64,
        deleted_at: Option<i64>,
    ) -> Result<Option<UserPreferencesRow>, sqlx::Error> {
        let existing = sqlx::query_as::<_, UserPreferencesRow>(
            "SELECT id, preferences, updated_at, deleted_at FROM user_preferences WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(ref current) = existing {
            if current.updated_at >= updated_at {
                return Ok(Some(current.clone()));
            }
        }

        let _ = sqlx::query(
            r#"
            INSERT INTO user_preferences (id, preferences, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
                preferences = EXCLUDED.preferences,
                updated_at = EXCLUDED.updated_at,
                deleted_at = EXCLUDED.deleted_at
            "#,
        )
        .bind(user_id)
        .bind(preferences)
        .bind(updated_at)
        .bind(deleted_at)
        .execute(&self.pool)
        .await?;

        Ok(None)
    }

    // --- MEAL TEMPLATES ---
    pub async fn get_official_templates(&self) -> Result<Vec<MealTemplateRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, updated_at, deleted_at
            FROM meal_templates
            WHERE is_official = TRUE AND deleted_at IS NULL
            ORDER BY name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn pull_meal_templates(
        &self,
        user_id: i32,
        checkpoint_updated_at: i64,
        checkpoint_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<MealTemplateRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, updated_at, deleted_at
            FROM meal_templates
            WHERE (user_id = $1 OR is_official = TRUE)
              AND (updated_at > $2 OR (updated_at = $2 AND id > COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)))
            ORDER BY updated_at ASC, id ASC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(checkpoint_updated_at)
        .bind(checkpoint_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn push_meal_template(
        &self,
        user_id: i32,
        id: Uuid,
        name: String,
        details: Value,
        updated_at: i64,
        deleted_at: Option<i64>,
    ) -> Result<Option<MealTemplateRow>, sqlx::Error> {
        let existing = sqlx::query_as::<_, MealTemplateRow>(
            "SELECT id, user_id, is_official, name, details, updated_at, deleted_at FROM meal_templates WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(ref current) = existing {
            // Protection: Reject mutations on Official Templates
            if current.is_official {
                tracing::warn!("Blocked attempt to mutate official template id={}", id);
                return Ok(Some(current.clone()));
            }

            if current.updated_at >= updated_at {
                return Ok(Some(current.clone()));
            }
        }

        let _res = sqlx::query(
            r#"
            INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at)
            VALUES ($1, $2, FALSE, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                details = EXCLUDED.details,
                updated_at = EXCLUDED.updated_at,
                deleted_at = EXCLUDED.deleted_at
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(name)
        .bind(details)
        .bind(updated_at)
        .bind(deleted_at)
        .execute(&self.pool)
        .await?;

        Ok(None)
    }

    // --- MEAL LOGS ---
    pub async fn pull_meal_logs(
        &self,
        user_id: i32,
        checkpoint_updated_at: i64,
        checkpoint_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<MealLogRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, MealLogRow>(
            r#"
            SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot, quantity, consumed_at, updated_at, deleted_at
            FROM meal_logs
            WHERE user_id = $1
              AND (updated_at > $2 OR (updated_at = $2 AND id > COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)))
            ORDER BY updated_at ASC, id ASC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(checkpoint_updated_at)
        .bind(checkpoint_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn push_meal_log(
        &self,
        user_id: i32,
        id: Uuid,
        template_id: Option<Uuid>,
        name_snapshot: String,
        nutrition_snapshot: Value,
        quantity: f64,
        consumed_at: i64,
        updated_at: i64,
        deleted_at: Option<i64>,
    ) -> Result<Option<MealLogRow>, sqlx::Error> {
        let existing = sqlx::query_as::<_, MealLogRow>(
            "SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot, quantity, consumed_at, updated_at, deleted_at FROM meal_logs WHERE id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(ref current) = existing {
            if current.updated_at >= updated_at {
                return Ok(Some(current.clone()));
            }
        }

        let _res = sqlx::query(
            r#"
            INSERT INTO meal_logs (id, user_id, template_id, name_snapshot, nutrition_snapshot, quantity, consumed_at, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
                template_id = EXCLUDED.template_id,
                name_snapshot = EXCLUDED.name_snapshot,
                nutrition_snapshot = EXCLUDED.nutrition_snapshot,
                quantity = EXCLUDED.quantity,
                consumed_at = EXCLUDED.consumed_at,
                updated_at = EXCLUDED.updated_at,
                deleted_at = EXCLUDED.deleted_at
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(template_id)
        .bind(name_snapshot)
        .bind(nutrition_snapshot)
        .bind(quantity)
        .bind(consumed_at)
        .bind(updated_at)
        .bind(deleted_at)
        .execute(&self.pool)
        .await?;

        Ok(None)
    }
}
