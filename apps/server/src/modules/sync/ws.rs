use axum::{
    Extension, Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    connectors::{
        db::Database,
        sync::{FoodDetails, MealLogMutation, NutritionSnapshot, validate_weight_grams},
    },
    modules::{auth::middleware::CurrentUser, sync::hub::SyncHub},
    shared::error::AppError,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PullCheckpoint {
    pub updated_at: i64,
    pub id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PullRequest {
    pub request_id: String,
    pub collection: String,
    pub checkpoint: Option<PullCheckpoint>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushRow {
    pub new_document_state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushRequest {
    pub request_id: String,
    pub collection: String,
    pub rows: Vec<PushRow>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum IncomingMessage {
    Pull(PullRequest),
    Push(PushRequest),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportProvenanceDocument {
    provider: String,
    external_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MealTemplateDocument {
    id: Uuid,
    name: String,
    details: FoodDetails,
    #[serde(default)]
    provenance: Option<ImportProvenanceDocument>,
    is_official: bool,
    updated_at: i64,
    #[serde(rename = "_deleted")]
    deleted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MealLogDocument {
    id: Uuid,
    template_id: Option<Uuid>,
    name_snapshot: String,
    nutrition_snapshot: NutritionSnapshot,
    #[serde(default)]
    provenance: Option<ImportProvenanceDocument>,
    quantity: f64,
    consumed_at: i64,
    updated_at: i64,
    #[serde(rename = "_deleted")]
    deleted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WeightLogDocument {
    id: String,
    weight_grams: i32,
    updated_at: i64,
    #[serde(rename = "_deleted")]
    deleted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UserPreferencesDocument {
    #[allow(dead_code)]
    id: Value,
    preferences: Value,
    updated_at: i64,
    #[serde(rename = "_deleted")]
    deleted: bool,
}

pub fn sync_routes() -> Router {
    Router::new().route("/ws/sync", get(ws_handler))
}

pub fn public_template_routes() -> Router {
    Router::new().route("/templates/official", get(get_official_templates_handler))
}

// GET /api/templates/official (Public Unauthenticated Endpoint)
async fn get_official_templates_handler(
    Extension(db): Extension<Arc<Database>>,
) -> impl IntoResponse {
    match db.sync.get_official_templates().await {
        Ok(templates) => {
            let docs: Vec<Value> = templates
                .into_iter()
                .map(|r| {
                    json!({
                        "id": r.id.to_string(),
                        "name": r.name,
                        "details": r.details,
                        "provenance": provenance_json(r.source_provider, r.external_id),
                        "isOfficial": r.is_official,
                        "updatedAt": r.updated_at,
                        "_deleted": false
                    })
                })
                .collect();
            (StatusCode::OK, axum::Json(json!({ "templates": docs }))).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to fetch official templates: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch official templates",
            )
                .into_response()
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
    Extension(sync_hub): Extension<SyncHub>,
) -> impl IntoResponse {
    ws.protocols(["balance"])
        .on_upgrade(move |socket| handle_socket(socket, current_user, db, sync_hub))
}

async fn handle_socket(
    mut socket: WebSocket,
    user: CurrentUser,
    db: Arc<Database>,
    sync_hub: SyncHub,
) {
    tracing::info!("RxDB WebSocket connected for user_id={}", user.id);
    let mut invalidations = sync_hub.subscribe();

    loop {
        tokio::select! {
            message = socket.recv() => {
                let Some(Ok(msg)) = message else { break };
                if let Message::Text(text) = msg {
                    match serde_json::from_str::<IncomingMessage>(&text) {
                        Ok(IncomingMessage::Pull(req)) => {
                            handle_pull(&mut socket, &user, &db, req).await;
                        }
                        Ok(IncomingMessage::Push(req)) => {
                            handle_push(&mut socket, &user, &db, &sync_hub, req).await;
                        }
                        Err(error) => {
                            tracing::warn!(?error, "Failed to parse sync message");
                            send_sync_error(&mut socket, "", "invalid_message", "Invalid sync message").await;
                        }
                    }
                }
            }
            invalidation = invalidations.recv() => {
                match invalidation {
                    Ok(invalidation) if invalidation.user_id == user.id => {
                        let response = json!({
                            "event": "collection_changed",
                            "collection": invalidation.collection
                        });
                        if socket.send(Message::Text(response.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    tracing::info!("RxDB WebSocket disconnected for user_id={}", user.id);
}

async fn handle_pull(
    socket: &mut WebSocket,
    user: &CurrentUser,
    db: &Arc<Database>,
    req: PullRequest,
) {
    let request_id = req.request_id.clone();
    let limit = req.limit.unwrap_or(50);
    if request_id.is_empty() || !(1..=200).contains(&limit) {
        send_sync_error(
            socket,
            &request_id,
            "invalid_request",
            "requestId is required and limit must be between 1 and 200",
        )
        .await;
        return;
    }
    let checkpoint_updated_at = req.checkpoint.as_ref().map(|c| c.updated_at).unwrap_or(0);
    let checkpoint_id = req.checkpoint.as_ref().and_then(|c| c.id.as_deref());

    match req.collection.as_str() {
        "userPreferences" => {
            let rows = match db
                .sync
                .pull_user_preferences(user.id, checkpoint_updated_at, limit)
                .await
            {
                Ok(rows) => rows,
                Err(error) => {
                    tracing::error!(?error, "Failed to pull user preferences");
                    send_sync_error(
                        socket,
                        &request_id,
                        "database_error",
                        "Database operation failed",
                    )
                    .await;
                    return;
                }
            };

            let has_more = (rows.len() as i64) == limit;
            let next_checkpoint = rows.last().map(|r| {
                json!({
                    "updatedAt": r.updated_at,
                    "id": r.id.to_string()
                })
            });

            let documents: Vec<Value> = rows
                .into_iter()
                .map(|r| {
                    json!({
                        "id": r.id,
                        "preferences": r.preferences,
                        "updatedAt": r.updated_at,
                        "_deleted": r.deleted_at.is_some(),
                    })
                })
                .collect();

            let resp = json!({
                "event": "pull_response",
                "requestId": request_id,
                "collection": "userPreferences",
                "documents": documents,
                "checkpoint": next_checkpoint,
                "hasMoreDocuments": has_more
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        "mealTemplates" => {
            let checkpoint_id = match parse_uuid_checkpoint(checkpoint_id) {
                Ok(value) => value,
                Err(message) => {
                    send_sync_error(socket, &request_id, "invalid_checkpoint", &message).await;
                    return;
                }
            };
            let rows = match db
                .sync
                .pull_meal_templates(user.id, checkpoint_updated_at, checkpoint_id, limit)
                .await
            {
                Ok(rows) => rows,
                Err(error) => {
                    tracing::error!(?error, "Failed to pull meal templates");
                    send_sync_error(
                        socket,
                        &request_id,
                        "database_error",
                        "Database operation failed",
                    )
                    .await;
                    return;
                }
            };

            let has_more = (rows.len() as i64) == limit;
            let next_checkpoint = rows.last().map(|r| {
                json!({
                    "updatedAt": r.updated_at,
                    "id": r.id.to_string()
                })
            });

            let documents: Vec<Value> = rows
                .into_iter()
                .map(|r| {
                    json!({
                        "id": r.id.to_string(),
                        "name": r.name,
                        "details": r.details,
                        "isOfficial": r.is_official,
                        "updatedAt": r.updated_at,
                        "_deleted": r.deleted_at.is_some(),
                    })
                })
                .collect();

            let resp = json!({
                "event": "pull_response",
                "requestId": request_id,
                "collection": "mealTemplates",
                "documents": documents,
                "checkpoint": next_checkpoint,
                "hasMoreDocuments": has_more
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        "mealLogs" => {
            let checkpoint_id = match parse_uuid_checkpoint(checkpoint_id) {
                Ok(value) => value,
                Err(message) => {
                    send_sync_error(socket, &request_id, "invalid_checkpoint", &message).await;
                    return;
                }
            };
            let rows = match db
                .sync
                .pull_meal_logs(user.id, checkpoint_updated_at, checkpoint_id, limit)
                .await
            {
                Ok(rows) => rows,
                Err(error) => {
                    tracing::error!(?error, "Failed to pull meal logs");
                    send_sync_error(
                        socket,
                        &request_id,
                        "database_error",
                        "Database operation failed",
                    )
                    .await;
                    return;
                }
            };

            let has_more = (rows.len() as i64) == limit;
            let next_checkpoint = rows.last().map(|r| {
                json!({
                    "updatedAt": r.updated_at,
                    "id": r.id.to_string()
                })
            });

            let documents: Vec<Value> = rows
                .into_iter()
                .map(|r| {
                    json!({
                        "id": r.id.to_string(),
                        "templateId": r.template_id.map(|t| t.to_string()),
                        "nameSnapshot": r.name_snapshot,
                        "nutritionSnapshot": r.nutrition_snapshot,
                        "provenance": provenance_json(r.source_provider, r.external_id),
                        "quantity": r.quantity,
                        "consumedAt": r.consumed_at,
                        "updatedAt": r.updated_at,
                        "_deleted": r.deleted_at.is_some(),
                    })
                })
                .collect();

            let resp = json!({
                "event": "pull_response",
                "requestId": request_id,
                "collection": "mealLogs",
                "documents": documents,
                "checkpoint": next_checkpoint,
                "hasMoreDocuments": has_more
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        "weightLogs" => {
            if !weight_tracking_enabled(db, user.id).await {
                send_sync_error(
                    socket,
                    &request_id,
                    "weight_tracking_disabled",
                    "Weight tracking is disabled in Settings",
                )
                .await;
                return;
            }
            let checkpoint_date = match parse_date_checkpoint(checkpoint_id) {
                Ok(value) => value,
                Err(message) => {
                    send_sync_error(socket, &request_id, "invalid_checkpoint", &message).await;
                    return;
                }
            };
            let rows = match db
                .sync
                .pull_weight_logs(user.id, checkpoint_updated_at, checkpoint_date, limit)
                .await
            {
                Ok(rows) => rows,
                Err(error) => {
                    tracing::error!(?error, "Failed to pull weight logs");
                    send_sync_error(
                        socket,
                        &request_id,
                        "database_error",
                        "Database operation failed",
                    )
                    .await;
                    return;
                }
            };
            let has_more = (rows.len() as i64) == limit;
            let next_checkpoint = rows.last().map(|row| {
                json!({
                    "updatedAt": row.updated_at,
                    "id": row.measured_on.to_string()
                })
            });
            let documents: Vec<Value> = rows
                .into_iter()
                .map(|row| {
                    json!({
                        "id": row.measured_on.to_string(),
                        "weightGrams": row.weight_grams,
                        "updatedAt": row.updated_at,
                        "_deleted": row.deleted_at.is_some()
                    })
                })
                .collect();
            let response = json!({
                "event": "pull_response",
                "requestId": request_id,
                "collection": "weightLogs",
                "documents": documents,
                "checkpoint": next_checkpoint,
                "hasMoreDocuments": has_more
            });
            let _ = socket
                .send(Message::Text(response.to_string().into()))
                .await;
        }

        _ => {
            send_sync_error(
                socket,
                &request_id,
                "unknown_collection",
                "Unknown sync collection",
            )
            .await;
        }
    }
}

async fn handle_push(
    socket: &mut WebSocket,
    user: &CurrentUser,
    db: &Arc<Database>,
    sync_hub: &SyncHub,
    req: PushRequest,
) {
    let request_id = req.request_id.clone();
    if request_id.is_empty() {
        send_sync_error(
            socket,
            &request_id,
            "invalid_request",
            "requestId is required",
        )
        .await;
        return;
    }
    let mut conflicts: Vec<Value> = Vec::new();
    let mut changed = false;

    match req.collection.as_str() {
        "userPreferences" => {
            for row in req.rows {
                let doc = match parse_user_preferences_document(row.new_document_state) {
                    Ok(doc) => doc,
                    Err(error) => {
                        let message = client_error_message(error);
                        send_sync_error(socket, &request_id, "invalid_document", &message).await;
                        return;
                    }
                };
                let deleted_at = if doc.deleted {
                    Some(doc.updated_at)
                } else {
                    None
                };

                match db
                    .sync
                    .push_user_preference(user.id, doc.preferences, doc.updated_at, deleted_at)
                    .await
                {
                    Ok(Some(conflict)) => conflicts.push(json!({
                        "id": conflict.id,
                        "preferences": conflict.preferences,
                        "updatedAt": conflict.updated_at,
                        "_deleted": conflict.deleted_at.is_some(),
                    })),
                    Ok(None) => changed = true,
                    Err(error) => {
                        tracing::error!(?error, "Failed to push user preference");
                        send_sync_error(
                            socket,
                            &request_id,
                            "database_error",
                            "Database operation failed",
                        )
                        .await;
                        return;
                    }
                }
            }

            let resp = json!({
                "event": "push_response",
                "requestId": request_id,
                "collection": "userPreferences",
                "conflicts": conflicts
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
            if changed {
                sync_hub.notify(user.id, "userPreferences");
            }
        }

        "mealTemplates" => {
            for row in req.rows {
                let doc = match parse_meal_template_document(row.new_document_state) {
                    Ok(doc) => doc,
                    Err(error) => {
                        let message = client_error_message(error);
                        send_sync_error(socket, &request_id, "invalid_document", &message).await;
                        return;
                    }
                };
                if doc.is_official {
                    send_sync_error(
                        socket,
                        &request_id,
                        "invalid_document",
                        "Clients cannot create or mutate official templates",
                    )
                    .await;
                    return;
                }
                let deleted_at = if doc.deleted {
                    Some(doc.updated_at)
                } else {
                    None
                };
                let details = serde_json::to_value(&doc.details).expect("FoodDetails serializes");
                let (source_provider, external_id) = match provenance_parts(doc.provenance) {
                    Ok(parts) => parts,
                    Err(error) => {
                        let message = client_error_message(error);
                        send_sync_error(socket, &request_id, "invalid_document", &message).await;
                        return;
                    }
                };

                match db
                    .sync
                    .push_meal_template(
                        user.id,
                        doc.id,
                        doc.name,
                        details,
                        source_provider,
                        external_id,
                        doc.updated_at,
                        deleted_at,
                    )
                    .await
                {
                    Ok(Some(conflict)) => conflicts.push(json!({
                        "id": conflict.id.to_string(),
                        "name": conflict.name,
                        "details": conflict.details,
                        "provenance": provenance_json(conflict.source_provider, conflict.external_id),
                        "isOfficial": conflict.is_official,
                        "updatedAt": conflict.updated_at,
                        "_deleted": conflict.deleted_at.is_some(),
                    })),
                    Ok(None) => changed = true,
                    Err(error) => {
                        send_app_error(socket, &request_id, error, "meal template").await;
                        return;
                    }
                }
            }

            let resp = json!({
                "event": "push_response",
                "requestId": request_id,
                "collection": "mealTemplates",
                "conflicts": conflicts
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
            if changed {
                sync_hub.notify(user.id, "mealTemplates");
            }
        }

        "mealLogs" => {
            for row in req.rows {
                let doc = match parse_meal_log_document(row.new_document_state) {
                    Ok(doc) => doc,
                    Err(error) => {
                        let message = client_error_message(error);
                        send_sync_error(socket, &request_id, "invalid_document", &message).await;
                        return;
                    }
                };
                let deleted_at = if doc.deleted {
                    Some(doc.updated_at)
                } else {
                    None
                };
                if let Err(error) = provenance_parts(doc.provenance) {
                    let message = client_error_message(error);
                    send_sync_error(socket, &request_id, "invalid_document", &message).await;
                    return;
                }
                match db
                    .sync
                    .push_meal_log(
                        user.id,
                        MealLogMutation {
                            id: doc.id,
                            template_id: doc.template_id,
                            quantity: doc.quantity,
                            consumed_at: doc.consumed_at,
                            updated_at: doc.updated_at,
                            deleted_at,
                        },
                    )
                    .await
                {
                    Ok(Some(conflict)) => conflicts.push(json!({
                        "id": conflict.id.to_string(),
                        "templateId": conflict.template_id.map(|t| t.to_string()),
                        "nameSnapshot": conflict.name_snapshot,
                        "nutritionSnapshot": conflict.nutrition_snapshot,
                        "provenance": provenance_json(conflict.source_provider, conflict.external_id),
                        "quantity": conflict.quantity,
                        "consumedAt": conflict.consumed_at,
                        "updatedAt": conflict.updated_at,
                        "_deleted": conflict.deleted_at.is_some(),
                    })),
                    Ok(None) => changed = true,
                    Err(error) => {
                        send_app_error(socket, &request_id, error, "meal log").await;
                        return;
                    }
                }
            }

            let resp = json!({
                "event": "push_response",
                "requestId": request_id,
                "collection": "mealLogs",
                "conflicts": conflicts
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
            if changed {
                sync_hub.notify(user.id, "mealLogs");
            }
        }

        "weightLogs" => {
            if !weight_tracking_enabled(db, user.id).await {
                send_sync_error(
                    socket,
                    &request_id,
                    "weight_tracking_disabled",
                    "Weight tracking is disabled in Settings",
                )
                .await;
                return;
            }
            let today = match db.sync.current_santiago_date().await {
                Ok(value) => NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                    .expect("database returns ISO date"),
                Err(error) => {
                    tracing::error!(?error, "Failed to resolve Santiago date");
                    send_sync_error(
                        socket,
                        &request_id,
                        "database_error",
                        "Database operation failed",
                    )
                    .await;
                    return;
                }
            };
            for row in req.rows {
                let doc = match parse_weight_log_document(row.new_document_state) {
                    Ok(doc) => doc,
                    Err(error) => {
                        let message = client_error_message(error);
                        send_sync_error(socket, &request_id, "invalid_document", &message).await;
                        return;
                    }
                };
                let measured_on =
                    NaiveDate::parse_from_str(&doc.id, "%Y-%m-%d").expect("validated weight date");
                if measured_on > today {
                    send_sync_error(
                        socket,
                        &request_id,
                        "invalid_document",
                        "weightLogs.id cannot be a future date",
                    )
                    .await;
                    return;
                }
                let deleted_at = if doc.deleted {
                    Some(doc.updated_at)
                } else {
                    None
                };
                match db
                    .sync
                    .push_weight_log(
                        user.id,
                        measured_on,
                        doc.weight_grams,
                        doc.updated_at,
                        deleted_at,
                    )
                    .await
                {
                    Ok(Some(conflict)) => conflicts.push(json!({
                        "id": conflict.measured_on.to_string(),
                        "weightGrams": conflict.weight_grams,
                        "updatedAt": conflict.updated_at,
                        "_deleted": conflict.deleted_at.is_some()
                    })),
                    Ok(None) => changed = true,
                    Err(error) => {
                        send_app_error(socket, &request_id, error, "weight log").await;
                        return;
                    }
                }
            }
            let response = json!({
                "event": "push_response",
                "requestId": request_id,
                "collection": "weightLogs",
                "conflicts": conflicts
            });
            let _ = socket
                .send(Message::Text(response.to_string().into()))
                .await;
            if changed {
                sync_hub.notify(user.id, "weightLogs");
            }
        }

        _ => {
            send_sync_error(
                socket,
                &request_id,
                "unknown_collection",
                "Unknown sync collection",
            )
            .await;
        }
    }
}

async fn send_sync_error(socket: &mut WebSocket, request_id: &str, code: &str, message: &str) {
    let response = json!({
        "event": "sync_error",
        "requestId": request_id,
        "error": { "code": code, "message": message }
    });
    let _ = socket
        .send(Message::Text(response.to_string().into()))
        .await;
}

async fn send_app_error(
    socket: &mut WebSocket,
    request_id: &str,
    error: AppError,
    operation: &str,
) {
    match error {
        AppError::BadRequest(message) => {
            send_sync_error(socket, request_id, "invalid_document", &message).await
        }
        AppError::Conflict(message) => {
            send_sync_error(socket, request_id, "conflict", &message).await
        }
        error => {
            tracing::error!(?error, operation, "Failed to push sync document");
            send_sync_error(
                socket,
                request_id,
                "database_error",
                "Database operation failed",
            )
            .await
        }
    }
}

fn parse_meal_template_document(value: Value) -> Result<MealTemplateDocument, AppError> {
    let document: MealTemplateDocument = serde_json::from_value(value)
        .map_err(|error| AppError::BadRequest(format!("Invalid meal template: {error}")))?;
    let name = document.name.trim();
    if name.is_empty() || name.chars().count() > 160 {
        return Err(AppError::BadRequest(
            "mealTemplates.name must contain between 1 and 160 characters".into(),
        ));
    }
    if document.updated_at <= 0 {
        return Err(AppError::BadRequest(
            "mealTemplates.updatedAt must be a positive epoch millisecond value".into(),
        ));
    }
    document.details.validate()?;
    Ok(MealTemplateDocument {
        name: name.to_owned(),
        ..document
    })
}

fn parse_meal_log_document(value: Value) -> Result<MealLogDocument, AppError> {
    let document: MealLogDocument = serde_json::from_value(value)
        .map_err(|error| AppError::BadRequest(format!("Invalid meal log: {error}")))?;
    let name = document.name_snapshot.trim();
    if name.is_empty() || name.chars().count() > 160 {
        return Err(AppError::BadRequest(
            "mealLogs.nameSnapshot must contain between 1 and 160 characters".into(),
        ));
    }
    if !document.quantity.is_finite() || document.quantity <= 0.0 {
        return Err(AppError::BadRequest(
            "mealLogs.quantity must be a finite number greater than zero".into(),
        ));
    }
    if document.consumed_at <= 0 || document.updated_at <= 0 {
        return Err(AppError::BadRequest(
            "mealLogs timestamps must be positive epoch millisecond values".into(),
        ));
    }
    document.nutrition_snapshot.validate()?;
    Ok(MealLogDocument {
        name_snapshot: name.to_owned(),
        ..document
    })
}

fn parse_user_preferences_document(value: Value) -> Result<UserPreferencesDocument, AppError> {
    let document: UserPreferencesDocument = serde_json::from_value(value)
        .map_err(|error| AppError::BadRequest(format!("Invalid user preferences: {error}")))?;
    if document.updated_at <= 0 {
        return Err(AppError::BadRequest(
            "userPreferences.updatedAt must be a positive epoch millisecond value".into(),
        ));
    }
    let preferences = document.preferences.as_object().ok_or_else(|| {
        AppError::BadRequest("userPreferences.preferences must be an object".into())
    })?;
    if let Some(value) = preferences.get("weightTrackingEnabled")
        && !value.is_boolean()
    {
        return Err(AppError::BadRequest(
            "userPreferences.weightTrackingEnabled must be a boolean".into(),
        ));
    }
    Ok(document)
}

fn parse_weight_log_document(value: Value) -> Result<WeightLogDocument, AppError> {
    let document: WeightLogDocument = serde_json::from_value(value)
        .map_err(|error| AppError::BadRequest(format!("Invalid weight log: {error}")))?;
    NaiveDate::parse_from_str(&document.id, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("weightLogs.id must use YYYY-MM-DD".into()))?;
    validate_weight_grams(document.weight_grams)?;
    if document.updated_at <= 0 {
        return Err(AppError::BadRequest(
            "weightLogs.updatedAt must be a positive epoch millisecond value".into(),
        ));
    }
    Ok(document)
}

fn parse_uuid_checkpoint(value: Option<&str>) -> Result<Option<Uuid>, String> {
    value
        .map(|id| Uuid::parse_str(id).map_err(|_| "checkpoint.id must be a UUID".into()))
        .transpose()
}

fn parse_date_checkpoint(value: Option<&str>) -> Result<Option<NaiveDate>, String> {
    value
        .map(|id| {
            NaiveDate::parse_from_str(id, "%Y-%m-%d")
                .map_err(|_| "checkpoint.id must use YYYY-MM-DD".into())
        })
        .transpose()
}

async fn weight_tracking_enabled(db: &Arc<Database>, user_id: i32) -> bool {
    match db.sync.weight_tracking_enabled(user_id).await {
        Ok(enabled) => enabled,
        Err(error) => {
            tracing::error!(?error, "Failed to read weight tracking preference");
            false
        }
    }
}

fn client_error_message(error: AppError) -> String {
    match error {
        AppError::BadRequest(message) => message,
        _ => "Invalid sync document".into(),
    }
}

fn provenance_parts(
    provenance: Option<ImportProvenanceDocument>,
) -> Result<(Option<String>, Option<String>), AppError> {
    let Some(provenance) = provenance else {
        return Ok((None, None));
    };
    if provenance.provider != "macrofactor"
        || provenance.external_id.is_empty()
        || provenance.external_id.len() > 128
    {
        return Err(AppError::BadRequest("Invalid import provenance".into()));
    }
    Ok((Some(provenance.provider), Some(provenance.external_id)))
}

fn provenance_json(provider: Option<String>, external_id: Option<String>) -> Value {
    match (provider, external_id) {
        (Some(provider), Some(external_id)) => json!({
            "provider": provider,
            "externalId": external_id,
        }),
        _ => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn valid_template() -> Value {
        json!({
            "id": Uuid::new_v4(),
            "name": "Manzana",
            "details": {
                "schemaVersion": 1,
                "baseAmount": 100.0,
                "unit": "g",
                "nutrition": {
                    "calories": 52.0,
                    "protein": 0.3,
                    "carbs": 14.0,
                    "fat": 0.2,
                    "fiber": 2.4
                }
            },
            "isOfficial": false,
            "updatedAt": 1_786_233_600_000_i64,
            "_deleted": false
        })
    }

    fn valid_log() -> Value {
        json!({
            "id": Uuid::new_v4(),
            "templateId": Uuid::new_v4(),
            "nameSnapshot": "Manzana",
            "nutritionSnapshot": {
                "schemaVersion": 1,
                "baseAmount": 100.0,
                "unit": "g",
                "nutrition": {
                    "calories": 52.0,
                    "protein": 0.3,
                    "carbs": 14.0,
                    "fat": 0.2
                }
            },
            "quantity": 150.0,
            "consumedAt": 1_786_233_600_000_i64,
            "updatedAt": 1_786_233_600_000_i64,
            "_deleted": false
        })
    }

    fn valid_weight() -> Value {
        json!({
            "id": "2026-08-09",
            "weightGrams": 72_400,
            "updatedAt": 1_786_233_600_000_i64,
            "_deleted": false
        })
    }

    #[test]
    fn sync_documents_are_strict_and_typed() {
        assert!(parse_meal_template_document(valid_template()).is_ok());
        assert!(parse_meal_log_document(valid_log()).is_ok());
        assert!(parse_weight_log_document(valid_weight()).is_ok());

        let mut template = valid_template();
        template["details"]["baseAmount"] = json!(0);
        assert!(parse_meal_template_document(template).is_err());

        let mut log = valid_log();
        log["templateId"] = json!("not-a-uuid");
        assert!(parse_meal_log_document(log).is_err());

        let mut weight = valid_weight();
        weight["weightGrams"] = json!(72_450);
        assert!(parse_weight_log_document(weight).is_err());

        let mut log = valid_log();
        log["nutritionSnapshot"]["nutrition"]["calories"] = json!(-1);
        assert!(parse_meal_log_document(log).is_err());
    }

    #[test]
    fn sync_documents_reject_unknown_fields_and_invalid_timestamps() {
        let mut template = valid_template();
        template["snake_case"] = json!(true);
        assert!(parse_meal_template_document(template).is_err());

        let mut log = valid_log();
        log["updatedAt"] = json!(0);
        assert!(parse_meal_log_document(log).is_err());

        let mut weight = valid_weight();
        weight["measuredOn"] = json!("2026-08-09");
        assert!(parse_weight_log_document(weight).is_err());
        assert!(parse_uuid_checkpoint(Some("not-a-uuid")).is_err());
        assert!(parse_date_checkpoint(Some("2026-02-30")).is_err());
    }

    #[test]
    fn weight_preference_is_optional_but_typed() {
        let valid = json!({
            "id": 7,
            "preferences": { "weightTrackingEnabled": false },
            "updatedAt": 1_786_233_600_000_i64,
            "_deleted": false
        });
        assert!(parse_user_preferences_document(valid).is_ok());
        let invalid = json!({
            "id": 7,
            "preferences": { "weightTrackingEnabled": "no" },
            "updatedAt": 1_786_233_600_000_i64,
            "_deleted": false
        });
        assert!(parse_user_preferences_document(invalid).is_err());
    }

    #[tokio::test]
    async fn official_templates_route_relies_on_the_reverse_proxy_api_prefix() {
        let canonical = public_template_routes()
            .oneshot(
                Request::builder()
                    .uri("/templates/official")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(canonical.status(), StatusCode::NOT_FOUND);

        let duplicated = public_template_routes()
            .oneshot(
                Request::builder()
                    .uri("/api/templates/official")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(duplicated.status(), StatusCode::NOT_FOUND);
    }
}
