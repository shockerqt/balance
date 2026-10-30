use axum::{
    Extension, Router,
    extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    http::{HeaderMap, StatusCode, Uri},
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
        sync::{
            FoodDetails, MealLogEntry, MealLogMutation, MealTemplateMutation, NutritionSnapshot,
            validate_weight_grams,
        },
    },
    modules::{
        auth::{
            middleware::{CurrentUser, authenticate_token},
            oidc::OidcConfig,
        },
        sync::hub::SyncHub,
    },
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
    canonical_quantity: f64,
    entry: MealLogEntry,
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

#[derive(Clone)]
pub struct WsAllowedOrigins(Vec<String>);

impl WsAllowedOrigins {
    pub fn from_env() -> anyhow::Result<Self> {
        Self::parse(&std::env::var("WS_ALLOWED_ORIGINS").unwrap_or_default())
    }
    fn parse(value: &str) -> anyhow::Result<Self> {
        let mut origins = Vec::new();
        for origin in value.split_whitespace() {
            let url = reqwest::Url::parse(origin)?;
            anyhow::ensure!(
                url.scheme() == "https"
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.path() == "/"
                    && url.query().is_none()
                    && url.fragment().is_none()
                    && url.origin().ascii_serialization() == origin,
                "invalid WS origin"
            );
            origins.push(origin.to_owned());
        }
        Ok(Self(origins))
    }
    fn allows(&self, headers: &HeaderMap) -> bool {
        let mut values = headers.get_all(axum::http::header::ORIGIN).iter();
        match (values.next(), values.next()) {
            (None, None) => true,
            (Some(origin), None) => origin
                .to_str()
                .is_ok_and(|origin| self.0.iter().any(|allowed| allowed == origin)),
            _ => false,
        }
    }
}

pub fn application_sync_routes(oidc: OidcConfig, origins: WsAllowedOrigins) -> Router {
    Router::new()
        .route("/ws/sync/application", get(application_ws_handler))
        .layer(Extension(oidc))
        .layer(Extension(origins))
}

async fn application_ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    uri: Uri,
    Extension(oidc): Extension<OidcConfig>,
    Extension(origins): Extension<WsAllowedOrigins>,
    Extension(db): Extension<Arc<Database>>,
    Extension(hub): Extension<SyncHub>,
) -> axum::response::Response {
    let protocols: Vec<_> = headers
        .get_all(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .collect();
    if !origins.allows(&headers)
        || uri.query().is_some()
        || headers.contains_key(axum::http::header::AUTHORIZATION)
        || protocols.len() != 1
        || protocols[0].to_str().ok() != Some("balance")
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.protocols(["balance"])
        .max_message_size(2 * 1024 * 1024)
        .max_frame_size(2 * 1024 * 1024)
        .on_upgrade(move |socket| authenticate_socket(socket, oidc, db, hub))
        .into_response()
}

#[derive(Deserialize)]
#[serde(tag = "event", rename_all = "camelCase", deny_unknown_fields)]
enum AuthenticationFrame {
    Authenticate {
        #[serde(rename = "accessToken")]
        access_token: String,
    },
}

async fn close_auth(socket: &mut WebSocket, code: u16) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: "Authentication required".into(),
        })))
        .await;
}

async fn authenticate_socket(
    mut socket: WebSocket,
    oidc: OidcConfig,
    db: Arc<Database>,
    hub: SyncHub,
) {
    let authentication = async {
        loop {
            match socket.recv().await {
                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => continue,
                Some(Ok(Message::Text(text))) if text.len() <= 16 * 1024 => {
                    let AuthenticationFrame::Authenticate { access_token } =
                        serde_json::from_str::<AuthenticationFrame>(&text).ok()?;
                    if access_token.is_empty() {
                        return None;
                    }
                    return Some(authenticate_token(&oidc, &db, &access_token).await);
                }
                _ => return None,
            }
        }
    };
    let (user, expiry) =
        match tokio::time::timeout(std::time::Duration::from_secs(10), authentication).await {
            Ok(Some(Ok(identity))) => identity,
            Ok(Some(Err(error))) => {
                close_auth(&mut socket, if error.is_expired() { 4001 } else { 4003 }).await;
                return;
            }
            _ => {
                close_auth(&mut socket, 4003).await;
                return;
            }
        };
    if i64::try_from(expiry)
        .unwrap_or(i64::MAX)
        .saturating_mul(1000)
        <= chrono::Utc::now().timestamp_millis()
    {
        close_auth(&mut socket, 4001).await;
        return;
    }
    if socket
        .send(Message::Text(
            json!({"event":"authenticated"}).to_string().into(),
        ))
        .await
        .is_err()
    {
        return;
    }
    handle_socket(socket, user, db, hub, Some(expiry)).await;
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
        .on_upgrade(move |socket| handle_socket(socket, current_user, db, sync_hub, None))
}

async fn handle_socket(
    mut socket: WebSocket,
    user: CurrentUser,
    db: Arc<Database>,
    sync_hub: SyncHub,
    expiry: Option<usize>,
) {
    if expiry.is_some() {
        tracing::info!("Authenticated sync WebSocket connected");
    } else {
        tracing::info!("RxDB WebSocket connected for user_id={}", user.id);
    }
    let mut invalidations = sync_hub.subscribe();

    let deadline = expiry.map(|exp| {
        let remaining = i64::try_from(exp)
            .unwrap_or(i64::MAX)
            .saturating_mul(1000)
            .saturating_sub(chrono::Utc::now().timestamp_millis())
            .max(0) as u64;
        tokio::time::Instant::now()
            .checked_add(std::time::Duration::from_millis(remaining))
            .unwrap_or_else(tokio::time::Instant::now)
    });
    loop {
        if deadline.is_some_and(|end| tokio::time::Instant::now() >= end) {
            close_auth(&mut socket, 4001).await;
            break;
        }
        tokio::select! {
            biased;
            _ = async { match deadline { Some(end) => tokio::time::sleep_until(end).await, None => std::future::pending().await } } => {
                close_auth(&mut socket, 4001).await; break;
            }
            message = socket.recv() => {
                let Some(Ok(msg)) = message else { break };
                if deadline.is_some_and(|end| tokio::time::Instant::now() >= end) { close_auth(&mut socket, 4001).await; break; }
                if let Message::Text(text) = msg {
                    if expiry.is_some() && serde_json::from_str::<Value>(&text).ok().and_then(|value| value.get("event").and_then(Value::as_str).map(str::to_owned)).as_deref() == Some("authenticate") {
                        close_auth(&mut socket, 4003).await; break;
                    }
                    match serde_json::from_str::<IncomingMessage>(&text) {
                        Ok(IncomingMessage::Pull(req)) => {
                            handle_pull(&mut socket, &user, &db, req).await;
                        }
                        Ok(IncomingMessage::Push(req)) => {
                            handle_push(&mut socket, &user, &db, &sync_hub, req).await;
                        }
                        Err(error) => {
                            if expiry.is_none() { tracing::warn!(?error, "Failed to parse sync message"); }
                            send_sync_error(&mut socket, "", "invalid_message", "Invalid sync message").await;
                        }
                    }
                }
            }
            invalidation = invalidations.recv() => {
                if deadline.is_some_and(|end| tokio::time::Instant::now() >= end) { close_auth(&mut socket, 4001).await; break; }
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

    if expiry.is_some() {
        tracing::info!("Authenticated sync WebSocket disconnected");
    } else {
        tracing::info!("RxDB WebSocket disconnected for user_id={}", user.id);
    }
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
                        "canonicalQuantity": r.canonical_quantity,
                        "entry": r.entry_snapshot,
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
    let mut rejections: Vec<Value> = Vec::new();
    let mut changed = false;

    match req.collection.as_str() {
        "userPreferences" => {
            for (index, row) in req.rows.into_iter().enumerate() {
                let doc = match parse_user_preferences_document(row.new_document_state) {
                    Ok(doc) => doc,
                    Err(error) => {
                        rejections.push(json!({
                            "index": index,
                            "code": "invalid_document",
                            "message": client_error_message(error)
                        }));
                        continue;
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
                        if changed {
                            sync_hub.notify(user.id, "userPreferences");
                        }
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
                "conflicts": conflicts,
                "rejections": rejections
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
            if changed {
                sync_hub.notify(user.id, "userPreferences");
            }
        }

        "mealTemplates" => {
            for (index, row) in req.rows.into_iter().enumerate() {
                let doc = match parse_meal_template_document(row.new_document_state) {
                    Ok(doc) => doc,
                    Err(error) => {
                        rejections.push(json!({
                            "index": index,
                            "code": "invalid_document",
                            "message": client_error_message(error)
                        }));
                        continue;
                    }
                };
                if doc.is_official {
                    rejections.push(json!({
                        "index": index,
                        "code": "invalid_document",
                        "message": "Clients cannot create or mutate official templates"
                    }));
                    continue;
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
                        MealTemplateMutation {
                            id: doc.id,
                            name: doc.name,
                            details,
                            source_provider,
                            external_id,
                            updated_at: doc.updated_at,
                            deleted_at,
                        },
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
                        if changed {
                            sync_hub.notify(user.id, "mealTemplates");
                        }
                        send_app_error(socket, &request_id, error, "meal template").await;
                        return;
                    }
                }
            }

            let resp = json!({
                "event": "push_response",
                "requestId": request_id,
                "collection": "mealTemplates",
                "conflicts": conflicts,
                "rejections": rejections
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
            if changed {
                sync_hub.notify(user.id, "mealTemplates");
            }
        }

        "mealLogs" => {
            for (index, row) in req.rows.into_iter().enumerate() {
                let doc = match parse_meal_log_document(row.new_document_state) {
                    Ok(doc) => doc,
                    Err(error) => {
                        rejections.push(json!({
                            "index": index,
                            "code": "invalid_document",
                            "message": client_error_message(error)
                        }));
                        continue;
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
                            canonical_quantity: doc.canonical_quantity,
                            entry: doc.entry,
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
                        "canonicalQuantity": conflict.canonical_quantity,
                        "entry": conflict.entry_snapshot,
                        "consumedAt": conflict.consumed_at,
                        "updatedAt": conflict.updated_at,
                        "_deleted": conflict.deleted_at.is_some(),
                    })),
                    Ok(None) => changed = true,
                    Err(error) => {
                        if changed {
                            sync_hub.notify(user.id, "mealLogs");
                        }
                        send_app_error(socket, &request_id, error, "meal log").await;
                        return;
                    }
                }
            }

            let resp = json!({
                "event": "push_response",
                "requestId": request_id,
                "collection": "mealLogs",
                "conflicts": conflicts,
                "rejections": rejections
            });

            let _ = socket.send(Message::Text(resp.to_string().into())).await;
            if changed {
                sync_hub.notify(user.id, "mealLogs");
            }
        }

        "weightLogs" => {
            let today = match db.sync.current_santiago_date().await {
                Ok(value) => match NaiveDate::parse_from_str(&value, "%Y-%m-%d") {
                    Ok(date) => date,
                    Err(error) => {
                        tracing::error!(?error, %value, "Database returned an invalid Santiago date");
                        send_sync_error(
                            socket,
                            &request_id,
                            "database_error",
                            "Database operation failed",
                        )
                        .await;
                        return;
                    }
                },
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
            for (index, row) in req.rows.into_iter().enumerate() {
                let (doc, measured_on) = match parse_weight_log_document(row.new_document_state) {
                    Ok(parsed) => parsed,
                    Err(error) => {
                        rejections.push(json!({
                            "index": index,
                            "code": "invalid_document",
                            "message": client_error_message(error)
                        }));
                        continue;
                    }
                };
                if measured_on > today {
                    rejections.push(json!({
                        "index": index,
                        "code": "invalid_document",
                        "message": "weightLogs.id cannot be a future date"
                    }));
                    continue;
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
                        if changed {
                            sync_hub.notify(user.id, "weightLogs");
                        }
                        send_app_error(socket, &request_id, error, "weight log").await;
                        return;
                    }
                }
            }
            let response = json!({
                "event": "push_response",
                "requestId": request_id,
                "collection": "weightLogs",
                "conflicts": conflicts,
                "rejections": rejections
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
    document.entry.validate(document.canonical_quantity)?;
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

fn parse_weight_log_document(value: Value) -> Result<(WeightLogDocument, NaiveDate), AppError> {
    let document: WeightLogDocument = serde_json::from_value(value)
        .map_err(|error| AppError::BadRequest(format!("Invalid weight log: {error}")))?;
    let measured_on = NaiveDate::parse_from_str(&document.id, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("weightLogs.id must use YYYY-MM-DD".into()))?;
    validate_weight_grams(document.weight_grams)?;
    if document.updated_at <= 0 {
        return Err(AppError::BadRequest(
            "weightLogs.updatedAt must be a positive epoch millisecond value".into(),
        ));
    }
    Ok((document, measured_on))
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
                "schemaVersion": 2,
                "canonicalUnit": "g",
                "nutritionPer100": {
                    "calories": 52.0,
                    "protein": 0.3,
                    "carbs": 14.0,
                    "fat": 0.2,
                    "fiber": 2.4
                },
                "portions": []
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
                "schemaVersion": 2,
                "canonicalUnit": "g",
                "nutritionPer100": {
                    "calories": 52.0,
                    "protein": 0.3,
                    "carbs": 14.0,
                    "fat": 0.2
                }
            },
            "canonicalQuantity": 150.0,
            "entry": { "enteredQuantity": 150.0 },
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
        template["details"]["nutritionPer100"]["calories"] = json!(-1);
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

#[cfg(test)]
mod application_tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{
        connect_async,
        tungstenite::{Message as ClientMessage, client::IntoClientRequest},
    };

    fn token(subject: &str, expiry: i64) -> String {
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        header.typ = Some("at+jwt".into());
        header.kid = Some("public-test-only".into());
        jsonwebtoken::encode(
            &header,
            &json!({
                "sub":subject,"iss":"https://issuer.example.invalid",
                "aud":"https://api.example.invalid/api","exp":expiry
            }),
            &jsonwebtoken::EncodingKey::from_rsa_pem(include_bytes!(
                "../auth/fixtures/PUBLIC-TEST-ONLY-active-private.pem"
            ))
            .unwrap(),
        )
        .unwrap()
    }

    type ClientSocket = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;
    async fn connect(url: &str) -> ClientSocket {
        let mut request = url.into_client_request().unwrap();
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", "balance".parse().unwrap());
        connect_async(request).await.unwrap().0
    }
    async fn next(socket: &mut ClientSocket) -> ClientMessage {
        tokio::time::timeout(std::time::Duration::from_secs(3), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
    }
    async fn authenticate(socket: &mut ClientSocket, jwt: &str) {
        socket
            .send(ClientMessage::Text(
                json!({"event":"authenticate","accessToken":jwt})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        assert_eq!(
            next(socket).await.into_text().unwrap(),
            "{\"event\":\"authenticated\"}"
        );
    }
    fn close_code(message: ClientMessage) -> u16 {
        match message {
            ClientMessage::Close(Some(frame)) => frame.code.into(),
            other => panic!("expected close, received {other:?}"),
        }
    }

    #[test]
    fn origins_are_exact_https_and_never_accept_null_or_lists() {
        let origins = WsAllowedOrigins::parse("https://balance-staging.shocker.cl").unwrap();
        let mut headers = HeaderMap::new();
        assert!(origins.allows(&headers));
        for value in [
            "null",
            "https://unlisted.example",
            "https://balance-staging.shocker.cl,https://other.example",
            "https://balance-staging.shocker.cl/",
            "malformed",
        ] {
            headers.insert("Origin", value.parse().unwrap());
            assert!(!origins.allows(&headers));
        }
        headers.insert(
            "Origin",
            "https://balance-staging.shocker.cl".parse().unwrap(),
        );
        assert!(origins.allows(&headers));
        headers.append(
            "Origin",
            "https://balance-staging.shocker.cl".parse().unwrap(),
        );
        assert!(!origins.allows(&headers));
        assert!(!WsAllowedOrigins::parse("").unwrap().allows(&headers));
        for value in [
            "http://example.com",
            "https://example.com/",
            "https://example.com/path",
            "https://user@example.com",
            "null",
        ] {
            assert!(WsAllowedOrigins::parse(value).is_err());
        }
    }

    #[tokio::test]
    async fn actual_application_socket_authentication_bounds_expiry_and_user_isolation() {
        let Some((db, schema)) = crate::connectors::user::isolated_identity_test_database().await
        else {
            return;
        };
        for subject in ["first", "second"] {
            let user = db
                .user
                .provision_identity(
                    "https://issuer.example.invalid",
                    subject,
                    &crate::connectors::user::NewUser {
                        email: format!("{subject}@example.invalid"),
                        name: None,
                        family_name: None,
                        given_name: None,
                        picture: None,
                    },
                )
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO user_preferences (id, preferences, updated_at) VALUES ($1, $2, 1)",
            )
            .bind(user.id)
            .bind(json!({"weightTrackingEnabled":subject == "first"}))
            .execute(&db.user.pool)
            .await
            .unwrap();
        }
        let db = Arc::new(db);
        let app = application_sync_routes(
            OidcConfig::test_cached_subject_config(),
            WsAllowedOrigins::parse("https://balance-staging.shocker.cl").unwrap(),
        )
        .layer(Extension(db.clone()))
        .layer(Extension(SyncHub::default()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "ws://{}/ws/sync/application",
            listener.local_addr().unwrap()
        );
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        for origin in [
            "null",
            "https://unlisted.example",
            "https://balance-staging.shocker.cl, https://other.example",
        ] {
            let mut request = url.as_str().into_client_request().unwrap();
            request
                .headers_mut()
                .insert("Sec-WebSocket-Protocol", "balance".parse().unwrap());
            request
                .headers_mut()
                .insert("Origin", origin.parse().unwrap());
            assert!(connect_async(request).await.is_err());
        }
        for protocols in [
            "balance, balance.bearer.synthetic",
            "balance.bearer.synthetic",
            "other",
        ] {
            let mut request = url.as_str().into_client_request().unwrap();
            request
                .headers_mut()
                .insert("Sec-WebSocket-Protocol", protocols.parse().unwrap());
            assert!(connect_async(request).await.is_err());
        }
        let mut request = format!("{url}?token=synthetic")
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", "balance".parse().unwrap());
        assert!(connect_async(request).await.is_err());
        let mut allowed = url.as_str().into_client_request().unwrap();
        allowed
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", "balance".parse().unwrap());
        allowed.headers_mut().insert(
            "Origin",
            "https://balance-staging.shocker.cl".parse().unwrap(),
        );
        let (mut allowed, _) = connect_async(allowed).await.unwrap();
        allowed.close(None).await.unwrap();
        let mut oversized = connect(&url).await;
        oversized
            .send(ClientMessage::Binary(vec![0; 2 * 1024 * 1024 + 1].into()))
            .await
            .unwrap();
        let rejected = tokio::time::timeout(std::time::Duration::from_secs(3), oversized.next())
            .await
            .unwrap();
        assert!(matches!(
            rejected,
            None | Some(Err(_)) | Some(Ok(ClientMessage::Close(_)))
        ));
        use tower::ServiceExt;
        let strict = Router::new()
            .route("/strict", get(|| async { StatusCode::NO_CONTENT }))
            .route_layer(axum::middleware::from_fn_with_state(
                OidcConfig::test_cached_subject_config(),
                crate::modules::auth::middleware::auth,
            ))
            .layer(Extension(db.clone()));
        let request = axum::http::Request::builder()
            .uri("/strict")
            .header(
                "Sec-WebSocket-Protocol",
                format!(
                    "balance.bearer.{}",
                    token("first", chrono::Utc::now().timestamp() + 60)
                ),
            )
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(
            strict.oneshot(request).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        for frame in [
            ClientMessage::Text(json!({"event":"pull","requestId":"preauth","collection":"userPreferences"}).to_string().into()),
            ClientMessage::Text(json!({"event":"push","requestId":"preauth","collection":"userPreferences","rows":[]}).to_string().into()),
            ClientMessage::Text("x".repeat(16 * 1024 + 1).into()),
            ClientMessage::Binary(vec![1,2,3].into()),
            ClientMessage::Text(json!({"event":"authenticate","accessToken":"bad","extra":true}).to_string().into()),
        ] {
            let mut socket = connect(&url).await;
            socket.send(frame).await.unwrap();
            assert_eq!(close_code(next(&mut socket).await), 4003);
        }
        let mut expired = connect(&url).await;
        expired.send(ClientMessage::Text(json!({"event":"authenticate","accessToken":token("first", chrono::Utc::now().timestamp()-1)}).to_string().into())).await.unwrap();
        assert_eq!(close_code(next(&mut expired).await), 4001);
        for subject in ["first", "second"] {
            let mut socket = connect(&url).await;
            authenticate(
                &mut socket,
                &token(subject, chrono::Utc::now().timestamp() + 60),
            )
            .await;
            socket.send(ClientMessage::Text(json!({"event":"pull","requestId":"read","collection":"userPreferences","checkpoint":null,"limit":50}).to_string().into())).await.unwrap();
            let response: Value =
                serde_json::from_str(&next(&mut socket).await.into_text().unwrap()).unwrap();
            assert_eq!(response["documents"].as_array().unwrap().len(), 1);
            assert_eq!(
                response["documents"][0]["preferences"]["weightTrackingEnabled"],
                subject == "first"
            );
            socket.send(ClientMessage::Text(json!({"event":"authenticate","accessToken":token("second",chrono::Utc::now().timestamp()+60)}).to_string().into())).await.unwrap();
            assert_eq!(close_code(next(&mut socket).await), 4003);
        }
        for traffic in [false, true] {
            let mut socket = connect(&url).await;
            authenticate(
                &mut socket,
                &token("first", chrono::Utc::now().timestamp() + 2),
            )
            .await;
            if traffic {
                loop {
                    socket
                        .send(ClientMessage::Ping(vec![1].into()))
                        .await
                        .unwrap();
                    let message = next(&mut socket).await;
                    if let ClientMessage::Close(_) = message {
                        assert_eq!(close_code(message), 4001);
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            } else {
                assert_eq!(close_code(next(&mut socket).await), 4001);
            }
        }
        let mut unauthenticated = connect(&url).await;
        let start = std::time::Instant::now();
        loop {
            unauthenticated
                .send(ClientMessage::Ping(vec![1].into()))
                .await
                .unwrap();
            match next(&mut unauthenticated).await {
                message @ ClientMessage::Close(_) => {
                    assert_eq!(close_code(message), 4003);
                    break;
                }
                _ => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
            }
        }
        assert!(start.elapsed() >= std::time::Duration::from_secs(9));
        assert!(start.elapsed() < std::time::Duration::from_secs(12));
        task.abort();
        crate::connectors::user::cleanup_identity_test_database(&db, &schema).await;
    }
}
