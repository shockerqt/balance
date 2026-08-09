use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    connectors::sync::{FoodDetails, NutritionSnapshot},
    shared::error::AppError,
};

const PROVIDER: &str = "macrofactor";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportProvenance {
    pub provider: String,
    pub external_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportTemplateDocument {
    pub id: Uuid,
    pub name: String,
    pub is_official: bool,
    pub details: FoodDetails,
    pub provenance: ImportProvenance,
    pub updated_at: i64,
    #[serde(rename = "_deleted")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportLogDocument {
    pub id: Uuid,
    pub template_id: Option<Uuid>,
    pub name_snapshot: String,
    pub nutrition_snapshot: NutritionSnapshot,
    pub quantity: f64,
    pub consumed_at: i64,
    pub provenance: ImportProvenance,
    pub updated_at: i64,
    #[serde(rename = "_deleted")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StagedImportLog {
    pub row_index: i32,
    pub document: ImportLogDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSummary {
    pub created: usize,
    pub updated: usize,
    pub deleted: usize,
    pub unchanged: usize,
}

impl ChangeSummary {
    fn empty() -> Self {
        Self {
            created: 0,
            updated: 0,
            deleted: 0,
            unchanged: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub templates: ChangeSummary,
    pub logs: ChangeSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSessionStatus {
    pub session_id: Uuid,
    pub status: String,
    pub expected_rows: i32,
    pub received_rows: i64,
    pub summary: Option<Value>,
}

#[derive(Debug, FromRow)]
struct ImportSessionRow {
    id: Uuid,
    provider: String,
    file_fingerprint: String,
    expected_rows: i32,
    templates: Value,
    status: String,
    summary: Option<Value>,
}

#[derive(Debug, FromRow)]
struct ExistingTemplate {
    id: Uuid,
    name: String,
    details: Value,
    external_id: String,
    deleted_at: Option<i64>,
}

#[derive(Debug, FromRow)]
struct ExistingLog {
    id: Uuid,
    template_id: Option<Uuid>,
    name_snapshot: String,
    nutrition_snapshot: Value,
    quantity: f64,
    consumed_at: i64,
    external_id: String,
    deleted_at: Option<i64>,
}

#[derive(Clone)]
pub struct ImportDatasource {
    pool: PgPool,
}

impl ImportDatasource {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create_session(
        &self,
        user_id: i32,
        operation_id: Uuid,
        file_fingerprint: &str,
        expected_rows: i32,
        templates: &[ImportTemplateDocument],
    ) -> Result<ImportSessionStatus, AppError> {
        if file_fingerprint.len() != 64
            || !file_fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(AppError::BadRequest(
                "fileFingerprint must be a SHA-256 hex digest".into(),
            ));
        }
        if !(1..=100_000).contains(&expected_rows) || expected_rows as usize == 0 {
            return Err(AppError::BadRequest(
                "expectedRows must be between 1 and 100000".into(),
            ));
        }
        validate_templates(templates)?;
        let templates = serde_json::to_value(templates)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            DELETE FROM food_import_sessions
            WHERE user_id = $1 AND (
                (status <> 'committed' AND created_at < clock_timestamp() - INTERVAL '24 hours')
                OR created_at < clock_timestamp() - INTERVAL '30 days'
            )
            "#,
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO food_import_sessions
                (id, user_id, provider, file_fingerprint, expected_rows, templates, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'staged')
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(operation_id)
        .bind(user_id)
        .bind(PROVIDER)
        .bind(file_fingerprint)
        .bind(expected_rows)
        .bind(&templates)
        .execute(&mut *tx)
        .await?;
        let session = load_session(&mut tx, user_id, operation_id, false).await?;
        if session.file_fingerprint != file_fingerprint
            || session.expected_rows != expected_rows
            || session.provider != PROVIDER
            || session.templates != templates
        {
            return Err(AppError::Conflict(
                "operationId is already used by another import".into(),
            ));
        }
        let received_rows = count_rows(&mut tx, operation_id).await?;
        tx.commit().await?;
        Ok(session_status(session, received_rows))
    }

    pub async fn stage_logs(
        &self,
        user_id: i32,
        session_id: Uuid,
        rows: &[StagedImportLog],
    ) -> Result<ImportSessionStatus, AppError> {
        if rows.is_empty() || rows.len() > 250 {
            return Err(AppError::BadRequest(
                "Each chunk must contain between 1 and 250 rows".into(),
            ));
        }
        let mut seen = HashSet::new();
        for row in rows {
            if row.row_index < 2 || !seen.insert(row.row_index) {
                return Err(AppError::BadRequest(
                    "Chunk rowIndex values must be unique and at least 2".into(),
                ));
            }
            validate_log(&row.document)?;
        }
        let mut tx = self.pool.begin().await?;
        let session = load_session(&mut tx, user_id, session_id, true).await?;
        if session.status != "staged" {
            return Err(AppError::Conflict(
                "Import session is not accepting chunks".into(),
            ));
        }
        for row in rows {
            let payload = serde_json::to_value(&row.document)
                .map_err(|error| AppError::Internal(error.to_string()))?;
            sqlx::query(
                r#"
                INSERT INTO food_import_rows (session_id, row_index, payload)
                VALUES ($1, $2, $3)
                ON CONFLICT (session_id, row_index) DO UPDATE SET payload = EXCLUDED.payload
                "#,
            )
            .bind(session_id)
            .bind(row.row_index)
            .bind(payload)
            .execute(&mut *tx)
            .await?;
        }
        let received_rows = count_rows(&mut tx, session_id).await?;
        if received_rows > i64::from(session.expected_rows) {
            return Err(AppError::BadRequest(
                "Received more rows than expected".into(),
            ));
        }
        tx.commit().await?;
        Ok(session_status(session, received_rows))
    }

    pub async fn cancel_session(&self, user_id: i32, session_id: Uuid) -> Result<(), AppError> {
        let result = sqlx::query(
            r#"
            UPDATE food_import_sessions
            SET status = 'cancelled'
            WHERE id = $1 AND user_id = $2 AND status = 'staged'
            "#,
        )
        .bind(session_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Active import session not found".into()));
        }
        Ok(())
    }

    pub async fn commit_session(
        &self,
        user_id: i32,
        session_id: Uuid,
    ) -> Result<ImportSummary, AppError> {
        let mut tx = self.pool.begin().await?;
        let session = load_session(&mut tx, user_id, session_id, true).await?;
        if session.status == "committed" {
            let summary = session
                .summary
                .ok_or_else(|| AppError::Internal("Committed import has no summary".into()))?;
            return serde_json::from_value(summary)
                .map_err(|error| AppError::Internal(error.to_string()));
        }
        if session.status != "staged" {
            return Err(AppError::Conflict(
                "Import session cannot be committed".into(),
            ));
        }
        let received_rows = count_rows(&mut tx, session_id).await?;
        if received_rows != i64::from(session.expected_rows) {
            return Err(AppError::Conflict(format!(
                "Import is incomplete: received {received_rows} of {} rows",
                session.expected_rows
            )));
        }
        let templates: Vec<ImportTemplateDocument> = serde_json::from_value(session.templates)
            .map_err(|error| AppError::BadRequest(format!("Invalid staged templates: {error}")))?;
        validate_templates(&templates)?;
        let payloads = sqlx::query_scalar::<_, Value>(
            "SELECT payload FROM food_import_rows WHERE session_id = $1 ORDER BY row_index ASC",
        )
        .bind(session_id)
        .fetch_all(&mut *tx)
        .await?;
        let logs: Vec<ImportLogDocument> = payloads
            .into_iter()
            .map(|payload| {
                serde_json::from_value(payload)
                    .map_err(|error| AppError::BadRequest(format!("Invalid staged log: {error}")))
            })
            .collect::<Result<_, _>>()?;
        for log in &logs {
            validate_log(log)?;
        }

        let now = sqlx::query_scalar::<_, i64>(
            "SELECT floor(extract(epoch from clock_timestamp()) * 1000)::bigint",
        )
        .fetch_one(&mut *tx)
        .await?;
        let template_summary = reconcile_templates(&mut tx, user_id, &templates, now).await?;
        let log_summary = reconcile_logs(&mut tx, user_id, &logs, now).await?;
        let summary = ImportSummary {
            templates: template_summary,
            logs: log_summary,
        };
        let summary_json = serde_json::to_value(&summary)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        sqlx::query(
            r#"
            UPDATE food_import_sessions
            SET status = 'committed', summary = $3, committed_at = clock_timestamp()
            WHERE id = $1 AND user_id = $2
            "#,
        )
        .bind(session_id)
        .bind(user_id)
        .bind(summary_json)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM food_import_rows WHERE session_id = $1")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(summary)
    }
}

async fn load_session(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    session_id: Uuid,
    for_update: bool,
) -> Result<ImportSessionRow, AppError> {
    let suffix = if for_update { " FOR UPDATE" } else { "" };
    let sql = format!(
        "SELECT id, provider, file_fingerprint, expected_rows, templates, status, summary FROM food_import_sessions WHERE id = $1 AND user_id = $2{suffix}"
    );
    sqlx::query_as::<_, ImportSessionRow>(&sql)
        .bind(session_id)
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Import session not found".into()))
}

async fn count_rows(tx: &mut Transaction<'_, Postgres>, session_id: Uuid) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM food_import_rows WHERE session_id = $1")
            .bind(session_id)
            .fetch_one(&mut **tx)
            .await?,
    )
}

fn session_status(session: ImportSessionRow, received_rows: i64) -> ImportSessionStatus {
    ImportSessionStatus {
        session_id: session.id,
        status: session.status,
        expected_rows: session.expected_rows,
        received_rows,
        summary: session.summary,
    }
}

fn validate_provenance(provenance: &ImportProvenance) -> Result<(), AppError> {
    if provenance.provider != PROVIDER
        || provenance.external_id.is_empty()
        || provenance.external_id.len() > 128
    {
        return Err(AppError::BadRequest(
            "Invalid MacroFactor provenance".into(),
        ));
    }
    Ok(())
}

fn validate_templates(templates: &[ImportTemplateDocument]) -> Result<(), AppError> {
    if templates.len() > 10_000 {
        return Err(AppError::BadRequest(
            "An import cannot contain more than 10000 templates".into(),
        ));
    }
    let mut ids = HashSet::new();
    let mut external_ids = HashSet::new();
    for template in templates {
        validate_provenance(&template.provenance)?;
        template.details.validate()?;
        if template.is_official
            || template.deleted
            || template.name.trim().is_empty()
            || template.name.chars().count() > 160
        {
            return Err(AppError::BadRequest("Invalid imported template".into()));
        }
        if !ids.insert(template.id)
            || !external_ids.insert(template.provenance.external_id.as_str())
        {
            return Err(AppError::BadRequest(
                "Imported templates must have unique identities".into(),
            ));
        }
    }
    Ok(())
}

fn validate_log(log: &ImportLogDocument) -> Result<(), AppError> {
    validate_provenance(&log.provenance)?;
    log.nutrition_snapshot.validate()?;
    if log.deleted
        || log.name_snapshot.trim().is_empty()
        || log.name_snapshot.chars().count() > 160
        || !log.quantity.is_finite()
        || log.quantity <= 0.0
        || log.consumed_at <= 0
    {
        return Err(AppError::BadRequest("Invalid imported meal log".into()));
    }
    Ok(())
}

async fn reconcile_templates(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    desired: &[ImportTemplateDocument],
    now: i64,
) -> Result<ChangeSummary, AppError> {
    let existing = sqlx::query_as::<_, ExistingTemplate>(
        r#"
        SELECT id, name, details, external_id, deleted_at
        FROM meal_templates
        WHERE user_id = $1 AND source_provider = $2 AND external_id IS NOT NULL
        FOR UPDATE
        "#,
    )
    .bind(user_id)
    .bind(PROVIDER)
    .fetch_all(&mut **tx)
    .await?;
    let mut existing: HashMap<String, ExistingTemplate> = existing
        .into_iter()
        .map(|row| (row.external_id.clone(), row))
        .collect();
    let mut summary = ChangeSummary::empty();
    for template in desired {
        let details = serde_json::to_value(&template.details)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        if let Some(current) = existing.remove(&template.provenance.external_id) {
            if current.id != template.id {
                return Err(AppError::Conflict(
                    "Imported template identity changed unexpectedly".into(),
                ));
            }
            let changed = current.name != template.name
                || current.details != details
                || current.deleted_at.is_some();
            if changed {
                sqlx::query(
                    "UPDATE meal_templates SET name = $3, details = $4, updated_at = $5, deleted_at = NULL WHERE id = $1 AND user_id = $2",
                )
                .bind(current.id).bind(user_id).bind(&template.name).bind(details).bind(now)
                .execute(&mut **tx).await?;
                summary.updated += 1;
            } else {
                summary.unchanged += 1;
            }
        } else {
            let occupied =
                sqlx::query_scalar::<_, i64>("SELECT count(*) FROM meal_templates WHERE id = $1")
                    .bind(template.id)
                    .fetch_one(&mut **tx)
                    .await?;
            if occupied != 0 {
                return Err(AppError::Conflict(
                    "Imported template id is already in use".into(),
                ));
            }
            sqlx::query(
                r#"
                INSERT INTO meal_templates
                    (id, user_id, is_official, name, details, source_provider, external_id, updated_at, deleted_at)
                VALUES ($1, $2, FALSE, $3, $4, $5, $6, $7, NULL)
                "#,
            )
            .bind(template.id).bind(user_id).bind(&template.name).bind(details)
            .bind(PROVIDER).bind(&template.provenance.external_id).bind(now)
            .execute(&mut **tx).await?;
            summary.created += 1;
        }
    }
    for current in existing.into_values() {
        if current.deleted_at.is_none() {
            sqlx::query("UPDATE meal_templates SET updated_at = $3, deleted_at = $3 WHERE id = $1 AND user_id = $2")
                .bind(current.id).bind(user_id).bind(now).execute(&mut **tx).await?;
            summary.deleted += 1;
        } else {
            summary.unchanged += 1;
        }
    }
    Ok(summary)
}

async fn reconcile_logs(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    desired: &[ImportLogDocument],
    now: i64,
) -> Result<ChangeSummary, AppError> {
    let existing = sqlx::query_as::<_, ExistingLog>(
        r#"
        SELECT id, template_id, name_snapshot, nutrition_snapshot, quantity,
               consumed_at, external_id, deleted_at
        FROM meal_logs
        WHERE user_id = $1 AND source_provider = $2 AND external_id IS NOT NULL
        FOR UPDATE
        "#,
    )
    .bind(user_id)
    .bind(PROVIDER)
    .fetch_all(&mut **tx)
    .await?;
    let mut existing: HashMap<String, ExistingLog> = existing
        .into_iter()
        .map(|row| (row.external_id.clone(), row))
        .collect();
    let mut desired_ids = HashSet::new();
    let mut summary = ChangeSummary::empty();
    for log in desired {
        if !desired_ids.insert(log.provenance.external_id.as_str()) {
            return Err(AppError::BadRequest(
                "Imported logs must have unique external identities".into(),
            ));
        }
        if let Some(template_id) = log.template_id {
            let valid = sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM meal_templates WHERE id = $1 AND user_id = $2 AND source_provider = $3 AND deleted_at IS NULL",
            )
            .bind(template_id).bind(user_id).bind(PROVIDER).fetch_one(&mut **tx).await?;
            if valid == 0 {
                return Err(AppError::BadRequest(
                    "Imported log references an invalid template".into(),
                ));
            }
        }
        let snapshot = serde_json::to_value(&log.nutrition_snapshot)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        if let Some(current) = existing.remove(&log.provenance.external_id) {
            if current.id != log.id {
                return Err(AppError::Conflict(
                    "Imported log identity changed unexpectedly".into(),
                ));
            }
            let changed = current.template_id != log.template_id
                || current.name_snapshot != log.name_snapshot
                || current.nutrition_snapshot != snapshot
                || current.quantity != log.quantity
                || current.consumed_at != log.consumed_at
                || current.deleted_at.is_some();
            if changed {
                sqlx::query(
                    r#"
                    UPDATE meal_logs SET template_id = $3, name_snapshot = $4,
                        nutrition_snapshot = $5, quantity = $6, consumed_at = $7,
                        updated_at = $8, deleted_at = NULL
                    WHERE id = $1 AND user_id = $2
                    "#,
                )
                .bind(current.id)
                .bind(user_id)
                .bind(log.template_id)
                .bind(&log.name_snapshot)
                .bind(snapshot)
                .bind(log.quantity)
                .bind(log.consumed_at)
                .bind(now)
                .execute(&mut **tx)
                .await?;
                summary.updated += 1;
            } else {
                summary.unchanged += 1;
            }
        } else {
            let occupied =
                sqlx::query_scalar::<_, i64>("SELECT count(*) FROM meal_logs WHERE id = $1")
                    .bind(log.id)
                    .fetch_one(&mut **tx)
                    .await?;
            if occupied != 0 {
                return Err(AppError::Conflict(
                    "Imported log id is already in use".into(),
                ));
            }
            sqlx::query(
                r#"
                INSERT INTO meal_logs
                    (id, user_id, template_id, name_snapshot, nutrition_snapshot,
                     source_provider, external_id, quantity, consumed_at, updated_at, deleted_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
                "#,
            )
            .bind(log.id)
            .bind(user_id)
            .bind(log.template_id)
            .bind(&log.name_snapshot)
            .bind(snapshot)
            .bind(PROVIDER)
            .bind(&log.provenance.external_id)
            .bind(log.quantity)
            .bind(log.consumed_at)
            .bind(now)
            .execute(&mut **tx)
            .await?;
            summary.created += 1;
        }
    }
    for current in existing.into_values() {
        if current.deleted_at.is_none() {
            sqlx::query("UPDATE meal_logs SET updated_at = $3, deleted_at = $3 WHERE id = $1 AND user_id = $2")
                .bind(current.id).bind(user_id).bind(now).execute(&mut **tx).await?;
            summary.deleted += 1;
        } else {
            summary.unchanged += 1;
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::sync::{FOOD_SCHEMA_VERSION, FoodUnit, NutritionValues};
    use std::collections::BTreeMap;

    fn details() -> FoodDetails {
        FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            base_amount: 1.0,
            unit: FoodUnit::Portion,
            serving_label: Some("serving".into()),
            grams_per_unit: Some(100.0),
            nutrition: NutritionValues {
                calories: 200.0,
                protein: 20.0,
                carbs: 10.0,
                fat: 8.0,
                fiber: 2.0,
                sodium_mg: Some(50.0),
                cholesterol_mg: None,
                extended_nutrition: BTreeMap::from([("vitaminCMg".into(), 12.0)]),
            },
            chilean_seals: vec![],
            category: None,
            typical_time: Some("08:00".into()),
        }
    }

    #[tokio::test]
    async fn staged_import_is_atomic_idempotent_and_source_scoped() {
        let Ok(database_url) = std::env::var("BALANCE_TEST_DATABASE_URL") else {
            return;
        };
        let pool = PgPool::connect(&database_url).await.unwrap();
        let datasource = ImportDatasource::new(pool.clone());
        let template_id = Uuid::new_v4();
        let log_id = Uuid::new_v4();
        let template = ImportTemplateDocument {
            id: template_id,
            name: "BAL-016 fixture".into(),
            is_official: false,
            details: details(),
            provenance: ImportProvenance {
                provider: PROVIDER.into(),
                external_id: "fixture-template".into(),
            },
            updated_at: 1,
            deleted: false,
        };
        let log = ImportLogDocument {
            id: log_id,
            template_id: Some(template_id),
            name_snapshot: template.name.clone(),
            nutrition_snapshot: template.details.snapshot(),
            quantity: 1.0,
            consumed_at: 1_723_000_000_000,
            provenance: ImportProvenance {
                provider: PROVIDER.into(),
                external_id: "fixture-log".into(),
            },
            updated_at: 1,
            deleted: false,
        };

        let incomplete_id = Uuid::new_v4();
        datasource
            .create_session(
                1,
                incomplete_id,
                &"a".repeat(64),
                2,
                std::slice::from_ref(&template),
            )
            .await
            .unwrap();
        datasource
            .stage_logs(
                1,
                incomplete_id,
                &[StagedImportLog {
                    row_index: 2,
                    document: log.clone(),
                }],
            )
            .await
            .unwrap();
        assert!(matches!(
            datasource.commit_session(1, incomplete_id).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM meal_logs WHERE user_id = 1 AND source_provider = $1",
            )
            .bind(PROVIDER)
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );

        let import_id = Uuid::new_v4();
        datasource
            .create_session(
                1,
                import_id,
                &"b".repeat(64),
                1,
                std::slice::from_ref(&template),
            )
            .await
            .unwrap();
        datasource
            .stage_logs(
                1,
                import_id,
                &[StagedImportLog {
                    row_index: 2,
                    document: log.clone(),
                }],
            )
            .await
            .unwrap();
        let first = datasource.commit_session(1, import_id).await.unwrap();
        assert_eq!(first.templates.created, 1);
        assert_eq!(first.logs.created, 1);
        assert_eq!(
            datasource
                .commit_session(1, import_id)
                .await
                .unwrap()
                .logs
                .created,
            1
        );

        let repeat_id = Uuid::new_v4();
        datasource
            .create_session(1, repeat_id, &"c".repeat(64), 1, &[template])
            .await
            .unwrap();
        datasource
            .stage_logs(
                1,
                repeat_id,
                &[StagedImportLog {
                    row_index: 2,
                    document: log,
                }],
            )
            .await
            .unwrap();
        let repeat = datasource.commit_session(1, repeat_id).await.unwrap();
        assert_eq!(repeat.templates.unchanged, 1);
        assert_eq!(repeat.logs.unchanged, 1);
    }
}
