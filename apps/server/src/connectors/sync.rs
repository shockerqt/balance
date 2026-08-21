use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

use crate::shared::error::AppError;

pub const FOOD_SCHEMA_VERSION: i32 = 2;

pub const EXTENDED_NUTRIENT_KEYS: &[&str] = &[
    "alcoholG",
    "vitaminB12Mcg",
    "thiamineMg",
    "riboflavinMg",
    "niacinMg",
    "pantothenicAcidMg",
    "pyridoxineMg",
    "caffeineMg",
    "calciumMg",
    "cholineMg",
    "copperMg",
    "cysteineG",
    "monounsaturatedFatG",
    "polyunsaturatedFatG",
    "saturatedFatG",
    "transFatG",
    "folateMcg",
    "histidineG",
    "ironMg",
    "isoleucineG",
    "leucineG",
    "lysineG",
    "magnesiumMg",
    "manganeseMg",
    "methionineG",
    "omega3AlaG",
    "omega3DhaG",
    "omega3EpaG",
    "omega3G",
    "omega6G",
    "phenylalanineG",
    "phosphorusMg",
    "potassiumMg",
    "seleniumMcg",
    "starchG",
    "sugarsG",
    "addedSugarsG",
    "threonineG",
    "tryptophanG",
    "tyrosineG",
    "valineG",
    "vitaminAMcg",
    "vitaminCMg",
    "vitaminDMcg",
    "vitaminEMg",
    "vitaminKMcg",
    "waterG",
    "zincMg",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CanonicalUnit {
    G,
    Ml,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NutritionValues {
    pub calories: f64,
    pub protein: f64,
    pub carbs: f64,
    pub fat: f64,
    #[serde(default)]
    pub fiber: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sodium_mg: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cholesterol_mg: Option<f64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extended_nutrition: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortionDefinition {
    pub id: String,
    pub name: String,
    pub portion_quantity: f64,
    pub canonical_quantity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoodDetails {
    pub schema_version: i32,
    pub canonical_unit: CanonicalUnit,
    pub nutrition_per100: NutritionValues,
    #[serde(default)]
    pub portions: Vec<PortionDefinition>,
    #[serde(default)]
    pub chilean_seals: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typical_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NutritionSnapshot {
    pub schema_version: i32,
    pub canonical_unit: CanonicalUnit,
    pub nutrition_per100: NutritionValues,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortionSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub portion_id: Option<String>,
    pub name: String,
    pub portion_quantity: f64,
    pub canonical_quantity: f64,
}

impl From<&PortionDefinition> for PortionSnapshot {
    fn from(value: &PortionDefinition) -> Self {
        Self {
            portion_id: Some(value.id.clone()),
            name: value.name.clone(),
            portion_quantity: value.portion_quantity,
            canonical_quantity: value.canonical_quantity,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MealLogEntry {
    pub entered_quantity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub portion_snapshot: Option<PortionSnapshot>,
}

impl PortionDefinition {
    fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() || self.id.chars().count() > 80 {
            return Err(AppError::BadRequest(
                "portion id must contain 1 to 80 characters".into(),
            ));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 120 {
            return Err(AppError::BadRequest(
                "portion name must contain 1 to 120 characters".into(),
            ));
        }
        validate_positive("portionQuantity", self.portion_quantity)?;
        validate_positive("canonicalQuantity", self.canonical_quantity)
    }
}

impl PortionSnapshot {
    fn validate(&self) -> Result<(), AppError> {
        if matches!(&self.portion_id, Some(id) if id.trim().is_empty() || id.chars().count() > 80) {
            return Err(AppError::BadRequest(
                "entry.portionSnapshot.portionId is invalid".into(),
            ));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 120 {
            return Err(AppError::BadRequest(
                "entry.portionSnapshot.name is invalid".into(),
            ));
        }
        validate_positive(
            "entry.portionSnapshot.portionQuantity",
            self.portion_quantity,
        )?;
        validate_positive(
            "entry.portionSnapshot.canonicalQuantity",
            self.canonical_quantity,
        )
    }
}

impl MealLogEntry {
    pub fn validate(&self, canonical_quantity: f64) -> Result<(), AppError> {
        validate_positive("entry.enteredQuantity", self.entered_quantity)?;
        validate_positive("canonicalQuantity", canonical_quantity)?;
        let expected = match &self.portion_snapshot {
            Some(portion) => {
                portion.validate()?;
                self.entered_quantity / portion.portion_quantity * portion.canonical_quantity
            }
            None => self.entered_quantity,
        };
        let tolerance = 1e-8_f64.max(expected.abs() * 1e-8);
        if (expected - canonical_quantity).abs() > tolerance {
            return Err(AppError::BadRequest(
                "entry conversion does not match canonicalQuantity".into(),
            ));
        }
        Ok(())
    }
}

impl FoodDetails {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != FOOD_SCHEMA_VERSION {
            return Err(AppError::BadRequest(
                "Unsupported food schema version".into(),
            ));
        }
        self.nutrition_per100.validate()?;
        let mut ids = std::collections::HashSet::new();
        for portion in &self.portions {
            portion.validate()?;
            if !ids.insert(portion.id.as_str()) {
                return Err(AppError::BadRequest("portion ids must be unique".into()));
            }
        }
        if let Some(time) = &self.typical_time {
            chrono::NaiveTime::parse_from_str(time, "%H:%M")
                .map_err(|_| AppError::BadRequest("typicalTime must use HH:MM".into()))?;
        }
        Ok(())
    }

    pub fn snapshot(&self) -> NutritionSnapshot {
        NutritionSnapshot {
            schema_version: self.schema_version,
            canonical_unit: self.canonical_unit,
            nutrition_per100: self.nutrition_per100.clone(),
        }
    }

    pub fn entry_for(
        &self,
        quantity: f64,
        portion_id: Option<&str>,
    ) -> Result<(f64, MealLogEntry), AppError> {
        validate_positive("quantity", quantity)?;
        if let Some(portion_id) = portion_id {
            let portion = self
                .portions
                .iter()
                .find(|portion| portion.id == portion_id)
                .ok_or_else(|| AppError::BadRequest("Unknown portionId for this food".into()))?;
            let canonical_quantity =
                quantity / portion.portion_quantity * portion.canonical_quantity;
            let entry = MealLogEntry {
                entered_quantity: quantity,
                portion_snapshot: Some(portion.into()),
            };
            entry.validate(canonical_quantity)?;
            Ok((canonical_quantity, entry))
        } else {
            let entry = MealLogEntry {
                entered_quantity: quantity,
                portion_snapshot: None,
            };
            entry.validate(quantity)?;
            Ok((quantity, entry))
        }
    }
}

impl NutritionSnapshot {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != FOOD_SCHEMA_VERSION {
            return Err(AppError::BadRequest(
                "Unsupported nutrition snapshot schema version".into(),
            ));
        }
        self.nutrition_per100.validate()
    }
}

impl NutritionValues {
    pub(crate) fn validate(&self) -> Result<(), AppError> {
        let required = [
            ("calories", self.calories),
            ("protein", self.protein),
            ("carbs", self.carbs),
            ("fat", self.fat),
            ("fiber", self.fiber),
        ];
        for (name, value) in required {
            if !value.is_finite() || value < 0.0 {
                return Err(AppError::BadRequest(format!(
                    "{name} must be a finite non-negative number"
                )));
            }
        }
        for (name, value) in [
            ("sodiumMg", self.sodium_mg),
            ("cholesterolMg", self.cholesterol_mg),
        ] {
            if matches!(value, Some(value) if !value.is_finite() || value < 0.0) {
                return Err(AppError::BadRequest(format!(
                    "{name} must be a finite non-negative number"
                )));
            }
        }
        for (name, value) in &self.extended_nutrition {
            if !EXTENDED_NUTRIENT_KEYS.contains(&name.as_str()) {
                return Err(AppError::BadRequest(format!(
                    "Unknown extended nutrient: {name}"
                )));
            }
            if !value.is_finite() || *value < 0.0 {
                return Err(AppError::BadRequest(format!(
                    "extendedNutrition.{name} must be a finite non-negative number"
                )));
            }
        }
        Ok(())
    }
}

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
    pub source_provider: Option<String>,
    pub external_id: Option<String>,
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
    pub source_provider: Option<String>,
    pub external_id: Option<String>,
    pub canonical_quantity: f64,
    pub entry_snapshot: Value,
    pub consumed_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct MealLogMutation {
    pub id: Uuid,
    pub template_id: Option<Uuid>,
    pub canonical_quantity: f64,
    pub entry: MealLogEntry,
    pub consumed_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, FromRow, PartialEq, Eq)]
pub struct WeightLogRow {
    pub user_id: i32,
    pub measured_on: NaiveDate,
    pub weight_grams: i32,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeightUpsertStatus {
    Created,
    Updated,
    Unchanged,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoodTemplate {
    pub id: Uuid,
    pub name: String,
    pub is_official: bool,
    pub details: FoodDetails,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Consumption {
    pub id: Uuid,
    pub template_id: Option<Uuid>,
    pub name: String,
    pub snapshot: NutritionSnapshot,
    pub canonical_quantity: f64,
    pub entry: MealLogEntry,
    pub consumed_at: i64,
    pub updated_at: i64,
}

impl Consumption {
    pub fn scaled_nutrition(&self) -> NutritionValues {
        let factor = self.canonical_quantity / 100.0;
        let nutrition = &self.snapshot.nutrition_per100;
        NutritionValues {
            calories: nutrition.calories * factor,
            protein: nutrition.protein * factor,
            carbs: nutrition.carbs * factor,
            fat: nutrition.fat * factor,
            fiber: nutrition.fiber * factor,
            sodium_mg: nutrition.sodium_mg.map(|value| value * factor),
            cholesterol_mg: nutrition.cholesterol_mg.map(|value| value * factor),
            extended_nutrition: nutrition
                .extended_nutrition
                .iter()
                .map(|(name, value)| (name.clone(), value * factor))
                .collect(),
        }
    }
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

        if let Some(ref current) = existing
            && current.updated_at >= updated_at
        {
            return Ok(Some(current.clone()));
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

    pub async fn weight_tracking_enabled(&self, user_id: i32) -> Result<bool, sqlx::Error> {
        let preferences = sqlx::query_scalar::<_, Value>(
            "SELECT preferences FROM user_preferences WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(preferences
            .as_ref()
            .and_then(|value| value.get("weightTrackingEnabled"))
            .and_then(Value::as_bool)
            .unwrap_or(true))
    }

    // --- MEAL TEMPLATES ---
    pub async fn get_official_templates(&self) -> Result<Vec<MealTemplateRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
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
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
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
        source_provider: Option<String>,
        external_id: Option<String>,
        updated_at: i64,
        deleted_at: Option<i64>,
    ) -> Result<Option<MealTemplateRow>, AppError> {
        let existing = sqlx::query_as::<_, MealTemplateRow>(
            "SELECT id, user_id, is_official, name, details, source_provider, external_id, updated_at, deleted_at FROM meal_templates WHERE id = $1",
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

            if current.user_id != Some(user_id) {
                return Err(AppError::Conflict(
                    "Template id is already owned by another user".into(),
                ));
            }

            if current.updated_at >= updated_at {
                return Ok(Some(current.clone()));
            }
        }

        let _res = sqlx::query(
            r#"
            INSERT INTO meal_templates
                (id, user_id, is_official, name, details, source_provider, external_id,
                 updated_at, deleted_at)
            VALUES ($1, $2, FALSE, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                details = EXCLUDED.details,
                source_provider = EXCLUDED.source_provider,
                external_id = EXCLUDED.external_id,
                updated_at = EXCLUDED.updated_at,
                deleted_at = EXCLUDED.deleted_at
            WHERE meal_templates.user_id = EXCLUDED.user_id
              AND meal_templates.is_official = FALSE
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(name)
        .bind(details)
        .bind(source_provider)
        .bind(external_id)
        .bind(updated_at)
        .bind(deleted_at)
        .execute(&self.pool)
        .await?;

        if _res.rows_affected() == 0 {
            return Err(AppError::Conflict(
                "Template id could not be written for this user".into(),
            ));
        }

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
        sqlx::query_as::<_, MealLogRow>(
            r#"
            SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
                   source_provider, external_id, canonical_quantity, entry_snapshot,
                   consumed_at, updated_at, deleted_at
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
        .await
    }

    pub async fn push_meal_log(
        &self,
        user_id: i32,
        mutation: MealLogMutation,
    ) -> Result<Option<MealLogRow>, AppError> {
        mutation.entry.validate(mutation.canonical_quantity)?;
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query_as::<_, MealLogRow>(
            r#"
            SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
                   source_provider, external_id, canonical_quantity, entry_snapshot,
                   consumed_at, updated_at, deleted_at
            FROM meal_logs
            WHERE id = $1 AND user_id = $2
            FOR UPDATE
            "#,
        )
        .bind(mutation.id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(ref current) = existing
            && current.updated_at >= mutation.updated_at
        {
            tx.commit().await?;
            return Ok(Some(current.clone()));
        }

        let entry_snapshot = serde_json::to_value(&mutation.entry)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        if existing.is_some() {
            sqlx::query(
                r#"
                UPDATE meal_logs
                SET canonical_quantity = $3,
                    entry_snapshot = $4,
                    consumed_at = $5,
                    updated_at = $6,
                    deleted_at = $7
                WHERE id = $1 AND user_id = $2
                "#,
            )
            .bind(mutation.id)
            .bind(user_id)
            .bind(mutation.canonical_quantity)
            .bind(entry_snapshot)
            .bind(mutation.consumed_at)
            .bind(mutation.updated_at)
            .bind(mutation.deleted_at)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(None);
        }

        let template_id = mutation.template_id.ok_or_else(|| {
            AppError::BadRequest("templateId is required for a new meal log".into())
        })?;
        let template = get_food_template_in_tx(&mut tx, user_id, template_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Food not found".into()))?;
        let nutrition_snapshot = serde_json::to_value(template.details.snapshot())
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let result = sqlx::query(
            r#"
            INSERT INTO meal_logs
                (id, user_id, template_id, name_snapshot, nutrition_snapshot,
                 canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(mutation.id)
        .bind(user_id)
        .bind(template_id)
        .bind(&template.name)
        .bind(nutrition_snapshot)
        .bind(mutation.canonical_quantity)
        .bind(entry_snapshot)
        .bind(mutation.consumed_at)
        .bind(mutation.updated_at)
        .bind(mutation.deleted_at)
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::Conflict(
                "Meal log id could not be written for this user".into(),
            ));
        }
        tx.commit().await?;
        Ok(None)
    }

    // --- WEIGHT LOGS ---

    pub async fn pull_weight_logs(
        &self,
        user_id: i32,
        checkpoint_updated_at: i64,
        checkpoint_date: Option<NaiveDate>,
        limit: i64,
    ) -> Result<Vec<WeightLogRow>, sqlx::Error> {
        sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1
              AND (
                    updated_at > $2
                 OR (updated_at = $2 AND measured_on > COALESCE($3, DATE '0001-01-01'))
              )
            ORDER BY updated_at ASC, measured_on ASC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(checkpoint_updated_at)
        .bind(checkpoint_date)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn push_weight_log(
        &self,
        user_id: i32,
        measured_on: NaiveDate,
        weight_grams: i32,
        updated_at: i64,
        deleted_at: Option<i64>,
    ) -> Result<Option<WeightLogRow>, AppError> {
        validate_weight_grams(weight_grams)?;
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1 AND measured_on = $2
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(ref current) = existing
            && current.updated_at >= updated_at
        {
            tx.commit().await?;
            return Ok(Some(current.clone()));
        }

        sqlx::query(
            r#"
            INSERT INTO weight_logs
                (user_id, measured_on, weight_grams, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, measured_on) DO UPDATE SET
                weight_grams = EXCLUDED.weight_grams,
                updated_at = EXCLUDED.updated_at,
                deleted_at = EXCLUDED.deleted_at
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .bind(weight_grams)
        .bind(updated_at)
        .bind(deleted_at)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(None)
    }

    pub async fn get_weight_history(
        &self,
        user_id: i32,
        start: Option<NaiveDate>,
        end: NaiveDate,
        limit: i64,
    ) -> Result<Vec<WeightLogRow>, AppError> {
        let mut rows = sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1
              AND deleted_at IS NULL
              AND measured_on <= $2
              AND ($3::date IS NULL OR measured_on >= $3)
            ORDER BY measured_on DESC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(end)
        .bind(start)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.reverse();
        Ok(rows)
    }

    pub async fn set_weight(
        &self,
        user_id: i32,
        measured_on: NaiveDate,
        weight_grams: i32,
    ) -> Result<(WeightLogRow, WeightUpsertStatus), AppError> {
        validate_weight_grams(weight_grams)?;
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1 AND measured_on = $2
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(current) = existing.as_ref()
            && current.deleted_at.is_none()
            && current.weight_grams == weight_grams
        {
            let current = current.clone();
            tx.commit().await?;
            return Ok((current, WeightUpsertStatus::Unchanged));
        }

        let status = if existing.is_some() {
            WeightUpsertStatus::Updated
        } else {
            WeightUpsertStatus::Created
        };
        let row = sqlx::query_as::<_, WeightLogRow>(
            r#"
            INSERT INTO weight_logs
                (user_id, measured_on, weight_grams, updated_at, deleted_at)
            VALUES (
                $1, $2, $3,
                floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                NULL
            )
            ON CONFLICT (user_id, measured_on) DO UPDATE SET
                weight_grams = EXCLUDED.weight_grams,
                updated_at = EXCLUDED.updated_at,
                deleted_at = NULL
            RETURNING user_id, measured_on, weight_grams, updated_at, deleted_at
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .bind(weight_grams)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((row, status))
    }

    pub async fn soft_delete_weight(
        &self,
        user_id: i32,
        measured_on: NaiveDate,
    ) -> Result<(WeightLogRow, bool), AppError> {
        let mut tx = self.pool.begin().await?;
        let current = sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1 AND measured_on = $2
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Weight measurement not found".into()))?;
        if current.deleted_at.is_some() {
            tx.commit().await?;
            return Ok((current, true));
        }
        let row = sqlx::query_as::<_, WeightLogRow>(
            r#"
            UPDATE weight_logs
            SET deleted_at = COALESCE(
                    deleted_at,
                    floor(extract(epoch from clock_timestamp()) * 1000)::bigint
                ),
                updated_at = CASE
                    WHEN deleted_at IS NULL
                    THEN floor(extract(epoch from clock_timestamp()) * 1000)::bigint
                    ELSE updated_at
                END
            WHERE user_id = $1 AND measured_on = $2
            RETURNING user_id, measured_on, weight_grams, updated_at, deleted_at
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((row, false))
    }

    pub async fn search_food_templates(
        &self,
        user_id: i32,
        query: &str,
        source: &str,
        limit: i64,
    ) -> Result<Vec<FoodTemplate>, AppError> {
        let escaped = query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{escaped}%");
        let rows = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
            FROM meal_templates
            WHERE deleted_at IS NULL
              AND (user_id = $1 OR is_official = TRUE)
              AND name ILIKE $2 ESCAPE '\'
              AND (
                    $3 = 'all'
                 OR ($3 = 'personal' AND user_id = $1 AND is_official = FALSE)
                 OR ($3 = 'official' AND is_official = TRUE)
              )
            ORDER BY CASE WHEN lower(name) = lower($4) THEN 0 ELSE 1 END,
                     is_official DESC,
                     name ASC,
                     id ASC
            LIMIT $5
            "#,
        )
        .bind(user_id)
        .bind(pattern)
        .bind(source)
        .bind(query)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(food_template_from_row).collect()
    }

    pub async fn create_personal_food(
        &self,
        user_id: i32,
        id: Uuid,
        name: &str,
        details: &FoodDetails,
    ) -> Result<(FoodTemplate, bool), AppError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
        details.validate()?;

        let duplicate = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id
            FROM meal_templates
            WHERE user_id = $1
              AND is_official = FALSE
              AND deleted_at IS NULL
              AND lower(btrim(name)) = lower($2)
              AND id <> $3
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .bind(name)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        if duplicate.is_some() {
            return Err(AppError::Conflict(
                "A personal food with the same name already exists".into(),
            ));
        }

        let details_json =
            serde_json::to_value(details).map_err(|error| AppError::Internal(error.to_string()))?;
        let result = sqlx::query(
            r#"
            INSERT INTO meal_templates
                (id, user_id, is_official, name, details, updated_at, deleted_at)
            VALUES
                ($1, $2, FALSE, $3, $4,
                 floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                 NULL)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(name)
        .bind(details_json)
        .execute(&self.pool)
        .await?;

        let row = self
            .get_food_template(user_id, id)
            .await?
            .ok_or_else(|| AppError::Conflict("operationId is already in use".into()))?;
        Ok((row, result.rows_affected() == 1))
    }

    pub async fn get_food_template(
        &self,
        user_id: i32,
        id: Uuid,
    ) -> Result<Option<FoodTemplate>, AppError> {
        let row = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
            FROM meal_templates
            WHERE id = $1
              AND deleted_at IS NULL
              AND (user_id = $2 OR is_official = TRUE)
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(food_template_from_row).transpose()
    }

    pub async fn create_consumption(
        &self,
        user_id: i32,
        id: Uuid,
        template_id: Uuid,
        quantity: f64,
        portion_id: Option<&str>,
        consumed_at: i64,
    ) -> Result<(Consumption, bool), AppError> {
        let mut tx = self.pool.begin().await?;
        let template = get_food_template_in_tx(&mut tx, user_id, template_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Food not found".into()))?;
        let (canonical_quantity, entry) = template.details.entry_for(quantity, portion_id)?;
        let snapshot = serde_json::to_value(template.details.snapshot())
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let entry_snapshot =
            serde_json::to_value(&entry).map_err(|error| AppError::Internal(error.to_string()))?;
        let result = sqlx::query(
            r#"
            INSERT INTO meal_logs
                (id, user_id, template_id, name_snapshot, nutrition_snapshot,
                 canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8,
                 floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                 NULL)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(template_id)
        .bind(&template.name)
        .bind(snapshot)
        .bind(canonical_quantity)
        .bind(entry_snapshot)
        .bind(consumed_at)
        .execute(&mut *tx)
        .await?;

        let row = get_consumption_in_tx(&mut tx, user_id, id)
            .await?
            .ok_or_else(|| AppError::Conflict("operationId is already in use".into()))?;
        tx.commit().await?;
        Ok((row, result.rows_affected() == 1))
    }

    pub async fn get_daily_consumptions(
        &self,
        user_id: i32,
        date: &str,
    ) -> Result<Vec<Consumption>, AppError> {
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| AppError::BadRequest("date must use YYYY-MM-DD".into()))?;
        let (start, end) = self.day_bounds(date).await?;
        let rows = sqlx::query_as::<_, MealLogRow>(
            r#"
            SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
                   source_provider, external_id, canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at
            FROM meal_logs
            WHERE user_id = $1
              AND deleted_at IS NULL
              AND consumed_at >= $2
              AND consumed_at < $3
            ORDER BY consumed_at ASC, id ASC
            "#,
        )
        .bind(user_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(consumption_from_row).collect()
    }

    pub async fn update_consumption(
        &self,
        user_id: i32,
        id: Uuid,
        quantity: Option<f64>,
        consumed_at: Option<i64>,
    ) -> Result<Consumption, AppError> {
        if quantity.is_none() && consumed_at.is_none() {
            return Err(AppError::BadRequest(
                "At least one of quantity or consumedAt is required".into(),
            ));
        }
        let mut tx = self.pool.begin().await?;
        let current = get_consumption_in_tx(&mut tx, user_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Consumption not found".into()))?;
        let (canonical_quantity, entry) = if let Some(quantity) = quantity {
            validate_positive("quantity", quantity)?;
            match &current.entry.portion_snapshot {
                Some(portion) => {
                    let canonical =
                        quantity / portion.portion_quantity * portion.canonical_quantity;
                    let entry = MealLogEntry {
                        entered_quantity: quantity,
                        portion_snapshot: Some(portion.clone()),
                    };
                    entry.validate(canonical)?;
                    (canonical, entry)
                }
                None => {
                    let entry = MealLogEntry {
                        entered_quantity: quantity,
                        portion_snapshot: None,
                    };
                    entry.validate(quantity)?;
                    (quantity, entry)
                }
            }
        } else {
            (current.canonical_quantity, current.entry.clone())
        };
        let entry_snapshot =
            serde_json::to_value(&entry).map_err(|error| AppError::Internal(error.to_string()))?;
        let row = sqlx::query_as::<_, MealLogRow>(
            r#"
            UPDATE meal_logs
            SET canonical_quantity = $3,
                entry_snapshot = $4,
                consumed_at = COALESCE($5, consumed_at),
                updated_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
            WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
            RETURNING id, user_id, template_id, name_snapshot,
                      nutrition_snapshot, source_provider, external_id,
                      canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(canonical_quantity)
        .bind(entry_snapshot)
        .bind(consumed_at)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        consumption_from_row(row)
    }

    pub async fn soft_delete_consumption(
        &self,
        user_id: i32,
        id: Uuid,
    ) -> Result<Consumption, AppError> {
        let row = sqlx::query_as::<_, MealLogRow>(
            r#"
            UPDATE meal_logs
            SET deleted_at = COALESCE(
                    deleted_at,
                    floor(extract(epoch from clock_timestamp()) * 1000)::bigint
                ),
                updated_at = CASE
                    WHEN deleted_at IS NULL
                    THEN floor(extract(epoch from clock_timestamp()) * 1000)::bigint
                    ELSE updated_at
                END
            WHERE id = $1 AND user_id = $2
            RETURNING id, user_id, template_id, name_snapshot,
                      nutrition_snapshot, source_provider, external_id, canonical_quantity, entry_snapshot,
                      consumed_at, updated_at, deleted_at
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Consumption not found".into()))?;
        consumption_from_row(row)
    }

    pub async fn current_santiago_date(&self) -> Result<String, AppError> {
        let date = sqlx::query_scalar::<_, String>(
            "SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(date)
    }

    pub async fn current_santiago_datetime(&self) -> Result<(String, String), AppError> {
        let result = sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT
                to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD'),
                to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago', 'HH24:MI')
            "#,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(result)
    }

    pub async fn local_datetime_to_epoch(&self, date: &str, time: &str) -> Result<i64, AppError> {
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| AppError::BadRequest("date must use YYYY-MM-DD".into()))?;
        chrono::NaiveTime::parse_from_str(time, "%H:%M")
            .map_err(|_| AppError::BadRequest("time must use HH:MM".into()))?;
        let (epoch, round_trip) = sqlx::query_as::<_, (i64, String)>(
            r#"
            SELECT
                floor(extract(epoch from (($1::date + $2::time)
                    AT TIME ZONE 'America/Santiago')) * 1000)::bigint,
                to_char(
                    ((($1::date + $2::time) AT TIME ZONE 'America/Santiago')
                        AT TIME ZONE 'America/Santiago'),
                    'YYYY-MM-DD HH24:MI'
                )
            "#,
        )
        .bind(date)
        .bind(time)
        .fetch_one(&self.pool)
        .await?;
        if round_trip != format!("{date} {time}") {
            return Err(AppError::BadRequest(
                "The local date/time does not exist in America/Santiago".into(),
            ));
        }
        Ok(epoch)
    }

    async fn day_bounds(&self, date: &str) -> Result<(i64, i64), AppError> {
        let bounds = sqlx::query_as::<_, (i64, i64)>(
            r#"
            SELECT
                floor(extract(epoch from ($1::date::timestamp
                    AT TIME ZONE 'America/Santiago')) * 1000)::bigint,
                floor(extract(epoch from (($1::date + 1)::timestamp
                    AT TIME ZONE 'America/Santiago')) * 1000)::bigint
            "#,
        )
        .bind(date)
        .fetch_one(&self.pool)
        .await?;
        Ok(bounds)
    }
}

fn food_template_from_row(row: MealTemplateRow) -> Result<FoodTemplate, AppError> {
    let details: FoodDetails = serde_json::from_value(row.details)
        .map_err(|error| AppError::Internal(format!("Invalid food details: {error}")))?;
    details.validate()?;
    Ok(FoodTemplate {
        id: row.id,
        name: row.name,
        is_official: row.is_official,
        details,
        updated_at: row.updated_at,
    })
}

fn consumption_from_row(row: MealLogRow) -> Result<Consumption, AppError> {
    let snapshot: NutritionSnapshot = serde_json::from_value(row.nutrition_snapshot)
        .map_err(|error| AppError::Internal(format!("Invalid nutrition snapshot: {error}")))?;
    snapshot.validate().map_err(|error| match error {
        AppError::BadRequest(message) => AppError::Internal(message),
        other => other,
    })?;
    let entry: MealLogEntry = serde_json::from_value(row.entry_snapshot)
        .map_err(|error| AppError::Internal(format!("Invalid meal log entry snapshot: {error}")))?;
    entry
        .validate(row.canonical_quantity)
        .map_err(|error| match error {
            AppError::BadRequest(message) => AppError::Internal(message),
            other => other,
        })?;
    Ok(Consumption {
        id: row.id,
        template_id: row.template_id,
        name: row.name_snapshot,
        snapshot,
        canonical_quantity: row.canonical_quantity,
        entry,
        consumed_at: row.consumed_at,
        updated_at: row.updated_at,
    })
}

async fn get_food_template_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    id: Uuid,
) -> Result<Option<FoodTemplate>, AppError> {
    let row = sqlx::query_as::<_, MealTemplateRow>(
        r#"
        SELECT id, user_id, is_official, name, details, source_provider, external_id,
               updated_at, deleted_at
        FROM meal_templates
        WHERE id = $1
          AND deleted_at IS NULL
          AND (user_id = $2 OR is_official = TRUE)
        FOR SHARE
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(food_template_from_row).transpose()
}

async fn get_consumption_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    id: Uuid,
) -> Result<Option<Consumption>, AppError> {
    let row = sqlx::query_as::<_, MealLogRow>(
        r#"
        SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
               source_provider, external_id, canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at
        FROM meal_logs
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(consumption_from_row).transpose()
}

fn validate_positive(name: &str, value: f64) -> Result<(), AppError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(AppError::BadRequest(format!(
            "{name} must be a finite number greater than zero"
        )));
    }
    Ok(())
}

pub fn validate_weight_grams(weight_grams: i32) -> Result<(), AppError> {
    if !(1_000..=500_000).contains(&weight_grams) || weight_grams % 100 != 0 {
        return Err(AppError::BadRequest(
            "weight must be between 1.0 and 500.0 kg in 0.1 kg increments".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_unit_serde_rejects_noncanonical_units() {
        assert_eq!(
            serde_json::from_str::<CanonicalUnit>("\"g\"").unwrap(),
            CanonicalUnit::G
        );
        assert_eq!(
            serde_json::from_str::<CanonicalUnit>("\"ml\"").unwrap(),
            CanonicalUnit::Ml
        );
        assert!(serde_json::from_str::<CanonicalUnit>("\"unit\"").is_err());
        assert!(serde_json::from_str::<CanonicalUnit>("\"portion\"").is_err());
    }

    #[test]
    fn weight_grams_are_exact_and_bounded() {
        assert!(validate_weight_grams(1_000).is_ok());
        assert!(validate_weight_grams(72_400).is_ok());
        assert!(validate_weight_grams(500_000).is_ok());
        assert!(validate_weight_grams(900).is_err());
        assert!(validate_weight_grams(72_450).is_err());
        assert!(validate_weight_grams(500_100).is_err());
    }

    #[test]
    fn test_nutrition_values_validation() {
        let valid = NutritionValues {
            calories: 100.0,
            protein: 10.0,
            carbs: 20.0,
            fat: 5.0,
            fiber: 2.0,
            sodium_mg: Some(150.0),
            cholesterol_mg: Some(10.0),
            extended_nutrition: Default::default(),
        };
        assert!(valid.validate().is_ok());

        let mut invalid = valid.clone();
        invalid.calories = -1.0;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.protein = -0.1;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.carbs = -5.0;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.fat = -0.01;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.fiber = -1.0;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.sodium_mg = Some(-10.0);
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.cholesterol_mg = Some(-1.0);
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.calories = f64::NAN;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.protein = f64::INFINITY;
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn canonical_portions_scale_and_snapshot_history() {
        let nutrition = NutritionValues {
            calories: 400.0,
            protein: 30.0,
            carbs: 40.0,
            fat: 12.0,
            fiber: 0.0,
            sodium_mg: None,
            cholesterol_mg: None,
            extended_nutrition: BTreeMap::from([("vitaminCMg".into(), 10.0)]),
        };
        let details = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: nutrition,
            portions: vec![
                PortionDefinition {
                    id: "bar".into(),
                    name: "barra".into(),
                    portion_quantity: 1.0,
                    canonical_quantity: 30.0,
                },
                PortionDefinition {
                    id: "tbsp".into(),
                    name: "cucharada".into(),
                    portion_quantity: 5.0,
                    canonical_quantity: 30.0,
                },
            ],
            chilean_seals: vec![],
            category: None,
            typical_time: None,
        };
        details.validate().unwrap();
        let (canonical, entry) = details.entry_for(2.0, Some("bar")).unwrap();
        assert_eq!(canonical, 60.0);
        assert_eq!(
            entry.portion_snapshot.as_ref().unwrap().canonical_quantity,
            30.0
        );
        let (one_spoon, _) = details.entry_for(1.0, Some("tbsp")).unwrap();
        assert_eq!(one_spoon, 6.0);
        let consumption = Consumption {
            id: Uuid::new_v4(),
            template_id: None,
            name: "fixture".into(),
            snapshot: details.snapshot(),
            canonical_quantity: canonical,
            entry,
            consumed_at: 1,
            updated_at: 1,
        };
        let scaled = consumption.scaled_nutrition();
        assert_eq!(scaled.calories, 240.0);
        assert_eq!(scaled.extended_nutrition["vitaminCMg"], 6.0);
    }

    #[test]
    fn test_nutrition_values_serde_deny_unknown() {
        let json_data = serde_json::json!({
            "calories": 100.0,
            "protein": 10.0,
            "carbs": 20.0,
            "fat": 5.0,
            "fiber": 1.0,
            "sodiumMg": 50.0,
            "cholesterolMg": 0.0,
            "extraField": "not_allowed"
        });
        assert!(serde_json::from_value::<NutritionValues>(json_data).is_err());
    }

    #[test]
    fn optional_nutrition_fields_are_omitted_and_missing_fields_deserialize() {
        let nutrition = NutritionValues {
            calories: 100.0,
            protein: 10.0,
            carbs: 20.0,
            fat: 5.0,
            fiber: 0.0,
            sodium_mg: None,
            cholesterol_mg: None,
            extended_nutrition: Default::default(),
        };
        let serialized = serde_json::to_value(&nutrition).unwrap();
        assert!(serialized.get("sodiumMg").is_none());
        assert!(serialized.get("cholesterolMg").is_none());

        let deserialized: NutritionValues = serde_json::from_value(json!({
            "calories": 100.0,
            "protein": 10.0,
            "carbs": 20.0,
            "fat": 5.0
        }))
        .unwrap();
        assert_eq!(deserialized.sodium_mg, None);
        assert_eq!(deserialized.cholesterol_mg, None);
    }

    #[tokio::test]
    async fn test_canonical_lax_flow_and_cross_user_isolation() {
        let Ok(database_url) = std::env::var("BALANCE_TEST_DATABASE_URL") else {
            return;
        };
        let pool = PgPool::connect(&database_url).await.unwrap();
        sqlx::query(
            "INSERT INTO users (id, email) VALUES (2, 'bal011-user2@example.invalid') ON CONFLICT (id) DO NOTHING",
        )
        .execute(&pool)
        .await
        .unwrap();
        let datasource = SyncDatasource::new(pool);
        let food_id = Uuid::new_v4();
        let details = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            base_amount: 100.0,
            unit: FoodUnit::G,
            nutrition: NutritionValues {
                calories: 52.0,
                protein: 0.3,
                carbs: 14.0,
                fat: 0.2,
                fiber: 2.4,
                sodium_mg: None,
                cholesterol_mg: None,
                extended_nutrition: Default::default(),
            },
            serving_label: None,
            grams_per_unit: None,
            chilean_seals: vec![],
            category: Some("fruit".into()),
            typical_time: None,
        };
        let (food, created) = datasource
            .create_personal_food(1, food_id, "Manzana BAL-011", &details)
            .await
            .unwrap();
        assert!(created);
        assert_eq!(food.id, food_id);
        assert!(
            datasource
                .get_food_template(2, food_id)
                .await
                .unwrap()
                .is_none()
        );

        let template_collision = datasource
            .push_meal_template(
                2,
                food_id,
                "Intento ajeno".into(),
                serde_json::to_value(&details).unwrap(),
                None,
                None,
                i64::MAX - 1,
                None,
            )
            .await;
        assert!(matches!(template_collision, Err(AppError::Conflict(_))));

        let consumed_at = datasource
            .local_datetime_to_epoch("2026-08-09", "12:30")
            .await
            .unwrap();
        let log_id = Uuid::new_v4();
        let (log, logged) = datasource
            .create_consumption(1, log_id, food_id, 150.0, FoodUnit::G, consumed_at)
            .await
            .unwrap();
        assert!(logged);
        assert_eq!(log.scaled_nutrition().calories, 78.0);
        assert_eq!(
            datasource
                .get_daily_consumptions(1, "2026-08-09")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(
            datasource
                .get_daily_consumptions(2, "2026-08-09")
                .await
                .unwrap()
                .is_empty()
        );

        let mobile_log_id = Uuid::new_v4();
        assert!(
            datasource
                .push_meal_log(
                    1,
                    MealLogMutation {
                        id: mobile_log_id,
                        template_id: Some(food_id),
                        quantity: 200.0,
                        consumed_at: consumed_at + 60_000,
                        updated_at: 1_786_233_600_000,
                        deleted_at: None,
                    },
                )
                .await
                .unwrap()
                .is_none()
        );
        let mobile_log = datasource
            .get_daily_consumptions(1, "2026-08-09")
            .await
            .unwrap()
            .into_iter()
            .find(|item| item.id == mobile_log_id)
            .unwrap();
        assert_eq!(mobile_log.snapshot, details.snapshot());
        assert_eq!(mobile_log.scaled_nutrition().calories, 104.0);

        let first_date = NaiveDate::from_ymd_opt(2026, 8, 8).unwrap();
        let second_date = NaiveDate::from_ymd_opt(2026, 8, 9).unwrap();
        let (first_weight, first_status) =
            datasource.set_weight(1, first_date, 72_600).await.unwrap();
        assert_eq!(first_status, WeightUpsertStatus::Created);
        assert_eq!(first_weight.weight_grams, 72_600);
        let (_, unchanged) = datasource.set_weight(1, first_date, 72_600).await.unwrap();
        assert_eq!(unchanged, WeightUpsertStatus::Unchanged);
        let (_, updated) = datasource.set_weight(1, first_date, 72_400).await.unwrap();
        assert_eq!(updated, WeightUpsertStatus::Updated);
        datasource.set_weight(1, second_date, 72_100).await.unwrap();
        datasource.set_weight(2, second_date, 99_900).await.unwrap();
        let history = datasource
            .get_weight_history(1, Some(first_date), second_date, 30)
            .await
            .unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].measured_on, first_date);
        assert_eq!(history[1].measured_on, second_date);
        assert_eq!(
            datasource
                .get_weight_history(2, Some(first_date), second_date, 30)
                .await
                .unwrap()
                .len(),
            1
        );

        let (_, already_deleted) = datasource.soft_delete_weight(1, second_date).await.unwrap();
        assert!(!already_deleted);
        let (_, already_deleted) = datasource.soft_delete_weight(1, second_date).await.unwrap();
        assert!(already_deleted);
        assert_eq!(
            datasource
                .get_weight_history(1, Some(first_date), second_date, 30)
                .await
                .unwrap()
                .len(),
            1
        );
        datasource.set_weight(1, second_date, 72_000).await.unwrap();
        assert_eq!(
            datasource
                .get_weight_history(1, Some(first_date), second_date, 30)
                .await
                .unwrap()
                .len(),
            2
        );

        assert!(datasource.weight_tracking_enabled(1).await.unwrap());
        datasource
            .push_user_preference(
                1,
                json!({ "weightTrackingEnabled": false }),
                i64::MAX - 2,
                None,
            )
            .await
            .unwrap();
        assert!(!datasource.weight_tracking_enabled(1).await.unwrap());
    }
}
