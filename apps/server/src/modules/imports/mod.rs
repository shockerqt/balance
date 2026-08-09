use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Extension, Path},
    routing::{delete, post, put},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    connectors::{
        db::Database,
        imports::{ImportSessionStatus, ImportSummary, ImportTemplateDocument, StagedImportLog},
    },
    modules::{auth::middleware::CurrentUser, sync::hub::SyncHub},
    shared::{error::AppError, response::ApiResponse},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateImportRequest {
    operation_id: Uuid,
    file_fingerprint: String,
    expected_rows: i32,
    templates: Vec<ImportTemplateDocument>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StageImportRequest {
    rows: Vec<StagedImportLog>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelImportResponse {
    session_id: Uuid,
    cancelled: bool,
}

pub fn import_routes() -> Router {
    Router::new()
        .route("/imports/macrofactor", post(create_import))
        .route(
            "/imports/macrofactor/{session_id}/chunks",
            put(stage_import_chunk),
        )
        .route(
            "/imports/macrofactor/{session_id}/commit",
            post(commit_import),
        )
        .route("/imports/macrofactor/{session_id}", delete(cancel_import))
}

async fn create_import(
    Extension(user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Json(request): Json<CreateImportRequest>,
) -> Result<Json<ApiResponse<ImportSessionStatus>>, AppError> {
    let status = db
        .imports
        .create_session(
            user.id,
            request.operation_id,
            &request.file_fingerprint,
            request.expected_rows,
            &request.templates,
        )
        .await?;
    Ok(Json(ApiResponse::success(status)))
}

async fn stage_import_chunk(
    Extension(user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Path(session_id): Path<Uuid>,
    Json(request): Json<StageImportRequest>,
) -> Result<Json<ApiResponse<ImportSessionStatus>>, AppError> {
    let status = db
        .imports
        .stage_logs(user.id, session_id, &request.rows)
        .await?;
    Ok(Json(ApiResponse::success(status)))
}

async fn commit_import(
    Extension(user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Extension(sync_hub): Extension<SyncHub>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<ApiResponse<ImportSummary>>, AppError> {
    let summary = db.imports.commit_session(user.id, session_id).await?;
    sync_hub.notify(user.id, "mealTemplates");
    sync_hub.notify(user.id, "mealLogs");
    Ok(Json(ApiResponse::success(summary)))
}

async fn cancel_import(
    Extension(user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<ApiResponse<CancelImportResponse>>, AppError> {
    db.imports.cancel_session(user.id, session_id).await?;
    Ok(Json(ApiResponse::success(CancelImportResponse {
        session_id,
        cancelled: true,
    })))
}
