from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SYNC = ROOT / 'apps/server/src/connectors/sync.rs'
WS = ROOT / 'apps/server/src/modules/sync/ws.rs'
MIG = ROOT / 'apps/server/migrations/20260821010000_canonical_units_portions.sql'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    return text.replace(old, new, 1)


def replace_pattern(text: str, pattern: str, new: str, label: str) -> str:
    text2, count = re.subn(pattern, new, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return text2

sync = SYNC.read_text()
sync = replace_once(sync, 'pub const FOOD_SCHEMA_VERSION: i32 = 1;', 'pub const FOOD_SCHEMA_VERSION: i32 = 2;', 'schema version')

new_domain = r'''#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CanonicalUnit {
    G,
    Ml,
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
            return Err(AppError::BadRequest("portion id must contain 1 to 80 characters".into()));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 120 {
            return Err(AppError::BadRequest("portion name must contain 1 to 120 characters".into()));
        }
        validate_positive("portionQuantity", self.portion_quantity)?;
        validate_positive("canonicalQuantity", self.canonical_quantity)
    }
}

impl PortionSnapshot {
    fn validate(&self) -> Result<(), AppError> {
        if matches!(&self.portion_id, Some(id) if id.trim().is_empty() || id.chars().count() > 80) {
            return Err(AppError::BadRequest("entry.portionSnapshot.portionId is invalid".into()));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 120 {
            return Err(AppError::BadRequest("entry.portionSnapshot.name is invalid".into()));
        }
        validate_positive("entry.portionSnapshot.portionQuantity", self.portion_quantity)?;
        validate_positive("entry.portionSnapshot.canonicalQuantity", self.canonical_quantity)
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
            return Err(AppError::BadRequest("Unsupported food schema version".into()));
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

    pub fn entry_for(&self, quantity: f64, portion_id: Option<&str>) -> Result<(f64, MealLogEntry), AppError> {
        validate_positive("quantity", quantity)?;
        if let Some(portion_id) = portion_id {
            let portion = self.portions.iter().find(|portion| portion.id == portion_id)
                .ok_or_else(|| AppError::BadRequest("Unknown portionId for this food".into()))?;
            let canonical_quantity = quantity / portion.portion_quantity * portion.canonical_quantity;
            let entry = MealLogEntry {
                entered_quantity: quantity,
                portion_snapshot: Some(portion.into()),
            };
            entry.validate(canonical_quantity)?;
            Ok((canonical_quantity, entry))
        } else {
            let entry = MealLogEntry { entered_quantity: quantity, portion_snapshot: None };
            entry.validate(quantity)?;
            Ok((quantity, entry))
        }
    }
}

impl NutritionSnapshot {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != FOOD_SCHEMA_VERSION {
            return Err(AppError::BadRequest("Unsupported nutrition snapshot schema version".into()));
        }
        self.nutrition_per100.validate()
    }
}

'''
sync = replace_pattern(
    sync,
    r'#\[derive\(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq\)\]\n#\[serde\(rename_all = "lowercase"\)\]\npub enum FoodUnit \{.*?\nimpl NutritionValues \{',
    new_domain + 'impl NutritionValues {',
    'domain block',
)

old_rows = '''pub struct MealLogRow {
    pub id: Uuid,
    pub user_id: i32,
    pub template_id: Option<Uuid>,
    pub name_snapshot: String,
    pub nutrition_snapshot: Value,
    pub source_provider: Option<String>,
    pub external_id: Option<String>,
    pub quantity: f64,
    pub consumed_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct MealLogMutation {
    pub id: Uuid,
    pub template_id: Option<Uuid>,
    pub quantity: f64,
    pub consumed_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}'''
new_rows = '''pub struct MealLogRow {
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
}'''
sync = replace_once(sync, old_rows, new_rows, 'meal log row structs')

old_consumption = '''pub struct Consumption {
    pub id: Uuid,
    pub template_id: Option<Uuid>,
    pub name: String,
    pub snapshot: NutritionSnapshot,
    pub quantity: f64,
    pub consumed_at: i64,
    pub updated_at: i64,
}

impl Consumption {
    pub fn scaled_nutrition(&self) -> NutritionValues {
        let factor = self.quantity / self.snapshot.base_amount;
        let nutrition = &self.snapshot.nutrition;'''
new_consumption = '''pub struct Consumption {
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
        let nutrition = &self.snapshot.nutrition_per100;'''
sync = replace_once(sync, old_consumption, new_consumption, 'consumption struct')

meal_logs_block = r'''    // --- MEAL LOGS ---
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
            return Err(AppError::Conflict("Meal log id could not be written for this user".into()));
        }
        tx.commit().await?;
        Ok(None)
    }

    // --- WEIGHT LOGS ---'''
sync = replace_pattern(sync, r'    // --- MEAL LOGS ---.*?    // --- WEIGHT LOGS ---', meal_logs_block, 'meal log datasource block')

create_consumption = r'''    pub async fn create_consumption(
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
        let entry_snapshot = serde_json::to_value(&entry)
            .map_err(|error| AppError::Internal(error.to_string()))?;
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
'''
sync = replace_pattern(sync, r'    pub async fn create_consumption\(.*?\n    pub async fn get_daily_consumptions\(', create_consumption + '\n    pub async fn get_daily_consumptions(', 'create consumption')

sync = sync.replace(
    'source_provider, external_id, quantity, consumed_at, updated_at, deleted_at',
    'source_provider, external_id, canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at'
)
sync = sync.replace(
    'source_provider, external_id,\n                      quantity, consumed_at, updated_at,\n                      deleted_at',
    'source_provider, external_id, canonical_quantity, entry_snapshot,\n                      consumed_at, updated_at, deleted_at'
)

update_consumption = r'''    pub async fn update_consumption(
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
                    let canonical = quantity / portion.portion_quantity * portion.canonical_quantity;
                    let entry = MealLogEntry {
                        entered_quantity: quantity,
                        portion_snapshot: Some(portion.clone()),
                    };
                    entry.validate(canonical)?;
                    (canonical, entry)
                }
                None => {
                    let entry = MealLogEntry { entered_quantity: quantity, portion_snapshot: None };
                    entry.validate(quantity)?;
                    (quantity, entry)
                }
            }
        } else {
            (current.canonical_quantity, current.entry.clone())
        };
        let entry_snapshot = serde_json::to_value(&entry)
            .map_err(|error| AppError::Internal(error.to_string()))?;
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
'''
sync = replace_pattern(sync, r'    pub async fn update_consumption\(.*?\n    pub async fn soft_delete_consumption\(', update_consumption + '\n    pub async fn soft_delete_consumption(', 'update consumption')

sync = sync.replace(
    'nutrition_snapshot, source_provider, external_id,\n                      quantity, consumed_at, updated_at,\n                      deleted_at',
    'nutrition_snapshot, source_provider, external_id,\n                      canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at'
)

old_from_row = '''    validate_quantity(row.quantity)?;
    Ok(Consumption {
        id: row.id,
        template_id: row.template_id,
        name: row.name_snapshot,
        snapshot,
        quantity: row.quantity,
        consumed_at: row.consumed_at,
        updated_at: row.updated_at,
    })'''
new_from_row = '''    let entry: MealLogEntry = serde_json::from_value(row.entry_snapshot)
        .map_err(|error| AppError::Internal(format!("Invalid meal log entry snapshot: {error}")))?;
    entry.validate(row.canonical_quantity).map_err(|error| match error {
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
    })'''
sync = replace_once(sync, old_from_row, new_from_row, 'consumption row mapping')

sync = replace_pattern(sync, r'fn validate_quantity\(quantity: f64\).*?\n\}\n\nfn validate_serving_metadata\(.*?\n\}\n', '''fn validate_positive(name: &str, value: f64) -> Result<(), AppError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(AppError::BadRequest(format!(
            "{name} must be a finite number greater than zero"
        )));
    }
    Ok(())
}
''', 'legacy quantity/serving validators')

# Replace stale unit/domain tests wholesale with focused V2 invariants while preserving unrelated tests.
sync = replace_pattern(sync, r'    #\[test\]\n    fn test_food_unit_serde\(\).*?\n    #\[test\]\n    fn weight_grams_are_exact_and_bounded', '''    #[test]
    fn canonical_unit_serde_rejects_noncanonical_units() {
        assert_eq!(serde_json::from_str::<CanonicalUnit>("\\\"g\\\"").unwrap(), CanonicalUnit::G);
        assert_eq!(serde_json::from_str::<CanonicalUnit>("\\\"ml\\\"").unwrap(), CanonicalUnit::Ml);
        assert!(serde_json::from_str::<CanonicalUnit>("\\\"unit\\\"").is_err());
        assert!(serde_json::from_str::<CanonicalUnit>("\\\"portion\\\"").is_err());
    }

    #[test]
    fn weight_grams_are_exact_and_bounded''', 'unit serde test')

# Older tests below instantiate V1 shapes; replace the affected tail with V2 coverage.
sync = replace_pattern(sync, r'    #\[test\]\n    fn extended_nutrition_is_allowlisted_validated_and_scaled\(\).*?\n    #\[test\]\n    fn test_nutrition_values_serde_deny_unknown', '''    #[test]
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
            portions: vec![PortionDefinition {
                id: "bar".into(),
                name: "barra".into(),
                portion_quantity: 1.0,
                canonical_quantity: 30.0,
            }, PortionDefinition {
                id: "tbsp".into(),
                name: "cucharada".into(),
                portion_quantity: 5.0,
                canonical_quantity: 30.0,
            }],
            chilean_seals: vec![],
            category: None,
            typical_time: None,
        };
        details.validate().unwrap();
        let (canonical, entry) = details.entry_for(2.0, Some("bar")).unwrap();
        assert_eq!(canonical, 60.0);
        assert_eq!(entry.portion_snapshot.as_ref().unwrap().canonical_quantity, 30.0);
        let (one_spoon, _) = details.entry_for(1.0, Some("tbsp")).unwrap();
        assert_eq!(one_spoon, 6.0);
        let consumption = Consumption {
            id: Uuid::new_v4(), template_id: None, name: "fixture".into(),
            snapshot: details.snapshot(), canonical_quantity: canonical, entry,
            consumed_at: 1, updated_at: 1,
        };
        let scaled = consumption.scaled_nutrition();
        assert_eq!(scaled.calories, 240.0);
        assert_eq!(scaled.extended_nutrition["vitaminCMg"], 6.0);
    }

    #[test]
    fn test_nutrition_values_serde_deny_unknown''', 'V1 domain tests')

sync = replace_pattern(sync, r'    #\[test\]\n    fn test_scaled_nutrition\(\).*?\n    \}\n', '', 'old scale test')

SYNC.write_text(sync)

ws = WS.read_text()
ws = ws.replace('sync::{FoodDetails, MealLogMutation, NutritionSnapshot, validate_weight_grams}', 'sync::{FoodDetails, MealLogEntry, MealLogMutation, NutritionSnapshot, validate_weight_grams}')
ws = replace_once(ws, '''    quantity: f64,
    consumed_at: i64,''', '''    canonical_quantity: f64,
    entry: MealLogEntry,
    consumed_at: i64,''', 'ws log document')
ws = ws.replace('"quantity": r.quantity,', '"canonicalQuantity": r.canonical_quantity,\n                        "entry": r.entry_snapshot,')
ws = ws.replace('quantity: doc.quantity,', 'canonical_quantity: doc.canonical_quantity,\n                            entry: doc.entry,')
ws = ws.replace('"quantity": conflict.quantity,', '"canonicalQuantity": conflict.canonical_quantity,\n                        "entry": conflict.entry_snapshot,')
WS.write_text(ws)

MIG.write_text(r'''-- BAL-027: make g/ml the only nutrition basis and preserve entered portion evidence.

CREATE OR REPLACE FUNCTION pg_temp.scale_nutrition(nutrition jsonb, factor double precision)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT COALESCE(jsonb_object_agg(key,
    CASE
      WHEN key = 'extendedNutrition' AND jsonb_typeof(value) = 'object' THEN
        (SELECT COALESCE(jsonb_object_agg(e.key, to_jsonb((e.value #>> '{}')::double precision * factor)), '{}'::jsonb)
         FROM jsonb_each(value) e)
      WHEN jsonb_typeof(value) = 'number' THEN to_jsonb((value #>> '{}')::double precision * factor)
      ELSE value
    END), '{}'::jsonb)
FROM jsonb_each(nutrition)
$$;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM meal_templates
    WHERE COALESCE((details->>'schemaVersion')::int, 0) = 1
      AND details->>'unit' NOT IN ('g', 'ml')
      AND NOT (
        jsonb_typeof(details->'gramsPerUnit') = 'number'
        AND (details->>'gramsPerUnit')::double precision > 0
      )
  ) THEN
    RAISE EXCEPTION 'BAL-027 cannot safely migrate a legacy food without canonical conversion metadata';
  END IF;
  IF EXISTS (
    SELECT 1 FROM meal_logs
    WHERE COALESCE((nutrition_snapshot->>'schemaVersion')::int, 0) = 1
      AND nutrition_snapshot->>'unit' NOT IN ('g', 'ml')
      AND NOT (
        jsonb_typeof(nutrition_snapshot->'gramsPerUnit') = 'number'
        AND (nutrition_snapshot->>'gramsPerUnit')::double precision > 0
      )
  ) THEN
    RAISE EXCEPTION 'BAL-027 cannot safely migrate a legacy log without canonical conversion metadata';
  END IF;
END
$guard$;

UPDATE meal_templates
SET details = jsonb_strip_nulls(jsonb_build_object(
  'schemaVersion', 2,
  'canonicalUnit', CASE WHEN details->>'unit' = 'ml' THEN 'ml' ELSE 'g' END,
  'nutritionPer100', pg_temp.scale_nutrition(
      details->'nutrition',
      100.0 / ((details->>'baseAmount')::double precision *
        CASE WHEN details->>'unit' IN ('g','ml') THEN 1.0 ELSE (details->>'gramsPerUnit')::double precision END)
  ),
  'portions', CASE
      WHEN jsonb_typeof(details->'gramsPerUnit') = 'number' AND (details->>'gramsPerUnit')::double precision > 0 THEN
        jsonb_build_array(jsonb_build_object(
          'id', 'legacy-serving',
          'name', COALESCE(NULLIF(details->>'servingLabel',''), details->>'unit'),
          'portionQuantity', 1,
          'canonicalQuantity', (details->>'gramsPerUnit')::double precision
        ))
      ELSE '[]'::jsonb END,
  'chileanSeals', COALESCE(details->'chileanSeals','[]'::jsonb),
  'category', details->'category',
  'typicalTime', details->'typicalTime'
))
WHERE COALESCE((details->>'schemaVersion')::int, 0) = 1;

ALTER TABLE meal_logs RENAME COLUMN quantity TO canonical_quantity;
ALTER TABLE meal_logs ADD COLUMN entry_snapshot JSONB;

UPDATE meal_logs
SET
  canonical_quantity = canonical_quantity * CASE
      WHEN nutrition_snapshot->>'unit' IN ('g','ml') THEN 1.0
      ELSE (nutrition_snapshot->>'gramsPerUnit')::double precision END,
  entry_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'enteredQuantity', canonical_quantity,
      'portionSnapshot', CASE
        WHEN nutrition_snapshot->>'unit' IN ('g','ml') THEN NULL
        ELSE jsonb_build_object(
          'name', COALESCE(NULLIF(nutrition_snapshot->>'servingLabel',''), nutrition_snapshot->>'unit'),
          'portionQuantity', 1,
          'canonicalQuantity', (nutrition_snapshot->>'gramsPerUnit')::double precision
        ) END
  )),
  nutrition_snapshot = jsonb_build_object(
      'schemaVersion', 2,
      'canonicalUnit', CASE WHEN nutrition_snapshot->>'unit' = 'ml' THEN 'ml' ELSE 'g' END,
      'nutritionPer100', pg_temp.scale_nutrition(
          nutrition_snapshot->'nutrition',
          100.0 / ((nutrition_snapshot->>'baseAmount')::double precision *
            CASE WHEN nutrition_snapshot->>'unit' IN ('g','ml') THEN 1.0 ELSE (nutrition_snapshot->>'gramsPerUnit')::double precision END)
      )
  )
WHERE COALESCE((nutrition_snapshot->>'schemaVersion')::int, 0) = 1;

-- Direct canonical legacy logs need the original quantity as entered evidence.
UPDATE meal_logs
SET entry_snapshot = jsonb_build_object('enteredQuantity', canonical_quantity)
WHERE entry_snapshot IS NULL OR entry_snapshot = '{}'::jsonb;

ALTER TABLE meal_logs ALTER COLUMN entry_snapshot SET NOT NULL;
ALTER TABLE meal_logs ADD CONSTRAINT meal_logs_canonical_quantity_positive CHECK (canonical_quantity > 0);
''')
