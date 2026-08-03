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

use crate::{connectors::db::Database, modules::auth::middleware::CurrentUser};

#[derive(Debug, Deserialize)]
pub struct PullCheckpoint {
    pub updatedAt: i64,
    pub id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub collection: String,
    pub checkpoint: Option<PullCheckpoint>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRow {
    pub new_document_state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    pub collection: String,
    pub rows: Vec<PushRow>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum IncomingMessage {
    Pull(PullRequest),
    Push(PushRequest),
}

pub fn sync_routes() -> Router {
    Router::new().route("/ws/sync", get(ws_handler))
}

pub fn public_template_routes() -> Router {
    Router::new().route("/api/templates/official", get(get_official_templates_handler))
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
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch official templates").into_response()
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Extension(current_user): Extension<CurrentUser>,
    Extension(db): Extension<Arc<Database>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, current_user, db))
}

async fn handle_socket(mut socket: WebSocket, user: CurrentUser, db: Arc<Database>) {
    tracing::info!("RxDB WebSocket connected for user_id={}", user.id);

    while let Some(Ok(msg)) = socket.recv().await {
        if let Message::Text(text) = msg {
            if let Ok(incoming) = serde_json::from_str::<IncomingMessage>(&text) {
                match incoming {
                    IncomingMessage::Pull(req) => {
                        handle_pull(&mut socket, &user, &db, req).await;
                    }
                    IncomingMessage::Push(req) => {
                        handle_push(&mut socket, &user, &db, req).await;
                    }
                }
            } else {
                tracing::warn!("Failed to parse incoming WebSocket message: {}", text);
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
    let limit = req.limit.unwrap_or(50);
    let checkpoint_updated_at = req.checkpoint.as_ref().map(|c| c.updatedAt).unwrap_or(0);
    let checkpoint_id = req.checkpoint.as_ref().and_then(|c| c.id);

    match req.collection.as_str() {
        "userPreferences" => {
            let rows = db
                .sync
                .pull_user_preferences(user.id, checkpoint_updated_at, limit)
                .await
                .unwrap_or_default();

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
                "collection": "userPreferences",
                "documents": documents,
                "checkpoint": next_checkpoint,
                "hasMoreDocuments": has_more
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        "mealTemplates" => {
            let rows = db
                .sync
                .pull_meal_templates(user.id, checkpoint_updated_at, checkpoint_id, limit)
                .await
                .unwrap_or_default();

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
                "collection": "mealTemplates",
                "documents": documents,
                "checkpoint": next_checkpoint,
                "hasMoreDocuments": has_more
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        "mealLogs" => {
            let rows = db
                .sync
                .pull_meal_logs(user.id, checkpoint_updated_at, checkpoint_id, limit)
                .await
                .unwrap_or_default();

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
                "collection": "mealLogs",
                "documents": documents,
                "checkpoint": next_checkpoint,
                "hasMoreDocuments": has_more
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        _ => {}
    }
}

async fn handle_push(
    socket: &mut WebSocket,
    user: &CurrentUser,
    db: &Arc<Database>,
    req: PushRequest,
) {
    let mut conflicts: Vec<Value> = Vec::new();

    match req.collection.as_str() {
        "userPreferences" => {
            for row in req.rows {
                let doc = row.new_document_state;
                let preferences = doc.get("preferences").cloned().unwrap_or(json!({}));
                let updated_at = doc.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
                let is_deleted = doc.get("_deleted").and_then(|v| v.as_bool()).unwrap_or(false);
                let deleted_at = if is_deleted { Some(updated_at) } else { None };

                if let Ok(conflict_opt) = db
                    .sync
                    .push_user_preference(user.id, preferences, updated_at, deleted_at)
                    .await
                {
                    if let Some(conflict) = conflict_opt {
                        conflicts.push(json!({
                            "id": conflict.id,
                            "preferences": conflict.preferences,
                            "updatedAt": conflict.updated_at,
                            "_deleted": conflict.deleted_at.is_some(),
                        }));
                    }
                }
            }

            let resp = json!({
                "event": "push_response",
                "collection": "userPreferences",
                "conflicts": conflicts
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        "mealTemplates" => {
            for row in req.rows {
                let doc = row.new_document_state;
                let id_str = doc.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let id = Uuid::parse_str(id_str).unwrap_or_else(|_| Uuid::new_v4());
                let name = doc.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let details = doc.get("details").cloned().unwrap_or(json!({}));
                let updated_at = doc.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
                let is_deleted = doc.get("_deleted").and_then(|v| v.as_bool()).unwrap_or(false);
                let deleted_at = if is_deleted { Some(updated_at) } else { None };

                if let Ok(conflict_opt) = db
                    .sync
                    .push_meal_template(user.id, id, name, details, updated_at, deleted_at)
                    .await
                {
                    if let Some(conflict) = conflict_opt {
                        conflicts.push(json!({
                            "id": conflict.id.to_string(),
                            "name": conflict.name,
                            "details": conflict.details,
                            "isOfficial": conflict.is_official,
                            "updatedAt": conflict.updated_at,
                            "_deleted": conflict.deleted_at.is_some(),
                        }));
                    }
                }
            }

            let resp = json!({
                "event": "push_response",
                "collection": "mealTemplates",
                "conflicts": conflicts
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        "mealLogs" => {
            for row in req.rows {
                let doc = row.new_document_state;
                let id_str = doc.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let id = Uuid::parse_str(id_str).unwrap_or_else(|_| Uuid::new_v4());
                let template_id = doc
                    .get("templateId")
                    .and_then(|v| v.as_str())
                    .and_then(|s| Uuid::parse_str(s).ok());
                let name_snapshot = doc
                    .get("nameSnapshot")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let nutrition_snapshot = doc.get("nutritionSnapshot").cloned().unwrap_or(json!({}));
                let quantity = doc.get("quantity").and_then(|v| v.as_f64()).unwrap_or(1.0);
                let consumed_at = doc.get("consumedAt").and_then(|v| v.as_i64()).unwrap_or(0);
                let updated_at = doc.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
                let is_deleted = doc.get("_deleted").and_then(|v| v.as_bool()).unwrap_or(false);
                let deleted_at = if is_deleted { Some(updated_at) } else { None };

                if let Ok(conflict_opt) = db
                    .sync
                    .push_meal_log(
                        user.id,
                        id,
                        template_id,
                        name_snapshot,
                        nutrition_snapshot,
                        quantity,
                        consumed_at,
                        updated_at,
                        deleted_at,
                    )
                    .await
                {
                    if let Some(conflict) = conflict_opt {
                        conflicts.push(json!({
                            "id": conflict.id.to_string(),
                            "templateId": conflict.template_id.map(|t| t.to_string()),
                            "nameSnapshot": conflict.name_snapshot,
                            "nutritionSnapshot": conflict.nutrition_snapshot,
                            "quantity": conflict.quantity,
                            "consumedAt": conflict.consumed_at,
                            "updatedAt": conflict.updated_at,
                            "_deleted": conflict.deleted_at.is_some(),
                        }));
                    }
                }
            }

            let resp = json!({
                "event": "push_response",
                "collection": "mealLogs",
                "conflicts": conflicts
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
        }

        _ => {}
    }
}
