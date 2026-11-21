use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{Instant, timeout_at},
};

use axum::{
    Extension, Json, Router,
    extract::rejection::JsonRejection,
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{MethodRouter, get, post},
};
use chrono::NaiveDate;
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{MapAccess, Visitor},
};
use serde_json::{Value, json, value::RawValue};
use uuid::Uuid;

use crate::{
    connectors::{
        db::Database,
        sync::{
            CanonicalUnit, Consumption, EXTENDED_NUTRIENT_KEYS, FOOD_SCHEMA_VERSION, FoodDetails,
            MAX_BRAND_CHARS, NutritionValues, PortionDefinition, WeightLogRow, WeightUpsertStatus,
            deserialize_optional_brand, validate_optional_brand,
        },
    },
    modules::{
        auth::{
            middleware::CurrentUser,
            oidc::{IdentityMode, OidcConfig},
        },
        sync::hub::SyncHub,
    },
    shared::error::AppError,
};

pub mod observation;

const MCP_URL: &str = "https://balance.shocker.cl/api/mcp";
const AUTHORIZATION_SERVER: &str = "https://auth.shocker.cl/realms/balance";
const TIMEZONE: &str = "America/Santiago";
const SERVER_INSTRUCTIONS: &str = "Usa get_daily_log para consultar consumos y search_foods exclusivamente para el catálogo. Nunca uses search_foods para consultar consumos, historial o fechas. Usa get_weight_history, set_weight y delete_weight_log únicamente para peso corporal. Si el seguimiento de peso está desactivado, indica que debe habilitarse en Configuración de la app. Para varios días de comidas llama get_daily_log una vez por fecha exacta; una consulta de peso puede usar un rango. Omite date únicamente cuando el usuario dice hoy; hoy se interpreta en America/Santiago.";

const MCP_ADMISSION_TIMEOUT: Duration = Duration::from_secs(10);
const MCP_MAX_ENROLLED: usize = 128;
const MCP_MAX_ENROLLED_PER_USER: usize = 24;
const MCP_MAX_RUNNING_PER_USER: usize = 6;

#[derive(Clone)]
pub struct AdmissionController {
    global: Arc<Semaphore>,
    enrolled: Arc<Mutex<EnrollmentCounts>>,
}

#[derive(Default)]
struct EnrollmentCounts {
    total: usize,
    users: HashMap<i32, UserEnrollment>,
}

struct UserEnrollment {
    count: usize,
    permits: Arc<Semaphore>,
}

struct Enrollment {
    counts: Arc<Mutex<EnrollmentCounts>>,
    user_id: i32,
}

impl Drop for Enrollment {
    fn drop(&mut self) {
        let mut counts = self.counts.lock().unwrap();
        counts.total -= 1;
        let user = counts.users.get_mut(&self.user_id).unwrap();
        user.count -= 1;
        if user.count == 0 {
            counts.users.remove(&self.user_id);
        }
    }
}

struct Admission {
    // Fields drop in order. Release permits before retiring the user entry.
    _global: Option<OwnedSemaphorePermit>,
    _user: Option<OwnedSemaphorePermit>,
    _enrollment: Enrollment,
}

impl AdmissionController {
    pub fn new(pool_max: u32) -> Self {
        let global_limit = pool_max.saturating_sub(2).clamp(1, 14) as usize;
        Self {
            global: Arc::new(Semaphore::new(global_limit)),
            enrolled: Arc::new(Mutex::new(EnrollmentCounts::default())),
        }
    }

    fn enroll(&self, user_id: i32) -> Option<(Enrollment, Arc<Semaphore>)> {
        let mut counts = self.enrolled.lock().unwrap();
        if counts.total >= MCP_MAX_ENROLLED
            || counts
                .users
                .get(&user_id)
                .is_some_and(|user| user.count >= MCP_MAX_ENROLLED_PER_USER)
        {
            return None;
        }
        counts.total += 1;
        let user = counts
            .users
            .entry(user_id)
            .or_insert_with(|| UserEnrollment {
                count: 0,
                permits: Arc::new(Semaphore::new(MCP_MAX_RUNNING_PER_USER)),
            });
        user.count += 1;
        let enrollment = Enrollment {
            counts: self.enrolled.clone(),
            user_id,
        };
        Some((enrollment, user.permits.clone()))
    }

    async fn admit(&self, user_id: i32) -> Option<Admission> {
        let deadline = Instant::now() + MCP_ADMISSION_TIMEOUT;
        let (enrollment, user) = self.enroll(user_id)?;
        let mut admission = Admission {
            _global: None,
            _user: None,
            _enrollment: enrollment,
        };
        timeout_at(deadline, async {
            admission._user = Some(
                user.acquire_owned()
                    .await
                    .expect("user semaphore stays open"),
            );
            admission._global = Some(
                self.global
                    .clone()
                    .acquire_owned()
                    .await
                    .expect("global semaphore stays open"),
            );
        })
        .await
        .ok()?;
        // The timeout polls the permits before its timer when both are ready.
        (Instant::now() < deadline).then_some(admission)
    }
}

pub fn mcp_post(admission: AdmissionController) -> MethodRouter {
    post(mcp_post_handler).layer(Extension(admission))
}

#[cfg(test)]
pub fn mcp_routes(admission: AdmissionController) -> Router {
    Router::new().route("/mcp", mcp_post(admission))
}

pub fn mcp_metadata_routes(api: &OidcConfig, mcp: &OidcConfig) -> Router {
    if api.identity_mode() == IdentityMode::IssuerSubject {
        return Router::new()
            .route(
                "/.well-known/oauth-protected-resource",
                strict_resource_metadata(api),
            )
            .route(
                "/.well-known/oauth-protected-resource/mcp",
                strict_resource_metadata(mcp),
            );
    }
    Router::new().route(
        "/.well-known/oauth-protected-resource/mcp",
        get(oauth_protected_resource_metadata),
    )
}

fn strict_resource_metadata(oidc: &OidcConfig) -> axum::routing::MethodRouter {
    let metadata = json!({
        "resource": oidc.resource().expect("strict resource"),
        "authorization_servers": [oidc.issuer()],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["openid", "profile", "email", "offline_access"]
    });
    get(move || {
        let metadata = metadata.clone();
        async move {
            (
                [(axum::http::header::CACHE_CONTROL, "no-store")],
                Json(metadata),
            )
        }
    })
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

const LATEST_VERSION: &str = "2025-11-25";
const JUNE_VERSION: &str = "2025-06-18";
pub const PROTOCOL_VERSION_HEADER: &str = "mcp-protocol-version";

pub fn supports_version(version: &HeaderValue) -> bool {
    version == LATEST_VERSION || version == JUNE_VERSION
}

#[derive(Default)]
struct Envelope<'a> {
    fields: HashMap<String, &'a RawValue>,
    duplicate: bool,
}

impl<'de> Deserialize<'de> for Envelope<'de> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct EnvelopeVisitor;

        impl<'de> Visitor<'de> for EnvelopeVisitor {
            type Value = Envelope<'de>;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a JSON-RPC object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Envelope<'de>, A::Error> {
                let mut envelope = Envelope::default();
                while let Some(name) = map.next_key::<String>()? {
                    let value = map.next_value()?;
                    envelope.duplicate |= envelope.fields.insert(name, value).is_some();
                }
                Ok(envelope)
            }
        }

        deserializer.deserialize_map(EnvelopeVisitor)
    }
}

fn valid_id(value: &RawValue) -> bool {
    let value = value.get();
    if value.starts_with('"') {
        serde_json::from_str::<String>(value).is_ok()
    } else {
        value.parse::<i64>().is_ok() || value.parse::<u64>().is_ok()
    }
}

fn valid_client_error(error: &RawValue) -> bool {
    if !error.get().starts_with('{') {
        return false;
    }
    serde_json::from_str::<HashMap<String, &RawValue>>(error.get()).is_ok_and(|error| {
        error.get("code").is_some_and(|code| {
            let code = code.get();
            code.strip_prefix('-')
                .unwrap_or(code)
                .bytes()
                .all(|byte| byte.is_ascii_digit())
        }) && error
            .get("message")
            .is_some_and(|message| serde_json::from_str::<String>(message.get()).is_ok())
    })
}

fn initialization_version(params: Option<&RawValue>) -> Option<&'static str> {
    let params: HashMap<String, &RawValue> = serde_json::from_str(params?.get()).ok()?;
    let proposal: String = serde_json::from_str(params.get("protocolVersion")?.get()).ok()?;
    let bytes = proposal.as_bytes();
    if bytes.len() != 10
        || !bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        })
    {
        return None;
    }
    if !params.get("capabilities")?.get().starts_with('{') {
        return None;
    }
    let client: HashMap<String, &RawValue> =
        serde_json::from_str(params.get("clientInfo")?.get()).ok()?;
    serde_json::from_str::<String>(client.get("name")?.get()).ok()?;
    serde_json::from_str::<String>(client.get("version")?.get()).ok()?;
    Some(if proposal == JUNE_VERSION {
        JUNE_VERSION
    } else {
        LATEST_VERSION
    })
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
struct PortionInput {
    id: String,
    name: String,
    portion_quantity: f64,
    canonical_quantity: f64,
}

const MAX_PORTION_ID_CHARS: usize = 80;
const MAX_CREATE_PORTIONS: usize = 50;
const MAX_CREATE_SEALS: usize = 4;
const MAX_CREATE_CATEGORY_CHARS: usize = 80;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateFoodArgs {
    operation_id: Uuid,
    name: String,
    canonical_unit: CanonicalUnit,
    calories: f64,
    protein: f64,
    carbs: f64,
    fat: f64,
    #[serde(default)]
    fiber: Option<f64>,
    sodium_mg: Option<f64>,
    cholesterol_mg: Option<f64>,
    #[serde(default)]
    portions: Vec<PortionInput>,
    #[serde(default)]
    chilean_seals: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_optional_brand")]
    brand: Option<String>,
    category: Option<String>,
    typical_time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogFoodArgs {
    operation_id: Uuid,
    food_id: Uuid,
    quantity: f64,
    portion_id: Option<String>,
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

#[derive(Clone, Copy)]
struct MessageRejection(&'static str);

fn reject_message(code: i32, id: Option<&RawValue>) -> Response {
    let (message, label) = match code {
        -32700 => ("Parse error", "json_parse_error"),
        _ => ("Invalid Request", "invalid_envelope"),
    };
    let mut response = (StatusCode::BAD_REQUEST, json_rpc_error(id, code, message)).into_response();
    response.extensions_mut().insert(MessageRejection(label));
    response
}

fn reject_without_reply(label: &'static str) -> Response {
    let mut response = StatusCode::BAD_REQUEST.into_response();
    response.extensions_mut().insert(MessageRejection(label));
    response
}

#[cfg(test)]
#[derive(Clone, Default)]
struct DispatchCount(Arc<std::sync::atomic::AtomicUsize>);

async fn mcp_post_handler(
    Extension(db): Extension<Arc<Database>>,
    Extension(sync_hub): Extension<SyncHub>,
    Extension(user): Extension<CurrentUser>,
    Extension(admission): Extension<AdmissionController>,
    observation: Option<Extension<observation::Observation>>,
    #[cfg(test)] dispatch_count: Option<Extension<DispatchCount>>,
    payload: Result<Json<Box<RawValue>>, JsonRejection>,
) -> Response {
    let raw = match payload {
        Ok(Json(raw)) => raw,
        Err(JsonRejection::JsonSyntaxError(_) | JsonRejection::JsonDataError(_)) => {
            return reject_message(-32700, None);
        }
        Err(rejection) => {
            let mut response = rejection.into_response();
            response
                .extensions_mut()
                .insert(MessageRejection("json_rejected"));
            return response;
        }
    };
    // RawValue checks the complete JSON text without decoding a batch's entries.
    if !raw.get().starts_with('{') {
        return reject_message(-32600, None);
    }
    let Envelope {
        mut fields,
        duplicate,
    } = match serde_json::from_str(raw.get()) {
        Ok(envelope) => envelope,
        Err(_) => return reject_message(-32700, None),
    };
    if duplicate {
        return reject_message(-32600, None);
    }
    let id = fields.remove("id");
    if id.is_some_and(|id| !valid_id(id)) {
        return reject_message(-32600, None);
    }
    let method = fields.remove("method");
    let params = fields.remove("params");
    let is_rpc_2 = fields.remove("jsonrpc").is_some_and(|version| {
        serde_json::from_str::<String>(version.get()).is_ok_and(|version| version == "2.0")
    });

    if fields.contains_key("result") || fields.contains_key("error") {
        let valid_response = match (fields.remove("result"), fields.remove("error")) {
            (Some(result), None) => id.is_some() && result.get().starts_with('{'),
            (None, Some(error)) => valid_client_error(error),
            _ => false,
        };
        return if is_rpc_2 && method.is_none() && params.is_none() && valid_response {
            reject_without_reply("unsolicited_response")
        } else {
            reject_message(-32600, None)
        };
    }
    let Some(method) = method.and_then(|method| serde_json::from_str::<String>(method.get()).ok())
    else {
        return reject_message(-32600, None);
    };
    let method = method.as_str();
    if !is_rpc_2 {
        return reject_message(-32600, id);
    }

    let observation = observation.as_ref().map(|Extension(value)| value);
    let notification_only = matches!(
        method,
        "notifications/initialized" | "notifications/cancelled"
    );
    let Some(id) = id else {
        if notification_only {
            if let Some(observation) = observation {
                observation.request(method, None);
                observation.outcome("notification_accepted");
            }
            // The stateless transport has no in-flight request registry to cancel.
            return StatusCode::ACCEPTED.into_response();
        }
        return reject_without_reply("unsupported_notification");
    };
    if notification_only {
        return reject_message(-32600, Some(id));
    }

    // Decode only the fields needed for routing. Nested values stay raw until used.
    let tool_params = if method == "tools/call" {
        params.and_then(|params| {
            serde_json::from_str::<HashMap<String, &RawValue>>(params.get()).ok()
        })
    } else {
        None
    };
    let tool_name = tool_params
        .as_ref()
        .and_then(|params| params.get("name"))
        .and_then(|name| serde_json::from_str::<String>(name.get()).ok());
    if let Some(observation) = observation {
        observation.request(
            method,
            (method == "tools/call").then(|| tool_name.as_deref().unwrap_or_default()),
        );
    }

    // Headerless operations use the common single-message behavior of 2025-03-26.
    // Explicit supported versions share those same operations.
    let rpc_error = |code, message| {
        if let Some(observation) = observation {
            observation.outcome("json_rpc_error");
        }
        json_rpc_error(Some(id), code, message)
    };
    match method {
        "initialize" => {
            let Some(version) = initialization_version(params) else {
                return rpc_error(-32602, "Invalid initialize parameters");
            };
            json_rpc_result(
                id,
                &json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "balance", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": SERVER_INSTRUCTIONS
                }),
            )
        }
        "ping" | "tools/list" => {
            if params.is_some_and(|params| !params.get().starts_with('{')) {
                return rpc_error(-32602, "Invalid params");
            }
            let result = if method == "ping" {
                json!({})
            } else {
                json!({"tools": tool_definitions()})
            };
            json_rpc_result(id, &result)
        }
        "tools/call" => {
            let name = tool_name.as_deref().unwrap_or_default();
            let arguments = tool_params
                .as_ref()
                .and_then(|params| params.get("arguments"));
            if name.is_empty() || arguments.is_some_and(|args| !args.get().starts_with('{')) {
                return rpc_error(-32602, "Invalid tools/call parameters");
            }
            if known_tool(name).is_none() {
                return rpc_error(-32602, "Unknown tool");
            }
            let Ok(args) = arguments.map_or_else(
                || Ok(json!({})),
                |arguments| serde_json::from_str(arguments.get()),
            ) else {
                return tool_failure(
                    id,
                    AppError::BadRequest("Invalid tool arguments".into()),
                    observation,
                );
            };
            let Some(_admitted) = admission.admit(user.id).await else {
                return tool_error(
                    id,
                    "server_busy",
                    "Server busy. Retry shortly.",
                    observation,
                );
            };
            #[cfg(test)]
            if let Some(Extension(dispatch_count)) = dispatch_count {
                dispatch_count
                    .0
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
            let mut food_log_committed = false;
            let result = call_tool(&db, user.id, name, args, &mut food_log_committed).await;
            let collection = if food_log_committed {
                Some("mealLogs")
            } else if result.is_ok() {
                mutated_collection(name)
            } else {
                None
            };
            if let Some(collection) = collection {
                sync_hub.notify(user.id, collection);
            }
            match result {
                Ok((summary, structured)) => tool_success(id, &summary, structured, observation),
                Err(error) => tool_failure(id, error, observation),
            }
        }
        _ => rpc_error(-32601, "Method not found"),
    }
}

fn known_tool(tool: &str) -> Option<&'static str> {
    match tool {
        "search_foods" => Some("search_foods"),
        "get_daily_log" => Some("get_daily_log"),
        "create_food" => Some("create_food"),
        "log_food" => Some("log_food"),
        "update_food_log" => Some("update_food_log"),
        "delete_food_log" => Some("delete_food_log"),
        "get_weight_history" => Some("get_weight_history"),
        "set_weight" => Some("set_weight"),
        "delete_weight_log" => Some("delete_weight_log"),
        _ => None,
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
    food_log_committed: &mut bool,
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
                Some(date) => {
                    validate_food_date(&date)?;
                    date
                }
                None => db.sync.current_santiago_date().await?,
            };
            let consumptions = db.sync.get_daily_consumptions(user_id, &date).await?;
            let (items, totals) = daily_nutrition_output(&consumptions)?;
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
            validate_optional_brand(args.brand.as_deref())?;
            if args.portions.len() > MAX_CREATE_PORTIONS {
                return Err(AppError::BadRequest(format!(
                    "portions must contain at most {MAX_CREATE_PORTIONS} items"
                )));
            }
            if args.chilean_seals.len() > MAX_CREATE_SEALS {
                return Err(AppError::BadRequest(format!(
                    "chileanSeals must contain at most {MAX_CREATE_SEALS} items"
                )));
            }
            if args
                .category
                .as_ref()
                .is_some_and(|category| category.chars().count() > MAX_CREATE_CATEGORY_CHARS)
            {
                return Err(AppError::BadRequest(format!(
                    "category must not exceed {MAX_CREATE_CATEGORY_CHARS} characters"
                )));
            }
            if let Some(time) = &args.typical_time {
                validate_time("typicalTime", time)?;
            }
            let details = FoodDetails {
                schema_version: FOOD_SCHEMA_VERSION,
                canonical_unit: args.canonical_unit,
                nutrition_per100: NutritionValues {
                    calories: args.calories,
                    protein: args.protein,
                    carbs: args.carbs,
                    fat: args.fat,
                    fiber: args.fiber,
                    sodium_mg: args.sodium_mg,
                    cholesterol_mg: args.cholesterol_mg,
                    extended_nutrition: Default::default(),
                },
                portions: args
                    .portions
                    .into_iter()
                    .map(|portion| PortionDefinition {
                        id: portion.id,
                        name: portion.name,
                        portion_quantity: portion.portion_quantity,
                        canonical_quantity: portion.canonical_quantity,
                    })
                    .collect(),
                chilean_seals: args.chilean_seals,
                brand: args.brand,
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
            if args
                .portion_id
                .as_ref()
                .is_some_and(|id| id.trim().is_empty() || id.chars().count() > MAX_PORTION_ID_CHARS)
            {
                return Err(AppError::BadRequest(format!(
                    "portionId must contain between 1 and {MAX_PORTION_ID_CHARS} characters and cannot be blank"
                )));
            }
            validate_quantity(args.quantity)?;
            let consumed_at = match resolve_optional_datetime(db, args.date, args.time).await? {
                Some(consumed_at) => consumed_at,
                None => {
                    let (date, time) = db.sync.current_santiago_datetime().await?;
                    db.sync.local_datetime_to_epoch(&date, &time).await?
                }
            };
            let (consumption, created) = db
                .sync
                .create_consumption(
                    user_id,
                    args.operation_id,
                    args.food_id,
                    args.quantity,
                    args.portion_id.as_deref(),
                    consumed_at,
                )
                .await?;
            *food_log_committed = created;
            Ok((
                if created {
                    format!("Se registró {}.", consumption.name)
                } else {
                    format!("El consumo de {} ya estaba registrado.", consumption.name)
                },
                json!({
                    "status": if created { "logged" } else { "alreadyLogged" },
                    "log": consumption_output(&consumption)?
                }),
            ))
        }
        "update_food_log" => {
            let args: UpdateFoodLogArgs = parse_args(args)?;
            if let Some(quantity) = args.quantity {
                validate_quantity(quantity)?;
            }
            let consumed_at = resolve_optional_datetime(db, args.date, args.time).await?;
            let consumption = db
                .sync
                .update_consumption(user_id, args.log_id, args.quantity, consumed_at)
                .await?;
            *food_log_committed = true;
            Ok((
                format!("Se actualizó el consumo de {}.", consumption.name),
                json!({ "status": "updated", "log": consumption_output(&consumption)? }),
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

fn validate_food_date(date: &str) -> Result<(), AppError> {
    let canonical = matches!(
        date.as_bytes(),
        [
            b'0'..=b'9',
            b'0'..=b'9',
            b'0'..=b'9',
            b'0'..=b'9',
            b'-',
            b'0'..=b'9',
            b'0'..=b'9',
            b'-',
            b'0'..=b'9',
            b'0'..=b'9'
        ]
    );
    if !canonical
        || date.starts_with("0000")
        || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err()
    {
        return Err(AppError::BadRequest(
            "date must be a valid YYYY-MM-DD date in years 0001–9999".into(),
        ));
    }
    Ok(())
}

fn validate_time(field: &str, time: &str) -> Result<(), AppError> {
    if !matches!(
        time.as_bytes(),
        [b'0'..=b'1', b'0'..=b'9', b':', b'0'..=b'5', b'0'..=b'9']
            | [b'2', b'0'..=b'3', b':', b'0'..=b'5', b'0'..=b'9']
    ) {
        return Err(AppError::BadRequest(format!(
            "{field} must use 24-hour HH:MM"
        )));
    }
    Ok(())
}

fn validate_quantity(quantity: f64) -> Result<(), AppError> {
    if !quantity.is_finite() || quantity <= 0.0 {
        return Err(AppError::BadRequest(
            "quantity must be finite and positive".into(),
        ));
    }
    Ok(())
}

async fn resolve_optional_datetime(
    db: &Database,
    date: Option<String>,
    time: Option<String>,
) -> Result<Option<i64>, AppError> {
    match (date, time) {
        (None, None) => Ok(None),
        (Some(date), Some(time)) => {
            validate_food_date(&date)?;
            validate_time("time", &time)?;
            Ok(Some(db.sync.local_datetime_to_epoch(&date, &time).await?))
        }
        _ => Err(AppError::BadRequest(
            "date and time must be provided together".into(),
        )),
    }
}

fn parse_args<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, AppError> {
    serde_json::from_value(args)
        .map_err(|error| AppError::BadRequest(format!("Invalid tool arguments: {error}")))
}

fn consumption_output(consumption: &Consumption) -> Result<Value, AppError> {
    let nutrition = consumption.scaled_nutrition();
    check_nutrition_finite(&nutrition)?;
    Ok(render_consumption(consumption, &nutrition))
}

fn render_consumption(consumption: &Consumption, nutrition: &NutritionValues) -> Value {
    let mut item = serde_json::Map::new();
    item.insert("id".into(), json!(consumption.id));
    item.insert("foodId".into(), json!(consumption.template_id));
    item.insert("name".into(), json!(consumption.name));
    if let Some(brand) = consumption
        .snapshot
        .brand
        .as_deref()
        .map(str::trim)
        .filter(|brand| !brand.is_empty())
    {
        item.insert("brand".into(), json!(brand));
    }
    let quantity = public_number(consumption.canonical_quantity);
    let quantity = if quantity == 0.0 {
        consumption.canonical_quantity
    } else {
        quantity
    };
    item.insert("canonicalQuantity".into(), json!(quantity));
    item.insert(
        "canonicalUnit".into(),
        json!(consumption.snapshot.canonical_unit),
    );
    item.insert("entry".into(), json!(consumption.entry));
    item.insert("consumedAt".into(), json!(consumption.consumed_at));
    item.insert("updatedAt".into(), json!(consumption.updated_at));
    item.insert("nutrition".into(), json!(nutrition_output(nutrition)));
    Value::Object(item)
}

const PUBLIC_NUTRITION_DECIMAL_PLACES: i32 = 6;

fn public_number(value: f64) -> f64 {
    let factor = 10_f64.powi(PUBLIC_NUTRITION_DECIMAL_PLACES);
    let scaled = value * factor;
    if !scaled.is_finite() {
        return value;
    }
    let rounded = scaled.round() / factor;
    if rounded == 0.0 { 0.0 } else { rounded }
}

/// Stabilize numeric MCP output without reducing persisted or calculation precision.
fn nutrition_output(value: &NutritionValues) -> NutritionValues {
    NutritionValues {
        calories: public_number(value.calories),
        protein: public_number(value.protein),
        carbs: public_number(value.carbs),
        fat: public_number(value.fat),
        fiber: value.fiber.map(public_number),
        sodium_mg: value.sodium_mg.map(public_number),
        cholesterol_mg: value.cholesterol_mg.map(public_number),
        extended_nutrition: value
            .extended_nutrition
            .iter()
            .map(|(name, amount)| (name.clone(), public_number(*amount)))
            .collect(),
    }
}

const NUTRITION_RENDER_ERROR: &str = "Nutrition result cannot be represented";

fn check_nutrition_finite(value: &NutritionValues) -> Result<(), AppError> {
    let amounts = [
        Some(value.calories),
        Some(value.protein),
        Some(value.carbs),
        Some(value.fat),
        value.fiber,
        value.sodium_mg,
        value.cholesterol_mg,
    ];
    if amounts
        .into_iter()
        .flatten()
        .chain(value.extended_nutrition.values().copied())
        .all(f64::is_finite)
    {
        Ok(())
    } else {
        Err(AppError::Internal(NUTRITION_RENDER_ERROR.into()))
    }
}

fn daily_nutrition_output(
    consumptions: &[Consumption],
) -> Result<(Vec<Value>, NutritionValues), AppError> {
    let mut total = zero_nutrition();
    let mut items = Vec::with_capacity(consumptions.len());
    for consumption in consumptions {
        let nutrition = consumption.scaled_nutrition();
        check_nutrition_finite(&nutrition)?;
        items.push(render_consumption(consumption, &nutrition));
        add_nutrition(&mut total, &nutrition);
    }
    check_nutrition_finite(&total)?;
    Ok((items, nutrition_output(&total)))
}

fn zero_nutrition() -> NutritionValues {
    NutritionValues {
        calories: 0.0,
        protein: 0.0,
        carbs: 0.0,
        fat: 0.0,
        fiber: Some(0.0),
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
    total.fiber = add_complete_optional(total.fiber, value.fiber);
    total.sodium_mg = add_optional(total.sodium_mg, value.sodium_mg);
    total.cholesterol_mg = add_optional(total.cholesterol_mg, value.cholesterol_mg);
}

fn add_complete_optional(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left + right),
        _ => None,
    }
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

/// Single text block for clients that forward only one text block to their
/// model (observed with Spark: it kept only the last block). The compact JSON
/// payload follows the summary on its own final line; serde escapes newlines
/// inside strings, so the payload never contains a raw newline.
pub(crate) fn readable_tool_text(summary: &str, structured: &Value) -> String {
    format!("{summary}\n\n{structured}")
}

/// The JSON payload embedded in a text block produced by `readable_tool_text`,
/// or the whole text when it has no newline (a bare JSON block).
pub(crate) fn embedded_json(text: &str) -> &str {
    text.rsplit_once('\n').map_or(text, |(_, json)| json)
}

fn tool_success(
    id: impl Serialize,
    summary: &str,
    structured: Value,
    observation: Option<&observation::Observation>,
) -> axum::response::Response {
    let result = json!({
        "content": [{ "type": "text", "text": readable_tool_text(summary, &structured) }],
        "structuredContent": structured,
        "isError": false
    });
    let response = json_rpc_result(id, &result);
    if let Some(observation) = observation {
        observation.result(&response, &result, "none");
    }
    response
}

fn tool_failure(
    id: impl Serialize,
    error: AppError,
    observation: Option<&observation::Observation>,
) -> axum::response::Response {
    let (code, message) = match error {
        AppError::BadRequest(message) => ("invalid_arguments", message),
        AppError::NotFound(message) => ("not_found", message),
        AppError::Conflict(message) => ("conflict", message),
        AppError::Db(error) => {
            // Consume the diagnostic without formatting or retaining its content.
            drop(error);
            ("database_error", "Database operation failed".into())
        }
        AppError::Internal(error) if error == NUTRITION_RENDER_ERROR => ("internal_error", error),
        AppError::Internal(error) => {
            drop(error);
            ("internal_error", "Internal operation failed".into())
        }
    };
    tool_error(id, code, &message, observation)
}

fn tool_error(
    id: impl Serialize,
    code: &'static str,
    message: &str,
    observation: Option<&observation::Observation>,
) -> Response {
    let result = json!({
        "content": [{ "type": "text", "text": message }],
        "structuredContent": { "error": { "code": code, "message": message } },
        "isError": true
    });
    let response = json_rpc_result(id, &result);
    if let Some(observation) = observation {
        observation.result(&response, &result, code);
    }
    response
}

fn json_rpc_result(id: impl Serialize, result: &Value) -> Response {
    #[derive(Serialize)]
    struct Reply<'a, I> {
        jsonrpc: &'static str,
        id: I,
        result: &'a Value,
    }

    Json(Reply {
        jsonrpc: "2.0",
        id,
        result,
    })
    .into_response()
}

fn json_rpc_error(id: Option<&RawValue>, code: i32, message: &str) -> Response {
    #[derive(Serialize)]
    struct ErrorReply<'a> {
        jsonrpc: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<&'a RawValue>,
        error: Value,
    }

    Json(ErrorReply {
        jsonrpc: "2.0",
        id,
        error: json!({ "code": code, "message": message }),
    })
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
            "description": "Busca exclusivamente alimentos disponibles en el catálogo oficial o personal por nombre, marca o categoría. Úsala para elegir un foodId antes de registrar. NUNCA consulta consumos, el diario, el historial ni fechas; para saber qué comió el usuario usa get_daily_log. Si hay varias coincidencias, presenta los candidatos y pide al usuario elegir uno.",
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
                "properties": { "date": nullable_schema(food_date_schema()) },
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
            "description": "Crea un alimento personal con nutrición por 100 g o 100 ml según canonicalUnit. Las porciones nombradas son conversiones opcionales con IDs únicos dentro del alimento. Úsala solo después de confirmar con el usuario cualquier dato ambiguo.",
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
            "description": "Registra un consumo de un foodId elegido inequívocamente. Sin portionId, quantity se expresa en la unidad canónica del alimento (g o ml). Con portionId, quantity cuenta unidades de esa conversión. Si 2 unidades equivalen a 60 g, quantity de 1 registra 30 g. Omite date y time para registrar la fecha y hora actuales de Santiago; ambos deben enviarse juntos cuando son explícitos.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "operationId": uuid_schema(),
                    "foodId": uuid_schema(),
                    "quantity": described_schema(positive_number_schema(), LOG_QUANTITY_DESCRIPTION),
                    "portionId": nullable_schema(json!({
                        "type": "string", "minLength": 1, "maxLength": MAX_PORTION_ID_CHARS,
                        "pattern": PORTION_ID_NONBLANK_PATTERN,
                        "description": "ID opaco y sensible a mayúsculas de details.portions[].id del alimento seleccionado."
                    })),
                    "date": nullable_schema(food_date_schema()),
                    "time": nullable_schema(time_schema())
                },
                "required": ["operationId", "foodId", "quantity"],
                "allOf": food_datetime_pair_conditions(),
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
            "description": "Corrige la cantidad o fecha y hora de un consumo identificado por logId. La cantidad usa la unidad de la entrada histórica y su conversión guardada. Envía quantity, el par date y time, o ambos cambios. No cambia su alimento ni su snapshot nutricional.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "logId": uuid_schema(),
                    "quantity": nullable_schema(described_schema(positive_number_schema(), UPDATE_QUANTITY_DESCRIPTION)),
                    "date": nullable_schema(food_date_schema()),
                    "time": nullable_schema(time_schema())
                },
                "required": ["logId"],
                "allOf": food_datetime_pair_conditions(),
                "anyOf": [present_value("quantity"), present_value("date")],
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
                    "startDate": weight_date_schema(),
                    "endDate": weight_date_schema(),
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
                    "date": weight_date_schema(),
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
                "properties": { "date": weight_date_schema() },
                "additionalProperties": false
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["deleted", "alreadyDeleted"] },
                    "date": weight_date_schema(),
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

const LOG_QUANTITY_DESCRIPTION: &str = "Sin portionId, cantidad en la unidad canónica (g o ml). Con portionId, número de unidades de esa conversión. Si 2 unidades equivalen a 60 g, quantity de 1 registra 30 g.";
const UPDATE_QUANTITY_DESCRIPTION: &str =
    "Cantidad en la unidad de la entrada histórica, usando su conversión guardada.";
const PER_100_DESCRIPTION: &str = "Valor por 100 g o 100 ml, según canonicalUnit.";
// Same Unicode White_Space set as str::trim.
const PORTION_ID_NONBLANK_PATTERN: &str =
    r"[^\x09-\x0d\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]";

fn food_date_schema() -> Value {
    json!({
        "type": "string",
        "format": "date",
        "minLength": 10,
        "maxLength": 10,
        "pattern": r"^(?:[1-9][0-9]{3}|0[1-9][0-9]{2}|00[1-9][0-9]|000[1-9])-[0-9]{2}-[0-9]{2}$",
        "description": "Fecha de calendario YYYY-MM-DD en el rango inclusivo de años 0001–9999."
    })
}

fn weight_date_schema() -> Value {
    json!({
        "anyOf": [
            { "type": "string", "format": "date" },
            { "type": "string", "pattern": r"^(?:-[0-9]{4,6}|\+[0-9]{5,6})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$" }
        ]
    })
}

fn time_schema() -> Value {
    json!({
        "type": "string", "minLength": 5, "maxLength": 5,
        "pattern": r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
        "description": "Hora local de Santiago en formato de 24 horas HH:MM."
    })
}

fn nullable_schema(schema: Value) -> Value {
    json!({ "anyOf": [schema, { "type": "null" }] })
}

fn described_schema(mut schema: Value, description: &str) -> Value {
    schema["description"] = json!(description);
    schema
}

fn present_value(field: &str) -> Value {
    json!({
        "required": [field],
        "properties": { (field): { "not": { "type": "null" } } }
    })
}

fn food_datetime_pair_conditions() -> Value {
    json!([
        { "if": present_value("date"), "then": present_value("time") },
        { "if": present_value("time"), "then": present_value("date") }
    ])
}

fn weight_measurement_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "date": weight_date_schema(),
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

fn portion_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": { "type": "string", "minLength": 1, "maxLength": 80 },
            "name": { "type": "string", "minLength": 1, "maxLength": 120 },
            "portionQuantity": positive_number_schema(),
            "canonicalQuantity": positive_number_schema()
        },
        "required": ["id", "name", "portionQuantity", "canonicalQuantity"],
        "additionalProperties": false
    })
}

fn portion_snapshot_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "portionId": { "type": "string", "minLength": 1, "maxLength": 80 },
            "name": { "type": "string", "minLength": 1, "maxLength": 120 },
            "portionQuantity": positive_number_schema(),
            "canonicalQuantity": positive_number_schema()
        },
        "required": ["name", "portionQuantity", "canonicalQuantity"],
        "additionalProperties": false
    })
}

fn entry_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "enteredQuantity": positive_number_schema(),
            "portionSnapshot": { "anyOf": [portion_snapshot_schema(), { "type": "null" }] }
        },
        "required": ["enteredQuantity"],
        "additionalProperties": false
    })
}

fn create_food_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "operationId": uuid_schema(),
            "name": { "type": "string", "minLength": 1, "maxLength": 160 },
            "canonicalUnit": canonical_unit_schema(),
            "calories": described_schema(non_negative_number_schema(), PER_100_DESCRIPTION),
            "protein": described_schema(non_negative_number_schema(), PER_100_DESCRIPTION),
            "carbs": described_schema(non_negative_number_schema(), PER_100_DESCRIPTION),
            "fat": described_schema(non_negative_number_schema(), PER_100_DESCRIPTION),
            "fiber": nullable_schema(described_schema(non_negative_number_schema(), PER_100_DESCRIPTION)),
            "sodiumMg": nullable_schema(described_schema(non_negative_number_schema(), PER_100_DESCRIPTION)),
            "cholesterolMg": nullable_schema(described_schema(non_negative_number_schema(), PER_100_DESCRIPTION)),
            "portions": { "type": "array", "items": portion_schema(), "maxItems": MAX_CREATE_PORTIONS, "description": "Los IDs de las porciones deben ser únicos dentro del alimento." },
            "chileanSeals": { "type": "array", "items": { "type": "string" }, "maxItems": MAX_CREATE_SEALS },
            "brand": { "type": ["string", "null"], "maxLength": MAX_BRAND_CHARS },
            "category": { "type": ["string", "null"], "maxLength": MAX_CREATE_CATEGORY_CHARS },
            "typicalTime": nullable_schema(time_schema())
        },
        "required": ["operationId", "name", "canonicalUnit", "calories", "protein", "carbs", "fat"],
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
            "date": food_date_schema(),
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
                    "canonicalUnit": canonical_unit_schema(),
                    "nutritionPer100": nutrition_schema(),
                    "portions": { "type": "array", "items": portion_schema() },
                    "chileanSeals": { "type": "array", "items": { "type": "string" } },
                    "brand": { "type": "string", "maxLength": MAX_BRAND_CHARS },
                    "category": { "type": "string" },
                    "typicalTime": { "type": "string" }
                },
                "required": ["schemaVersion", "canonicalUnit", "nutritionPer100", "portions", "chileanSeals"],
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
            "brand": { "type": "string", "maxLength": MAX_BRAND_CHARS },
            "canonicalQuantity": positive_number_schema(),
            "canonicalUnit": canonical_unit_schema(),
            "entry": entry_schema(),
            "consumedAt": { "type": "integer" },
            "updatedAt": { "type": "integer" },
            "nutrition": nutrition_schema()
        },
        "required": ["id", "foodId", "name", "canonicalQuantity", "canonicalUnit", "entry", "consumedAt", "updatedAt", "nutrition"],
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
    let extended = EXTENDED_NUTRIENT_KEYS
        .iter()
        .map(|&name| (name.to_owned(), non_negative_number_schema()))
        .collect::<serde_json::Map<_, _>>();
    json!({
        "type": "object",
        "properties": {
            "calories": non_negative_number_schema(),
            "protein": non_negative_number_schema(),
            "carbs": non_negative_number_schema(),
            "fat": non_negative_number_schema(),
            "fiber": non_negative_number_schema(),
            "sodiumMg": non_negative_number_schema(),
            "cholesterolMg": non_negative_number_schema(),
            "extendedNutrition": {
                "type": "object",
                "properties": extended,
                "additionalProperties": false
            }
        },
        "required": ["calories", "protein", "carbs", "fat"],
        "additionalProperties": false
    })
}

fn uuid_schema() -> Value {
    json!({ "type": "string", "format": "uuid" })
}

fn canonical_unit_schema() -> Value {
    json!({ "type": "string", "enum": ["g", "ml"] })
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

    use axum::{
        body::{Body, to_bytes},
        http::{Request, header},
    };
    use tower::ServiceExt;

    fn handler_router(db: Arc<Database>, hub: SyncHub, user_id: i32) -> Router {
        mcp_routes(AdmissionController::new(
            db.user.pool.options().get_max_connections(),
        ))
        .layer(Extension(db))
        .layer(Extension(hub))
        .layer(Extension(CurrentUser { id: user_id }))
    }

    fn protocol_fixture() -> (Router, DispatchCount) {
        use crate::connectors::{
            imports::ImportDatasource, sync::SyncDatasource, user::UserDatasource,
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://synthetic@127.0.0.1:1/unused")
            .unwrap();
        let db = Arc::new(Database {
            user: UserDatasource { pool: pool.clone() },
            sync: SyncDatasource::new(pool.clone()),
            imports: ImportDatasource::new(pool),
        });
        // Supply the authenticated identity at the auth/handler boundary.
        let count = DispatchCount::default();
        (
            crate::mcp_transport(
                handler_router(db, SyncHub::default(), 1),
                Default::default(),
            )
            .layer(Extension(count.clone())),
            count,
        )
    }

    fn rpc_request(body: impl Into<Body>) -> Request<Body> {
        Request::post("/mcp")
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.into())
            .unwrap()
    }

    async fn reply_body(response: Response, status: StatusCode) -> Value {
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    async fn assert_bad_message(response: Response, code: i32, id: Option<Value>) {
        let reply = reply_body(response, StatusCode::BAD_REQUEST).await;
        assert_eq!(reply["jsonrpc"], "2.0");
        assert_eq!(reply["error"]["code"], code);
        assert_eq!(reply.get("id"), id.as_ref());
        assert_eq!(
            reply.as_object().unwrap().len(),
            2 + usize::from(id.is_some())
        );
    }

    async fn assert_empty(response: Response, status: StatusCode) {
        assert_eq!(response.status(), status);
        assert!(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .is_empty()
        );
    }

    impl DispatchCount {
        fn calls(&self) -> usize {
            self.0.load(std::sync::atomic::Ordering::Relaxed)
        }
    }

    #[test]
    fn admission_global_limit_reserves_pool_capacity_where_possible() {
        for (pool_max, expected) in [
            (1, 1),
            (2, 1),
            (3, 1),
            (4, 2),
            (15, 13),
            (16, 14),
            (20, 14),
            (50, 14),
        ] {
            assert_eq!(
                AdmissionController::new(pool_max)
                    .global
                    .available_permits(),
                expected
            );
        }
    }

    struct AdmissionFixture {
        admin: Database,
        schema: String,
        db: Arc<Database>,
        app: Router,
        controller: AdmissionController,
        hub: SyncHub,
        dispatch: DispatchCount,
        users: Vec<(i32, String)>,
    }

    impl AdmissionFixture {
        async fn new(user_count: usize) -> Option<Self> {
            use crate::connectors::{
                db::PoolSettings,
                user::{NewUser, isolated_identity_test_database},
            };
            use crate::modules::auth::middleware::authenticate_token;

            let (admin, schema) = isolated_identity_test_database().await?;
            let mut url =
                reqwest::Url::parse(&std::env::var("BALANCE_TEST_DATABASE_URL").unwrap()).unwrap();
            url.query_pairs_mut()
                .append_pair("options[search_path]", &schema);
            let db = Arc::new(
                Database::new(url.as_str(), PoolSettings::parse(None).unwrap())
                    .await
                    .unwrap(),
            );
            let controller = AdmissionController::new(db.user.pool.options().get_max_connections());
            let api = OidcConfig::test_cached_subject_config();
            let mcp = api.mcp_config();
            let exp = chrono::Utc::now().timestamp() + 120;
            let mut users = Vec::new();
            for index in 0..user_count {
                let subject = format!("admission-{index}");
                let user = db
                    .user
                    .provision_identity(
                        api.issuer(),
                        &subject,
                        &NewUser {
                            email: format!("{subject}@example.invalid"),
                            name: None,
                            given_name: None,
                            family_name: None,
                            picture: None,
                        },
                    )
                    .await
                    .unwrap();
                let (authenticated, _) =
                    authenticate_token(&api.clone(), &db, &api.test_access_token(&subject, exp))
                        .await
                        .ok()
                        .unwrap();
                assert_eq!(authenticated.id, user.id);
                users.push((user.id, mcp.test_access_token(&subject, exp)));
            }

            let hub = SyncHub::default();
            let dispatch = DispatchCount::default();
            let app = crate::application_router(
                api,
                Default::default(),
                Router::new(),
                controller.clone(),
            )
            .layer(Extension(db.clone()))
            .layer(Extension(hub.clone()))
            .layer(Extension(dispatch.clone()));
            Some(Self {
                admin,
                schema,
                db,
                app,
                controller,
                hub,
                dispatch,
                users,
            })
        }

        fn request(&self, user: usize, method: &str, params: Value) -> Request<Body> {
            let mut request = rpc_request(
                json!({
                    "jsonrpc": "2.0", "id": "admission-request", "method": method, "params": params
                })
                .to_string(),
            );
            request.headers_mut().insert(
                header::AUTHORIZATION,
                format!("Bearer {}", self.users[user].1).parse().unwrap(),
            );
            request
        }

        fn log(&self, user: usize, args: &Value) -> Request<Body> {
            self.request(
                user,
                "tools/call",
                json!({"name": "log_food", "arguments": args}),
            )
        }

        fn assert_idle(&self) {
            let counts = self.controller.enrolled.lock().unwrap();
            assert_eq!(counts.total, 0);
            assert!(counts.users.is_empty());
            assert_eq!(self.controller.global.available_permits(), 14);
        }

        async fn cleanup(self) {
            self.assert_idle();
            self.db.user.pool.close().await;
            crate::connectors::user::cleanup_identity_test_database(&self.admin, &self.schema)
                .await;
        }
    }

    async fn assert_pending<F: std::future::Future>(mut request: std::pin::Pin<&mut F>) {
        std::future::poll_fn(|cx| {
            assert!(request.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
    }

    async fn assert_busy(response: Response) {
        let message = "Server busy. Retry shortly.";
        assert_eq!(
            reply_body(response, StatusCode::OK).await,
            json!({
                "jsonrpc": "2.0",
                "id": "admission-request",
                "result": {
                    "content": [{"type": "text", "text": message}],
                    "structuredContent": {"error": {"code": "server_busy", "message": message}},
                    "isError": true
                }
            })
        );
    }

    #[tokio::test]
    async fn admission_caps_and_cancellation_use_production_mcp_route() {
        let Some(fixture) = AdmissionFixture::new(7).await else {
            return;
        };
        let global = fixture
            .controller
            .global
            .clone()
            .try_acquire_many_owned(14)
            .unwrap();
        let args = log_args(Uuid::new_v4(), 1.0, "2026-01-12");
        let mut requests = Vec::new();
        let mut events = fixture.hub.subscribe();

        for user in 0..6 {
            let count = if user == 5 { 8 } else { 24 };
            for _ in 0..count {
                let mut request = Box::pin(fixture.app.clone().oneshot(fixture.log(user, &args)));
                assert_pending(request.as_mut()).await;
                requests.push(request);
            }
            if user == 0 {
                // With spare global enrollment, this rejection isolates the per-user cap.
                assert_busy(
                    fixture
                        .app
                        .clone()
                        .oneshot(fixture.log(0, &args))
                        .await
                        .unwrap(),
                )
                .await;
            }
        }
        let semaphore = {
            let counts = fixture.controller.enrolled.lock().unwrap();
            assert_eq!(counts.total, 128);
            assert_eq!(counts.users[&fixture.users[0].0].count, 24);
            counts.users[&fixture.users[0].0].permits.clone()
        };
        assert_eq!(semaphore.available_permits(), 0);
        // A user with no prior requests cannot enroll once the process cap is reached.
        assert_busy(
            fixture
                .app
                .clone()
                .oneshot(fixture.log(6, &args))
                .await
                .unwrap(),
        )
        .await;

        for (method, params) in [
            (
                "initialize",
                json!({"protocolVersion": "2025-11-25", "capabilities": {},
                "clientInfo": {"name": "admission-test", "version": "1"}}),
            ),
            ("ping", json!({})),
            ("tools/list", json!({})),
        ] {
            let response = fixture
                .app
                .clone()
                .oneshot(fixture.request(0, method, params))
                .await
                .unwrap();
            assert!(
                reply_body(response, StatusCode::OK)
                    .await
                    .get("result")
                    .is_some()
            );
        }

        drop(requests.remove(6)); // The seventh request is waiting for its user permit.
        assert_eq!(semaphore.available_permits(), 0);
        assert_eq!(fixture.controller.enrolled.lock().unwrap().total, 127);
        drop(requests.remove(0)); // The first request owns a user permit and waits globally.
        {
            let counts = fixture.controller.enrolled.lock().unwrap();
            assert_eq!(counts.total, 126);
            assert_eq!(counts.users[&fixture.users[0].0].count, 22);
        }
        drop(requests);
        assert_eq!(semaphore.available_permits(), 6);
        drop(global);
        fixture.assert_idle();
        assert_eq!(fixture.dispatch.calls(), 0);
        let persisted: i64 = sqlx::query_scalar("SELECT count(*) FROM meal_logs WHERE id = $1")
            .bind(operation_id(&args))
            .fetch_one(&fixture.db.user.pool)
            .await
            .unwrap();
        assert_eq!(persisted, 0);
        assert_no_invalidation(&mut events);
        fixture.cleanup().await;
    }

    #[tokio::test]
    async fn admission_deadline_spans_both_permit_waits() {
        let Some(fixture) = AdmissionFixture::new(1).await else {
            return;
        };
        let (enrollment, user) = fixture.controller.enroll(fixture.users[0].0).unwrap();
        let user_hold = user.clone().try_acquire_many_owned(6).unwrap();
        let global_hold = fixture
            .controller
            .global
            .clone()
            .try_acquire_many_owned(14)
            .unwrap();
        let args = log_args(Uuid::new_v4(), 1.0, "2026-01-12");
        let mut events = fixture.hub.subscribe();
        let started = Instant::now();
        let mut request = Box::pin(fixture.app.clone().oneshot(fixture.log(0, &args)));
        assert_pending(request.as_mut()).await;
        tokio::time::sleep(Duration::from_secs(3)).await;
        drop(user_hold);
        assert_pending(request.as_mut()).await;
        assert_eq!(user.available_permits(), 5);
        let response = timeout_at(started + Duration::from_secs(12), request)
            .await
            .unwrap()
            .unwrap();
        assert!(started.elapsed() >= Duration::from_secs(10));
        assert_busy(response).await;
        assert_eq!(user.available_permits(), 6);
        assert_eq!(fixture.controller.enrolled.lock().unwrap().total, 1);
        assert_eq!(fixture.dispatch.calls(), 0);
        assert_no_invalidation(&mut events);
        let persisted: i64 = sqlx::query_scalar("SELECT count(*) FROM meal_logs WHERE id = $1")
            .bind(operation_id(&args))
            .fetch_one(&fixture.db.user.pool)
            .await
            .unwrap();
        assert_eq!(persisted, 0);
        drop(global_hold);
        drop(enrollment);
        fixture.cleanup().await;
    }

    #[tokio::test]
    async fn authenticated_parallel_food_logs_leave_capacity_for_readiness() {
        let Some(fixture) = AdmissionFixture::new(3).await else {
            return;
        };
        let mut food_ids = Vec::new();
        for &(user_id, _) in &fixture.users {
            let id = Uuid::new_v4();
            fixture
                .db
                .sync
                .create_personal_food(user_id, id, "Burst test food", &iron_food_details())
                .await
                .unwrap();
            food_ids.push(id);
        }
        let mut hold = fixture.db.user.pool.begin().await.unwrap();
        sqlx::query("LOCK TABLE meal_logs IN SHARE MODE")
            .execute(&mut *hold)
            .await
            .unwrap();
        let mut events = fixture.hub.subscribe();
        let mut operations = Vec::new();
        let mut requests = Vec::new();
        for (user, food_id) in food_ids.into_iter().enumerate() {
            for _ in 0..if user == 0 { 18 } else { 6 } {
                let args = log_args(food_id, 1.0, "2026-01-12");
                let mut request = Box::pin(fixture.app.clone().oneshot(fixture.log(user, &args)));
                assert_pending(request.as_mut()).await;
                operations.push((user, args));
                requests.push(request);
            }
            assert_eq!(fixture.dispatch.calls(), [6, 12, 14][user]);
        }
        assert_eq!(fixture.controller.global.available_permits(), 0);
        assert_eq!(fixture.controller.enrolled.lock().unwrap().total, 30);
        // Keep polling all tool requests while waiting for all 14 executions to reach the DB lock.
        tokio::time::timeout(Duration::from_secs(7), async {
            loop {
                for request in &mut requests {
                    assert_pending(request.as_mut()).await;
                }
                let blocked: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM pg_locks WHERE relation = 'meal_logs'::regclass AND NOT granted"
                ).fetch_one(&fixture.db.user.pool).await.unwrap();
                if blocked == 14 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        let health = fixture
            .app
            .clone()
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::NO_CONTENT);
        hold.commit().await.unwrap();

        for response in futures_util::future::join_all(requests).await {
            let reply = reply_body(response.unwrap(), StatusCode::OK).await;
            assert_eq!(reply["result"]["isError"], false, "{reply}");
            assert_eq!(reply["result"]["structuredContent"]["status"], "logged");
        }
        fixture.assert_idle();
        assert_eq!(fixture.dispatch.calls(), 30);
        let mut invalidations = HashMap::new();
        while let Ok(event) = events.try_recv() {
            assert_eq!(event.collection, "mealLogs");
            *invalidations.entry(event.user_id).or_insert(0) += 1;
        }
        assert_eq!(
            invalidations,
            HashMap::from([
                (fixture.users[0].0, 18),
                (fixture.users[1].0, 6),
                (fixture.users[2].0, 6),
            ])
        );

        let (user, args) = &operations[0];
        let response = fixture
            .app
            .clone()
            .oneshot(fixture.log(*user, args))
            .await
            .unwrap();
        let reply = reply_body(response, StatusCode::OK).await;
        assert_eq!(
            reply["result"]["structuredContent"]["status"],
            "alreadyLogged"
        );
        let replay_event = events.try_recv().unwrap();
        assert_eq!(replay_event.user_id, fixture.users[*user].0);
        assert_eq!(replay_event.collection, "mealLogs");
        assert_no_invalidation(&mut events);
        let persisted: Vec<(Uuid, i32)> = sqlx::query_as("SELECT id, user_id FROM meal_logs")
            .fetch_all(&fixture.db.user.pool)
            .await
            .unwrap();
        assert_eq!(persisted.len(), operations.len());
        let expected: HashMap<_, _> = operations
            .iter()
            .map(|(user, args)| (operation_id(args), fixture.users[*user].0))
            .collect();
        assert_eq!(persisted.into_iter().collect::<HashMap<_, _>>(), expected);
        fixture.cleanup().await;
    }

    #[tokio::test]
    async fn mcp_rejects_unsolicited_responses() {
        let (app, count) = protocol_fixture();
        assert_unsolicited_responses(&app, |body| rpc_request(body.to_owned())).await;
        assert_eq!(count.calls(), 0);
    }

    async fn assert_unsolicited_responses(app: &Router, request: impl Fn(&str) -> Request<Body>) {
        for body in [
            r#"{"jsonrpc":"2.0","id":"reply","result":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid params"}}"#,
            r#"{"jsonrpc":"2.0","error":{"code":-32602,"message":"Invalid params"}}"#,
        ] {
            assert_empty(
                app.clone().oneshot(request(body)).await.unwrap(),
                StatusCode::BAD_REQUEST,
            )
            .await;
        }
        for body in [
            r#"{"jsonrpc":"2.0","result":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":[]}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":1,"message":"error"}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{},"method":"tools/call"}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{},"params":null}"#,
            r#"{"jsonrpc":"2.0","error":{"code":1.5,"message":"error"}}"#,
            r#"{"jsonrpc":"2.0","error":{"code":1,"message":false}}"#,
        ] {
            assert_bad_message(
                app.clone().oneshot(request(body)).await.unwrap(),
                -32600,
                None,
            )
            .await;
        }
        for id in [json!(null), json!(1.5), json!(false), json!({}), json!([])] {
            let body = json!({"jsonrpc":"2.0","id":id,"error":{"code":1,"message":"error"}});
            assert_bad_message(
                app.clone()
                    .oneshot(request(&body.to_string()))
                    .await
                    .unwrap(),
                -32600,
                None,
            )
            .await;
        }
    }

    #[tokio::test]
    async fn mcp_rejects_duplicate_envelope_members() {
        let (app, count) = protocol_fixture();
        assert_duplicate_envelope_members(&app, |body| rpc_request(body.to_owned())).await;
        assert_eq!(count.calls(), 0);
    }

    async fn assert_duplicate_envelope_members(
        app: &Router,
        request: impl Fn(&str) -> Request<Body>,
    ) {
        for body in [
            r#"{"jsonrpc":"2.0","id":1,"method":"ping","method":"tools/list"}"#,
            r#"{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":1e1000,"id":2,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ping","params":{},"params":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ping","m\u0065thod":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ping","ignored":1,"ignored":2}"#,
        ] {
            assert_bad_message(
                app.clone().oneshot(request(body)).await.unwrap(),
                -32600,
                None,
            )
            .await;
        }
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping","params":{"nested":1,"nested":2}}"#;
        let reply = reply_body(
            app.clone().oneshot(request(body)).await.unwrap(),
            StatusCode::OK,
        )
        .await;
        assert_eq!(reply["result"], json!({}));
        let body = r#"{"jsonrpc":"2.0","id":1,"id":2,"method":"ping",}"#;
        assert_bad_message(
            app.clone().oneshot(request(body)).await.unwrap(),
            -32700,
            None,
        )
        .await;
    }

    #[tokio::test]
    async fn mcp_single_message_ids_and_notifications() {
        let (app, count) = protocol_fixture();
        for id in [
            json!("opaque-001"),
            json!(-9_007_199_254_740_993_i64),
            json!(i64::MIN),
            json!(u64::MAX),
        ] {
            let body = json!({"jsonrpc":"2.0","id":id,"method":"ping"});
            let reply = reply_body(
                app.clone()
                    .oneshot(rpc_request(body.to_string()))
                    .await
                    .unwrap(),
                StatusCode::OK,
            )
            .await;
            assert_eq!(reply, json!({"jsonrpc":"2.0","id":id,"result":{}}));
        }
        let response = app
            .clone()
            .oneshot(rpc_request(r#"{"jsonrpc":"2.0","id":-0,"method":"ping"}"#))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let reply: HashMap<String, &RawValue> = serde_json::from_slice(&body).unwrap();
        assert_eq!(reply["id"].get(), "-0");

        for id in [
            json!(null),
            json!(1.5),
            json!(1.0),
            json!(true),
            json!({}),
            json!([]),
        ] {
            let body = json!({"jsonrpc":"2.0","id":id,"method":"ping"});
            assert_bad_message(
                app.clone()
                    .oneshot(rpc_request(body.to_string()))
                    .await
                    .unwrap(),
                -32600,
                None,
            )
            .await;
        }
        for (body, id) in [
            ("null", None),
            ("{}", None),
            (r#"{"jsonrpc":"2.0","id":1,"method":false}"#, None),
            (
                r#"{"jsonrpc":"1.0","id":1,"method":"ping"}"#,
                Some(json!(1)),
            ),
            (
                r#"{"jsonrpc":"2.0","id":1,"method":"notifications/initialized"}"#,
                Some(json!(1)),
            ),
            (
                r#"{"jsonrpc":"2.0","id":1,"method":"notifications/cancelled"}"#,
                Some(json!(1)),
            ),
        ] {
            assert_bad_message(
                app.clone().oneshot(rpc_request(body)).await.unwrap(),
                -32600,
                id,
            )
            .await;
        }
        for (body, status) in [
            (
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
                StatusCode::ACCEPTED,
            ),
            (
                r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"unknown"}}"#,
                StatusCode::ACCEPTED,
            ),
            (
                r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":true}"#,
                StatusCode::ACCEPTED,
            ),
            (
                r#"{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_food"}}"#,
                StatusCode::BAD_REQUEST,
            ),
            (
                r#"{"jsonrpc":"2.0","method":"ping"}"#,
                StatusCode::BAD_REQUEST,
            ),
        ] {
            assert_empty(
                app.clone().oneshot(rpc_request(body)).await.unwrap(),
                status,
            )
            .await;
        }
        assert_eq!(count.calls(), 0);
    }

    #[tokio::test]
    async fn mcp_negotiates_versions_and_rejects_invalid_method_params() {
        let (app, count) = protocol_fixture();
        let initialize =
            |params: Value| json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":params});
        let params = |proposal: &str| {
            json!({
                "protocolVersion": proposal, "capabilities": {},
                "clientInfo": {"name":"client","version":"1"}
            })
        };
        for (header, proposed, version) in [
            (None, LATEST_VERSION, LATEST_VERSION),
            (None, JUNE_VERSION, JUNE_VERSION),
            (Some(JUNE_VERSION), JUNE_VERSION, JUNE_VERSION),
            (Some(LATEST_VERSION), "2025-03-26", LATEST_VERSION),
        ] {
            let mut request = rpc_request(initialize(params(proposed)).to_string());
            if let Some(header) = header {
                request
                    .headers_mut()
                    .insert(PROTOCOL_VERSION_HEADER, HeaderValue::from_static(header));
            }
            let response = app.clone().oneshot(request).await.unwrap();
            assert!(!response.headers().contains_key("mcp-session-id"));
            let reply = reply_body(response, StatusCode::OK).await;
            assert_eq!(reply["result"]["protocolVersion"], version);
        }
        for bad in [
            json!(null),
            json!({}),
            json!([]),
            params("bad-version"),
            params("2025-1-01"),
            json!({"protocolVersion":LATEST_VERSION,"capabilities":[],"clientInfo":{"name":"c","version":"1"}}),
            json!({"protocolVersion":LATEST_VERSION,"capabilities":{},"clientInfo":{"name":"c"}}),
            json!({"protocolVersion":LATEST_VERSION,"capabilities":{},"clientInfo":{"name":"c","version":1}}),
        ] {
            let response = app
                .clone()
                .oneshot(rpc_request(initialize(bad).to_string()))
                .await
                .unwrap();
            assert_eq!(
                reply_body(response, StatusCode::OK).await["error"]["code"],
                -32602
            );
        }
        for (method, params, code) in [
            ("unknown", json!({}), -32601),
            ("ping", json!([]), -32602),
            ("tools/list", json!(null), -32602),
            ("tools/call", json!([]), -32602),
            ("tools/call", json!({"name":""}), -32602),
            ("tools/call", json!({"name":4}), -32602),
            (
                "tools/call",
                json!({"name":"log_food","arguments":[]}),
                -32602,
            ),
            (
                "tools/call",
                json!({"name":"log_food","arguments":null}),
                -32602,
            ),
            ("tools/call", json!({"name":"unknown"}), -32602),
        ] {
            let body = json!({"jsonrpc":"2.0","id":"rpc","method":method,"params":params});
            let response = app
                .clone()
                .oneshot(rpc_request(body.to_string()))
                .await
                .unwrap();
            let reply = reply_body(response, StatusCode::OK).await;
            assert_eq!(reply["error"]["code"], code);
            assert_eq!(reply["id"], "rpc");
        }
        assert_eq!(count.calls(), 0);
        let body =
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_foods"}}"#;
        let reply = reply_body(
            app.oneshot(rpc_request(body)).await.unwrap(),
            StatusCode::OK,
        )
        .await;
        assert_tool_error(&reply["result"], "invalid_arguments");
        assert_eq!(count.calls(), 1);
    }

    #[tokio::test]
    async fn mcp_routes_requests_with_deeply_nested_params() {
        let (app, count) = protocol_fixture();
        let nested = format!("{}0{}", "[".repeat(160), "]".repeat(160));
        let body = format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"{JUNE_VERSION}","capabilities":{{"experimental":{{"extension":{nested}}}}},"clientInfo":{{"name":"client","version":"1"}}}}}}"#
        );
        let reply = reply_body(
            app.clone().oneshot(rpc_request(body)).await.unwrap(),
            StatusCode::OK,
        )
        .await;
        assert_eq!(reply["result"]["protocolVersion"], JUNE_VERSION);

        for method in ["ping", "tools/list"] {
            let body = format!(
                r#"{{"jsonrpc":"2.0","id":2,"method":"{method}","params":{{"_meta":{nested}}}}}"#
            );
            let reply = reply_body(
                app.clone().oneshot(rpc_request(body)).await.unwrap(),
                StatusCode::OK,
            )
            .await;
            assert!(reply["result"].is_object());
        }

        for invalid_query in [nested.as_str(), "1e1000"] {
            let body = format!(
                r#"{{"jsonrpc":"2.0","id":"tool","method":"tools/call","params":{{"name":"search_foods","arguments":{{"query":{invalid_query}}}}}}}"#
            );
            let reply = reply_body(
                app.clone().oneshot(rpc_request(body)).await.unwrap(),
                StatusCode::OK,
            )
            .await;
            assert_eq!(reply["id"], "tool");
            assert_eq!(
                assert_tool_error(&reply["result"], "invalid_arguments"),
                "Invalid tool arguments"
            );
        }
        assert_eq!(count.calls(), 0);
    }

    #[tokio::test]
    async fn mcp_rejects_batches_and_preserves_json_extractor_limits() {
        let (app, count) = protocol_fixture();
        for body in [
            "[]",
            "[1e1000]",
            r#"[{"jsonrpc":"2.0","id":1,"method":"ping"}]"#,
            r#"[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]"#,
            r#"[true,{"jsonrpc":"2.0","id":1,"method":"tools/list"}]"#,
        ] {
            for header in [None, Some(LATEST_VERSION)] {
                let mut request = rpc_request(body);
                if let Some(header) = header {
                    request
                        .headers_mut()
                        .insert(PROTOCOL_VERSION_HEADER, HeaderValue::from_static(header));
                }
                assert_bad_message(app.clone().oneshot(request).await.unwrap(), -32600, None).await;
            }
        }
        for body in ["{", "[}", "{} {}"] {
            assert_bad_message(
                app.clone().oneshot(rpc_request(body)).await.unwrap(),
                -32700,
                None,
            )
            .await;
        }
        let wrong_type = Request::post("/mcp")
            .header(header::CONTENT_TYPE, "text/plain")
            .body(Body::from("{}"))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(wrong_type).await.unwrap().status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        let oversized = rpc_request(" ".repeat(2 * 1024 * 1024 + 1));
        assert_eq!(
            app.oneshot(oversized).await.unwrap().status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(count.calls(), 0);
    }

    fn validator(schema: &Value, formats: bool) -> jsonschema::Validator {
        jsonschema::draft202012::options()
            .should_validate_formats(formats)
            .build(schema)
            .unwrap()
    }

    fn assert_valid(validator: &jsonschema::Validator, instance: &Value) {
        if let Err(error) = validator.validate(instance) {
            panic!(
                "Contract violation at {}: {error}; instance: {instance}",
                error.instance_path
            );
        }
    }

    fn tool_definition<'a>(definitions: &'a Value, name: &str) -> &'a Value {
        definitions
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == name)
            .unwrap()
    }

    fn create_args(operation_id: Uuid) -> Value {
        json!({
            "operationId": operation_id,
            "name": format!("MCP {operation_id}"),
            "canonicalUnit": "g",
            "calories": 100, "protein": 4, "carbs": 20, "fat": 2
        })
    }

    fn log_args(food_id: Uuid, quantity: f64, date: &str) -> Value {
        json!({
            "operationId": Uuid::new_v4(), "foodId": food_id, "quantity": quantity,
            "date": date, "time": "12:00"
        })
    }

    fn food_date_cases(date: &str) -> [(&'static str, Value); 3] {
        [
            ("get_daily_log", json!({"date": date})),
            ("log_food", log_args(Uuid::new_v4(), 1.0, date)),
            (
                "update_food_log",
                json!({"logId": Uuid::new_v4(), "date": date, "time": "12:00"}),
            ),
        ]
    }

    fn iron_food_details() -> FoodDetails {
        let mut nutrition = zero_nutrition();
        nutrition.calories = 100.0;
        nutrition.fiber = None;
        nutrition.sodium_mg = Some(0.0);
        nutrition.cholesterol_mg = Some(10.0);
        nutrition.extended_nutrition.insert("ironMg".into(), 2.0);
        FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: nutrition,
            portions: vec![PortionDefinition {
                id: "Scoop".into(),
                name: "Scoop".into(),
                portion_quantity: 2.0,
                canonical_quantity: 60.0,
            }],
            chilean_seals: vec![],
            brand: Some("Brand".into()),
            category: None,
            typical_time: None,
        }
    }

    #[test]
    fn mcp_output_schema_2020_12() {
        use crate::connectors::sync::FoodTemplate;
        let tools = tool_definitions();
        for (name, args) in food_date_cases("0000-01-02") {
            let schema = &tool_definition(&tools, name)["inputSchema"];
            assert!(!validator(schema, false).is_valid(&args), "{name}: {args}");
            let check = validator(schema, true);
            assert!(!check.is_valid(&args), "{name}: {args}");
            for (date, valid) in [
                ("0001-01-02", true),
                ("9999-01-02", true),
                ("2024-02-29", true),
                ("2025-02-29", false),
                ("2025-1-02", false),
                ("+10000-01-02", false),
                ("２０２５-01-02", false),
                ("2025-01-02\n", false),
            ] {
                let mut args = args.clone();
                args["date"] = json!(date);
                assert_eq!(check.is_valid(&args), valid, "{name}: {args}");
                assert_eq!(validate_food_date(date).is_ok(), valid, "{name}: {date}");
            }
        }

        let daily_tool = tool_definition(&tools, "get_daily_log");
        let daily_input = validator(&daily_tool["inputSchema"], true);
        for args in [json!({}), json!({"date": null})] {
            assert_valid(&daily_input, &args);
        }
        let daily_output = validator(&daily_tool["outputSchema"], true);
        let daily_date = validator(&daily_tool["outputSchema"]["properties"]["date"], false);
        assert!(!daily_date.is_valid(&json!("0000-01-02")));
        for (date, valid) in [
            ("0000-01-02", false),
            ("0001-01-02", true),
            ("9999-01-02", true),
            ("2025-02-29", false),
        ] {
            let output = json!({"date": date, "timezone": TIMEZONE, "items": [], "totals": zero_nutrition()});
            assert_eq!(daily_output.is_valid(&output), valid, "{output}");
        }

        let log_tool = tool_definition(&tools, "log_food");
        let update_tool = tool_definition(&tools, "update_food_log");
        let log_input = validator(&log_tool["inputSchema"], true);
        let update_input = validator(&update_tool["inputSchema"], true);
        let id = Uuid::new_v4();
        for (date, time, valid_pair) in [
            (None, None, true),
            (Some(Value::Null), Some(Value::Null), true),
            (Some(Value::Null), None, true),
            (Some(json!("2025-09-07")), Some(json!("00:30")), true),
            (Some(json!("2025-09-07")), Some(json!("0:30")), false),
            (Some(json!("2025-09-07")), Some(json!("24:00")), false),
            (Some(json!("2025-09-07")), Some(json!("12:60")), false),
            (Some(json!("2025-09-07")), Some(json!("０９:30")), false),
            (Some(json!("2025-09-07")), None, false),
            (Some(json!("2025-09-07")), Some(Value::Null), false),
            (None, Some(json!("00:30")), false),
            (Some(Value::Null), Some(json!("00:30")), false),
        ] {
            let mut log = json!({"operationId": id, "foodId": id, "quantity": 1.0});
            let mut update = json!({"logId": id});
            let has_date = date.as_ref().is_some_and(|date| !date.is_null());
            for (field, value) in [("date", date), ("time", time)] {
                if let Some(value) = value {
                    log[field] = value.clone();
                    update[field] = value;
                }
            }
            assert_eq!(log_input.is_valid(&log), valid_pair, "{log}");
            for quantity in [None, Some(Value::Null), Some(json!(1.0)), Some(json!(0))] {
                let mut update = update.clone();
                let has_quantity = quantity.as_ref().is_some_and(|q| q == &json!(1.0));
                let invalid_quantity = quantity.as_ref().is_some_and(|q| q == &json!(0));
                if let Some(quantity) = quantity {
                    update["quantity"] = quantity;
                }
                assert_eq!(
                    update_input.is_valid(&update),
                    valid_pair && !invalid_quantity && (has_quantity || has_date),
                    "{update}"
                );
            }
        }
        for (portion, valid) in [
            (json!(null), true),
            (json!(""), false),
            (json!(" \t\u{85}\u{3000}"), false),
            (json!("é".repeat(80)), true),
            (json!("é".repeat(81)), false),
        ] {
            let mut log = log_args(id, 1.0, "2025-01-02");
            log["portionId"] = portion;
            assert_eq!(log_input.is_valid(&log), valid, "{log}");
        }
        let mut invalid_id = log_args(id, 1.0, "2025-01-02");
        invalid_id["foodId"] = json!("not-a-uuid");
        assert!(validator(&log_tool["inputSchema"], false).is_valid(&invalid_id));
        assert!(!log_input.is_valid(&invalid_id));

        let create_tool = tool_definition(&tools, "create_food");
        let create_input = validator(&create_tool["inputSchema"], true);
        let mut create = create_args(id);
        assert_valid(&create_input, &create);
        create["brand"] = json!("Brand");
        assert_valid(&create_input, &create);
        for field in [
            "brand",
            "category",
            "fiber",
            "sodiumMg",
            "cholesterolMg",
            "typicalTime",
        ] {
            create[field] = Value::Null;
        }
        assert_valid(&create_input, &create);
        let parsed = parse_args::<CreateFoodArgs>(create).unwrap();
        assert!(
            parsed.brand.is_none() && parsed.category.is_none() && parsed.typical_time.is_none()
        );
        assert!(
            parsed.fiber.is_none() && parsed.sodium_mg.is_none() && parsed.cholesterol_mg.is_none()
        );

        let search_tool = tool_definition(&tools, "search_foods");
        let search_output = validator(&search_tool["outputSchema"], true);
        let create_output = validator(&create_tool["outputSchema"], true);
        let log_output = validator(&log_tool["outputSchema"], true);
        let update_output = validator(&update_tool["outputSchema"], true);
        let details = iron_food_details();
        let food = FoodTemplate {
            id,
            name: "Iron food".into(),
            is_official: false,
            details: details.clone(),
            updated_at: 1,
        };
        let (quantity, entry) = details.entry_for(1.0, Some("Scoop")).unwrap();
        let mut consumption = Consumption {
            id: Uuid::new_v4(),
            template_id: None,
            name: food.name.clone(),
            snapshot: details.snapshot(),
            canonical_quantity: quantity,
            entry,
            consumed_at: 1,
            updated_at: 1,
        };
        let log = consumption_output(&consumption).unwrap();
        assert_eq!(log["canonicalQuantity"], 30.0);
        assert_eq!(log["nutrition"]["extendedNutrition"]["ironMg"], 0.6);
        assert_eq!(log["nutrition"]["sodiumMg"], 0.0);
        assert!(log["nutrition"].get("fiber").is_none());
        assert_valid(&search_output, &json!({"foods": [food]}));
        assert_valid(&search_output, &json!({"foods": []}));
        assert_valid(
            &create_output,
            &json!({"status": "alreadyCreated", "food": food}),
        );
        assert_valid(&log_output, &json!({"status": "logged", "log": log}));
        assert_valid(&update_output, &json!({"status": "updated", "log": log}));
        let (items, totals) = daily_nutrition_output(std::slice::from_ref(&consumption)).unwrap();
        let day =
            json!({"date": "2025-01-02", "timezone": TIMEZONE, "items": items, "totals": totals});
        assert_valid(&daily_output, &day);
        assert!(day["totals"].get("fiber").is_none());
        assert!(day["totals"].get("extendedNutrition").is_none());
        assert_eq!(day["totals"]["sodiumMg"], 0.0);
        assert_eq!(day["totals"]["cholesterolMg"], 3.0);

        for extended in [
            json!({"extra": 0}),
            json!({"ironMg": -1}),
            json!({"ironMg": null}),
            json!({"ironMg": "3"}),
        ] {
            let mut output = json!({"status": "logged", "log": log});
            output["log"]["nutrition"]["extendedNutrition"] = extended;
            assert!(!log_output.is_valid(&output), "{output}");
        }
        let mut output = json!({"status": "logged", "log": log});
        output["log"]["nutrition"]["sodiumMg"] = Value::Null;
        assert!(!log_output.is_valid(&output));
        output["log"]["nutrition"]
            .as_object_mut()
            .unwrap()
            .remove("sodiumMg");
        output["log"]["unexpected"] = json!(0);
        assert!(!log_output.is_valid(&output));

        for name in ["get_weight_history", "set_weight", "delete_weight_log"] {
            let tool = tool_definition(&tools, name);
            let input = validator(&tool["inputSchema"], true);
            let output = validator(&tool["outputSchema"], true);
            for (date, valid) in [
                ("2025-01-02", true),
                ("-0001-01-02", true),
                ("+10000-01-02", true),
                ("-001-01-02", false),
                ("+0001-01-02", false),
                ("-1234567-01-02", false),
                ("-0001-00-02", false),
                ("+10000-13-02", false),
                ("-0001-01-32", false),
                ("-0001-01-02\n", false),
                ("-0001-1-02", false),
                ("2025-02-29", false),
            ] {
                if valid {
                    assert_eq!(parse_weight_date(date).unwrap().to_string(), date);
                }
                let measurement = json!({"date": date, "weightKg": 70.1, "updatedAt": 1});
                let (args, result) = match name {
                    "get_weight_history" => (
                        json!({"startDate": date, "endDate": date}),
                        json!({"timezone": TIMEZONE, "entries": [measurement], "latest": measurement, "changeKg": null}),
                    ),
                    "set_weight" => (
                        json!({"date": date, "weightKg": 70.1}),
                        json!({"status": "created", "measurement": measurement}),
                    ),
                    _ => (
                        json!({"date": date}),
                        json!({"status": "deleted", "date": date, "updatedAt": 1}),
                    ),
                };
                assert_eq!(input.is_valid(&args), valid, "{name}: {args}");
                assert_eq!(output.is_valid(&result), valid, "{name}: {result}");
            }
        }

        consumption.canonical_quantity = 200.0;
        consumption
            .snapshot
            .nutrition_per100
            .extended_nutrition
            .insert("ironMg".into(), 1e308);
        assert!(consumption_output(&consumption).is_err());
        assert!(daily_nutrition_output(std::slice::from_ref(&consumption)).is_err());
        consumption
            .snapshot
            .nutrition_per100
            .extended_nutrition
            .clear();
        consumption.canonical_quantity = 100.0;
        for nutrient in ["calories", "fiber", "sodiumMg", "cholesterolMg"] {
            let mut nutrition = json!(zero_nutrition());
            nutrition[nutrient] = json!(1e308);
            consumption.snapshot.nutrition_per100 = serde_json::from_value(nutrition).unwrap();
            assert_valid(
                &log_output,
                &json!({"status": "logged", "log": consumption_output(&consumption).unwrap()}),
            );
            assert!(
                daily_nutrition_output(&[consumption.clone(), consumption.clone()]).is_err(),
                "{nutrient}"
            );
        }
        assert_eq!(public_number(f64::MAX), f64::MAX);
    }

    async fn dispatch(
        db: &Arc<Database>,
        hub: &SyncHub,
        user_id: i32,
        name: &str,
        args: Value,
    ) -> Value {
        let request = rpc_request(
            json!({
                "jsonrpc":"2.0","id":1,"method":"tools/call",
                "params":{"name":name,"arguments":args}
            })
            .to_string(),
        );
        let response = handler_router(db.clone(), hub.clone(), user_id)
            .oneshot(request)
            .await
            .unwrap();
        let envelope = reply_body(response, StatusCode::OK).await;
        assert_eq!(envelope["jsonrpc"], "2.0");
        assert_eq!(envelope["id"], 1);
        envelope["result"].clone()
    }

    fn assert_tool_error<'a>(result: &'a Value, code: &str) -> &'a str {
        assert_eq!(result["isError"], true, "{result}");
        let error = &result["structuredContent"];
        assert_eq!(error.as_object().unwrap().len(), 1, "{result}");
        assert_eq!(error["error"]["code"], code, "{result}");
        let message = error["error"]["message"].as_str().unwrap();
        assert_eq!(
            result["content"],
            json!([{"type": "text", "text": message}])
        );
        message
    }

    #[tokio::test]
    async fn mcp_food_year_zero_before_sql() {
        use crate::connectors::{
            imports::ImportDatasource, sync::SyncDatasource, user::UserDatasource,
        };
        use sqlx::postgres::PgPoolOptions;

        // SQLx closes the child pool when an acquisition discovers the
        // closed parent. That records an attempt without opening a socket.
        let url = "postgres://unused@localhost/unused";
        let options = PgPoolOptions::new().max_connections(1);
        let parent = options.clone().connect_lazy(url).unwrap();
        let pool = options.parent(parent.clone()).connect_lazy(url).unwrap();
        parent.close().await;
        assert!(!pool.is_closed());
        let db = Arc::new(Database {
            user: UserDatasource { pool: pool.clone() },
            sync: SyncDatasource::new(pool.clone()),
            imports: ImportDatasource::new(pool.clone()),
        });
        let hub = SyncHub::default();
        for (tool, args) in food_date_cases("0000-01-02") {
            let result = dispatch(&db, &hub, 80, tool, args).await;
            assert!(
                !pool.is_closed(),
                "{tool} tried to acquire a SQL connection"
            );
            assert_eq!(pool.size(), 0);
            assert!(assert_tool_error(&result, "invalid_arguments").contains("0001–9999"));
        }
        // Check the acquisition detector independently of the handler.
        assert!(matches!(pool.acquire().await, Err(sqlx::Error::PoolClosed)));
        assert!(pool.is_closed());
        for date in ["0001-01-02", "9999-01-02"] {
            validate_food_date(date).unwrap();
        }
    }

    struct ContractFixture {
        db: Arc<Database>,
        hub: SyncHub,
        user_id: i32,
        input: std::collections::HashMap<String, jsonschema::Validator>,
        output: std::collections::HashMap<String, jsonschema::Validator>,
    }

    impl ContractFixture {
        async fn call(&self, name: &str, args: Value) -> Value {
            dispatch(&self.db, &self.hub, self.user_id, name, args).await
        }

        async fn success(&self, name: &str, args: Value) -> Value {
            assert_valid(&self.input[name], &args);
            let result = self.call(name, args).await;
            assert_eq!(result["isError"], false, "{name}: {result}");
            let structured = &result["structuredContent"];
            assert_valid(&self.output[name], structured);
            let content = result["content"].as_array().unwrap();
            assert_eq!(content.len(), 1);
            assert_eq!(content[0]["type"], "text");
            let text = content[0]["text"].as_str().unwrap();
            let embedded = embedded_json(text);
            assert!(text.strip_suffix(embedded).unwrap().ends_with("\n\n"));
            assert!(!text.strip_suffix(embedded).unwrap().trim().is_empty());
            assert_eq!(
                serde_json::from_str::<Value>(embedded).unwrap(),
                *structured
            );
            structured.clone()
        }

        async fn seed_food(&self, id: Uuid, name: &str, details: &FoodDetails) {
            let (food, created) = self
                .db
                .sync
                .create_personal_food(self.user_id, id, name, details)
                .await
                .unwrap();
            assert!(created);
            assert_eq!(food.id, id);
        }

        async fn stored_log(&self, id: Uuid) -> (i64, Option<f64>) {
            sqlx::query_as("SELECT count(*), max(canonical_quantity) FROM meal_logs WHERE user_id = $1 AND id = $2")
                .bind(self.user_id)
                .bind(id)
                .fetch_one(&self.db.sync.pool)
                .await
                .unwrap()
        }

        fn assert_meal_invalidation(
            &self,
            events: &mut tokio::sync::broadcast::Receiver<
                crate::modules::sync::hub::SyncInvalidation,
            >,
        ) {
            let event = events.try_recv().unwrap();
            assert_eq!(event.user_id, self.user_id);
            assert_eq!(event.collection, "mealLogs");
            assert_no_invalidation(events);
        }
    }

    fn assert_no_invalidation(
        events: &mut tokio::sync::broadcast::Receiver<crate::modules::sync::hub::SyncInvalidation>,
    ) {
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
    }

    fn operation_id(args: &Value) -> Uuid {
        serde_json::from_value(args["operationId"].clone()).unwrap()
    }

    #[tokio::test]
    async fn mcp_dispatch_contract_postgres() {
        use crate::connectors::user::{
            NewUser, cleanup_identity_test_database, isolated_identity_test_database,
        };

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let oidc = OidcConfig::test_cached_subject_config().mcp_config();
        let subject = "mcp-contract-fixture";
        let user = db
            .user
            .provision_identity(
                oidc.issuer(),
                subject,
                &NewUser {
                    email: "mcp-contract@example.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();

        let tools = tool_definitions();
        let compile = |key: &str| {
            tools
                .as_array()
                .unwrap()
                .iter()
                .map(|tool| {
                    (
                        tool["name"].as_str().unwrap().to_owned(),
                        validator(&tool[key], true),
                    )
                })
                .collect()
        };
        let fixture = ContractFixture {
            db: Arc::new(db),
            hub: SyncHub::default(),
            user_id: user.id,
            input: compile("inputSchema"),
            output: compile("outputSchema"),
        };
        assert_authenticated_rejections_are_inert(&fixture, oidc, subject).await;
        dispatch_weight_contract(&fixture).await;
        dispatch_food_contract(&fixture).await;
        dispatch_nutrition_overflow(&fixture).await;

        cleanup_identity_test_database(&fixture.db, &schema).await;
    }

    async fn assert_authenticated_rejections_are_inert(
        fixture: &ContractFixture,
        oidc: OidcConfig,
        subject: &str,
    ) {
        let mut jwt_header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        jwt_header.typ = Some("at+jwt".into());
        jwt_header.kid = Some("public-test-only".into());
        let token = jsonwebtoken::encode(
            &jwt_header,
            &json!({
                "sub": subject,
                "iss": oidc.issuer(),
                "aud": oidc.resource().unwrap(),
                "exp": chrono::Utc::now().timestamp() + 120,
            }),
            &jsonwebtoken::EncodingKey::from_rsa_pem(include_bytes!(
                "../auth/fixtures/PUBLIC-TEST-ONLY-active-private.pem"
            ))
            .unwrap(),
        )
        .unwrap();
        let authorization = HeaderValue::from_str(&format!("Bearer {token}")).unwrap();
        let request = |body: &str| {
            let mut request = rpc_request(body.to_owned());
            request
                .headers_mut()
                .insert(header::AUTHORIZATION, authorization.clone());
            request
        };

        let count = DispatchCount::default();
        let router = crate::mcp_transport(
            crate::mcp_authenticated(
                oidc,
                AdmissionController::new(fixture.db.user.pool.options().get_max_connections()),
            ),
            Default::default(),
        )
        .layer(Extension(fixture.db.clone()))
        .layer(Extension(fixture.hub.clone()))
        .layer(Extension(count.clone()));
        let mut events = fixture.hub.subscribe();
        assert_unsolicited_responses(&router, &request).await;
        assert_duplicate_envelope_members(&router, &request).await;
        assert_eq!(count.calls(), 0);

        let args = create_args(Uuid::new_v4());
        assert_valid(&fixture.input["create_food"], &args);
        let params = json!({"name":"create_food","arguments":args});
        let duplicate = format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{}},"params":{params}}}"#
        );
        let mutation = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":params});
        let batch = json!([mutation]).to_string();
        for body in [duplicate, batch] {
            let response = router.clone().oneshot(request(&body)).await.unwrap();
            assert_bad_message(response, -32600, None).await;
            assert_eq!(count.calls(), 0);
            assert_no_invalidation(&mut events);
            let stored: i64 =
                sqlx::query_scalar("SELECT count(*) FROM meal_templates WHERE user_id = $1")
                    .bind(fixture.user_id)
                    .fetch_one(&fixture.db.sync.pool)
                    .await
                    .unwrap();
            assert_eq!(stored, 0);
        }
    }

    async fn dispatch_weight_contract(fixture: &ContractFixture) {
        fixture
            .db
            .sync
            .push_user_preference(
                fixture.user_id,
                json!({"weightTrackingEnabled": true}),
                1,
                None,
            )
            .await
            .unwrap();
        let empty = fixture.success("get_weight_history", json!({})).await;
        assert_eq!(empty["entries"], json!([]));
        assert!(empty["latest"].is_null());
        assert!(empty["changeKg"].is_null());

        let date = "-0001-01-02";
        let (_, status) = fixture
            .db
            .sync
            .set_weight(fixture.user_id, parse_weight_date(date).unwrap(), 70_000)
            .await
            .unwrap();
        assert!(matches!(status, WeightUpsertStatus::Created));
        for args in [json!({}), json!({"startDate": date, "endDate": date})] {
            let history = fixture.success("get_weight_history", args).await;
            assert_eq!(history["entries"].as_array().unwrap().len(), 1);
            assert_eq!(history["entries"][0]["date"], date);
            assert_eq!(history["latest"]["date"], date);
        }
        for (date, status, kg) in [
            ("-0002-01-02", "created", 71.2),
            (date, "updated", 72.3),
            (date, "unchanged", 72.3),
            ("2025-01-02", "created", 73.4),
        ] {
            let result = fixture
                .success("set_weight", json!({"date": date, "weightKg": kg}))
                .await;
            assert_eq!(result["status"], status);
            assert_eq!(result["measurement"]["date"], date);
            assert_eq!(result["measurement"]["weightKg"], kg);
        }
        let history = fixture
            .success(
                "get_weight_history",
                json!({"startDate":"2025-01-02", "endDate":"2025-01-02"}),
            )
            .await;
        assert_eq!(history["latest"]["date"], "2025-01-02");
        for status in ["deleted", "alreadyDeleted"] {
            let result = fixture
                .success("delete_weight_log", json!({"date": date}))
                .await;
            assert_eq!(result["status"], status);
            assert_eq!(result["date"], date);
        }
    }

    async fn dispatch_create_limits(fixture: &ContractFixture) -> Uuid {
        let id = Uuid::new_v4();
        let mut max_create = create_args(id);
        max_create["canonicalUnit"] = json!("ml");
        max_create["portions"] = json!((0..MAX_CREATE_PORTIONS).map(|i| {
            json!({"id": format!("cup-{i}"), "name": "Cup", "portionQuantity": 1, "canonicalQuantity": 250})
        }).collect::<Vec<_>>());
        max_create["chileanSeals"] = json!(["Free-form", "", "sello", "other"]);
        max_create["category"] = json!("á".repeat(MAX_CREATE_CATEGORY_CHARS));
        max_create["typicalTime"] = json!("23:59");
        for key in ["brand", "fiber", "sodiumMg", "cholesterolMg"] {
            max_create[key] = Value::Null;
        }
        let created = fixture.success("create_food", max_create.clone()).await;
        assert_eq!(created["status"], "created");
        assert_eq!(
            created["food"]["details"]["portions"]
                .as_array()
                .unwrap()
                .len(),
            MAX_CREATE_PORTIONS
        );
        assert_eq!(
            created["food"]["details"]["chileanSeals"],
            max_create["chileanSeals"]
        );
        assert_eq!(
            created["food"]["details"]["category"],
            max_create["category"]
        );
        assert_eq!(created["food"]["details"]["typicalTime"], "23:59");
        assert_eq!(
            created["food"]["details"]["nutritionPer100"],
            json!({"calories": 100.0, "protein": 4.0, "carbs": 20.0, "fat": 2.0})
        );
        assert!(created["food"]["details"].get("brand").is_none());

        let mut too_many_portions = max_create["portions"].as_array().unwrap().clone();
        too_many_portions.push(
            json!({"id": "extra", "name": "Extra", "portionQuantity": 1, "canonicalQuantity": 1}),
        );
        for (field, value) in [
            ("portions", json!(too_many_portions)),
            ("chileanSeals", json!(["a", "b", "c", "d", "e"])),
            ("category", json!("á".repeat(MAX_CREATE_CATEGORY_CHARS + 1))),
            ("typicalTime", json!("9:00")),
            ("typicalTime", json!("24:00")),
            ("typicalTime", json!("１２:00")),
        ] {
            let id = Uuid::new_v4();
            let mut rejected = create_args(id);
            rejected[field] = value;
            assert!(
                !fixture.input["create_food"].is_valid(&rejected),
                "{rejected}"
            );
            let result = fixture.call("create_food", rejected).await;
            assert!(assert_tool_error(&result, "invalid_arguments").contains(field));
            assert!(
                fixture
                    .db
                    .sync
                    .get_food_template(fixture.user_id, id)
                    .await
                    .unwrap()
                    .is_none()
            );
        }

        let bad_id = Uuid::new_v4();
        let mut duplicate = create_args(bad_id);
        duplicate["portions"] = json!([
            {"id": "duplicate", "name": "First", "portionQuantity": 1, "canonicalQuantity": 1},
            {"id": "duplicate", "name": "Second", "portionQuantity": 1, "canonicalQuantity": 1}
        ]);
        assert_valid(&fixture.input["create_food"], &duplicate);
        let result = fixture.call("create_food", duplicate).await;
        assert!(assert_tool_error(&result, "invalid_arguments").contains("unique"));
        assert!(
            fixture
                .db
                .sync
                .get_food_template(fixture.user_id, bad_id)
                .await
                .unwrap()
                .is_none()
        );
        id
    }

    async fn dispatch_food_contract(fixture: &ContractFixture) {
        const DAY: &str = "2025-01-02";
        let iron_id = Uuid::new_v4();
        let iron_name = format!("Iron {iron_id}");
        let mut iron = iron_food_details();
        fixture.seed_food(iron_id, &iron_name, &iron).await;
        let oversized_id = Uuid::new_v4();
        let oversized_name = format!("Oversized {oversized_id}");
        let mut oversized = iron.clone();
        oversized.portions.clear();
        oversized.chilean_seals = vec!["free form".into(); MAX_CREATE_SEALS + 1];
        fixture
            .seed_food(oversized_id, &oversized_name, &oversized)
            .await;
        let mut replay_create = create_args(iron_id);
        replay_create["name"] = json!(iron_name);
        let replay = fixture.success("create_food", replay_create).await;
        assert_eq!(replay["status"], "alreadyCreated");
        assert_eq!(
            replay["food"]["details"]["nutritionPer100"]["extendedNutrition"]["ironMg"],
            2.0
        );
        for (id, query) in [(iron_id, iron_name), (oversized_id, oversized_name)] {
            let search = fixture
                .success(
                    "search_foods",
                    json!({"query": query, "source": "personal"}),
                )
                .await;
            assert_eq!(search["foods"].as_array().unwrap().len(), 1);
            assert_eq!(search["foods"][0]["id"], json!(id));
            assert_eq!(
                search["foods"][0]["details"]["nutritionPer100"]["extendedNutrition"]["ironMg"],
                2.0
            );
        }
        let search = fixture
            .success(
                "search_foods",
                json!({"query": Uuid::new_v4().to_string(), "source": "personal"}),
            )
            .await;
        assert_eq!(search["foods"], json!([]));

        for date in [DAY, "0001-01-02", "9999-01-02"] {
            let empty = fixture
                .success("get_daily_log", json!({"date": date}))
                .await;
            assert_eq!(empty["date"], date);
            assert_eq!(empty["items"], json!([]));
            assert_eq!(empty["totals"], json!(zero_nutrition()));
        }
        for args in [json!({}), json!({"date": null})] {
            let today = fixture.success("get_daily_log", args).await;
            assert_eq!(today["items"], json!([]));
        }

        let ml_id = dispatch_create_limits(fixture).await;
        for (id, unit) in [(iron_id, "g"), (ml_id, "ml")] {
            let args = log_args(id, 1.0, DAY);
            let result = fixture.success("log_food", args).await;
            assert_eq!(result["status"], "logged");
            assert_eq!(result["log"]["canonicalQuantity"], 1.0);
            assert_eq!(result["log"]["canonicalUnit"], unit);
        }

        let mut scoop = log_args(iron_id, 1.0, DAY);
        scoop["portionId"] = json!("Scoop");
        let scoop_id = operation_id(&scoop);
        for status in ["logged", "alreadyLogged"] {
            let result = fixture.success("log_food", scoop.clone()).await;
            assert_eq!(result["status"], status);
            assert_eq!(result["log"]["canonicalQuantity"], 30.0);
            assert_eq!(
                result["log"]["nutrition"]["extendedNutrition"]["ironMg"],
                0.6
            );
            assert_eq!(
                result["log"]["entry"]["portionSnapshot"]["portionId"],
                "Scoop"
            );
        }
        for (id, message) in [
            (json!("scoop"), "Unknown portionId"),
            (json!("unknown"), "Unknown portionId"),
            (json!(" Scoop "), "Unknown portionId"),
            (json!("\u{3000}"), "cannot be blank"),
            (json!("é".repeat(81)), "80 characters"),
        ] {
            let mut args = log_args(iron_id, 1.0, DAY);
            args["portionId"] = id;
            let op_id = operation_id(&args);
            let error = fixture.call("log_food", args).await;
            assert!(assert_tool_error(&error, "invalid_arguments").contains(message));
            assert_eq!(fixture.stored_log(op_id).await, (0, None));
        }

        iron.portions[0].canonical_quantity = 100.0;
        let changed =
            sqlx::query("UPDATE meal_templates SET details = $1 WHERE user_id = $2 AND id = $3")
                .bind(json!(iron))
                .bind(fixture.user_id)
                .bind(iron_id)
                .execute(&fixture.db.sync.pool)
                .await
                .unwrap();
        assert_eq!(changed.rows_affected(), 1);
        let quantity_update = fixture
            .success(
                "update_food_log",
                json!({"logId": scoop_id, "quantity": 2.0, "date": null, "time": null}),
            )
            .await;
        assert_eq!(quantity_update["status"], "updated");
        assert_eq!(quantity_update["log"]["canonicalQuantity"], 60.0);
        assert_eq!(
            quantity_update["log"]["nutrition"]["extendedNutrition"]["ironMg"],
            1.2
        );
        let date_update = fixture
            .success(
                "update_food_log",
                json!({"logId": scoop_id, "quantity": null, "date": DAY, "time": "11:00"}),
            )
            .await;
        assert_eq!(date_update["log"]["canonicalQuantity"], 60.0);
        assert_ne!(
            date_update["log"]["consumedAt"],
            quantity_update["log"]["consumedAt"]
        );
        let combined = fixture
            .success(
                "update_food_log",
                json!({"logId": scoop_id, "quantity": 2.0, "date": DAY, "time": "12:00"}),
            )
            .await;
        assert_eq!(combined["log"]["canonicalQuantity"], 60.0);
        assert_eq!(
            combined["log"]["consumedAt"],
            quantity_update["log"]["consumedAt"]
        );

        let tiny_args = log_args(iron_id, 0.00000001, DAY);
        let tiny_id = operation_id(&tiny_args);
        let tiny = fixture.success("log_food", tiny_args).await;
        assert_eq!(tiny["log"]["canonicalQuantity"], 0.00000001);
        let changed =
            sqlx::query("UPDATE meal_logs SET template_id = NULL WHERE user_id = $1 AND id = $2")
                .bind(fixture.user_id)
                .bind(tiny_id)
                .execute(&fixture.db.sync.pool)
                .await
                .unwrap();
        assert_eq!(changed.rows_affected(), 1);

        let precise_args = log_args(iron_id, 1.123456789, DAY);
        let precise_id = operation_id(&precise_args);
        let precise = fixture.success("log_food", precise_args).await;
        assert_eq!(precise["log"]["canonicalQuantity"], 1.123457);
        assert_eq!(fixture.stored_log(precise_id).await, (1, Some(1.123456789)));
        let large = fixture
            .success("log_food", log_args(iron_id, 1e308, "2025-01-03"))
            .await;
        assert_eq!(large["log"]["canonicalQuantity"], 1e308);
        assert_eq!(large["log"]["nutrition"]["calories"], 1e308);

        let daily = fixture.success("get_daily_log", json!({"date": DAY})).await;
        let items = daily["items"].as_array().unwrap();
        let tiny = items
            .iter()
            .find(|item| item["id"] == json!(tiny_id))
            .unwrap();
        assert_eq!(tiny["canonicalQuantity"], 0.00000001);
        assert!(tiny["foodId"].is_null());
        let scoop = items
            .iter()
            .find(|item| item["id"] == json!(scoop_id))
            .unwrap();
        assert_eq!(scoop["nutrition"]["extendedNutrition"]["ironMg"], 1.2);
        assert!(daily["totals"].get("extendedNutrition").is_none());
        assert!(daily["totals"].get("fiber").is_none());
        assert_eq!(daily["totals"]["sodiumMg"], 0.0);

        let deleted = fixture
            .success("delete_food_log", json!({"logId": scoop_id}))
            .await;
        assert_eq!(deleted["status"], "deleted");
        assert_eq!(deleted["logId"], json!(scoop_id));

        let omitted = json!({"operationId": Uuid::new_v4(), "foodId": iron_id, "quantity": 1.0});
        let omitted = fixture.success("log_food", omitted).await;
        assert_eq!(omitted["status"], "logged");
        let nulls = json!({"operationId": Uuid::new_v4(), "foodId": iron_id, "quantity": 1.0, "date": null, "time": null, "portionId": null});
        assert_eq!(fixture.success("log_food", nulls).await["status"], "logged");

        for (date, time, message) in [
            (json!("2025-09-07"), json!("00:30"), "does not exist"),
            (json!("2025-02-29"), json!("12:00"), "YYYY-MM-DD"),
            (json!("2025-1-02"), json!("12:00"), "YYYY-MM-DD"),
            (json!(DAY), json!("9:00"), "24-hour HH:MM"),
            (json!(DAY), json!("24:00"), "24-hour HH:MM"),
            (json!(DAY), Value::Null, "provided together"),
            (Value::Null, json!("12:00"), "provided together"),
        ] {
            let mut log = log_args(iron_id, 1.0, DAY);
            log["date"] = date.clone();
            log["time"] = time.clone();
            let result = fixture.call("log_food", log).await;
            assert!(assert_tool_error(&result, "invalid_arguments").contains(message));
            let result = fixture
                .call(
                    "update_food_log",
                    json!({"logId": precise_id, "date": date, "time": time}),
                )
                .await;
            assert!(assert_tool_error(&result, "invalid_arguments").contains(message));
        }
        for patch in [
            json!({"logId": precise_id}),
            json!({"logId": precise_id, "quantity": null, "date": null, "time": null}),
        ] {
            let result = fixture.call("update_food_log", patch).await;
            assert_tool_error(&result, "invalid_arguments");
        }
    }

    async fn dispatch_nutrition_overflow(fixture: &ContractFixture) {
        const SCALING_DAY: &str = "2025-01-05";
        const SUM_DAY: &str = "2025-01-06";
        let food_id = Uuid::new_v4();
        let mut details = iron_food_details();
        details.nutrition_per100.calories = 1e308;
        fixture
            .seed_food(food_id, &format!("Overflow {food_id}"), &details)
            .await;

        let overflow_log = log_args(food_id, 200.0, SCALING_DAY);
        let overflow_id = operation_id(&overflow_log);
        let mut events = fixture.hub.subscribe();
        let result = fixture.call("log_food", overflow_log.clone()).await;
        assert_eq!(
            assert_tool_error(&result, "internal_error"),
            NUTRITION_RENDER_ERROR
        );
        fixture.assert_meal_invalidation(&mut events);
        assert_eq!(fixture.stored_log(overflow_id).await, (1, Some(200.0)));
        let replay = fixture.call("log_food", overflow_log).await;
        assert_eq!(replay, result);
        assert_eq!(fixture.stored_log(overflow_id).await, (1, Some(200.0)));
        assert_no_invalidation(&mut events);

        let update_args = log_args(food_id, 100.0, SCALING_DAY);
        let update_id = operation_id(&update_args);
        assert_eq!(
            fixture.success("log_food", update_args).await["log"]["nutrition"]["calories"],
            1e308
        );
        let mut events = fixture.hub.subscribe();
        let result = fixture
            .call(
                "update_food_log",
                json!({"logId": update_id, "quantity": 200.0}),
            )
            .await;
        assert_eq!(
            assert_tool_error(&result, "internal_error"),
            NUTRITION_RENDER_ERROR
        );
        fixture.assert_meal_invalidation(&mut events);
        assert_eq!(fixture.stored_log(update_id).await, (1, Some(200.0)));

        let rejected = log_args(food_id, 200.0, "0000-01-02");
        let rejected_id = operation_id(&rejected);
        let result = fixture.call("log_food", rejected).await;
        assert_tool_error(&result, "invalid_arguments");
        assert_eq!(fixture.stored_log(rejected_id).await, (0, None));
        let result = fixture
            .call(
                "update_food_log",
                json!({"logId": update_id, "quantity": 0}),
            )
            .await;
        assert_tool_error(&result, "invalid_arguments");
        assert_eq!(fixture.stored_log(update_id).await, (1, Some(200.0)));
        assert_no_invalidation(&mut events);

        let result = fixture
            .call("get_daily_log", json!({"date": SCALING_DAY}))
            .await;
        assert_eq!(
            assert_tool_error(&result, "internal_error"),
            NUTRITION_RENDER_ERROR
        );
        assert_no_invalidation(&mut events);

        for _ in 0..2 {
            let result = fixture
                .success("log_food", log_args(food_id, 100.0, SUM_DAY))
                .await;
            assert_eq!(result["log"]["nutrition"]["calories"], 1e308);
        }
        let mut events = fixture.hub.subscribe();
        let result = fixture
            .call("get_daily_log", json!({"date": SUM_DAY}))
            .await;
        assert_eq!(
            assert_tool_error(&result, "internal_error"),
            NUTRITION_RENDER_ERROR
        );
        assert_no_invalidation(&mut events);
    }

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
    fn public_nutrition_removes_float_artifacts_after_scaling_and_aggregation() {
        let mut total = zero_nutrition();
        let mut first = zero_nutrition();
        first.fat = 12.219999999999;
        first.protein = 0.1;
        first.sodium_mg = Some(10.12345678);
        first.extended_nutrition.insert("ironMg".into(), 0.00000049);
        let mut second = zero_nutrition();
        second.protein = 0.2;

        let item = serde_json::to_value(nutrition_output(&first)).unwrap();
        assert_eq!(item["fat"], json!(12.22));
        assert_eq!(item["sodiumMg"], json!(10.123457));
        assert_eq!(item["extendedNutrition"]["ironMg"], json!(0.0));

        add_nutrition(&mut total, &first);
        add_nutrition(&mut total, &second);
        let totals = serde_json::to_value(nutrition_output(&total)).unwrap();
        assert_eq!(totals["protein"], json!(0.3));
        assert_eq!(totals["fiber"], json!(0.0));
    }

    #[test]
    fn optional_fiber_is_preserved_across_mcp_input_output_and_aggregation() {
        let operation_id = Uuid::new_v4();
        let without_fiber = parse_args::<CreateFoodArgs>(json!({
            "operationId": operation_id,
            "name": "Sin fibra informada",
            "canonicalUnit": "g",
            "calories": 100.0,
            "protein": 10.0,
            "carbs": 20.0,
            "fat": 5.0
        }))
        .unwrap();
        assert_eq!(without_fiber.fiber, None);

        let explicit_zero = parse_args::<CreateFoodArgs>(json!({
            "operationId": operation_id,
            "name": "Fibra cero",
            "canonicalUnit": "g",
            "calories": 100.0,
            "protein": 10.0,
            "carbs": 20.0,
            "fat": 5.0,
            "fiber": 0.0
        }))
        .unwrap();
        assert_eq!(explicit_zero.fiber, Some(0.0));

        let output = serde_json::to_value(nutrition_output(&NutritionValues {
            calories: 100.0,
            protein: 10.0,
            carbs: 20.0,
            fat: 5.0,
            fiber: None,
            sodium_mg: None,
            cholesterol_mg: None,
            extended_nutrition: Default::default(),
        }))
        .unwrap();
        assert!(output.get("fiber").is_none());

        let schema = nutrition_schema();
        let required = schema["required"].as_array().unwrap();
        assert!(!required.contains(&json!("fiber")));

        let mut total = zero_nutrition();
        let known = NutritionValues {
            calories: 1.0,
            protein: 1.0,
            carbs: 1.0,
            fat: 1.0,
            fiber: Some(2.0),
            sodium_mg: None,
            cholesterol_mg: None,
            extended_nutrition: Default::default(),
        };
        add_nutrition(&mut total, &known);
        assert_eq!(total.fiber, Some(2.0));
        let mut unknown = known;
        unknown.fiber = None;
        add_nutrition(&mut total, &unknown);
        assert_eq!(total.fiber, None);
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
        let res = tool_success(json!("req-1"), "Exito", json!({ "status": "ok" }), None);
        let val = extract_json_response(res);

        assert_eq!(val["jsonrpc"], "2.0");
        assert_eq!(val["id"], "req-1");
        assert_eq!(val["result"]["isError"], false);
        assert_eq!(val["result"]["content"].as_array().unwrap().len(), 1);
        assert_eq!(val["result"]["content"][0]["type"], "text");
        let text = val["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.starts_with("Exito\n\n"));
        let text_payload: Value = serde_json::from_str(embedded_json(text)).unwrap();
        assert_eq!(text_payload, val["result"]["structuredContent"]);
        assert_eq!(
            val["result"]["structuredContent"],
            json!({ "status": "ok" })
        );
    }

    #[test]
    fn test_text_success_weight_history_contains_dates_and_numeric_weights() {
        let entry = weight_output(&WeightLogRow {
            user_id: 1,
            measured_on: NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(),
            weight_grams: 72_300,
            updated_at: 1_767_398_400_000,
            deleted_at: None,
        });
        let payload = json!({ "entries": [entry] });
        let response = extract_json_response(tool_success(
            json!(42),
            "Found 1 weight entries.",
            payload.clone(),
            None,
        ));
        let text = response["result"]["content"][0]["text"].as_str().unwrap();
        let text_payload: Value = serde_json::from_str(embedded_json(text)).unwrap();

        assert_eq!(response["result"]["content"].as_array().unwrap().len(), 1);
        assert!(text.starts_with("Found 1 weight entries.\n\n"));
        assert!(text.contains("\"date\":\"2026-01-02\""));
        assert!(text.contains("\"weightKg\":72.3"));
        assert_eq!(text_payload, payload);
        assert_eq!(text_payload, response["result"]["structuredContent"]);
        assert_eq!(text_payload["entries"][0]["date"], "2026-01-02");
        assert_eq!(text_payload["entries"][0]["weightKg"].as_f64(), Some(72.3));
        assert_eq!(
            text_payload["entries"][0]["updatedAt"].as_i64(),
            Some(1_767_398_400_000)
        );
        assert_eq!(response["id"], 42);
    }

    #[test]
    fn test_text_success_preserves_empty_null_escaped_and_typed_values() {
        let summary = "Summary with \"quotes\", a newline\n and café 🥣";
        for payload in [
            json!({ "entries": [], "measurement": null }),
            json!({
                "name": "Café \"quoted\"\nline\t\\path 🥣",
                "nested": [{ "enabled": true, "count": 2, "quantity": 1.5 }],
                "disabled": false,
                "nothing": null
            }),
        ] {
            let response =
                extract_json_response(tool_success(Value::Null, summary, payload.clone(), None));
            let text = response["result"]["content"][0]["text"].as_str().unwrap();
            let text_payload: Value = serde_json::from_str(embedded_json(text)).unwrap();

            assert_eq!(text_payload, payload);
            assert_eq!(text_payload, response["result"]["structuredContent"]);
            assert!(text.starts_with(&format!("{summary}\n\n")));
            assert_eq!(response["result"]["content"].as_array().unwrap().len(), 1);
            assert_eq!(response["id"], Value::Null);
            assert_eq!(response["result"]["isError"], false);
        }
    }

    #[test]
    fn test_structured_failure_response_envelope_variants() {
        let bad = tool_failure(json!(10), AppError::BadRequest("bad input".into()), None);
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

        let not_found = tool_failure(json!(11), AppError::NotFound("item missing".into()), None);
        let v_nf = extract_json_response(not_found);
        assert_eq!(
            v_nf["result"]["structuredContent"]["error"]["code"],
            "not_found"
        );
        assert_eq!(
            v_nf["result"]["structuredContent"]["error"]["message"],
            "item missing"
        );

        let conflict = tool_failure(json!(12), AppError::Conflict("already exists".into()), None);
        let v_cf = extract_json_response(conflict);
        assert_eq!(
            v_cf["result"]["structuredContent"]["error"]["code"],
            "conflict"
        );

        let db_err = tool_failure(json!(13), AppError::Db(sqlx::Error::RowNotFound), None);
        let v_db = extract_json_response(db_err);
        assert_eq!(
            v_db["result"]["structuredContent"]["error"]["code"],
            "database_error"
        );
        assert_eq!(
            v_db["result"]["structuredContent"]["error"]["message"],
            "Database operation failed"
        );

        let int_err = tool_failure(json!(14), AppError::Internal("internal crash".into()), None);
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
        let id = serde_json::value::to_raw_value(&5).unwrap();
        let res = json_rpc_error(Some(&id), -32601, "Method not found");
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

    #[test]
    fn optional_food_brand_is_normalized_validated_and_exposed_in_mcp_contracts() {
        let op_id = Uuid::new_v4();
        let with_brand = parse_args::<CreateFoodArgs>(json!({
            "operationId": op_id,
            "name": "Yogurt griego",
            "canonicalUnit": "g",
            "calories": 90.0,
            "protein": 8.0,
            "carbs": 5.0,
            "fat": 4.0,
            "brand": "  Soprole  "
        }))
        .unwrap();
        assert_eq!(with_brand.brand.as_deref(), Some("Soprole"));
        assert!(validate_optional_brand(with_brand.brand.as_deref()).is_ok());

        let blank_brand = parse_args::<CreateFoodArgs>(json!({
            "operationId": op_id,
            "name": "Avena",
            "canonicalUnit": "g",
            "calories": 370.0,
            "protein": 13.0,
            "carbs": 60.0,
            "fat": 7.0,
            "brand": "   "
        }))
        .unwrap();
        assert_eq!(blank_brand.brand, None);

        let too_long = "a".repeat(MAX_BRAND_CHARS + 1);
        assert!(validate_optional_brand(Some(&too_long)).is_err());
        let exact_max = "á".repeat(MAX_BRAND_CHARS);
        assert!(validate_optional_brand(Some(&exact_max)).is_ok());

        let create_schema = create_food_input_schema();
        assert_eq!(
            create_schema.pointer("/properties/brand"),
            Some(&json!({ "type": ["string", "null"], "maxLength": MAX_BRAND_CHARS }))
        );
        assert!(
            !create_schema["required"]
                .as_array()
                .unwrap()
                .contains(&json!("brand"))
        );

        let f_schema = food_schema();
        assert_eq!(
            f_schema.pointer("/properties/details/properties/brand"),
            Some(&json!({ "type": "string", "maxLength": MAX_BRAND_CHARS }))
        );
        assert!(
            !f_schema
                .pointer("/properties/details/required")
                .unwrap()
                .as_array()
                .unwrap()
                .contains(&json!("brand"))
        );

        let c_schema = consumption_schema();
        assert_eq!(
            c_schema.pointer("/properties/brand"),
            Some(&json!({ "type": "string", "maxLength": MAX_BRAND_CHARS }))
        );
        assert!(
            !c_schema["required"]
                .as_array()
                .unwrap()
                .contains(&json!("brand"))
        );

        let details_with_brand = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: NutritionValues {
                calories: 90.0,
                protein: 8.0,
                carbs: 5.0,
                fat: 4.0,
                fiber: None,
                sodium_mg: None,
                cholesterol_mg: None,
                extended_nutrition: Default::default(),
            },
            portions: vec![],
            chilean_seals: vec![],
            brand: Some("Soprole".into()),
            category: None,
            typical_time: None,
        };
        let template_with_brand = crate::connectors::sync::FoodTemplate {
            id: Uuid::new_v4(),
            name: "Yogurt griego".into(),
            is_official: false,
            details: details_with_brand.clone(),
            updated_at: 1_767_398_400_000,
        };
        let template_json = serde_json::to_value(&template_with_brand).unwrap();
        assert_eq!(template_json["details"]["brand"], "Soprole");

        let mut details_without_brand = details_with_brand.clone();
        details_without_brand.brand = None;
        let template_without_brand = crate::connectors::sync::FoodTemplate {
            id: Uuid::new_v4(),
            name: "Avena".into(),
            is_official: false,
            details: details_without_brand.clone(),
            updated_at: 1_767_398_400_000,
        };
        let template_without_json = serde_json::to_value(&template_without_brand).unwrap();
        assert!(template_without_json["details"].get("brand").is_none());

        let consumption_with_brand = Consumption {
            id: Uuid::new_v4(),
            template_id: Some(template_with_brand.id),
            name: "Yogurt griego".into(),
            snapshot: details_with_brand.snapshot(),
            canonical_quantity: 125.0,
            entry: crate::connectors::sync::MealLogEntry {
                entered_quantity: 125.0,
                portion_snapshot: None,
            },
            consumed_at: 1_767_398_400_000,
            updated_at: 1_767_398_400_000,
        };
        let output_with_brand = consumption_output(&consumption_with_brand).unwrap();
        assert_eq!(output_with_brand["brand"], "Soprole");

        let consumption_without_brand = Consumption {
            id: Uuid::new_v4(),
            template_id: Some(template_without_brand.id),
            name: "Avena".into(),
            snapshot: details_without_brand.snapshot(),
            canonical_quantity: 50.0,
            entry: crate::connectors::sync::MealLogEntry {
                entered_quantity: 50.0,
                portion_snapshot: None,
            },
            consumed_at: 1_767_398_400_000,
            updated_at: 1_767_398_400_000,
        };
        let output_without_brand = consumption_output(&consumption_without_brand).unwrap();
        assert!(output_without_brand.get("brand").is_none());
    }

    #[tokio::test]
    async fn mcp_brand_search_create_log_and_daily_log_roundtrip() {
        let Ok(database_url) = std::env::var("BALANCE_TEST_DATABASE_URL") else {
            return;
        };
        let db = Arc::new(
            Database::new(
                &database_url,
                crate::connectors::db::PoolSettings::parse(None).unwrap(),
            )
            .await
            .unwrap(),
        );
        let op_branded = Uuid::new_v4();
        let unique_brand = format!("MarcaMcp{}", &op_branded.simple().to_string()[..8]);
        let (_, created_json) = call_tool(
            &db,
            1,
            "create_food",
            json!({
                "operationId": op_branded,
                "name": format!("Yogurt {}", unique_brand),
                "canonicalUnit": "g",
                "calories": 90.0,
                "protein": 8.0,
                "carbs": 5.0,
                "fat": 4.0,
                "brand": format!("  {unique_brand}  ")
            }),
            &mut false,
        )
        .await
        .unwrap();
        assert_eq!(created_json["status"], "created");
        assert_eq!(created_json["food"]["details"]["brand"], unique_brand);

        let (_, search_json) = call_tool(
            &db,
            1,
            "search_foods",
            json!({
                "query": unique_brand.to_lowercase(),
                "source": "personal",
                "limit": 10
            }),
            &mut false,
        )
        .await
        .unwrap();
        let foods = search_json["foods"].as_array().unwrap();
        assert!(foods.iter().any(|f| {
            f["id"] == created_json["food"]["id"] && f["details"]["brand"] == unique_brand
        }));

        let op_plain = Uuid::new_v4();
        let (_, plain_json) = call_tool(
            &db,
            1,
            "create_food",
            json!({
                "operationId": op_plain,
                "name": format!("Avena {}", op_plain.simple()),
                "canonicalUnit": "g",
                "calories": 370.0,
                "protein": 13.0,
                "carbs": 60.0,
                "fat": 7.0
            }),
            &mut false,
        )
        .await
        .unwrap();
        assert!(plain_json["food"]["details"].get("brand").is_none());

        let log_branded = Uuid::new_v4();
        let (_, logged_json) = call_tool(
            &db,
            1,
            "log_food",
            json!({
                "operationId": log_branded,
                "foodId": op_branded,
                "quantity": 100.0,
                "date": "2026-08-10",
                "time": "09:00"
            }),
            &mut false,
        )
        .await
        .unwrap();
        assert_eq!(logged_json["log"]["brand"], unique_brand);

        let log_plain = Uuid::new_v4();
        let (_, logged_plain_json) = call_tool(
            &db,
            1,
            "log_food",
            json!({
                "operationId": log_plain,
                "foodId": op_plain,
                "quantity": 50.0,
                "date": "2026-08-10",
                "time": "09:05"
            }),
            &mut false,
        )
        .await
        .unwrap();
        assert!(logged_plain_json["log"].get("brand").is_none());

        let (_, daily_json) = call_tool(
            &db,
            1,
            "get_daily_log",
            json!({ "date": "2026-08-10" }),
            &mut false,
        )
        .await
        .unwrap();
        let items = daily_json["items"].as_array().unwrap();
        let branded_item = items
            .iter()
            .find(|i| i["id"] == log_branded.to_string())
            .unwrap();
        assert_eq!(branded_item["brand"], unique_brand);
        let plain_item = items
            .iter()
            .find(|i| i["id"] == log_plain.to_string())
            .unwrap();
        assert!(plain_item.get("brand").is_none());
    }
}

#[cfg(test)]
mod resource_metadata_tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn public_resource_metadata_is_configured_no_store_and_host_independent() {
        let api = OidcConfig::test_cached_subject_config();
        let mcp = api.mcp_config();
        let app = mcp_metadata_routes(&api, &mcp);
        for (path, resource) in [
            (
                "/.well-known/oauth-protected-resource",
                "https://api.example.invalid/api",
            ),
            (
                "/.well-known/oauth-protected-resource/mcp",
                "https://api.example.invalid/api/mcp",
            ),
        ] {
            for host in ["api.example.invalid", "attacker.example.invalid"] {
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .uri(path)
                            .header("Host", host)
                            .header("X-Forwarded-Host", "attacker.example.invalid")
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                assert_eq!(
                    response
                        .headers()
                        .get(axum::http::header::CACHE_CONTROL)
                        .unwrap(),
                    "no-store"
                );
                assert_eq!(
                    response
                        .headers()
                        .get(axum::http::header::CONTENT_TYPE)
                        .unwrap(),
                    "application/json"
                );
                let metadata: Value =
                    serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap())
                        .unwrap();
                assert_eq!(metadata["resource"], resource);
                assert_eq!(
                    metadata["authorization_servers"],
                    json!(["https://issuer.example.invalid"])
                );
                assert_eq!(metadata["bearer_methods_supported"], json!(["header"]));
                assert_eq!(
                    metadata["scopes_supported"],
                    json!(["openid", "profile", "email", "offline_access"])
                );
                assert_eq!(metadata.as_object().unwrap().len(), 4);
            }
        }
    }
}
