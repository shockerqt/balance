use std::sync::Arc;

use axum::{
    Extension, Json, Router,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    connectors::{
        db::Database,
        sync::{
            Consumption, FOOD_SCHEMA_VERSION, FoodDetails, FoodUnit, NutritionValues, WeightLogRow,
            WeightUpsertStatus,
        },
    },
    modules::{auth::middleware::CurrentUser, sync::hub::SyncHub},
    shared::error::AppError,
};

const MCP_URL: &str = "https://balance.shocker.cl/api/mcp";
const AUTHORIZATION_SERVER: &str = "https://auth.shocker.cl/realms/balance";
const TIMEZONE: &str = "America/Santiago";
const SERVER_INSTRUCTIONS: &str = "Usa get_daily_log para consultar consumos y search_foods exclusivamente para el catálogo. Nunca uses search_foods para consultar consumos, historial o fechas. Usa get_weight_history, set_weight y delete_weight_log únicamente para peso corporal. Si el seguimiento de peso está desactivado, indica que debe habilitarse en Configuración de la app. Para varios días de comidas llama get_daily_log una vez por fecha exacta; una consulta de peso puede usar un rango. Omite date únicamente cuando el usuario dice hoy; hoy se interpreta en America/Santiago.";

pub fn mcp_routes() -> Router {
    Router::new().route("/mcp", post(mcp_post_handler))
}

pub fn mcp_metadata_routes() -> Router {
    Router::new().route(
        "/.well-known/oauth-protected-resource/mcp",
        get(oauth_protected_resource_metadata),
    )
}

async fn oauth_protected_resource_metadata() -> impl IntoResponse {
    Json(json!({
        "resource": MCP_URL,
        "authorization_servers": [AUTHORIZATION_SERVER],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["openid", "profile", "email"],
        "resource_documentation": "https://balance.shocker.cl/docs"
    }))
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SearchFoodsArgs {
    query: String,
    #[serde(default = "default_source")]
    source: String,
    #[serde(default = "default_limit")]
    limit: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetDailyLogArgs {
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateFoodArgs {
    operation_id: Uuid,
    name: String,
    base_amount: f64,
    unit: FoodUnit,
    calories: f64,
    protein: f64,
    carbs: f64,
    fat: f64,
    #[serde(default)]
    fiber: f64,
    sodium_mg: Option<f64>,
    cholesterol_mg: Option<f64>,
    #[serde(default)]
    chilean_seals: Vec<String>,
    category: Option<String>,
    typical_time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogFoodArgs {
    operation_id: Uuid,
    food_id: Uuid,
    quantity: f64,
    unit: FoodUnit,
    date: Option<String>,
    time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateFoodLogArgs {
    log_id: Uuid,
    quantity: Option<f64>,
    date: Option<String>,
    time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteFoodLogArgs {
    log_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetWeightHistoryArgs {
    start_date: Option<String>,
    end_date: Option<String>,
    #[serde(default = "default_weight_limit")]
    limit: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetWeightArgs {
    date: Option<String>,
    weight_kg: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteWeightLogArgs {
    date: Option<String>,
}

fn default_source() -> String {
    "all".into()
}

fn default_limit() -> i64 {
    10
}

fn default_weight_limit() -> i64 {
    30
}

async fn mcp_post_handler(
    Extension(db): Extension<Arc<Database>>,
    Extension(sync_hub): Extension<SyncHub>,
    Extension(user): Extension<CurrentUser>,
    Json(payload): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    if payload.jsonrpc != "2.0" {
        return json_rpc_error(payload.id, -32600, "Invalid JSON-RPC version");
    }
    let id = payload.id.unwrap_or(Value::Null);
    match payload.method.as_str() {
        "initialize" => Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2025-11-25",
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "balance", "version": env!("CARGO_PKG_VERSION") },
                "instructions": SERVER_INSTRUCTIONS
            }
        }))
        .into_response(),
        "notifications/initialized" => StatusCode::ACCEPTED.into_response(),
        "ping" => Json(json!({"jsonrpc": "2.0", "id": id, "result": {}})).into_response(),
        "tools/list" => Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "tools": tool_definitions() }
        }))
        .into_response(),
        "tools/call" => {
            let params = payload.params.unwrap_or_else(|| json!({}));
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let result = call_tool(&db, user.id, name, args).await;
            match result {
                Ok((summary, structured)) => {
                    if let Some(collection) = mutated_collection(name) {
                        sync_hub.notify(user.id, collection);
                    }
                    tool_success(id, &summary, structured)
                }
                Err(error) => tool_failure(id, error),
            }
        }
        _ => json_rpc_error(Some(id), -32601, "Method not found"),
    }
}

fn mutated_collection(tool_name: &str) -> Option<&'static str> {
    match tool_name {
        "create_food" => Some("mealTemplates"),
        "log_food" | "update_food_log" | "delete_food_log" => Some("mealLogs"),
        "set_weight" | "delete_weight_log" => Some("weightLogs"),
        _ => None,
    }
}

async fn call_tool(
    db: &Database,
    user_id: i32,
    name: &str,
    args: Value,
) -> Result<(String, Value), AppError> {
    match name {
        "search_foods" => {
            let args: SearchFoodsArgs = parse_args(args)?;
            let query = args.query.trim();
            if query.is_empty() || query.chars().count() > 120 {
                return Err(AppError::BadRequest(
                    "query must contain between 1 and 120 characters".into(),
                ));
            }
            if !matches!(args.source.as_str(), "all" | "personal" | "official") {
                return Err(AppError::BadRequest(
                    "source must be all, personal, or official".into(),
                ));
            }
            if !(1..=20).contains(&args.limit) {
                return Err(AppError::BadRequest(
                    "limit must be between 1 and 20".into(),
                ));
            }
            let foods = db
                .sync
                .search_food_templates(user_id, query, &args.source, args.limit)
                .await?;
            let count = foods.len();
            Ok((
                format!("Se encontraron {count} alimentos."),
                json!({ "foods": foods }),
            ))
        }
        "get_daily_log" => {
            let args: GetDailyLogArgs = parse_args(args)?;
            let date = match args.date {
                Some(date) => date,
                None => db.sync.current_santiago_date().await?,
            };
            let consumptions = db.sync.get_daily_consumptions(user_id, &date).await?;
            let items: Vec<Value> = consumptions.iter().map(consumption_output).collect();
            let totals = consumptions
                .iter()
                .fold(zero_nutrition(), |mut total, item| {
                    add_nutrition(&mut total, &item.scaled_nutrition());
                    total
                });
            Ok((
                format!("Hay {} consumos registrados para {date}.", items.len()),
                json!({
                    "date": date,
                    "timezone": TIMEZONE,
                    "items": items,
                    "totals": totals
                }),
            ))
        }
        "create_food" => {
            let args: CreateFoodArgs = parse_args(args)?;
            if args.name.trim().chars().count() > 160 {
                return Err(AppError::BadRequest(
                    "name must not exceed 160 characters".into(),
                ));
            }
            let details = FoodDetails {
                schema_version: FOOD_SCHEMA_VERSION,
                base_amount: args.base_amount,
                unit: args.unit,
                nutrition: NutritionValues {
                    calories: args.calories,
                    protein: args.protein,
                    carbs: args.carbs,
                    fat: args.fat,
                    fiber: args.fiber,
                    sodium_mg: args.sodium_mg,
                    cholesterol_mg: args.cholesterol_mg,
                    extended_nutrition: Default::default(),
                },
                serving_label: None,
                grams_per_unit: None,
                chilean_seals: args.chilean_seals,
                category: args.category,
                typical_time: args.typical_time,
            };
            let (food, created) = db
                .sync
                .create_personal_food(user_id, args.operation_id, &args.name, &details)
                .await?;
            Ok((
                if created {
                    format!("Se creó el alimento {}.", food.name)
                } else {
                    format!("El alimento {} ya había sido creado.", food.name)
                },
                json!({
                    "status": if created { "created" } else { "alreadyCreated" },
                    "food": food
                }),
            ))
        }
        "log_food" => {
            let args: LogFoodArgs = parse_args(args)?;
            let consumed_at = resolve_consumed_at(db, args.date, args.time).await?;
            let (consumption, created) = db
                .sync
                .create_consumption(
                    user_id,
                    args.operation_id,
                    args.food_id,
                    args.quantity,
                    args.unit,
                    consumed_at,
                )
                .await?;
            Ok((
                if created {
                    format!("Se registró {}.", consumption.name)
                } else {
                    format!("El consumo de {} ya estaba registrado.", consumption.name)
                },
                json!({
                    "status": if created { "logged" } else { "alreadyLogged" },
                    "log": consumption_output(&consumption)
                }),
            ))
        }
        "update_food_log" => {
            let args: UpdateFoodLogArgs = parse_args(args)?;
            let consumed_at = resolve_optional_datetime(db, args.date, args.time).await?;
            let consumption = db
                .sync
                .update_consumption(user_id, args.log_id, args.quantity, consumed_at)
                .await?;
            Ok((
                format!("Se actualizó el consumo de {}.", consumption.name),
                json!({ "status": "updated", "log": consumption_output(&consumption) }),
            ))
        }
        "delete_food_log" => {
            let args: DeleteFoodLogArgs = parse_args(args)?;
            let consumption = db
                .sync
                .soft_delete_consumption(user_id, args.log_id)
                .await?;
            Ok((
                format!("Se eliminó el consumo de {}.", consumption.name),
                json!({
                    "status": "deleted",
                    "logId": consumption.id,
                    "updatedAt": consumption.updated_at
                }),
            ))
        }
        "get_weight_history" => {
            require_weight_tracking(db, user_id).await?;
            let args: GetWeightHistoryArgs = parse_args(args)?;
            if !(1..=366).contains(&args.limit) {
                return Err(AppError::BadRequest(
                    "limit must be between 1 and 366".into(),
                ));
            }
            if args.start_date.is_some() != args.end_date.is_some() {
                return Err(AppError::BadRequest(
                    "startDate and endDate must be provided together".into(),
                ));
            }
            let today = current_weight_date(db).await?;
            let (start, end) = match (args.start_date, args.end_date) {
                (Some(start), Some(end)) => {
                    let start = parse_weight_date(&start)?;
                    let end = parse_weight_date(&end)?;
                    if start > end {
                        return Err(AppError::BadRequest(
                            "startDate must not be after endDate".into(),
                        ));
                    }
                    if end > today {
                        return Err(AppError::BadRequest(
                            "endDate cannot be in the future".into(),
                        ));
                    }
                    (Some(start), end)
                }
                (None, None) => (None, today),
                _ => unreachable!("paired range checked above"),
            };
            let rows = db
                .sync
                .get_weight_history(user_id, start, end, args.limit)
                .await?;
            let entries: Vec<Value> = rows.iter().map(weight_output).collect();
            let latest = entries.last().cloned().unwrap_or(Value::Null);
            let change_kg = if rows.len() >= 2 {
                let previous = rows[rows.len() - 2].weight_grams;
                Some((rows[rows.len() - 1].weight_grams - previous) as f64 / 1000.0)
            } else {
                None
            };
            Ok((
                format!("Hay {} registros de peso.", entries.len()),
                json!({
                    "timezone": TIMEZONE,
                    "entries": entries,
                    "latest": latest,
                    "changeKg": change_kg
                }),
            ))
        }
        "set_weight" => {
            require_weight_tracking(db, user_id).await?;
            let args: SetWeightArgs = parse_args(args)?;
            let date = resolve_weight_date(db, args.date).await?;
            let grams = weight_kg_to_grams(args.weight_kg)?;
            let (row, status) = db.sync.set_weight(user_id, date, grams).await?;
            let status = match status {
                WeightUpsertStatus::Created => "created",
                WeightUpsertStatus::Updated => "updated",
                WeightUpsertStatus::Unchanged => "unchanged",
            };
            Ok((
                match status {
                    "created" => format!("Se registró el peso para {date}."),
                    "updated" => format!("Se actualizó el peso para {date}."),
                    _ => format!("El peso de {date} ya tenía ese valor."),
                },
                json!({ "status": status, "measurement": weight_output(&row) }),
            ))
        }
        "delete_weight_log" => {
            require_weight_tracking(db, user_id).await?;
            let args: DeleteWeightLogArgs = parse_args(args)?;
            let date = resolve_weight_date(db, args.date).await?;
            let (row, already_deleted) = db.sync.soft_delete_weight(user_id, date).await?;
            Ok((
                if already_deleted {
                    format!("El peso de {date} ya estaba eliminado.")
                } else {
                    format!("Se eliminó el peso de {date}.")
                },
                json!({
                    "status": if already_deleted { "alreadyDeleted" } else { "deleted" },
                    "date": date.to_string(),
                    "updatedAt": row.updated_at
                }),
            ))
        }
        _ => Err(AppError::BadRequest("Unknown tool".into())),
    }
}

async fn resolve_consumed_at(
    db: &Database,
    date: Option<String>,
    time: Option<String>,
) -> Result<i64, AppError> {
    match (date, time) {
        (None, None) => {
            let (date, time) = db.sync.current_santiago_datetime().await?;
            db.sync.local_datetime_to_epoch(&date, &time).await
        }
        (Some(date), Some(time)) => db.sync.local_datetime_to_epoch(&date, &time).await,
        _ => Err(AppError::BadRequest(
            "date and time must be provided together".into(),
        )),
    }
}

async fn resolve_optional_datetime(
    db: &Database,
    date: Option<String>,
    time: Option<String>,
) -> Result<Option<i64>, AppError> {
    match (date, time) {
        (None, None) => Ok(None),
        (Some(date), Some(time)) => Ok(Some(db.sync.local_datetime_to_epoch(&date, &time).await?)),
        _ => Err(AppError::BadRequest(
            "date and time must be provided together".into(),
        )),
    }
}

fn parse_args<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, AppError> {
    serde_json::from_value(args)
        .map_err(|error| AppError::BadRequest(format!("Invalid tool arguments: {error}")))
}

fn consumption_output(consumption: &Consumption) -> Value {
    json!({
        "id": consumption.id,
        "foodId": consumption.template_id,
        "name": consumption.name,
        "quantity": consumption.quantity,
        "unit": consumption.snapshot.unit,
        "consumedAt": consumption.consumed_at,
        "updatedAt": consumption.updated_at,
        "nutrition": consumption.scaled_nutrition()
    })
}

fn zero_nutrition() -> NutritionValues {
    NutritionValues {
        calories: 0.0,
        protein: 0.0,
        carbs: 0.0,
        fat: 0.0,
        fiber: 0.0,
        sodium_mg: None,
        cholesterol_mg: None,
        extended_nutrition: Default::default(),
    }
}

fn add_nutrition(total: &mut NutritionValues, value: &NutritionValues) {
    total.calories += value.calories;
    total.protein += value.protein;
    total.carbs += value.carbs;
    total.fat += value.fat;
    total.fiber += value.fiber;
    total.sodium_mg = add_optional(total.sodium_mg, value.sodium_mg);
    total.cholesterol_mg = add_optional(total.cholesterol_mg, value.cholesterol_mg);
}

fn add_optional(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (None, None) => None,
        (left, right) => Some(left.unwrap_or(0.0) + right.unwrap_or(0.0)),
    }
}

async fn require_weight_tracking(db: &Database, user_id: i32) -> Result<(), AppError> {
    if db.sync.weight_tracking_enabled(user_id).await? {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "Weight tracking is disabled; enable it in Balance Settings first".into(),
        ))
    }
}

async fn current_weight_date(db: &Database) -> Result<NaiveDate, AppError> {
    parse_weight_date(&db.sync.current_santiago_date().await?)
}

async fn resolve_weight_date(db: &Database, date: Option<String>) -> Result<NaiveDate, AppError> {
    let today = current_weight_date(db).await?;
    let date = date
        .as_deref()
        .map(parse_weight_date)
        .transpose()?
        .unwrap_or(today);
    if date > today {
        return Err(AppError::BadRequest(
            "date cannot be in the future in America/Santiago".into(),
        ));
    }
    Ok(date)
}

fn parse_weight_date(value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("date must use YYYY-MM-DD".into()))
}

fn weight_kg_to_grams(weight_kg: f64) -> Result<i32, AppError> {
    if !weight_kg.is_finite() {
        return Err(AppError::BadRequest("weightKg must be finite".into()));
    }
    let grams = weight_kg * 1000.0;
    let rounded = grams.round();
    if (grams - rounded).abs() > 0.000_001 {
        return Err(AppError::BadRequest(
            "weightKg must use at most one decimal place".into(),
        ));
    }
    let grams = rounded as i32;
    crate::connectors::sync::validate_weight_grams(grams)?;
    Ok(grams)
}

fn weight_output(row: &WeightLogRow) -> Value {
    json!({
        "date": row.measured_on.to_string(),
        "weightKg": row.weight_grams as f64 / 1000.0,
        "updatedAt": row.updated_at
    })
}

fn tool_success(id: Value, summary: &str, structured: Value) -> axum::response::Response {
    Json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": summary }],
            "structuredContent": structured,
            "isError": false
        }
    }))
    .into_response()
}

fn tool_failure(id: Value, error: AppError) -> axum::response::Response {
    let (code, message) = match error {
        AppError::BadRequest(message) => ("invalid_arguments", message),
        AppError::NotFound(message) => ("not_found", message),
        AppError::Conflict(message) => ("conflict", message),
        AppError::Db(error) => {
            tracing::error!(?error, "MCP database operation failed");
            ("database_error", "Database operation failed".into())
        }
        AppError::Internal(error) => {
            tracing::error!(%error, "MCP internal operation failed");
            ("internal_error", "Internal operation failed".into())
        }
    };
    Json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": message }],
            "structuredContent": { "error": { "code": code, "message": message } },
            "isError": true
        }
    }))
    .into_response()
}

fn json_rpc_error(id: Option<Value>, code: i32, message: &str) -> axum::response::Response {
    Json(json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": { "code": code, "message": message }
    }))
    .into_response()
}

pub(crate) fn tool_definitions() -> Value {
    let auth = json!([{ "type": "oauth2", "scopes": ["openid", "profile", "email"] }]);
    let read_annotations = json!({
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
    });
    let write_annotations = json!({
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
    });
    json!([
        {
            "name": "search_foods",
            "title": "Buscar en el catálogo de alimentos",
            "description": "Busca exclusivamente alimentos disponibles en el catálogo oficial o personal por nombre o categoría. Úsala para elegir un foodId antes de registrar. NUNCA consulta consumos, el diario, el historial ni fechas; para saber qué comió el usuario usa get_daily_log. Si hay varias coincidencias, presenta los candidatos y pide al usuario elegir uno.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "minLength": 1, "maxLength": 120 },
                    "source": { "type": "string", "enum": ["all", "personal", "official"], "default": "all" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 10 }
                },
                "required": ["query"],
                "additionalProperties": false
            },
            "outputSchema": foods_output_schema(),
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": read_annotations
        },
        {
            "name": "get_daily_log",
            "title": "Consultar consumos por fecha",
            "description": "Consulta exclusivamente los consumos ya registrados y sus totales para una fecha del diario. Para varios días, llama esta herramienta una vez por cada fecha exacta. NUNCA busca alimentos en el catálogo. Si el usuario consulta su historial sin indicar una fecha, pide aclararla. Omite date solo cuando el usuario pide hoy; hoy se interpreta en America/Santiago.",
            "inputSchema": {
                "type": "object",
                "properties": { "date": { "type": "string", "format": "date" } },
                "additionalProperties": false
            },
            "outputSchema": daily_output_schema(),
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": read_annotations
        },
        {
            "name": "create_food",
            "title": "Crear alimento personal",
            "description": "Crea un alimento personal solo después de confirmar una porción base y valores nutricionales completos. No estima ni completa datos faltantes.",
            "inputSchema": create_food_input_schema(),
            "outputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["created", "alreadyCreated"] },
                    "food": food_schema()
                },
                "required": ["status", "food"],
                "additionalProperties": false
            },
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": write_annotations
        },
        {
            "name": "log_food",
            "title": "Registrar consumo",
            "description": "Registra una cantidad de un foodId elegido inequívocamente. Omite date y time solo cuando el usuario quiere registrar el consumo ahora; ambos deben enviarse juntos en cualquier otro caso.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "operationId": uuid_schema(),
                    "foodId": uuid_schema(),
                    "quantity": positive_number_schema(),
                    "unit": unit_schema(),
                    "date": { "type": "string", "format": "date" },
                    "time": { "type": "string", "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }
                },
                "required": ["operationId", "foodId", "quantity", "unit"],
                "additionalProperties": false
            },
            "outputSchema": log_mutation_output_schema(&["logged", "alreadyLogged"]),
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": write_annotations
        },
        {
            "name": "update_food_log",
            "title": "Corregir consumo",
            "description": "Corrige la cantidad o fecha/hora de un consumo identificado por logId. No cambia su alimento ni su snapshot nutricional.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "logId": uuid_schema(),
                    "quantity": positive_number_schema(),
                    "date": { "type": "string", "format": "date" },
                    "time": { "type": "string", "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }
                },
                "required": ["logId"],
                "additionalProperties": false
            },
            "outputSchema": log_mutation_output_schema(&["updated"]),
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": write_annotations
        },
        {
            "name": "delete_food_log",
            "title": "Eliminar consumo",
            "description": "Elimina de forma reversible un consumo concreto. Confirma con el usuario el registro seleccionado antes de usar esta herramienta.",
            "inputSchema": {
                "type": "object",
                "properties": { "logId": uuid_schema() },
                "required": ["logId"],
                "additionalProperties": false
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "const": "deleted" },
                    "logId": uuid_schema(),
                    "updatedAt": { "type": "integer" }
                },
                "required": ["status", "logId", "updatedAt"],
                "additionalProperties": false
            },
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "get_weight_history",
            "title": "Consultar historial de peso",
            "description": "Consulta exclusivamente mediciones de peso corporal. Sin rango devuelve hasta los 30 registros más recientes. Para un rango, envía startDate y endDate juntos; usa la misma fecha en ambos para un día exacto. No funciona mientras el seguimiento de peso esté desactivado en Configuración.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "startDate": { "type": "string", "format": "date" },
                    "endDate": { "type": "string", "format": "date" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 366, "default": 30 }
                },
                "additionalProperties": false
            },
            "outputSchema": weight_history_output_schema(),
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": read_annotations
        },
        {
            "name": "set_weight",
            "title": "Registrar o corregir peso",
            "description": "Registra un peso corporal en kg con un decimal. Existe un solo valor por fecha: repetir el mismo valor no cambia nada y enviar otro lo corrige. Omite date solo para hoy. Requiere que el seguimiento esté habilitado en Configuración.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "date": { "type": "string", "format": "date" },
                    "weightKg": { "type": "number", "minimum": 1.0, "maximum": 500.0, "description": "Kilograms with at most one decimal place" }
                },
                "required": ["weightKg"],
                "additionalProperties": false
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["created", "updated", "unchanged"] },
                    "measurement": weight_measurement_schema()
                },
                "required": ["status", "measurement"],
                "additionalProperties": false
            },
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": write_annotations
        },
        {
            "name": "delete_weight_log",
            "title": "Eliminar peso diario",
            "description": "Elimina de forma reversible el peso de una fecha. Omite date solo para hoy y confirma la fecha con el usuario. Requiere que el seguimiento esté habilitado en Configuración.",
            "inputSchema": {
                "type": "object",
                "properties": { "date": { "type": "string", "format": "date" } },
                "additionalProperties": false
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["deleted", "alreadyDeleted"] },
                    "date": { "type": "string", "format": "date" },
                    "updatedAt": { "type": "integer" }
                },
                "required": ["status", "date", "updatedAt"],
                "additionalProperties": false
            },
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            }
        }
    ])
}

fn weight_measurement_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "date": { "type": "string", "format": "date" },
            "weightKg": { "type": "number", "minimum": 1.0, "maximum": 500.0 },
            "updatedAt": { "type": "integer" }
        },
        "required": ["date", "weightKg", "updatedAt"],
        "additionalProperties": false
    })
}

fn weight_history_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "timezone": { "type": "string", "const": TIMEZONE },
            "entries": { "type": "array", "items": weight_measurement_schema() },
            "latest": {
                "anyOf": [weight_measurement_schema(), { "type": "null" }]
            },
            "changeKg": { "type": ["number", "null"] }
        },
        "required": ["timezone", "entries", "latest", "changeKg"],
        "additionalProperties": false
    })
}

fn create_food_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "operationId": uuid_schema(),
            "name": { "type": "string", "minLength": 1, "maxLength": 160 },
            "baseAmount": positive_number_schema(),
            "unit": unit_schema(),
            "calories": non_negative_number_schema(),
            "protein": non_negative_number_schema(),
            "carbs": non_negative_number_schema(),
            "fat": non_negative_number_schema(),
            "fiber": non_negative_number_schema(),
            "sodiumMg": non_negative_number_schema(),
            "cholesterolMg": non_negative_number_schema(),
            "chileanSeals": { "type": "array", "items": { "type": "string" }, "maxItems": 4 },
            "category": { "type": "string", "maxLength": 80 },
            "typicalTime": { "type": "string", "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }
        },
        "required": ["operationId", "name", "baseAmount", "unit", "calories", "protein", "carbs", "fat"],
        "additionalProperties": false
    })
}

fn foods_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "foods": { "type": "array", "items": food_schema() } },
        "required": ["foods"],
        "additionalProperties": false
    })
}

fn daily_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "date": { "type": "string", "format": "date" },
            "timezone": { "type": "string", "const": TIMEZONE },
            "items": { "type": "array", "items": consumption_schema() },
            "totals": nutrition_schema()
        },
        "required": ["date", "timezone", "items", "totals"],
        "additionalProperties": false
    })
}

fn food_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": uuid_schema(),
            "name": { "type": "string" },
            "isOfficial": { "type": "boolean" },
            "details": {
                "type": "object",
                "properties": {
                    "schemaVersion": { "type": "integer", "const": FOOD_SCHEMA_VERSION },
                    "baseAmount": positive_number_schema(),
                    "unit": unit_schema(),
                    "nutrition": nutrition_schema(),
                    "chileanSeals": { "type": "array", "items": { "type": "string" } },
                    "category": { "type": "string" },
                    "typicalTime": { "type": "string" }
                },
                "required": ["schemaVersion", "baseAmount", "unit", "nutrition", "chileanSeals"],
                "additionalProperties": false
            },
            "updatedAt": { "type": "integer" }
        },
        "required": ["id", "name", "isOfficial", "details", "updatedAt"],
        "additionalProperties": false
    })
}

fn consumption_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": uuid_schema(),
            "foodId": { "type": ["string", "null"], "format": "uuid" },
            "name": { "type": "string" },
            "quantity": positive_number_schema(),
            "unit": unit_schema(),
            "consumedAt": { "type": "integer" },
            "updatedAt": { "type": "integer" },
            "nutrition": nutrition_schema()
        },
        "required": ["id", "foodId", "name", "quantity", "unit", "consumedAt", "updatedAt", "nutrition"],
        "additionalProperties": false
    })
}

fn log_mutation_output_schema(statuses: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": {
            "status": { "type": "string", "enum": statuses },
            "log": consumption_schema()
        },
        "required": ["status", "log"],
        "additionalProperties": false
    })
}

fn nutrition_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "calories": non_negative_number_schema(),
            "protein": non_negative_number_schema(),
            "carbs": non_negative_number_schema(),
            "fat": non_negative_number_schema(),
            "fiber": non_negative_number_schema(),
            "sodiumMg": { "type": ["number", "null"], "minimum": 0 },
            "cholesterolMg": { "type": ["number", "null"], "minimum": 0 }
        },
        "required": ["calories", "protein", "carbs", "fat", "fiber"],
        "additionalProperties": false
    })
}

fn uuid_schema() -> Value {
    json!({ "type": "string", "format": "uuid" })
}

fn unit_schema() -> Value {
    json!({ "type": "string", "enum": ["g", "ml", "unit", "portion", "cup"] })
}

fn positive_number_schema() -> Value {
    json!({ "type": "number", "exclusiveMinimum": 0 })
}

fn non_negative_number_schema() -> Value {
    json!({ "type": "number", "minimum": 0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extract_json_response(res: axum::response::Response) -> Value {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let bytes = rt.block_on(async {
            axum::body::to_bytes(res.into_body(), usize::MAX)
                .await
                .unwrap()
        });
        serde_json::from_slice(&bytes).unwrap()
    }

    fn check_keys_are_camel_case(val: &Value) {
        match val {
            Value::Object(map) => {
                for (k, v) in map {
                    if k != "additionalProperties" && k != "$schema" {
                        assert!(
                            !k.contains('_'),
                            "Key '{k}' contains underscore, violating camelCase boundary contract"
                        );
                        let first_char = k.chars().next().unwrap();
                        assert!(
                            first_char.is_ascii_lowercase(),
                            "Key '{k}' does not start with lowercase letter"
                        );
                    }
                    if k == "properties" {
                        check_keys_are_camel_case(v);
                    }
                }
            }
            Value::Array(arr) => {
                for item in arr {
                    check_keys_are_camel_case(item);
                }
            }
            _ => {}
        }
    }

    #[test]
    fn tool_surface_contains_only_canonical_tools() {
        let tools = tool_definitions().as_array().unwrap().clone();
        let names: Vec<_> = tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .collect();
        assert_eq!(
            names,
            [
                "search_foods",
                "get_daily_log",
                "create_food",
                "log_food",
                "update_food_log",
                "delete_food_log",
                "get_weight_history",
                "set_weight",
                "delete_weight_log"
            ]
        );
        assert_eq!(tools.len(), 9);
    }

    #[test]
    fn weight_precision_conversion_is_exact_and_bounded() {
        assert_eq!(weight_kg_to_grams(72.4).unwrap(), 72_400);
        assert_eq!(weight_kg_to_grams(1.0).unwrap(), 1_000);
        assert!(weight_kg_to_grams(72.45).is_err());
        assert!(weight_kg_to_grams(0.9).is_err());
        assert!(weight_kg_to_grams(500.1).is_err());
        assert!(weight_kg_to_grams(f64::NAN).is_err());
    }

    #[test]
    fn every_tool_has_strict_structured_contract_and_auth() {
        for tool in tool_definitions().as_array().unwrap() {
            assert!(tool.get("title").is_some());
            assert!(tool.get("outputSchema").is_some());
            assert_eq!(
                tool.pointer("/inputSchema/additionalProperties"),
                Some(&Value::Bool(false))
            );
            assert_eq!(
                tool.pointer("/outputSchema/additionalProperties"),
                Some(&Value::Bool(false))
            );
            assert_eq!(
                tool.pointer("/securitySchemes/0/type")
                    .and_then(Value::as_str),
                Some("oauth2")
            );
            let scopes = tool.pointer("/securitySchemes/0/scopes").unwrap();
            assert_eq!(scopes, &json!(["openid", "profile", "email"]));
            assert_eq!(
                tool.pointer("/_meta/securitySchemes"),
                tool.get("securitySchemes"),
                "OpenAI compatibility metadata must mirror securitySchemes"
            );
        }
    }

    #[test]
    fn tool_schemas_are_strictly_camel_case_at_mcp_boundary() {
        for tool in tool_definitions().as_array().unwrap() {
            check_keys_are_camel_case(tool.get("inputSchema").unwrap());
            check_keys_are_camel_case(tool.get("outputSchema").unwrap());
        }
    }

    #[test]
    fn mutation_tools_do_not_accept_client_snapshots() {
        let tools = tool_definitions();
        let mutation_tools = [
            "create_food",
            "log_food",
            "update_food_log",
            "delete_food_log",
        ];
        for name in mutation_tools {
            let tool = tools
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t.get("name") == Some(&Value::String(name.into())))
                .unwrap();
            let props = tool.pointer("/inputSchema/properties").unwrap();
            assert!(
                props.get("nutritionSnapshot").is_none(),
                "Tool {name} accepts nutritionSnapshot"
            );
            assert!(
                props.get("nameSnapshot").is_none(),
                "Tool {name} accepts nameSnapshot"
            );
            assert!(
                props.get("snapshot").is_none(),
                "Tool {name} accepts snapshot"
            );
            assert!(
                props.get("nutrition_snapshot").is_none(),
                "Tool {name} accepts nutrition_snapshot"
            );
            assert!(
                props.get("name_snapshot").is_none(),
                "Tool {name} accepts name_snapshot"
            );
        }
    }

    #[test]
    fn tool_descriptions_mandate_clarification_for_ambiguity() {
        let tools = tool_definitions();
        let get_desc = |name: &str| -> String {
            tools
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t.get("name") == Some(&Value::String(name.into())))
                .unwrap()
                .get("description")
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        };

        assert!(get_desc("search_foods").contains("pide al usuario elegir uno"));
        assert!(get_desc("get_daily_log").contains("Omite date solo cuando"));
        assert!(get_desc("create_food").contains("solo después de confirmar"));
        assert!(get_desc("log_food").contains("inequívocamente"));
        assert!(get_desc("log_food").contains("ambos deben enviarse juntos"));
        assert!(
            get_desc("update_food_log")
                .contains("No cambia su alimento ni su snapshot nutricional")
        );
        assert!(
            get_desc("delete_food_log")
                .contains("Confirma con el usuario el registro seleccionado")
        );
    }

    #[test]
    fn catalog_and_history_routing_rules_are_mutually_exclusive() {
        let tools = tool_definitions();
        let get_tool = |name: &str| {
            tools
                .as_array()
                .unwrap()
                .iter()
                .find(|tool| tool.get("name") == Some(&Value::String(name.into())))
                .unwrap()
        };

        let search_foods = get_tool("search_foods");
        let get_daily_log = get_tool("get_daily_log");
        let search_description = search_foods["description"].as_str().unwrap();
        let daily_description = get_daily_log["description"].as_str().unwrap();

        assert!(search_description.contains("exclusivamente"));
        assert!(search_description.contains("catálogo"));
        assert!(search_description.contains("NUNCA consulta consumos"));
        assert!(search_description.contains("usa get_daily_log"));
        assert!(daily_description.contains("consumos ya registrados"));
        assert!(daily_description.contains("una vez por cada fecha exacta"));
        assert!(daily_description.contains("NUNCA busca alimentos en el catálogo"));
        assert!(SERVER_INSTRUCTIONS.contains("Nunca uses search_foods"));

        assert!(
            search_foods
                .pointer("/inputSchema/properties/date")
                .is_none(),
            "search_foods must not accept dates"
        );
        assert!(
            get_daily_log
                .pointer("/inputSchema/properties/query")
                .is_none(),
            "get_daily_log must not accept catalog queries"
        );
    }

    #[test]
    fn idempotency_contract_exposure() {
        let tools = tool_definitions();
        for tool in tools.as_array().unwrap() {
            let idempotent = tool.pointer("/annotations/idempotentHint");
            assert_eq!(
                idempotent,
                Some(&Value::Bool(true)),
                "Tool {:?} missing idempotentHint",
                tool.get("name")
            );
        }

        let create_food = tools
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t.get("name") == Some(&Value::String("create_food".into())))
            .unwrap();
        assert_eq!(
            create_food.pointer("/inputSchema/properties/operationId/format"),
            Some(&Value::String("uuid".into()))
        );

        let log_food = tools
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t.get("name") == Some(&Value::String("log_food".into())))
            .unwrap();
        assert_eq!(
            log_food.pointer("/inputSchema/properties/operationId/format"),
            Some(&Value::String("uuid".into()))
        );
    }

    #[test]
    fn test_structured_success_response_envelope() {
        let res = tool_success(json!("req-1"), "Exito", json!({ "status": "ok" }));
        let val = extract_json_response(res);

        assert_eq!(val["jsonrpc"], "2.0");
        assert_eq!(val["id"], "req-1");
        assert_eq!(val["result"]["isError"], false);
        assert_eq!(val["result"]["content"][0]["type"], "text");
        assert_eq!(val["result"]["content"][0]["text"], "Exito");
        assert_eq!(
            val["result"]["structuredContent"],
            json!({ "status": "ok" })
        );
    }

    #[test]
    fn test_structured_failure_response_envelope_variants() {
        let bad = tool_failure(json!(10), AppError::BadRequest("bad input".into()));
        let v_bad = extract_json_response(bad);
        assert_eq!(v_bad["jsonrpc"], "2.0");
        assert_eq!(v_bad["id"], 10);
        assert_eq!(v_bad["result"]["isError"], true);
        assert_eq!(
            v_bad["result"]["structuredContent"]["error"]["code"],
            "invalid_arguments"
        );
        assert_eq!(
            v_bad["result"]["structuredContent"]["error"]["message"],
            "bad input"
        );

        let not_found = tool_failure(json!(11), AppError::NotFound("item missing".into()));
        let v_nf = extract_json_response(not_found);
        assert_eq!(
            v_nf["result"]["structuredContent"]["error"]["code"],
            "not_found"
        );
        assert_eq!(
            v_nf["result"]["structuredContent"]["error"]["message"],
            "item missing"
        );

        let conflict = tool_failure(json!(12), AppError::Conflict("already exists".into()));
        let v_cf = extract_json_response(conflict);
        assert_eq!(
            v_cf["result"]["structuredContent"]["error"]["code"],
            "conflict"
        );

        let db_err = tool_failure(json!(13), AppError::Db(sqlx::Error::RowNotFound));
        let v_db = extract_json_response(db_err);
        assert_eq!(
            v_db["result"]["structuredContent"]["error"]["code"],
            "database_error"
        );
        assert_eq!(
            v_db["result"]["structuredContent"]["error"]["message"],
            "Database operation failed"
        );

        let int_err = tool_failure(json!(14), AppError::Internal("internal crash".into()));
        let v_int = extract_json_response(int_err);
        assert_eq!(
            v_int["result"]["structuredContent"]["error"]["code"],
            "internal_error"
        );
        assert_eq!(
            v_int["result"]["structuredContent"]["error"]["message"],
            "Internal operation failed"
        );
    }

    #[test]
    fn test_json_rpc_error_response_envelope() {
        let res = json_rpc_error(Some(json!(5)), -32601, "Method not found");
        let val = extract_json_response(res);

        assert_eq!(val["jsonrpc"], "2.0");
        assert_eq!(val["id"], 5);
        assert_eq!(val["error"]["code"], -32601);
        assert_eq!(val["error"]["message"], "Method not found");
    }

    #[test]
    fn negative_serde_rejects_unknown_fields() {
        let op_id = Uuid::new_v4();
        let food_id = Uuid::new_v4();

        assert!(
            parse_args::<SearchFoodsArgs>(json!({ "query": "apple", "extraField": 123 })).is_err()
        );
        assert!(
            parse_args::<GetDailyLogArgs>(json!({ "date": "2026-08-09", "unexpected": true }))
                .is_err()
        );
        assert!(
            parse_args::<CreateFoodArgs>(json!({
                "operationId": op_id,
                "name": "Manzana",
                "baseAmount": 100.0,
                "unit": "g",
                "calories": 50.0,
                "protein": 0.5,
                "carbs": 12.0,
                "fat": 0.1,
                "unknown": "bad"
            }))
            .is_err()
        );
        assert!(
            parse_args::<LogFoodArgs>(json!({
                "operationId": op_id,
                "foodId": food_id,
                "quantity": 150.0,
                "unit": "g",
                "extra": 1
            }))
            .is_err()
        );
        assert!(
            parse_args::<UpdateFoodLogArgs>(json!({ "logId": food_id, "foo": "bar" })).is_err()
        );
        assert!(
            parse_args::<DeleteFoodLogArgs>(json!({ "logId": food_id, "bogus": false })).is_err()
        );
    }

    #[test]
    fn negative_serde_rejects_invalid_units() {
        let op_id = Uuid::new_v4();
        let food_id = Uuid::new_v4();

        assert!(
            parse_args::<CreateFoodArgs>(json!({
                "operationId": op_id,
                "name": "Pan",
                "baseAmount": 100.0,
                "unit": "grams",
                "calories": 250.0,
                "protein": 8.0,
                "carbs": 50.0,
                "fat": 2.0
            }))
            .is_err()
        );

        assert!(
            parse_args::<LogFoodArgs>(json!({
                "operationId": op_id,
                "foodId": food_id,
                "quantity": 1.0,
                "unit": "lbs"
            }))
            .is_err()
        );
    }

    #[test]
    fn negative_serde_rejects_malformed_uuids() {
        assert!(
            parse_args::<CreateFoodArgs>(json!({
                "operationId": "not-a-uuid",
                "name": "Leche",
                "baseAmount": 200.0,
                "unit": "ml",
                "calories": 120.0,
                "protein": 6.0,
                "carbs": 10.0,
                "fat": 6.0
            }))
            .is_err()
        );

        assert!(
            parse_args::<LogFoodArgs>(json!({
                "operationId": Uuid::new_v4(),
                "foodId": "12345",
                "quantity": 100.0,
                "unit": "g"
            }))
            .is_err()
        );

        assert!(parse_args::<UpdateFoodLogArgs>(json!({ "logId": "invalid-uuid" })).is_err());
        assert!(parse_args::<DeleteFoodLogArgs>(json!({ "logId": "" })).is_err());
    }
}
