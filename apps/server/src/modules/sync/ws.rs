use axum::{
    Extension, Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    connectors::{
        db::Database,
        sync::{FoodDetails, MealLogMutation, NutritionSnapshot},
    },
    modules::{auth::middleware::CurrentUser, sync::hub::SyncHub},
    shared::error::AppError,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PullCheckpoint {
    pub updated_at: i64,
    pub id: Option<Uuid>,
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
struct MealTemplateDocument {
    id: Uuid,
    name: String,
    details: FoodDetails,
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
    quantity: f64,
    consumed_at: i64,
    updated_at: i64,
    #[serde(rename = "_deleted")]
    deleted: bool,
}

pub fn sync_routes() -> Router {
    Router::new().route("/ws/sync", get(ws_handler))
}

pub fn public_template_routes() -> Router {
    Router::new().route(
        "/api/templates/official",
        get(get_official_templates_handler),
    )
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
    let checkpoint_id = req.checkpoint.as_ref().and_then(|c| c.id);

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
                let doc = row.new_document_state;
                let preferences = doc.get("preferences").cloned().unwrap_or(json!({}));
                let updated_at = doc.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
                let is_deleted = doc
                    .get("_deleted")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let deleted_at = if is_deleted { Some(updated_at) } else { None };

                match db
                    .sync
                    .push_user_preference(user.id, preferences, updated_at, deleted_at)
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

                match db
                    .sync
                    .push_meal_template(
                        user.id,
                        doc.id,
                        doc.name,
                        details,
                        doc.updated_at,
                        deleted_at,
                    )
                    .await
                {
                    Ok(Some(conflict)) => conflicts.push(json!({
                        "id": conflict.id.to_string(),
                        "name": conflict.name,
                        "details": conflict.details,
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

fn client_error_message(error: AppError) -> String {
    match error {
        AppError::BadRequest(message) => message,
        _ => "Invalid sync document".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn sync_documents_are_strict_and_typed() {
        assert!(parse_meal_template_document(valid_template()).is_ok());
        assert!(parse_meal_log_document(valid_log()).is_ok());

        let mut template = valid_template();
        template["details"]["baseAmount"] = json!(0);
        assert!(parse_meal_template_document(template).is_err());

        let mut log = valid_log();
        log["templateId"] = json!("not-a-uuid");
        assert!(parse_meal_log_document(log).is_err());

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
    }
}
