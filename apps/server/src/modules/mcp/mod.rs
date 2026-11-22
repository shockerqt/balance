use std::{
    collections::{HashMap, HashSet},
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
            BatchDeleteFoodLogStatus, CanonicalUnit, Consumption, CreatePersonalFoodOutcome,
            DuplicatePersonalFood, EXTENDED_NUTRIENT_KEYS, FOOD_SCHEMA_VERSION, FoodDetails,
            LogFoodTimeIntent, MAX_BATCH_DELETE_FOOD_LOG_IDS, MAX_BRAND_CHARS,
            MAX_DUPLICATE_PERSONAL_FOOD_CANDIDATES, NutritionValues, PersonalFoodPatch,
            PortionDefinition, WeightLogRow, WeightUpsertStatus, deserialize_optional_brand,
            validate_optional_brand,
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
    #[serde(default)]
    include_extended_nutrition: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetDailyLogArgs {
    date: Option<String>,
    #[serde(default)]
    include_extended_nutrition: bool,
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

fn deserialize_non_null_patch<'de, T, D>(deserializer: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn deserialize_nullable_patch<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateFoodArgs {
    food_id: Uuid,
    #[serde(default, deserialize_with = "deserialize_non_null_patch")]
    name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_non_null_patch")]
    calories: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_non_null_patch")]
    protein: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_non_null_patch")]
    carbs: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_non_null_patch")]
    fat: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    fiber: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    sodium_mg: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    cholesterol_mg: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_non_null_patch")]
    portions: Option<Vec<PortionInput>>,
    #[serde(default, deserialize_with = "deserialize_non_null_patch")]
    chilean_seals: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    brand: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    category: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    typical_time: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteFoodArgs {
    food_id: Uuid,
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
struct BatchDeleteFoodLogArgs {
    log_ids: Vec<Uuid>,
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
            let mut mutated_collection: Option<&'static str> = None;
            let result = call_tool(&db, user.id, name, args, &mut mutated_collection).await;
            if let Some(collection) = mutated_collection {
                sync_hub.notify(user.id, collection);
            }
            match result {
                Ok(ToolCallOutcome::Success {
                    summary,
                    structured,
                }) => tool_success(id, &summary, structured, observation),
                Ok(ToolCallOutcome::StructuredError {
                    code,
                    summary,
                    structured,
                }) => tool_structured_error(id, code, &summary, structured, observation),
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
        "update_food" => Some("update_food"),
        "delete_food" => Some("delete_food"),
        "log_food" => Some("log_food"),
        "update_food_log" => Some("update_food_log"),
        "delete_food_log" => Some("delete_food_log"),
        "batch_delete_food_log" => Some("batch_delete_food_log"),
        "get_weight_history" => Some("get_weight_history"),
        "set_weight" => Some("set_weight"),
        "delete_weight_log" => Some("delete_weight_log"),
        _ => None,
    }
}

enum ToolCallOutcome {
    Success {
        summary: String,
        structured: Value,
    },
    StructuredError {
        code: &'static str,
        summary: String,
        structured: Value,
    },
}

fn duplicate_personal_food_message(duplicate: &DuplicatePersonalFood) -> String {
    if duplicate.candidates.len() == 1 && !duplicate.has_more_candidates {
        format!(
            "Ya existe un alimento personal equivalente (foodId: {}). Confirma con el usuario y reutiliza ese foodId en log_food, o aclara si difieren las porciones.",
            duplicate.candidates[0].food_id
        )
    } else if duplicate.has_more_candidates {
        "Ya existen varios alimentos personales equivalentes. Pide al usuario elegir qué foodId reutilizar en log_food o aclara la diferencia. Hay más candidatos; usa search_foods con source \"personal\" para inspeccionar más opciones.".into()
    } else {
        "Ya existen varios alimentos personales equivalentes. Pide al usuario elegir qué foodId reutilizar en log_food o aclara la diferencia.".into()
    }
}

async fn call_tool(
    db: &Database,
    user_id: i32,
    name: &str,
    args: Value,
    mutated_collection: &mut Option<&'static str>,
) -> Result<ToolCallOutcome, AppError> {
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
            let result = db
                .sync
                .search_food_templates(user_id, query, &args.source, args.limit)
                .await?;
            let foods: Vec<_> = result
                .foods
                .into_iter()
                .map(|mut food| {
                    food.details.nutrition_per100 = read_nutrition_output(
                        &food.details.nutrition_per100,
                        args.include_extended_nutrition,
                    );
                    food
                })
                .collect();
            let count = foods.len();
            let summary = if result.has_more {
                let mut summary = format!(
                    "Se muestran {count} alimentos. Hay más coincidencias. Refina la búsqueda por nombre, marca o `source`."
                );
                if args.limit < 20 {
                    summary.push_str(" También puedes aumentar `limit` hasta 20.");
                }
                summary
            } else if count == 0 {
                "No se encontraron alimentos. Prueba la búsqueda en el otro idioma (español o inglés).".into()
            } else {
                format!("Se encontraron {count} alimentos.")
            };
            Ok(ToolCallOutcome::Success {
                summary,
                structured: json!({ "foods": foods, "hasMore": result.has_more }),
            })
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
            let (items, totals) =
                daily_nutrition_output(&consumptions, args.include_extended_nutrition)?;
            let summary = daily_log_summary(&date, &totals);
            Ok(ToolCallOutcome::Success {
                summary,
                structured: json!({
                    "date": date,
                    "timezone": TIMEZONE,
                    "items": items,
                    "totals": totals
                }),
            })
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
            match db
                .sync
                .create_mcp_food(user_id, args.operation_id, &args.name, &details)
                .await?
            {
                CreatePersonalFoodOutcome::Created(food) => {
                    *mutated_collection = Some("mealTemplates");
                    Ok(ToolCallOutcome::Success {
                        summary: format!("Se creó el alimento {}.", food.name),
                        structured: json!({
                            "status": "created",
                            "food": food
                        }),
                    })
                }
                CreatePersonalFoodOutcome::AlreadyCreated(food) => Ok(ToolCallOutcome::Success {
                    summary: format!("El alimento {} ya había sido creado.", food.name),
                    structured: json!({
                        "status": "alreadyCreated",
                        "food": food
                    }),
                }),
                CreatePersonalFoodOutcome::Duplicate(duplicate) => {
                    let message = duplicate_personal_food_message(&duplicate);
                    let structured = json!({
                        "error": {
                            "code": "conflict",
                            "reason": "duplicatePersonalFood",
                            "message": message,
                            "candidates": duplicate.candidates,
                            "hasMoreCandidates": duplicate.has_more_candidates
                        }
                    });
                    Ok(ToolCallOutcome::StructuredError {
                        code: "conflict",
                        summary: message,
                        structured,
                    })
                }
            }
        }
        "update_food" => {
            let args: UpdateFoodArgs = parse_args(args)?;
            let name = match args.name {
                Some(name) => {
                    let trimmed = name.trim();
                    if trimmed.is_empty() || trimmed.chars().count() > 160 {
                        return Err(AppError::BadRequest(
                            "name must contain between 1 and 160 characters".into(),
                        ));
                    }
                    Some(trimmed.to_owned())
                }
                None => None,
            };
            if let Some(Some(brand)) = args.brand.as_ref() {
                validate_optional_brand(Some(brand.as_str()))?;
            }
            if let Some(Some(category)) = args.category.as_ref()
                && category.chars().count() > MAX_CREATE_CATEGORY_CHARS
            {
                return Err(AppError::BadRequest(format!(
                    "category must not exceed {MAX_CREATE_CATEGORY_CHARS} characters"
                )));
            }
            if let Some(Some(time)) = args.typical_time.as_ref() {
                validate_time("typicalTime", time)?;
            }
            let portions = match args.portions {
                Some(portions) => {
                    if portions.len() > MAX_CREATE_PORTIONS {
                        return Err(AppError::BadRequest(format!(
                            "portions must contain at most {MAX_CREATE_PORTIONS} items"
                        )));
                    }
                    Some(
                        portions
                            .into_iter()
                            .map(|portion| PortionDefinition {
                                id: portion.id,
                                name: portion.name,
                                portion_quantity: portion.portion_quantity,
                                canonical_quantity: portion.canonical_quantity,
                            })
                            .collect(),
                    )
                }
                None => None,
            };
            let chilean_seals = match args.chilean_seals {
                Some(seals) => {
                    if seals.len() > MAX_CREATE_SEALS {
                        return Err(AppError::BadRequest(format!(
                            "chileanSeals must contain at most {MAX_CREATE_SEALS} items"
                        )));
                    }
                    Some(seals)
                }
                None => None,
            };
            for (field, value) in [
                ("calories", args.calories),
                ("protein", args.protein),
                ("carbs", args.carbs),
                ("fat", args.fat),
                ("fiber", args.fiber.flatten()),
                ("sodiumMg", args.sodium_mg.flatten()),
                ("cholesterolMg", args.cholesterol_mg.flatten()),
            ] {
                if let Some(value) = value {
                    validate_non_negative(field, value)?;
                }
            }
            let patch = PersonalFoodPatch {
                name,
                calories: args.calories,
                protein: args.protein,
                carbs: args.carbs,
                fat: args.fat,
                fiber: args.fiber,
                sodium_mg: args.sodium_mg,
                cholesterol_mg: args.cholesterol_mg,
                portions,
                chilean_seals,
                brand: args.brand,
                category: args.category,
                typical_time: args.typical_time,
            };
            if patch.is_empty() {
                return Err(AppError::BadRequest(
                    "At least one field must be provided".into(),
                ));
            }
            let food = db
                .sync
                .update_personal_food(user_id, args.food_id, &patch)
                .await?;
            *mutated_collection = Some("mealTemplates");
            Ok(ToolCallOutcome::Success {
                summary: format!("Se actualizó el alimento {}.", food.name),
                structured: json!({
                    "status": "updated",
                    "food": food
                }),
            })
        }
        "delete_food" => {
            let args: DeleteFoodArgs = parse_args(args)?;
            let (updated_at, already_deleted) = db
                .sync
                .soft_delete_personal_food(user_id, args.food_id)
                .await?;
            if !already_deleted {
                *mutated_collection = Some("mealTemplates");
            }
            Ok(ToolCallOutcome::Success {
                summary: if already_deleted {
                    "El alimento personal ya estaba eliminado.".into()
                } else {
                    "Se eliminó el alimento personal.".into()
                },
                structured: json!({
                    "status": if already_deleted { "alreadyDeleted" } else { "deleted" },
                    "foodId": args.food_id,
                    "updatedAt": updated_at
                }),
            })
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
            let time_intent = parse_log_food_time_intent(args.date, args.time)?;
            let (consumption, created) = db
                .sync
                .create_mcp_consumption(
                    user_id,
                    args.operation_id,
                    args.food_id,
                    args.quantity,
                    args.portion_id.as_deref(),
                    &time_intent,
                )
                .await?;
            if created {
                *mutated_collection = Some("mealLogs");
            }
            Ok(ToolCallOutcome::Success {
                summary: if created {
                    format!("Se registró {}.", consumption.name)
                } else {
                    format!("El consumo de {} ya estaba registrado.", consumption.name)
                },
                structured: json!({
                    "status": if created { "logged" } else { "alreadyLogged" },
                    "log": consumption_output(&consumption)?
                }),
            })
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
            *mutated_collection = Some("mealLogs");
            Ok(ToolCallOutcome::Success {
                summary: format!("Se actualizó el consumo de {}.", consumption.name),
                structured: json!({ "status": "updated", "log": consumption_output(&consumption)? }),
            })
        }
        "delete_food_log" => {
            let args: DeleteFoodLogArgs = parse_args(args)?;
            let consumption = db
                .sync
                .soft_delete_consumption(user_id, args.log_id)
                .await?;
            *mutated_collection = Some("mealLogs");
            Ok(ToolCallOutcome::Success {
                summary: format!("Se eliminó el consumo de {}.", consumption.name),
                structured: json!({
                    "status": "deleted",
                    "logId": consumption.id,
                    "updatedAt": consumption.updated_at
                }),
            })
        }
        "batch_delete_food_log" => {
            let args: BatchDeleteFoodLogArgs = parse_args(args)?;
            if !(1..=MAX_BATCH_DELETE_FOOD_LOG_IDS).contains(&args.log_ids.len()) {
                return Err(AppError::BadRequest(
                    "logIds must contain between 1 and 30 items".into(),
                ));
            }
            let mut seen = HashSet::with_capacity(args.log_ids.len());
            for id in &args.log_ids {
                if !seen.insert(*id) {
                    return Err(AppError::BadRequest(
                        "logIds must not contain duplicate IDs".into(),
                    ));
                }
            }
            let batch = db
                .sync
                .batch_soft_delete_consumptions(user_id, &args.log_ids)
                .await?;
            if batch.deleted_count > 0 {
                *mutated_collection = Some("mealLogs");
            }
            let summary = match (batch.deleted_count, batch.already_deleted_count) {
                (1, 0) => "Se eliminó 1 consumo.".to_string(),
                (d, 0) => format!("Se eliminaron {d} consumos."),
                (0, 1) => "1 consumo ya estaba eliminado.".to_string(),
                (0, a) => format!("Los {a} consumos ya estaban eliminados."),
                (1, 1) => "Se eliminó 1 consumo (1 ya estaba eliminado).".to_string(),
                (1, a) => format!("Se eliminó 1 consumo ({a} ya estaban eliminados)."),
                (d, 1) => format!("Se eliminaron {d} consumos (1 ya estaba eliminado)."),
                (d, a) => format!("Se eliminaron {d} consumos ({a} ya estaban eliminados)."),
            };
            let results: Vec<Value> = batch
                .results
                .iter()
                .map(|item| {
                    json!({
                        "logId": item.log_id,
                        "status": match item.status {
                            BatchDeleteFoodLogStatus::Deleted => "deleted",
                            BatchDeleteFoodLogStatus::AlreadyDeleted => "alreadyDeleted",
                        },
                        "updatedAt": item.updated_at,
                    })
                })
                .collect();
            Ok(ToolCallOutcome::Success {
                summary,
                structured: json!({
                    "results": results,
                    "deletedCount": batch.deleted_count,
                    "alreadyDeletedCount": batch.already_deleted_count,
                }),
            })
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
            Ok(ToolCallOutcome::Success {
                summary: format!("Hay {} registros de peso.", entries.len()),
                structured: json!({
                    "timezone": TIMEZONE,
                    "entries": entries,
                    "latest": latest,
                    "changeKg": change_kg
                }),
            })
        }
        "set_weight" => {
            require_weight_tracking(db, user_id).await?;
            let args: SetWeightArgs = parse_args(args)?;
            let date = resolve_weight_date(db, args.date).await?;
            let grams = weight_kg_to_grams(args.weight_kg)?;
            let (row, status) = db.sync.set_weight(user_id, date, grams).await?;
            *mutated_collection = Some("weightLogs");
            let status = match status {
                WeightUpsertStatus::Created => "created",
                WeightUpsertStatus::Updated => "updated",
                WeightUpsertStatus::Unchanged => "unchanged",
            };
            Ok(ToolCallOutcome::Success {
                summary: match status {
                    "created" => format!("Se registró el peso para {date}."),
                    "updated" => format!("Se actualizó el peso para {date}."),
                    _ => format!("El peso de {date} ya tenía ese valor."),
                },
                structured: json!({ "status": status, "measurement": weight_output(&row) }),
            })
        }
        "delete_weight_log" => {
            require_weight_tracking(db, user_id).await?;
            let args: DeleteWeightLogArgs = parse_args(args)?;
            let date = resolve_weight_date(db, args.date).await?;
            let (row, already_deleted) = db.sync.soft_delete_weight(user_id, date).await?;
            *mutated_collection = Some("weightLogs");
            Ok(ToolCallOutcome::Success {
                summary: if already_deleted {
                    format!("El peso de {date} ya estaba eliminado.")
                } else {
                    format!("Se eliminó el peso de {date}.")
                },
                structured: json!({
                    "status": if already_deleted { "alreadyDeleted" } else { "deleted" },
                    "date": date.to_string(),
                    "updatedAt": row.updated_at
                }),
            })
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

fn validate_non_negative(field: &str, value: f64) -> Result<(), AppError> {
    if !value.is_finite() || value < 0.0 {
        return Err(AppError::BadRequest(format!(
            "{field} must be finite and non-negative"
        )));
    }
    Ok(())
}

fn parse_log_food_time_intent(
    date: Option<String>,
    time: Option<String>,
) -> Result<LogFoodTimeIntent, AppError> {
    match (date, time) {
        (None, None) => Ok(LogFoodTimeIntent::Omitted),
        (Some(date), Some(time)) => {
            validate_food_date(&date)?;
            validate_time("time", &time)?;
            Ok(LogFoodTimeIntent::Explicit { date, time })
        }
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
    Ok(render_consumption(
        consumption,
        &nutrition_output(&nutrition),
    ))
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
    item.insert("nutrition".into(), json!(nutrition));
    Value::Object(item)
}

const PUBLIC_NUTRITION_DECIMAL_PLACES: i32 = 6;
/// Bulk read-tool nutrients (`calories`, `protein`, `carbs`, `fat`, and present `fiber`) round to
/// 2 decimal places.
const READ_BULK_NUTRITION_DECIMAL_PLACES: i32 = 2;
/// Micronutrients (`sodiumMg`, `cholesterolMg`, and `extendedNutrition` entries) round to 6 decimal
/// places while preserving positive values that would otherwise round to zero.
const READ_MICRO_NUTRITION_DECIMAL_PLACES: i32 = 6;

fn round_public_number(value: f64, decimal_places: i32) -> f64 {
    let factor = 10_f64.powi(decimal_places);
    let scaled = value * factor;
    if !scaled.is_finite() {
        return if value == 0.0 { 0.0 } else { value };
    }
    let rounded = scaled.round() / factor;
    if rounded == 0.0 { 0.0 } else { rounded }
}

fn public_number(value: f64) -> f64 {
    round_public_number(value, PUBLIC_NUTRITION_DECIMAL_PLACES)
}

fn read_bulk_number(value: f64) -> f64 {
    round_public_number(value, READ_BULK_NUTRITION_DECIMAL_PLACES)
}

fn read_micro_number(value: f64) -> f64 {
    let rounded = round_public_number(value, READ_MICRO_NUTRITION_DECIMAL_PLACES);
    if rounded == 0.0 && value > 0.0 {
        value
    } else {
        rounded
    }
}

/// Stabilize numeric MCP output for mutation responses without reducing persisted or calculation precision.
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

/// Project nutrition values for read tools (`search_foods` and `get_daily_log` items).
/// Bulk nutrients (`calories`, `protein`, `carbs`, `fat`, and present `fiber`) round to 2 decimal
/// places; `sodiumMg`, `cholesterolMg`, and `extendedNutrition` entries round to 6 decimal places
/// while retaining positive traces that would round to zero.
fn read_nutrition_output(
    value: &NutritionValues,
    include_extended_nutrition: bool,
) -> NutritionValues {
    NutritionValues {
        calories: read_bulk_number(value.calories),
        protein: read_bulk_number(value.protein),
        carbs: read_bulk_number(value.carbs),
        fat: read_bulk_number(value.fat),
        fiber: value.fiber.map(read_bulk_number),
        sodium_mg: value.sodium_mg.map(read_micro_number),
        cholesterol_mg: value.cholesterol_mg.map(read_micro_number),
        extended_nutrition: if include_extended_nutrition {
            value
                .extended_nutrition
                .iter()
                .map(|(name, amount)| (name.clone(), read_micro_number(*amount)))
                .collect()
        } else {
            Default::default()
        },
    }
}

const NUTRITION_RENDER_ERROR: &str = "Nutrition result cannot be represented";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum NutrientCompletenessStatus {
    Complete,
    Partial,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NutrientCompleteness {
    known_items: usize,
    status: NutrientCompletenessStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DailyTotalsCompleteness {
    item_count: usize,
    fiber: NutrientCompleteness,
    sodium_mg: NutrientCompleteness,
    cholesterol_mg: NutrientCompleteness,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DailyTotals {
    calories: f64,
    protein: f64,
    carbs: f64,
    fat: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    fiber: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sodium_mg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cholesterol_mg: Option<f64>,
    completeness: DailyTotalsCompleteness,
}

#[derive(Default)]
struct OptionalNutrientAccumulator {
    known_items: usize,
    sum: f64,
}

impl OptionalNutrientAccumulator {
    fn add(&mut self, value: Option<f64>) {
        if let Some(amount) = value {
            self.known_items += 1;
            self.sum += amount;
        }
    }

    fn finish(self, item_count: usize) -> (Option<f64>, NutrientCompleteness) {
        if item_count == 0 {
            (
                Some(0.0),
                NutrientCompleteness {
                    known_items: 0,
                    status: NutrientCompletenessStatus::Complete,
                },
            )
        } else if self.known_items == 0 {
            (
                None,
                NutrientCompleteness {
                    known_items: 0,
                    status: NutrientCompletenessStatus::Unknown,
                },
            )
        } else {
            let status = if self.known_items == item_count {
                NutrientCompletenessStatus::Complete
            } else {
                NutrientCompletenessStatus::Partial
            };
            (
                Some(self.sum),
                NutrientCompleteness {
                    known_items: self.known_items,
                    status,
                },
            )
        }
    }
}

fn empty_daily_totals() -> DailyTotals {
    let empty_nutrient = NutrientCompleteness {
        known_items: 0,
        status: NutrientCompletenessStatus::Complete,
    };
    DailyTotals {
        calories: 0.0,
        protein: 0.0,
        carbs: 0.0,
        fat: 0.0,
        fiber: Some(0.0),
        sodium_mg: Some(0.0),
        cholesterol_mg: Some(0.0),
        completeness: DailyTotalsCompleteness {
            item_count: 0,
            fiber: empty_nutrient,
            sodium_mg: empty_nutrient,
            cholesterol_mg: empty_nutrient,
        },
    }
}

fn daily_log_summary(date: &str, totals: &DailyTotals) -> String {
    let item_count = totals.completeness.item_count;
    let mut summary = format!("Hay {item_count} consumos registrados para {date}.");
    let mut partial = Vec::new();
    let mut unknown = Vec::new();

    for (label, completeness) in [
        ("fibra", totals.completeness.fiber),
        ("sodio", totals.completeness.sodium_mg),
        ("colesterol", totals.completeness.cholesterol_mg),
    ] {
        match completeness.status {
            NutrientCompletenessStatus::Complete => {}
            NutrientCompletenessStatus::Partial => {
                partial.push(format!(
                    "{label} ({}/{item_count})",
                    completeness.known_items
                ));
            }
            NutrientCompletenessStatus::Unknown => unknown.push(label),
        }
    }

    if !partial.is_empty() {
        summary.push_str(&format!(
            " Totales parciales (solo consumos con dato): {}.",
            partial.join(", ")
        ));
    }
    if !unknown.is_empty() {
        summary.push_str(&format!(
            " Sin datos disponibles para: {}.",
            unknown.join(", ")
        ));
    }

    summary
}

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

fn check_daily_totals_finite(
    calories: f64,
    protein: f64,
    carbs: f64,
    fat: f64,
    fiber: Option<f64>,
    sodium_mg: Option<f64>,
    cholesterol_mg: Option<f64>,
) -> Result<(), AppError> {
    if [
        Some(calories),
        Some(protein),
        Some(carbs),
        Some(fat),
        fiber,
        sodium_mg,
        cholesterol_mg,
    ]
    .into_iter()
    .flatten()
    .all(f64::is_finite)
    {
        Ok(())
    } else {
        Err(AppError::Internal(NUTRITION_RENDER_ERROR.into()))
    }
}

fn daily_nutrition_output(
    consumptions: &[Consumption],
    include_extended_nutrition: bool,
) -> Result<(Vec<Value>, DailyTotals), AppError> {
    if consumptions.is_empty() {
        return Ok((Vec::new(), empty_daily_totals()));
    }

    let mut calories = 0.0;
    let mut protein = 0.0;
    let mut carbs = 0.0;
    let mut fat = 0.0;
    let mut fiber = OptionalNutrientAccumulator::default();
    let mut sodium_mg = OptionalNutrientAccumulator::default();
    let mut cholesterol_mg = OptionalNutrientAccumulator::default();
    let mut items = Vec::with_capacity(consumptions.len());

    for consumption in consumptions {
        let nutrition = consumption.scaled_nutrition();
        check_nutrition_finite(&nutrition)?;
        let projected = read_nutrition_output(&nutrition, include_extended_nutrition);
        items.push(render_consumption(consumption, &projected));
        calories += nutrition.calories;
        protein += nutrition.protein;
        carbs += nutrition.carbs;
        fat += nutrition.fat;
        fiber.add(nutrition.fiber);
        sodium_mg.add(nutrition.sodium_mg);
        cholesterol_mg.add(nutrition.cholesterol_mg);
    }

    let item_count = consumptions.len();
    let (fiber_total, fiber_completeness) = fiber.finish(item_count);
    let (sodium_total, sodium_completeness) = sodium_mg.finish(item_count);
    let (cholesterol_total, cholesterol_completeness) = cholesterol_mg.finish(item_count);

    check_daily_totals_finite(
        calories,
        protein,
        carbs,
        fat,
        fiber_total,
        sodium_total,
        cholesterol_total,
    )?;

    Ok((
        items,
        DailyTotals {
            calories: read_bulk_number(calories),
            protein: read_bulk_number(protein),
            carbs: read_bulk_number(carbs),
            fat: read_bulk_number(fat),
            fiber: fiber_total.map(read_bulk_number),
            sodium_mg: sodium_total.map(read_micro_number),
            cholesterol_mg: cholesterol_total.map(read_micro_number),
            completeness: DailyTotalsCompleteness {
                item_count,
                fiber: fiber_completeness,
                sodium_mg: sodium_completeness,
                cholesterol_mg: cholesterol_completeness,
            },
        },
    ))
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

fn tool_structured_error(
    id: impl Serialize,
    code: &'static str,
    summary: &str,
    structured: Value,
    observation: Option<&observation::Observation>,
) -> Response {
    let result = json!({
        "content": [{ "type": "text", "text": readable_tool_text(summary, &structured) }],
        "structuredContent": structured,
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
            "description": "Busca exclusivamente alimentos disponibles en el catálogo oficial o personal por nombre o marca, sin distinguir mayúsculas ni acentos. El catálogo combina nombres en español e inglés. Si no hay resultados, vuelve a buscar en el otro idioma antes de considerar una creación. Si hasMore es true, refina la búsqueda para explorar más coincidencias. Úsala para elegir un foodId antes de registrar. NUNCA consulta consumos, el diario, el historial ni fechas; para saber qué comió el usuario usa get_daily_log. Si hay varias coincidencias, presenta los candidatos y pide al usuario elegir uno. Por defecto omite extendedNutrition; envía includeExtendedNutrition en true para incluir el detalle nutricional extendido disponible de cada resultado.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "minLength": 1, "maxLength": 120 },
                    "source": { "type": "string", "enum": ["all", "personal", "official"], "default": "all" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 10 },
                    "includeExtendedNutrition": { "type": "boolean", "default": false }
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
            "description": "Consulta exclusivamente los consumos ya registrados y sus totales para una fecha del diario. Para varios días, llama esta herramienta una vez por cada fecha exacta. NUNCA busca alimentos en el catálogo. Si el usuario consulta su historial sin indicar una fecha, pide aclararla. Omite date solo cuando el usuario pide hoy; hoy se interpreta en America/Santiago. Por defecto omite extendedNutrition en cada consumo; envía includeExtendedNutrition en true para incluir el detalle nutricional extendido disponible en cada item (totals nunca incluye extendedNutrition). totals.completeness indica por nutriente (fiber, sodiumMg, cholesterolMg) cuántos consumos tienen dato (knownItems sobre itemCount) y su status (complete, partial o unknown): cuando es partial el número es un subtotal solo de los consumos con dato, cuando es unknown el nutriente se omite de totals, y solo debe presentarse como total diario completo cuando status es complete.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "date": nullable_schema(food_date_schema()),
                    "includeExtendedNutrition": { "type": "boolean", "default": false }
                },
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
            "description": "Crea un alimento personal con nutrición por 100 g o 100 ml según canonicalUnit. Las porciones nombradas son conversiones opcionales con IDs opacos y únicos dentro del alimento. Genera un operationId UUID nuevo en tiempo de ejecución para cada creación nueva y conserva exactamente el mismo operationId y los mismos argumentos al reintentar tras una respuesta perdida. Si reutilizas un operationId con otros argumentos o tras editar o eliminar el alimento, devolverá conflict: inspecciona el catálogo actual y genera un nuevo operationId solo tras confirmar una nueva creación. Si ya existe un alimento personal equivalente, devolverá conflict con reason \"duplicatePersonalFood\" y candidates: confirma con el usuario y reutiliza el foodId elegido en log_food, pídele elegir cuando haya varios candidatos y usa search_foods con source \"personal\" si hasMoreCandidates es true. Úsala solo después de confirmar con el usuario cualquier dato ambiguo.",
            "inputSchema": create_food_input_schema(),
            "outputSchema": create_food_output_schema(),
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": write_annotations
        },
        {
            "name": "update_food",
            "title": "Corregir alimento personal",
            "description": "Corrige campos de un alimento personal existente identificado por foodId sin modificar los consumos históricos ya registrados. Envía solo los campos que cambian: los campos omitidos se conservan intactos. En brand, category, typicalTime, fiber, sodiumMg y cholesterolMg, enviar null borra el valor guardado; en portions o chileanSeals, enviar [] borra la lista. No permite cambiar canonicalUnit ni editar alimentos oficiales. Confirma los cambios con el usuario si hay ambigüedad.",
            "inputSchema": update_food_input_schema(),
            "outputSchema": update_food_output_schema(),
            "securitySchemes": auth,
            "_meta": { "securitySchemes": auth },
            "annotations": write_annotations
        },
        {
            "name": "delete_food",
            "title": "Eliminar alimento personal",
            "description": "Elimina de forma reversible un alimento personal del catálogo mediante foodId sin alterar los consumos históricos ya registrados. Repetir la eliminación sobre un alimento personal ya eliminado devuelve alreadyDeleted. No permite eliminar alimentos oficiales. Confirma con el usuario el alimento seleccionado antes de usar esta herramienta.",
            "inputSchema": {
                "type": "object",
                "properties": { "foodId": uuid_schema() },
                "required": ["foodId"],
                "additionalProperties": false
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["deleted", "alreadyDeleted"] },
                    "foodId": uuid_schema(),
                    "updatedAt": { "type": "integer" }
                },
                "required": ["status", "foodId", "updatedAt"],
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
            "name": "log_food",
            "title": "Registrar consumo",
            "description": "Registra un consumo de un foodId opaco elegido inequívocamente. Sin portionId, quantity se expresa en la unidad canónica del alimento (g o ml). Con portionId, quantity cuenta unidades de esa conversión. Si 2 unidades equivalen a 60 g, quantity de 1 registra 30 g. Omite date y time para registrar la fecha y hora actuales de Santiago; ambos deben enviarse juntos cuando son explícitos. Genera un operationId UUID nuevo en tiempo de ejecución para cada registro nuevo y conserva exactamente el mismo operationId y los mismos argumentos (incluido si omitiste o enviaste date y time) al reintentar tras una respuesta perdida. Si reutilizas un operationId con otros argumentos o tras editar o eliminar el consumo, devolverá conflict: consulta el diario actual antes de confirmar un nuevo registro con un nuevo operationId.",
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
            "name": "batch_delete_food_log",
            "title": "Eliminar varios consumos",
            "description": "Elimina de forma reversible y atómica entre 1 y 30 consumos concretos en una sola operación. Confirma con el usuario el conjunto completo de registros seleccionados antes de usar esta herramienta.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "logIds": {
                        "type": "array",
                        "items": uuid_schema(),
                        "minItems": 1,
                        "maxItems": MAX_BATCH_DELETE_FOOD_LOG_IDS,
                        "uniqueItems": true
                    }
                },
                "required": ["logIds"],
                "additionalProperties": false
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "results": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": MAX_BATCH_DELETE_FOOD_LOG_IDS,
                        "items": {
                            "type": "object",
                            "properties": {
                                "logId": uuid_schema(),
                                "status": { "type": "string", "enum": ["deleted", "alreadyDeleted"] },
                                "updatedAt": { "type": "integer" }
                            },
                            "required": ["logId", "status", "updatedAt"],
                            "additionalProperties": false
                        }
                    },
                    "deletedCount": { "type": "integer", "minimum": 0 },
                    "alreadyDeletedCount": { "type": "integer", "minimum": 0 }
                },
                "required": ["results", "deletedCount", "alreadyDeletedCount"],
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

fn update_food_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "foodId": uuid_schema(),
            "name": { "type": "string", "minLength": 1, "maxLength": 160 },
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
        "required": ["foodId"],
        "minProperties": 2,
        "additionalProperties": false
    })
}

fn update_food_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "status": { "type": "string", "const": "updated" },
            "food": food_schema()
        },
        "required": ["status", "food"],
        "additionalProperties": false
    })
}

fn duplicate_food_candidate_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "foodId": uuid_schema(),
            "name": { "type": "string" },
            "brand": { "type": "string", "maxLength": MAX_BRAND_CHARS },
            "canonicalUnit": canonical_unit_schema(),
            "nutritionPer100": nutrition_schema(),
            "portions": { "type": "array", "items": portion_schema() }
        },
        "required": ["foodId", "name", "canonicalUnit", "nutritionPer100", "portions"],
        "additionalProperties": false
    })
}

fn create_food_output_schema() -> Value {
    json!({
        "type": "object",
        "oneOf": [
            {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["created", "alreadyCreated"] },
                    "food": food_schema()
                },
                "required": ["status", "food"],
                "additionalProperties": false
            },
            {
                "type": "object",
                "properties": {
                    "error": {
                        "type": "object",
                        "properties": {
                            "code": { "type": "string", "const": "conflict" },
                            "reason": { "type": "string", "const": "duplicatePersonalFood" },
                            "message": { "type": "string", "minLength": 1 },
                            "candidates": {
                                "type": "array",
                                "minItems": 1,
                                "maxItems": MAX_DUPLICATE_PERSONAL_FOOD_CANDIDATES,
                                "items": duplicate_food_candidate_schema()
                            },
                            "hasMoreCandidates": { "type": "boolean" }
                        },
                        "required": ["code", "reason", "message", "candidates", "hasMoreCandidates"],
                        "additionalProperties": false
                    }
                },
                "required": ["error"],
                "additionalProperties": false
            }
        ]
    })
}

fn foods_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "foods": { "type": "array", "items": food_schema() },
            "hasMore": { "type": "boolean" }
        },
        "required": ["foods", "hasMore"],
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
            "totals": daily_totals_schema()
        },
        "required": ["date", "timezone", "items", "totals"],
        "additionalProperties": false
    })
}

fn nutrient_completeness_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "knownItems": { "type": "integer", "minimum": 0 },
            "status": { "type": "string", "enum": ["complete", "partial", "unknown"] }
        },
        "required": ["knownItems", "status"],
        "additionalProperties": false
    })
}

fn daily_totals_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "calories": non_negative_number_schema(),
            "protein": non_negative_number_schema(),
            "carbs": non_negative_number_schema(),
            "fat": non_negative_number_schema(),
            "fiber": described_schema(
                non_negative_number_schema(),
                "Suma conocida de fibra en gramos; se omite cuando completeness.fiber.status es unknown."
            ),
            "sodiumMg": described_schema(
                non_negative_number_schema(),
                "Suma conocida de sodio en mg; se omite cuando completeness.sodiumMg.status es unknown."
            ),
            "cholesterolMg": described_schema(
                non_negative_number_schema(),
                "Suma conocida de colesterol en mg; se omite cuando completeness.cholesterolMg.status es unknown."
            ),
            "completeness": {
                "type": "object",
                "properties": {
                    "itemCount": { "type": "integer", "minimum": 0 },
                    "fiber": nutrient_completeness_schema(),
                    "sodiumMg": nutrient_completeness_schema(),
                    "cholesterolMg": nutrient_completeness_schema()
                },
                "required": ["itemCount", "fiber", "sodiumMg", "cholesterolMg"],
                "additionalProperties": false
            }
        },
        "required": ["calories", "protein", "carbs", "fat", "completeness"],
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

    const BUDGET_DATE: &str = "2025-01-02";
    const BUDGET_KEYS: [&str; 35] = [
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
    ];

    fn budget_consumptions() -> Vec<Consumption> {
        use crate::connectors::sync::{MealLogEntry, NutritionSnapshot, PortionSnapshot};

        const EPOCH: i64 = 1_735_830_000; // 2025-01-02 12:00 in America/Santiago
        assert!(
            BUDGET_KEYS
                .iter()
                .all(|key| EXTENDED_NUTRIENT_KEYS.contains(key))
        );
        let nutrition_per100 = NutritionValues {
            calories: 157.24137931034485,
            protein: 8.7654321,
            carbs: 28.1234567,
            fat: 3.1234567,
            fiber: Some(2.3456789),
            sodium_mg: Some(21.1234567),
            cholesterol_mg: Some(1.2345678),
            extended_nutrition: BUDGET_KEYS
                .iter()
                .enumerate()
                .map(|(index, key)| (key.to_string(), (index + 1) as f64 / 7.0))
                .collect(),
        };
        (1..=17)
            .map(|index| Consumption {
                id: Uuid::from_u128(index as u128),
                template_id: Some(Uuid::from_u128(100)),
                name: format!("Alimento sintético {index:02}"),
                snapshot: NutritionSnapshot {
                    schema_version: FOOD_SCHEMA_VERSION,
                    canonical_unit: CanonicalUnit::G,
                    nutrition_per100: nutrition_per100.clone(),
                    brand: Some("Marca sintética".into()),
                },
                canonical_quantity: 125.25,
                entry: MealLogEntry {
                    entered_quantity: 1.0,
                    portion_snapshot: Some(PortionSnapshot {
                        portion_id: Some("serving".into()),
                        name: "Porción".into(),
                        portion_quantity: 1.0,
                        canonical_quantity: 125.25,
                    }),
                },
                consumed_at: EPOCH + index * 60,
                updated_at: EPOCH + index * 60 + 1,
            })
            .collect()
    }

    #[tokio::test]
    async fn daily_log_synthetic_envelope_budget() {
        const BASELINE_SHA: &str = "a7a8d448b5a64abb9dd22a74686b385e1a742b3e";
        const BASELINE_DEFAULT_BYTES: usize = 48_233;
        const BASELINE_OPT_IN_BYTES: usize = 48_233;
        const BUDGET_MAX_BYTES: usize = BASELINE_DEFAULT_BYTES * 60 / 100;

        let consumptions = budget_consumptions();
        let daily_output = validator(&daily_output_schema(), true);
        let mut measured = [0usize; 2];
        for (slot, include_extended) in [(0, false), (1, true)] {
            let date = BUDGET_DATE;
            let (items, totals) = daily_nutrition_output(&consumptions, include_extended).unwrap();
            let summary = daily_log_summary(date, &totals);
            let payload = json!({
                "date": date,
                "timezone": TIMEZONE,
                "items": items,
                "totals": totals
            });
            let response = tool_success("bal-063-budget", &summary, payload, None);
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            measured[slot] = body.len();

            let parsed: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(parsed["id"], "bal-063-budget");
            let structured = &parsed["result"]["structuredContent"];
            assert_valid(&daily_output, structured);
            assert_eq!(structured["items"].as_array().unwrap().len(), 17);
            assert!(structured["totals"].get("extendedNutrition").is_none());
            assert_eq!(
                structured["totals"]["completeness"],
                json!({
                    "itemCount": 17,
                    "fiber": {"knownItems": 17, "status": "complete"},
                    "sodiumMg": {"knownItems": 17, "status": "complete"},
                    "cholesterolMg": {"knownItems": 17, "status": "complete"}
                })
            );
            for item in structured["items"].as_array().unwrap() {
                if include_extended {
                    let extended = item["nutrition"]["extendedNutrition"].as_object().unwrap();
                    assert_eq!(extended.len(), BUDGET_KEYS.len());
                } else {
                    assert!(item["nutrition"].get("extendedNutrition").is_none());
                }
            }
        }

        let [final_default_bytes, final_opt_in_bytes] = measured;
        let ratio = final_default_bytes as f64 / BASELINE_DEFAULT_BYTES as f64;
        println!(
            "BAL-063 budget baseline_sha={BASELINE_SHA} baseline_default={BASELINE_DEFAULT_BYTES} \
             baseline_full={BASELINE_OPT_IN_BYTES} final_default={final_default_bytes} \
             final_opt_in={final_opt_in_bytes} budget_60pct={BUDGET_MAX_BYTES} ratio={ratio:.4}"
        );
        assert!(
            final_default_bytes < final_opt_in_bytes,
            "expected compact default ({final_default_bytes}) < opt-in ({final_opt_in_bytes})"
        );
        assert!(
            final_default_bytes <= BUDGET_MAX_BYTES,
            "expected compact default ({final_default_bytes}) <= 60% budget ({BUDGET_MAX_BYTES})"
        );
    }

    #[test]
    fn read_nutrition_projection_rounds_bulk_and_micro_values() {
        use crate::connectors::sync::{MealLogEntry, NutritionSnapshot};

        let mut source = NutritionValues {
            calories: 157.24137931034485,
            protein: 12.3456789,
            carbs: 28.126,
            fat: -0.0,
            fiber: Some(2.3456),
            sodium_mg: Some(0.00000049),
            cholesterol_mg: Some(10.1234567),
            extended_nutrition: [
                ("ironMg".to_string(), 0.00000049),
                ("vitaminB12Mcg".to_string(), 0.00000012),
                ("alcoholG".to_string(), 0.00000033),
                ("calciumMg".to_string(), 12.1234567),
                ("folateMcg".to_string(), 0.0),
                ("zincMg".to_string(), -0.0),
                ("potassiumMg".to_string(), 1e308),
            ]
            .into_iter()
            .collect(),
        };
        let original_source = source.clone();

        let compact = read_nutrition_output(&source, false);
        assert_eq!(source, original_source);
        assert_eq!(compact.calories, 157.24);
        assert_eq!(compact.protein, 12.35);
        assert_eq!(compact.carbs, 28.13);
        assert_eq!(compact.fat, 0.0);
        assert!(compact.fat.is_sign_positive());
        assert_eq!(compact.fiber, Some(2.35));
        assert_eq!(compact.sodium_mg, Some(0.00000049));
        assert_eq!(compact.cholesterol_mg, Some(10.123457));
        assert!(compact.extended_nutrition.is_empty());
        let compact_json = serde_json::to_value(&compact).unwrap();
        assert_eq!(compact_json["calories"], json!(157.24));
        assert!(compact_json.get("extendedNutrition").is_none());

        let opt_in = read_nutrition_output(&source, true);
        assert_eq!(opt_in.calories, 157.24);
        assert_eq!(opt_in.extended_nutrition.get("ironMg"), Some(&0.00000049));
        assert_eq!(
            opt_in.extended_nutrition.get("vitaminB12Mcg"),
            Some(&0.00000012)
        );
        assert_eq!(opt_in.extended_nutrition.get("alcoholG"), Some(&0.00000033));
        assert_eq!(opt_in.extended_nutrition.get("calciumMg"), Some(&12.123457));
        assert_eq!(opt_in.extended_nutrition.get("folateMcg"), Some(&0.0));
        let zinc = *opt_in.extended_nutrition.get("zincMg").unwrap();
        assert_eq!(zinc, 0.0);
        assert!(zinc.is_sign_positive());
        assert_eq!(opt_in.extended_nutrition.get("potassiumMg"), Some(&1e308));
        assert!(
            opt_in
                .extended_nutrition
                .keys()
                .all(|key| EXTENDED_NUTRIENT_KEYS.contains(&key.as_str()))
        );

        // Finite decimal-scaling overflow on bulk and micro values returns the original value.
        source.calories = 1e308;
        source.sodium_mg = Some(1e308);
        let overflow_safe = read_nutrition_output(&source, false);
        assert_eq!(overflow_safe.calories, 1e308);
        assert_eq!(overflow_safe.sodium_mg, Some(1e308));

        // Totals round after aggregating full-precision scaled values (1.234 + 1.234 = 2.468 -> 2.47).
        let make_consumption = |index: u128, fiber: Option<f64>| Consumption {
            id: Uuid::from_u128(index),
            template_id: None,
            name: format!("Item {index}"),
            snapshot: NutritionSnapshot {
                schema_version: FOOD_SCHEMA_VERSION,
                canonical_unit: CanonicalUnit::G,
                nutrition_per100: NutritionValues {
                    calories: 1.234,
                    protein: 1.234,
                    carbs: 1.234,
                    fat: 1.234,
                    fiber,
                    sodium_mg: Some(0.0000004),
                    cholesterol_mg: Some(0.0),
                    extended_nutrition: [("ironMg".to_string(), 0.0000004)].into_iter().collect(),
                },
                brand: None,
            },
            canonical_quantity: 100.0,
            entry: MealLogEntry {
                entered_quantity: 100.0,
                portion_snapshot: None,
            },
            consumed_at: 1,
            updated_at: 1,
        };
        let pair = [
            make_consumption(1, Some(1.234)),
            make_consumption(2, Some(1.234)),
        ];
        for include_extended in [false, true] {
            let (items, totals) = daily_nutrition_output(&pair, include_extended).unwrap();
            assert_eq!(pair[0].scaled_nutrition().calories, 1.234);
            for item in &items {
                assert_eq!(item["nutrition"]["calories"], json!(1.23));
                assert_eq!(item["nutrition"]["protein"], json!(1.23));
                assert_eq!(item["nutrition"]["carbs"], json!(1.23));
                assert_eq!(item["nutrition"]["fat"], json!(1.23));
                assert_eq!(item["nutrition"]["fiber"], json!(1.23));
                assert_eq!(item["nutrition"]["sodiumMg"], json!(0.0000004));
                assert_eq!(item["nutrition"]["cholesterolMg"], json!(0.0));
                if include_extended {
                    assert_eq!(
                        item["nutrition"]["extendedNutrition"]["ironMg"],
                        json!(0.0000004)
                    );
                } else {
                    assert!(item["nutrition"].get("extendedNutrition").is_none());
                }
            }
            assert_eq!(totals.calories, 2.47);
            assert_eq!(totals.protein, 2.47);
            assert_eq!(totals.carbs, 2.47);
            assert_eq!(totals.fat, 2.47);
            assert_eq!(totals.fiber, Some(2.47));
            assert_eq!(totals.sodium_mg, Some(0.000001));
            assert_eq!(totals.cholesterol_mg, Some(0.0));
            assert_eq!(
                totals.completeness,
                DailyTotalsCompleteness {
                    item_count: 2,
                    fiber: NutrientCompleteness {
                        known_items: 2,
                        status: NutrientCompletenessStatus::Complete,
                    },
                    sodium_mg: NutrientCompleteness {
                        known_items: 2,
                        status: NutrientCompletenessStatus::Complete,
                    },
                    cholesterol_mg: NutrientCompleteness {
                        known_items: 2,
                        status: NutrientCompletenessStatus::Complete,
                    },
                }
            );
            assert!(
                serde_json::to_value(&totals)
                    .unwrap()
                    .get("extendedNutrition")
                    .is_none()
            );
        }

        // Mixed known and missing fiber reports the known subtotal as partial; explicit zero fiber is preserved; empty day is complete with all zeros.
        let mixed = [make_consumption(1, Some(1.234)), make_consumption(2, None)];
        let (_, mixed_totals) = daily_nutrition_output(&mixed, false).unwrap();
        assert_eq!(mixed_totals.fiber, Some(1.23));
        assert_eq!(
            mixed_totals.completeness.fiber,
            NutrientCompleteness {
                known_items: 1,
                status: NutrientCompletenessStatus::Partial,
            }
        );
        let zero_fiber = [make_consumption(1, Some(0.0))];
        let (zero_items, zero_totals) = daily_nutrition_output(&zero_fiber, false).unwrap();
        assert_eq!(zero_items[0]["nutrition"]["fiber"], json!(0.0));
        assert_eq!(zero_totals.fiber, Some(0.0));
        assert_eq!(
            zero_totals.completeness.fiber,
            NutrientCompleteness {
                known_items: 1,
                status: NutrientCompletenessStatus::Complete,
            }
        );
        let (empty_items, empty_totals) = daily_nutrition_output(&[], true).unwrap();
        assert!(empty_items.is_empty());
        assert_eq!(empty_totals, empty_daily_totals());
    }

    #[test]
    fn daily_nutrition_completeness_matrix_and_16_of_17() {
        use crate::connectors::sync::{MealLogEntry, NutritionSnapshot};

        let make_item = |index: u128,
                         fiber: Option<f64>,
                         sodium_mg: Option<f64>,
                         cholesterol_mg: Option<f64>| Consumption {
            id: Uuid::from_u128(index),
            template_id: None,
            name: format!("Completeness Item {index}"),
            snapshot: NutritionSnapshot {
                schema_version: FOOD_SCHEMA_VERSION,
                canonical_unit: CanonicalUnit::G,
                nutrition_per100: NutritionValues {
                    calories: 50.0,
                    protein: 5.0,
                    carbs: 10.0,
                    fat: 2.0,
                    fiber,
                    sodium_mg,
                    cholesterol_mg,
                    extended_nutrition: [("ironMg".to_string(), 1.5)].into_iter().collect(),
                },
                brand: None,
            },
            canonical_quantity: 100.0,
            entry: MealLogEntry {
                entered_quantity: 100.0,
                portion_snapshot: None,
            },
            consumed_at: index as i64,
            updated_at: index as i64,
        };
        let totals_validator = validator(&daily_totals_schema(), true);
        let output_validator = validator(&daily_output_schema(), true);
        let check_valid = |items: &[Value], totals: &DailyTotals| {
            let totals_json = serde_json::to_value(totals).unwrap();
            assert_valid(&totals_validator, &totals_json);
            assert!(totals_json.get("extendedNutrition").is_none());
            assert_valid(
                &output_validator,
                &json!({
                    "date": "2025-01-02",
                    "timezone": TIMEZONE,
                    "items": items,
                    "totals": totals_json
                }),
            );
        };

        // 1. Complete (2 + 3 -> 5)
        let complete_items = [
            make_item(1, Some(2.0), Some(100.0), Some(15.0)),
            make_item(2, Some(3.0), Some(250.0), Some(25.0)),
        ];
        let (items, totals) = daily_nutrition_output(&complete_items, false).unwrap();
        check_valid(&items, &totals);
        assert_eq!(totals.fiber, Some(5.0));
        assert_eq!(totals.sodium_mg, Some(350.0));
        assert_eq!(totals.cholesterol_mg, Some(40.0));
        assert_eq!(
            totals.completeness,
            DailyTotalsCompleteness {
                item_count: 2,
                fiber: NutrientCompleteness {
                    known_items: 2,
                    status: NutrientCompletenessStatus::Complete,
                },
                sodium_mg: NutrientCompleteness {
                    known_items: 2,
                    status: NutrientCompletenessStatus::Complete,
                },
                cholesterol_mg: NutrientCompleteness {
                    known_items: 2,
                    status: NutrientCompletenessStatus::Complete,
                },
            }
        );
        assert_eq!(
            daily_log_summary("2025-01-02", &totals),
            "Hay 2 consumos registrados para 2025-01-02."
        );

        // 2. Partial (2 + None -> 2)
        let partial_items = [
            make_item(1, Some(2.0), Some(10.0), Some(5.0)),
            make_item(2, None, None, None),
        ];
        let (items, totals) = daily_nutrition_output(&partial_items, false).unwrap();
        check_valid(&items, &totals);
        assert_eq!(totals.fiber, Some(2.0));
        assert_eq!(totals.sodium_mg, Some(10.0));
        assert_eq!(totals.cholesterol_mg, Some(5.0));
        assert_eq!(
            totals.completeness,
            DailyTotalsCompleteness {
                item_count: 2,
                fiber: NutrientCompleteness {
                    known_items: 1,
                    status: NutrientCompletenessStatus::Partial,
                },
                sodium_mg: NutrientCompleteness {
                    known_items: 1,
                    status: NutrientCompletenessStatus::Partial,
                },
                cholesterol_mg: NutrientCompleteness {
                    known_items: 1,
                    status: NutrientCompletenessStatus::Partial,
                },
            }
        );

        // 3. 16-of-17 partial fiber day
        let mut seventeen: Vec<Consumption> = (1..=16)
            .map(|i| make_item(i, Some(1.5), Some(10.0), Some(2.0)))
            .collect();
        seventeen.push(make_item(17, None, Some(10.0), Some(2.0)));
        let (items, totals) = daily_nutrition_output(&seventeen, true).unwrap();
        check_valid(&items, &totals);
        assert_eq!(totals.fiber, Some(24.0));
        assert_eq!(totals.sodium_mg, Some(170.0));
        assert_eq!(totals.cholesterol_mg, Some(34.0));
        assert_eq!(
            totals.completeness,
            DailyTotalsCompleteness {
                item_count: 17,
                fiber: NutrientCompleteness {
                    known_items: 16,
                    status: NutrientCompletenessStatus::Partial,
                },
                sodium_mg: NutrientCompleteness {
                    known_items: 17,
                    status: NutrientCompletenessStatus::Complete,
                },
                cholesterol_mg: NutrientCompleteness {
                    known_items: 17,
                    status: NutrientCompletenessStatus::Complete,
                },
            }
        );
        let summary_16_17 = daily_log_summary("2025-01-02", &totals);
        assert!(summary_16_17.contains("Hay 17 consumos registrados para 2025-01-02."));
        assert!(summary_16_17.contains("fibra (16/17)"));
        assert!(!summary_16_17.contains("sodio"));
        assert!(!summary_16_17.contains("colesterol"));

        // 4. All-unknown nonempty day omits numeric keys
        let unknown_items = [
            make_item(1, None, None, None),
            make_item(2, None, None, None),
        ];
        let (items, totals) = daily_nutrition_output(&unknown_items, false).unwrap();
        check_valid(&items, &totals);
        assert_eq!(totals.fiber, None);
        assert_eq!(totals.sodium_mg, None);
        assert_eq!(totals.cholesterol_mg, None);
        let unknown_json = serde_json::to_value(&totals).unwrap();
        assert!(unknown_json.get("fiber").is_none());
        assert!(unknown_json.get("sodiumMg").is_none());
        assert!(unknown_json.get("cholesterolMg").is_none());
        assert_eq!(
            totals.completeness,
            DailyTotalsCompleteness {
                item_count: 2,
                fiber: NutrientCompleteness {
                    known_items: 0,
                    status: NutrientCompletenessStatus::Unknown,
                },
                sodium_mg: NutrientCompleteness {
                    known_items: 0,
                    status: NutrientCompletenessStatus::Unknown,
                },
                cholesterol_mg: NutrientCompleteness {
                    known_items: 0,
                    status: NutrientCompletenessStatus::Unknown,
                },
            }
        );
        let unknown_summary = daily_log_summary("2025-01-02", &totals);
        assert!(unknown_summary.contains("Sin datos disponibles para: fibra, sodio, colesterol."));

        // 5. Explicit zero alone (complete) and paired with None (partial)
        let zero_alone = [make_item(1, Some(0.0), Some(0.0), Some(0.0))];
        let (items, totals) = daily_nutrition_output(&zero_alone, false).unwrap();
        check_valid(&items, &totals);
        assert_eq!(totals.fiber, Some(0.0));
        assert_eq!(totals.sodium_mg, Some(0.0));
        assert_eq!(totals.cholesterol_mg, Some(0.0));
        assert_eq!(
            totals.completeness.fiber.status,
            NutrientCompletenessStatus::Complete
        );
        assert_eq!(
            totals.completeness.sodium_mg.status,
            NutrientCompletenessStatus::Complete
        );
        assert_eq!(
            totals.completeness.cholesterol_mg.status,
            NutrientCompletenessStatus::Complete
        );

        let zero_and_missing = [
            make_item(1, Some(0.0), Some(0.0), Some(0.0)),
            make_item(2, None, None, None),
        ];
        let (items, totals) = daily_nutrition_output(&zero_and_missing, false).unwrap();
        check_valid(&items, &totals);
        assert_eq!(totals.fiber, Some(0.0));
        assert_eq!(totals.sodium_mg, Some(0.0));
        assert_eq!(totals.cholesterol_mg, Some(0.0));
        assert_eq!(totals.completeness.fiber.known_items, 1);
        assert_eq!(
            totals.completeness.fiber.status,
            NutrientCompletenessStatus::Partial
        );
        assert_eq!(totals.completeness.sodium_mg.known_items, 1);
        assert_eq!(
            totals.completeness.sodium_mg.status,
            NutrientCompletenessStatus::Partial
        );
        assert_eq!(totals.completeness.cholesterol_mg.known_items, 1);
        assert_eq!(
            totals.completeness.cholesterol_mg.status,
            NutrientCompletenessStatus::Partial
        );

        // 6. Empty day (0/0 complete with 0.0 for all 7 nutrients)
        let (items, totals) = daily_nutrition_output(&[], false).unwrap();
        check_valid(&items, &totals);
        assert!(items.is_empty());
        assert_eq!(totals, empty_daily_totals());
        assert_eq!(
            serde_json::to_value(&totals).unwrap(),
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0,
                "fiber": 0.0,
                "sodiumMg": 0.0,
                "cholesterolMg": 0.0,
                "completeness": {
                    "itemCount": 0,
                    "fiber": {"knownItems": 0, "status": "complete"},
                    "sodiumMg": {"knownItems": 0, "status": "complete"},
                    "cholesterolMg": {"knownItems": 0, "status": "complete"}
                }
            })
        );
        assert_eq!(
            daily_log_summary("2025-01-02", &totals),
            "Hay 0 consumos registrados para 2025-01-02."
        );

        // 7. Independent per-nutrient coverage (complete fiber, partial sodium, unknown cholesterol)
        let independent = [
            make_item(1, Some(1.234), Some(0.0000004), None),
            make_item(2, Some(1.234), None, None),
        ];
        let (items, totals) = daily_nutrition_output(&independent, false).unwrap();
        check_valid(&items, &totals);
        assert_eq!(totals.fiber, Some(2.47));
        assert_eq!(totals.sodium_mg, Some(0.0000004));
        assert_eq!(totals.cholesterol_mg, None);
        assert_eq!(
            totals.completeness,
            DailyTotalsCompleteness {
                item_count: 2,
                fiber: NutrientCompleteness {
                    known_items: 2,
                    status: NutrientCompletenessStatus::Complete,
                },
                sodium_mg: NutrientCompleteness {
                    known_items: 1,
                    status: NutrientCompletenessStatus::Partial,
                },
                cholesterol_mg: NutrientCompleteness {
                    known_items: 0,
                    status: NutrientCompletenessStatus::Unknown,
                },
            }
        );
        let independent_summary = daily_log_summary("2025-01-02", &totals);
        assert!(
            independent_summary
                .contains("Totales parciales (solo consumos con dato): sodio (1/2).")
        );
        assert!(independent_summary.contains("Sin datos disponibles para: colesterol."));
        assert!(!independent_summary.contains("fibra"));

        // 8. Partial-day overflow for fiber, sodiumMg, and cholesterolMg returns NUTRITION_RENDER_ERROR
        for (name, items) in [
            (
                "fiber",
                [
                    make_item(1, Some(1e308), None, None),
                    make_item(2, Some(1e308), None, None),
                    make_item(3, None, None, None),
                ],
            ),
            (
                "sodiumMg",
                [
                    make_item(1, None, Some(1e308), None),
                    make_item(2, None, Some(1e308), None),
                    make_item(3, None, None, None),
                ],
            ),
            (
                "cholesterolMg",
                [
                    make_item(1, None, None, Some(1e308)),
                    make_item(2, None, None, Some(1e308)),
                    make_item(3, None, None, None),
                ],
            ),
        ] {
            let err = daily_nutrition_output(&items, false).unwrap_err();
            assert!(
                matches!(err, AppError::Internal(ref message) if message == NUTRITION_RENDER_ERROR),
                "expected NUTRITION_RENDER_ERROR for partial {name} overflow, got {err:?}"
            );
        }
    }

    #[tokio::test]
    async fn mcp_observer_classifies_production_daily_log_responses() {
        use std::io;
        use tracing::instrument::WithSubscriber;

        #[derive(Clone, Default)]
        struct LogCapture(Arc<Mutex<Vec<u8>>>);

        struct LogWriter(Arc<Mutex<Vec<u8>>>);

        impl io::Write for LogWriter {
            fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(buf);
                Ok(buf.len())
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogCapture {
            type Writer = LogWriter;

            fn make_writer(&'a self) -> Self::Writer {
                LogWriter(self.0.clone())
            }
        }

        async fn synthetic_daily_endpoint(
            observation: Option<Extension<observation::Observation>>,
            Json(payload): Json<Value>,
        ) -> Response {
            let observation = observation.as_ref().map(|Extension(value)| value);
            if let Some(observation) = observation {
                observation.request("tools/call", Some("get_daily_log"));
            }
            let consumptions = budget_consumptions();
            let (slice, include_extended) = match payload["mode"].as_str().unwrap() {
                "small" => (&consumptions[..1], false),
                _ => (&consumptions[..], true),
            };
            let (items, totals) = daily_nutrition_output(slice, include_extended).unwrap();
            let summary = format!(
                "Hay {} consumos registrados para {BUDGET_DATE}.",
                items.len()
            );
            let body = json!({
                "date": BUDGET_DATE,
                "timezone": TIMEZONE,
                "items": items,
                "totals": totals
            });
            tool_success("bal-063-observer", &summary, body, observation)
        }

        let capture = LogCapture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(observation::logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();

        async {
            let router = observation::observe_routes(
                Router::new().route("/mcp", post(synthetic_daily_endpoint)),
            );
            for (mode, expected) in [
                ("small", "first_text_json=\"matches\""),
                ("over_budget", "first_text_json=\"not_checked\""),
            ] {
                let response = router
                    .clone()
                    .oneshot(rpc_request(json!({"mode": mode}).to_string()))
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                let _ = to_bytes(response.into_body(), usize::MAX).await.unwrap();
                let logs = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
                assert!(
                    logs.lines().any(|line| {
                        line.contains("event=\"tool_result_prepared\"")
                            && line.contains("tool=\"get_daily_log\"")
                            && line.contains("http_status=200")
                            && line.contains(expected)
                    }),
                    "missing {expected} for mode={mode} in:\n{logs}"
                );
            }
        }
        .with_subscriber(subscriber)
        .await;
    }

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
        let nutrition = NutritionValues {
            calories: 100.0,
            protein: 0.0,
            carbs: 0.0,
            fat: 0.0,
            fiber: None,
            sodium_mg: Some(0.0),
            cholesterol_mg: Some(10.0),
            extended_nutrition: [("ironMg".into(), 2.0)].into_iter().collect(),
        };
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
        let daily_desc = daily_tool["description"].as_str().unwrap();
        assert!(daily_desc.contains("includeExtendedNutrition"));
        assert!(daily_desc.contains("America/Santiago"));
        assert!(daily_desc.contains("totals nunca incluye extendedNutrition"));
        assert!(daily_desc.contains("totals.completeness"));
        assert!(daily_desc.contains("partial"));
        assert!(daily_desc.contains("unknown"));
        assert!(daily_desc.contains("complete"));
        assert_eq!(
            daily_tool["inputSchema"]["properties"]["includeExtendedNutrition"],
            json!({"type": "boolean", "default": false})
        );
        assert!(daily_tool["inputSchema"].get("required").is_none());
        let daily_input = validator(&daily_tool["inputSchema"], true);
        for args in [
            json!({}),
            json!({"date": null}),
            json!({"includeExtendedNutrition": false}),
            json!({"includeExtendedNutrition": true}),
            json!({"date": "2025-01-02", "includeExtendedNutrition": true}),
        ] {
            assert_valid(&daily_input, &args);
        }
        for invalid in [
            json!({"includeExtendedNutrition": "true"}),
            json!({"includeExtendedNutrition": "false"}),
            json!({"includeExtendedNutrition": 1}),
            json!({"includeExtendedNutrition": 0}),
            json!({"includeExtendedNutrition": null}),
        ] {
            assert!(!daily_input.is_valid(&invalid), "{invalid}");
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
            let output = json!({"date": date, "timezone": TIMEZONE, "items": [], "totals": empty_daily_totals()});
            assert_eq!(daily_output.is_valid(&output), valid, "{output}");
        }
        for invalid_totals in [
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0
            }),
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0,
                "extendedNutrition": {"ironMg": 1.0},
                "completeness": empty_daily_totals().completeness
            }),
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0,
                "fiber": null,
                "completeness": empty_daily_totals().completeness
            }),
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0,
                "completeness": {
                    "itemCount": -1,
                    "fiber": {"knownItems": 0, "status": "complete"},
                    "sodiumMg": {"knownItems": 0, "status": "complete"},
                    "cholesterolMg": {"knownItems": 0, "status": "complete"}
                }
            }),
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0,
                "completeness": {
                    "itemCount": 1,
                    "fiber": {"knownItems": 1, "status": "incomplete"},
                    "sodiumMg": {"knownItems": 0, "status": "unknown"},
                    "cholesterolMg": {"knownItems": 0, "status": "unknown"}
                }
            }),
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0,
                "completeness": {
                    "itemCount": 1,
                    "fiber": {"knownItems": -1, "status": "partial"},
                    "sodiumMg": {"knownItems": 0, "status": "unknown"},
                    "cholesterolMg": {"knownItems": 0, "status": "unknown"}
                }
            }),
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0,
                "completeness": {
                    "itemCount": 0,
                    "fiber": {"knownItems": 0, "status": "complete"},
                    "sodiumMg": {"knownItems": 0, "status": "complete"}
                }
            }),
            json!({
                "calories": 0.0,
                "protein": 0.0,
                "carbs": 0.0,
                "fat": 0.0,
                "completeness": {
                    "itemCount": 0,
                    "fiber": {"knownItems": 0, "status": "complete", "extra": true},
                    "sodiumMg": {"knownItems": 0, "status": "complete"},
                    "cholesterolMg": {"knownItems": 0, "status": "complete"}
                }
            }),
        ] {
            let invalid_day = json!({
                "date": "2025-01-02",
                "timezone": TIMEZONE,
                "items": [],
                "totals": invalid_totals
            });
            assert!(!daily_output.is_valid(&invalid_day), "{invalid_day}");
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
        assert!(
            search_tool["description"]
                .as_str()
                .unwrap()
                .contains("includeExtendedNutrition")
        );
        assert!(
            search_tool["description"]
                .as_str()
                .unwrap()
                .contains("hasMore")
        );
        assert_eq!(
            search_tool["annotations"],
            json!({
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            })
        );
        let search_input = &search_tool["inputSchema"];
        assert_eq!(search_input["properties"]["source"]["default"], "all");
        assert_eq!(search_input["properties"]["limit"]["default"], 10);
        assert_eq!(
            search_input["properties"]["includeExtendedNutrition"],
            json!({"type": "boolean", "default": false})
        );
        assert_eq!(search_input["required"], json!(["query"]));
        let search_input = validator(search_input, true);
        for source in ["all", "personal", "official"] {
            assert_valid(
                &search_input,
                &json!({"query": "x", "source": source, "limit": 1}),
            );
        }
        for flag in [false, true] {
            assert_valid(
                &search_input,
                &json!({"query": "x", "includeExtendedNutrition": flag}),
            );
        }
        assert_valid(
            &search_input,
            &json!({"query": "á".repeat(120), "limit": 20}),
        );
        for invalid in [
            json!({}),
            json!({"query": ""}),
            json!({"query": "á".repeat(121)}),
            json!({"query": "x", "source": "other"}),
            json!({"query": "x", "limit": 0}),
            json!({"query": "x", "limit": 21}),
            json!({"query": "x", "category": "fruit"}),
            json!({"query": "x", "includeExtendedNutrition": "true"}),
            json!({"query": "x", "includeExtendedNutrition": 1}),
            json!({"query": "x", "includeExtendedNutrition": null}),
        ] {
            assert!(!search_input.is_valid(&invalid), "{invalid}");
        }
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
        assert_valid(&search_output, &json!({"foods": [food], "hasMore": true}));
        assert_valid(&search_output, &json!({"foods": [], "hasMore": false}));
        for invalid in [
            json!({"foods": []}),
            json!({"foods": [], "hasMore": "false"}),
            json!({"foods": [], "hasMore": false, "total": 0}),
        ] {
            assert!(!search_output.is_valid(&invalid), "{invalid}");
        }
        assert_valid(
            &create_output,
            &json!({"status": "alreadyCreated", "food": food}),
        );
        assert_valid(&log_output, &json!({"status": "logged", "log": log}));
        assert_valid(&update_output, &json!({"status": "updated", "log": log}));
        for include_extended in [false, true] {
            let (items, totals) =
                daily_nutrition_output(std::slice::from_ref(&consumption), include_extended)
                    .unwrap();
            let day = json!({
                "date": "2025-01-02",
                "timezone": TIMEZONE,
                "items": items,
                "totals": totals
            });
            assert_valid(&daily_output, &day);
            assert!(day["totals"].get("fiber").is_none());
            assert!(day["totals"].get("extendedNutrition").is_none());
            assert_eq!(day["totals"]["sodiumMg"], 0.0);
            assert_eq!(day["totals"]["cholesterolMg"], 3.0);
            assert_eq!(
                day["totals"]["completeness"],
                json!({
                    "itemCount": 1,
                    "fiber": {"knownItems": 0, "status": "unknown"},
                    "sodiumMg": {"knownItems": 1, "status": "complete"},
                    "cholesterolMg": {"knownItems": 1, "status": "complete"}
                })
            );
            if include_extended {
                assert_eq!(
                    day["items"][0]["nutrition"]["extendedNutrition"]["ironMg"],
                    0.6
                );
            } else {
                assert!(
                    day["items"][0]["nutrition"]
                        .get("extendedNutrition")
                        .is_none()
                );
            }
        }

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
        for include_extended in [false, true] {
            assert!(
                daily_nutrition_output(std::slice::from_ref(&consumption), include_extended)
                    .is_err()
            );
        }
        consumption
            .snapshot
            .nutrition_per100
            .extended_nutrition
            .clear();
        consumption.canonical_quantity = 100.0;
        let base_nutrition = NutritionValues {
            calories: 0.0,
            protein: 0.0,
            carbs: 0.0,
            fat: 0.0,
            fiber: None,
            sodium_mg: None,
            cholesterol_mg: None,
            extended_nutrition: Default::default(),
        };
        let mut unknown_consumption = consumption.clone();
        unknown_consumption.snapshot.nutrition_per100 = base_nutrition.clone();
        for nutrient in ["calories", "fiber", "sodiumMg", "cholesterolMg"] {
            let mut nutrition = json!(base_nutrition);
            nutrition[nutrient] = json!(1e308);
            consumption.snapshot.nutrition_per100 = serde_json::from_value(nutrition).unwrap();
            assert_valid(
                &log_output,
                &json!({"status": "logged", "log": consumption_output(&consumption).unwrap()}),
            );
            for include_extended in [false, true] {
                assert!(
                    daily_nutrition_output(
                        &[consumption.clone(), consumption.clone()],
                        include_extended
                    )
                    .is_err(),
                    "{nutrient}"
                );
                if nutrient != "calories" {
                    assert!(
                        daily_nutrition_output(
                            &[
                                consumption.clone(),
                                consumption.clone(),
                                unknown_consumption.clone()
                            ],
                            include_extended
                        )
                        .is_err(),
                        "partial {nutrient}"
                    );
                }
            }
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
        fn new(db: Database, user_id: i32) -> Self {
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
            Self {
                db: Arc::new(db),
                hub: SyncHub::default(),
                user_id,
                input: compile("inputSchema"),
                output: compile("outputSchema"),
            }
        }

        async fn call(&self, name: &str, args: Value) -> Value {
            dispatch(&self.db, &self.hub, self.user_id, name, args).await
        }

        async fn success(&self, name: &str, args: Value) -> Value {
            self.success_with_summary(name, args).await.0
        }

        async fn success_with_summary(&self, name: &str, args: Value) -> (Value, String) {
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
            let summary = text
                .strip_suffix(embedded)
                .unwrap()
                .strip_suffix("\n\n")
                .unwrap();
            assert!(!summary.trim().is_empty());
            assert_eq!(
                serde_json::from_str::<Value>(embedded).unwrap(),
                *structured
            );
            (structured.clone(), summary.to_owned())
        }

        async fn seed_food(&self, id: Uuid, name: &str, details: &FoodDetails) {
            let CreatePersonalFoodOutcome::Created(food) = self
                .db
                .sync
                .create_personal_food(self.user_id, id, name, details)
                .await
                .unwrap()
            else {
                panic!("expected created seeded food");
            };
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

        let fixture = ContractFixture::new(db, user.id);
        assert_authenticated_rejections_are_inert(&fixture, oidc, subject).await;
        dispatch_weight_contract(&fixture).await;
        dispatch_food_contract(&fixture).await;
        dispatch_daily_completeness_contract(&fixture).await;
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
        let mut legacy_collision = create_args(iron_id);
        legacy_collision["name"] = json!(iron_name);
        let collision_result = fixture.call("create_food", legacy_collision).await;
        assert_tool_error(&collision_result, "conflict");
        let collision_message = collision_result["structuredContent"]["error"]["message"]
            .as_str()
            .unwrap();
        assert!(!collision_message.contains(&iron_name));
        assert!(!collision_message.contains("ironMg"));
        for (id, query) in [(iron_id, iron_name), (oversized_id, oversized_name)] {
            let search_default = fixture
                .success(
                    "search_foods",
                    json!({"query": query, "source": "personal"}),
                )
                .await;
            let search_false = fixture
                .success(
                    "search_foods",
                    json!({"query": query, "source": "personal", "includeExtendedNutrition": false}),
                )
                .await;
            assert_eq!(search_default, search_false);
            assert_eq!(search_default["foods"].as_array().unwrap().len(), 1);
            assert_eq!(search_default["foods"][0]["id"], json!(id));
            assert!(
                search_default["foods"][0]["details"]["nutritionPer100"]
                    .get("extendedNutrition")
                    .is_none()
            );
            assert!(
                search_default["foods"][0]["details"]["nutritionPer100"]
                    .get("fiber")
                    .is_none()
            );

            let search_opt_in = fixture
                .success(
                    "search_foods",
                    json!({"query": query, "source": "personal", "includeExtendedNutrition": true}),
                )
                .await;
            assert_eq!(search_opt_in["foods"].as_array().unwrap().len(), 1);
            assert_eq!(search_opt_in["foods"][0]["id"], json!(id));
            assert_eq!(
                search_opt_in["foods"][0]["details"]["nutritionPer100"]["extendedNutrition"]["ironMg"],
                2.0
            );
        }
        let missing_query = Uuid::new_v4().to_string();
        for args in [
            json!({"query": missing_query, "source": "personal"}),
            json!({"query": missing_query, "source": "personal", "includeExtendedNutrition": false}),
            json!({"query": missing_query, "source": "personal", "includeExtendedNutrition": true}),
        ] {
            let search = fixture.success("search_foods", args).await;
            assert_eq!(search, json!({"foods": [], "hasMore": false}));
        }
        for invalid in [json!("true"), json!(1), Value::Null] {
            let result = fixture
                .call(
                    "search_foods",
                    json!({"query": "Iron", "includeExtendedNutrition": invalid}),
                )
                .await;
            assert_tool_error(&result, "invalid_arguments");
            let result = fixture
                .call(
                    "get_daily_log",
                    json!({"date": DAY, "includeExtendedNutrition": invalid}),
                )
                .await;
            assert_tool_error(&result, "invalid_arguments");
        }

        for date in [DAY, "0001-01-02", "9999-01-02"] {
            for args in [
                json!({"date": date}),
                json!({"date": date, "includeExtendedNutrition": false}),
                json!({"date": date, "includeExtendedNutrition": true}),
            ] {
                let empty = fixture.success("get_daily_log", args).await;
                assert_eq!(empty["date"], date);
                assert_eq!(empty["items"], json!([]));
                assert_eq!(empty["totals"], json!(empty_daily_totals()));
                assert!(empty["totals"].get("extendedNutrition").is_none());
            }
        }
        for args in [json!({}), json!({"date": null})] {
            let today = fixture.success("get_daily_log", args).await;
            assert_eq!(today["items"], json!([]));
        }

        let ml_id = dispatch_create_limits(fixture).await;
        // Opt-in search on a food with an empty extendedNutrition map omits extendedNutrition.
        let ml_search = fixture
            .success(
                "search_foods",
                json!({"query": format!("MCP {ml_id}"), "source": "personal", "includeExtendedNutrition": true}),
            )
            .await;
        assert_eq!(ml_search["foods"].as_array().unwrap().len(), 1);
        assert!(
            ml_search["foods"][0]["details"]["nutritionPer100"]
                .get("extendedNutrition")
                .is_none()
        );
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
        let daily_false = fixture
            .success(
                "get_daily_log",
                json!({"date": DAY, "includeExtendedNutrition": false}),
            )
            .await;
        assert_eq!(daily, daily_false);
        let items = daily["items"].as_array().unwrap();
        let tiny = items
            .iter()
            .find(|item| item["id"] == json!(tiny_id))
            .unwrap();
        assert_eq!(tiny["canonicalQuantity"], 0.00000001);
        assert!(tiny["foodId"].is_null());
        for item in items {
            assert!(item["nutrition"].get("extendedNutrition").is_none());
        }
        assert!(daily["totals"].get("extendedNutrition").is_none());
        assert!(daily["totals"].get("fiber").is_none());
        assert_eq!(daily["totals"]["sodiumMg"], 0.0);
        assert_eq!(
            daily["totals"]["completeness"],
            json!({
                "itemCount": 5,
                "fiber": {"knownItems": 0, "status": "unknown"},
                "sodiumMg": {"knownItems": 4, "status": "partial"},
                "cholesterolMg": {"knownItems": 4, "status": "partial"}
            })
        );

        let daily_opt_in = fixture
            .success(
                "get_daily_log",
                json!({"date": DAY, "includeExtendedNutrition": true}),
            )
            .await;
        let opt_in_items = daily_opt_in["items"].as_array().unwrap();
        let scoop = opt_in_items
            .iter()
            .find(|item| item["id"] == json!(scoop_id))
            .unwrap();
        assert_eq!(scoop["nutrition"]["extendedNutrition"]["ironMg"], 1.2);
        let ml_item = opt_in_items
            .iter()
            .find(|item| item["foodId"] == json!(ml_id))
            .unwrap();
        assert!(ml_item["nutrition"].get("extendedNutrition").is_none());
        assert!(daily_opt_in["totals"].get("extendedNutrition").is_none());
        assert!(daily_opt_in["totals"].get("fiber").is_none());
        assert_eq!(daily_opt_in["totals"]["sodiumMg"], 0.0);
        assert_eq!(
            daily_opt_in["totals"]["completeness"],
            daily["totals"]["completeness"]
        );

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

    async fn dispatch_daily_completeness_contract(fixture: &ContractFixture) {
        const PARTIAL_16_17_DAY: &str = "2025-01-07";
        const INDEPENDENT_DAY: &str = "2025-01-08";
        const EMPTY_DAY: &str = "2025-01-09";
        const PARTIAL_OVERFLOW_DAY: &str = "2025-01-10";

        let make_details =
            |fiber: Option<f64>, sodium_mg: Option<f64>, cholesterol_mg: Option<f64>| FoodDetails {
                schema_version: FOOD_SCHEMA_VERSION,
                canonical_unit: CanonicalUnit::G,
                nutrition_per100: NutritionValues {
                    calories: 100.0,
                    protein: 5.0,
                    carbs: 10.0,
                    fat: 2.0,
                    fiber,
                    sodium_mg,
                    cholesterol_mg,
                    extended_nutrition: [("ironMg".into(), 1.25)].into_iter().collect(),
                },
                portions: vec![],
                chilean_seals: vec![],
                brand: None,
                category: None,
                typical_time: None,
            };

        let known_fiber_id = Uuid::new_v4();
        fixture
            .seed_food(
                known_fiber_id,
                &format!("Known Fiber {known_fiber_id}"),
                &make_details(Some(1.5), Some(20.0), Some(5.0)),
            )
            .await;
        let missing_fiber_id = Uuid::new_v4();
        fixture
            .seed_food(
                missing_fiber_id,
                &format!("Missing Fiber {missing_fiber_id}"),
                &make_details(None, Some(20.0), Some(5.0)),
            )
            .await;

        // 16-of-17 partial fiber day
        for _ in 0..16 {
            fixture
                .success(
                    "log_food",
                    log_args(known_fiber_id, 100.0, PARTIAL_16_17_DAY),
                )
                .await;
        }
        fixture
            .success(
                "log_food",
                log_args(missing_fiber_id, 100.0, PARTIAL_16_17_DAY),
            )
            .await;

        let mut events = fixture.hub.subscribe();
        let (partial_day, partial_summary) = fixture
            .success_with_summary("get_daily_log", json!({"date": PARTIAL_16_17_DAY}))
            .await;
        assert_no_invalidation(&mut events);
        assert_eq!(partial_day["items"].as_array().unwrap().len(), 17);
        assert_eq!(partial_day["totals"]["fiber"], json!(24.0));
        assert_eq!(partial_day["totals"]["sodiumMg"], json!(340.0));
        assert_eq!(partial_day["totals"]["cholesterolMg"], json!(85.0));
        assert!(partial_day["totals"].get("extendedNutrition").is_none());
        assert_eq!(
            partial_day["totals"]["completeness"],
            json!({
                "itemCount": 17,
                "fiber": {"knownItems": 16, "status": "partial"},
                "sodiumMg": {"knownItems": 17, "status": "complete"},
                "cholesterolMg": {"knownItems": 17, "status": "complete"}
            })
        );
        assert!(partial_summary.contains(&format!(
            "Hay 17 consumos registrados para {PARTIAL_16_17_DAY}."
        )));
        assert!(
            partial_summary.contains("Totales parciales (solo consumos con dato): fibra (16/17).")
        );
        assert!(!partial_summary.contains("Sin datos disponibles"));

        // Independent nutrient completeness + explicit zero
        let zero_sodium_id = Uuid::new_v4();
        fixture
            .seed_food(
                zero_sodium_id,
                &format!("Zero Sodium {zero_sodium_id}"),
                &make_details(Some(2.0), Some(0.0), None),
            )
            .await;
        let unknown_micro_id = Uuid::new_v4();
        fixture
            .seed_food(
                unknown_micro_id,
                &format!("Unknown Micro {unknown_micro_id}"),
                &make_details(Some(3.0), None, None),
            )
            .await;
        fixture
            .success("log_food", log_args(zero_sodium_id, 100.0, INDEPENDENT_DAY))
            .await;
        fixture
            .success(
                "log_food",
                log_args(unknown_micro_id, 100.0, INDEPENDENT_DAY),
            )
            .await;

        let mut events = fixture.hub.subscribe();
        let (independent_day, independent_summary) = fixture
            .success_with_summary(
                "get_daily_log",
                json!({"date": INDEPENDENT_DAY, "includeExtendedNutrition": true}),
            )
            .await;
        assert_no_invalidation(&mut events);
        assert_eq!(independent_day["totals"]["fiber"], json!(5.0));
        assert_eq!(independent_day["totals"]["sodiumMg"], json!(0.0));
        assert!(independent_day["totals"].get("cholesterolMg").is_none());
        assert!(independent_day["totals"].get("extendedNutrition").is_none());
        assert_eq!(
            independent_day["totals"]["completeness"],
            json!({
                "itemCount": 2,
                "fiber": {"knownItems": 2, "status": "complete"},
                "sodiumMg": {"knownItems": 1, "status": "partial"},
                "cholesterolMg": {"knownItems": 0, "status": "unknown"}
            })
        );
        assert!(
            independent_summary
                .contains("Totales parciales (solo consumos con dato): sodio (1/2).")
        );
        assert!(independent_summary.contains("Sin datos disponibles para: colesterol."));
        assert!(!independent_summary.contains("fibra"));

        // Empty day: 0/0 complete with 0.0 for all 7 nutrients
        let mut events = fixture.hub.subscribe();
        let (empty_day, empty_summary) = fixture
            .success_with_summary("get_daily_log", json!({"date": EMPTY_DAY}))
            .await;
        assert_no_invalidation(&mut events);
        assert_eq!(empty_day["totals"], json!(empty_daily_totals()));
        assert_eq!(
            empty_summary,
            format!("Hay 0 consumos registrados para {EMPTY_DAY}.")
        );

        // Partial-day overflow returns sanitized internal_error and emits no invalidation
        let overflow_fiber_id = Uuid::new_v4();
        fixture
            .seed_food(
                overflow_fiber_id,
                &format!("Overflow Fiber {overflow_fiber_id}"),
                &make_details(Some(1e308), None, None),
            )
            .await;
        for _ in 0..2 {
            fixture
                .success(
                    "log_food",
                    log_args(overflow_fiber_id, 100.0, PARTIAL_OVERFLOW_DAY),
                )
                .await;
        }
        fixture
            .success(
                "log_food",
                log_args(missing_fiber_id, 100.0, PARTIAL_OVERFLOW_DAY),
            )
            .await;
        let mut events = fixture.hub.subscribe();
        let overflow_result = fixture
            .call("get_daily_log", json!({"date": PARTIAL_OVERFLOW_DAY}))
            .await;
        assert_eq!(
            assert_tool_error(&overflow_result, "internal_error"),
            NUTRITION_RENDER_ERROR
        );
        assert_no_invalidation(&mut events);
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
        use crate::connectors::sync::{MealLogEntry, NutritionSnapshot};

        let first = NutritionValues {
            calories: 0.0,
            protein: 0.1,
            carbs: 0.0,
            fat: 12.219999999999,
            fiber: Some(0.0),
            sodium_mg: Some(10.12345678),
            cholesterol_mg: None,
            extended_nutrition: [("ironMg".into(), 0.00000049)].into_iter().collect(),
        };
        let second = NutritionValues {
            calories: 0.0,
            protein: 0.2,
            carbs: 0.0,
            fat: 0.0,
            fiber: Some(0.0),
            sodium_mg: None,
            cholesterol_mg: None,
            extended_nutrition: Default::default(),
        };

        let item = serde_json::to_value(nutrition_output(&first)).unwrap();
        assert_eq!(item["fat"], json!(12.22));
        assert_eq!(item["sodiumMg"], json!(10.123457));
        assert_eq!(item["extendedNutrition"]["ironMg"], json!(0.0));

        let make_consumption = |index: u128, nutrition_per100: NutritionValues| Consumption {
            id: Uuid::from_u128(index),
            template_id: None,
            name: format!("Float Artifact {index}"),
            snapshot: NutritionSnapshot {
                schema_version: FOOD_SCHEMA_VERSION,
                canonical_unit: CanonicalUnit::G,
                nutrition_per100,
                brand: None,
            },
            canonical_quantity: 100.0,
            entry: MealLogEntry {
                entered_quantity: 100.0,
                portion_snapshot: None,
            },
            consumed_at: index as i64,
            updated_at: index as i64,
        };
        let (_, daily_totals) = daily_nutrition_output(
            &[make_consumption(1, first), make_consumption(2, second)],
            false,
        )
        .unwrap();
        let totals = serde_json::to_value(daily_totals).unwrap();
        assert_eq!(totals["protein"], json!(0.3));
        assert_eq!(totals["fiber"], json!(0.0));
        assert_eq!(totals["sodiumMg"], json!(10.123457));
        assert_eq!(
            totals["completeness"]["sodiumMg"],
            json!({"knownItems": 1, "status": "partial"})
        );
    }

    #[test]
    fn optional_fiber_is_preserved_across_mcp_input_output_and_aggregation() {
        use crate::connectors::sync::{MealLogEntry, NutritionSnapshot};

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

        let make_consumption = |index: u128, fiber: Option<f64>| Consumption {
            id: Uuid::from_u128(index),
            template_id: None,
            name: format!("Fiber {index}"),
            snapshot: NutritionSnapshot {
                schema_version: FOOD_SCHEMA_VERSION,
                canonical_unit: CanonicalUnit::G,
                nutrition_per100: NutritionValues {
                    calories: 1.0,
                    protein: 1.0,
                    carbs: 1.0,
                    fat: 1.0,
                    fiber,
                    sodium_mg: None,
                    cholesterol_mg: None,
                    extended_nutrition: Default::default(),
                },
                brand: None,
            },
            canonical_quantity: 100.0,
            entry: MealLogEntry {
                entered_quantity: 100.0,
                portion_snapshot: None,
            },
            consumed_at: index as i64,
            updated_at: index as i64,
        };
        let known = make_consumption(1, Some(2.0));
        let unknown = make_consumption(2, None);

        let (_, known_totals) =
            daily_nutrition_output(std::slice::from_ref(&known), false).unwrap();
        assert_eq!(known_totals.fiber, Some(2.0));
        assert_eq!(
            known_totals.completeness.fiber,
            NutrientCompleteness {
                known_items: 1,
                status: NutrientCompletenessStatus::Complete,
            }
        );

        let (_, partial_totals) = daily_nutrition_output(&[known, unknown.clone()], false).unwrap();
        assert_eq!(partial_totals.fiber, Some(2.0));
        assert_eq!(
            partial_totals.completeness.fiber,
            NutrientCompleteness {
                known_items: 1,
                status: NutrientCompletenessStatus::Partial,
            }
        );

        let (_, unknown_totals) = daily_nutrition_output(&[unknown], false).unwrap();
        assert_eq!(unknown_totals.fiber, None);
        assert_eq!(
            unknown_totals.completeness.fiber,
            NutrientCompleteness {
                known_items: 0,
                status: NutrientCompletenessStatus::Unknown,
            }
        );
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
                "update_food",
                "delete_food",
                "log_food",
                "update_food_log",
                "delete_food_log",
                "batch_delete_food_log",
                "get_weight_history",
                "set_weight",
                "delete_weight_log"
            ]
        );
        assert_eq!(tools.len(), 12);
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
            if let Some(branches) = tool
                .pointer("/outputSchema/oneOf")
                .and_then(Value::as_array)
            {
                assert!(!branches.is_empty());
                assert_eq!(
                    tool.pointer("/outputSchema/type").and_then(Value::as_str),
                    Some("object")
                );
                for branch in branches {
                    assert_eq!(branch.get("type").and_then(Value::as_str), Some("object"));
                    assert_eq!(
                        branch.get("additionalProperties"),
                        Some(&Value::Bool(false))
                    );
                }
            } else {
                assert_eq!(
                    tool.pointer("/outputSchema/additionalProperties"),
                    Some(&Value::Bool(false))
                );
            }
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
            "update_food",
            "delete_food",
            "log_food",
            "update_food_log",
            "delete_food_log",
            "batch_delete_food_log",
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
        assert!(
            get_desc("batch_delete_food_log").contains(
                "Confirma con el usuario el conjunto completo de registros seleccionados"
            )
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
        assert!(search_description.contains("por nombre o marca"));
        assert!(!search_description.contains("categoría"));
        assert!(search_description.contains("nombres en español e inglés"));
        assert!(search_description.contains("vuelve a buscar en el otro idioma"));
        assert!(search_description.contains("hasMore"));
        assert!(search_description.contains("foodId"));
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

    async fn food_search_fixture(rows: Value) -> Option<(ContractFixture, String)> {
        let (db, schema) = crate::connectors::user::isolated_identity_test_database().await?;
        sqlx::query("INSERT INTO users (id, email) VALUES (1, 'search@example.invalid'), (2, 'other@example.invalid')")
            .execute(&db.sync.pool)
            .await
            .unwrap();
        sqlx::query(
            r#"
            INSERT INTO meal_templates (id, user_id, name, details, is_official, updated_at, deleted_at)
            SELECT lpad(to_hex(id), 32, '0')::uuid, user_id, name,
                   $2::jsonb || jsonb_strip_nulls(jsonb_build_object('brand', brand, 'category', category)),
                   COALESCE(official, user_id IS NULL), 1, deleted_at
            FROM jsonb_to_recordset($1) AS input(
                id integer, user_id integer, name text, brand text, category text,
                official boolean, deleted_at bigint
            )
            "#,
        )
        .bind(rows)
        .bind(json!(iron_food_details()))
        .execute(&db.sync.pool)
        .await
        .unwrap();
        Some((ContractFixture::new(db, 1), schema))
    }

    fn assert_food_search_ids(
        payload: &Value,
        expected: impl IntoIterator<Item = u128>,
        has_more: bool,
    ) {
        let expected: Vec<_> = expected.into_iter().map(Uuid::from_u128).collect();
        let actual: Vec<Uuid> = payload["foods"]
            .as_array()
            .unwrap()
            .iter()
            .map(|food| serde_json::from_value(food["id"].clone()).unwrap())
            .collect();
        assert_eq!(actual, expected, "{payload}");
        assert_eq!(payload["hasMore"], has_more, "{payload}");
    }

    #[tokio::test]
    async fn mcp_food_search_folds_names_and_brands_and_escapes_literals() {
        let decomposed = "Melo\u{301}n";
        let brand = "Ñuñoá";
        let long_query = "á".repeat(120);
        let Some((fixture, schema)) = food_search_fixture(json!([
            {"id": 1, "name": "Plátano"},
            {"id": 2, "name": decomposed, "brand": brand},
            {"id": 3, "name": "Té 50%"},
            {"id": 4, "name": "Té 500"},
            {"id": 5, "name": "Lote_A"},
            {"id": 6, "name": "LoteXA"},
            {"id": 7, "name": "Especia", "brand": "A\\B"},
            {"id": 8, "name": "Aromática", "brand": "AB"},
            {"id": 9, "name": "Fruta", "category": "Solo categoría"},
            {"id": 10, "name": long_query},
            {"id": 11, "name": "q"}
        ]))
        .await
        else {
            return;
        };
        for (query, id, name) in [
            ("platano", 1, "Plátano"),
            ("  PLÁTANO  ", 1, "Plátano"),
            ("PLA\u{301}TANO", 1, "Plátano"),
            ("Melón", 2, decomposed),
            ("MELO\u{301}N", 2, decomposed),
            ("NUNOA", 2, decomposed),
            ("50%", 3, "Té 50%"),
            ("lote_a", 5, "Lote_A"),
            ("a\\b", 7, "Especia"),
        ] {
            let payload = fixture
                .success("search_foods", json!({"query": query}))
                .await;
            assert_food_search_ids(&payload, [id], false);
            assert_eq!(payload["foods"][0]["name"], name);
            if id == 2 {
                assert_eq!(payload["foods"][0]["details"]["brand"], brand);
            }
        }
        for query in ["inexistente", "\u{301}\u{36f}", "solo categoria"] {
            let (payload, summary) = fixture
                .success_with_summary("search_foods", json!({"query": query}))
                .await;
            assert_eq!(payload, json!({"foods": [], "hasMore": false}));
            assert!(summary.contains("otro idioma"));
        }

        // Runtime length checks apply after trimming; the advertised schema counts the raw string.
        for (query, id) in [(format!(" {long_query} "), 10), (" q ".into(), 11)] {
            let result = fixture.call("search_foods", json!({"query": query})).await;
            assert_eq!(result["isError"], false, "{result}");
            assert_food_search_ids(&result["structuredContent"], [id], false);
        }
        for args in [
            json!({"query": "   "}),
            json!({"query": format!("{long_query}á")}),
            json!({"query": "x", "source": "other"}),
            json!({"query": "x", "limit": 0}),
            json!({"query": "x", "limit": 21}),
            json!({"query": "x", "date": "2026-11-21"}),
        ] {
            let result = fixture.call("search_foods", args).await;
            assert_tool_error(&result, "invalid_arguments");
        }

        crate::connectors::user::cleanup_identity_test_database(&fixture.db, &schema).await;
    }

    #[tokio::test]
    async fn mcp_food_search_expands_whole_query_aliases_to_name_tokens() {
        let Some((fixture, schema)) = food_search_fixture(json!([
            {"id": 1, "name": "Chicken"},
            {"id": 2, "name": "Pollo (chicken)"},
            {"id": 3, "name": "Fondo de Pollo"},
            {"id": 4, "name": "Fondo", "brand": "Chicken"},
            {"id": 5, "name": "aChicken"},
            {"id": 6, "name": "Chicken2"},
            {"id": 7, "name": "2Chicken"},
            {"id": 8, "name": "βChicken"},
            {"id": 9, "name": "Chickenβ"},
            {"id": 10, "name": "Chicken-plate"},
            {"id": 11, "name": "Papaya"},
            {"id": 12, "name": "Papas"},
            {"id": 13, "name": "Patatas"},
            {"id": 14, "name": "Potatoes"},
            {"id": 15, "name": "Aguacate"},
            {"id": 16, "name": "Avocados"},
            {"id": 17, "name": "Palta"},
            {"id": 18, "name": "Paltas"},
            {"id": 19, "name": "Aguacates"},
            {"id": 20, "name": "Chicken stock"},
            {"id": 21, "name": "Carrots, raw"},
            {"id": 22, "name": "Egg, whole"},
            {"id": 23, "name": "Corn"},
            {"id": 24, "name": "Strawberries"},
            {"id": 25, "name": "Zanahoria rallada"},
            {"id": 26, "name": "Popcorn"},
            {"id": 27, "name": "Eggplant"},
            {"id": 28, "name": "Banana, raw"}
        ]))
        .await
        else {
            return;
        };
        for (query, mut expected) in [
            ("PÓLLO", vec![1, 10, 20, 3, 2]),
            ("chickens", vec![1, 10, 20, 3, 2]),
            ("pollos", vec![1, 10, 20, 3, 2]),
            ("pollo chicken", vec![]),
            ("fondo de pollo", vec![3]),
            ("potatoes", vec![14, 12, 13]),
            ("papa", vec![12, 11, 13, 14]),
            ("patata", vec![12, 13, 14]),
            ("palta", vec![17, 15, 19, 16, 18]),
            ("avocado", vec![15, 19, 16, 17, 18]),
            ("aguacates", vec![19, 15, 16, 17, 18]),
            ("zanahoria", vec![21, 25]),
            ("carrot", vec![21, 25]),
            ("huevo", vec![22]),
            ("choclo", vec![23]),
            ("frutilla", vec![24]),
            ("  Maíz  ", vec![23]),
            ("  Plátano  ", vec![28]),
            ("quinoa", vec![]),
        ] {
            let payload = fixture
                .success("search_foods", json!({"query": query}))
                .await;
            let mut actual: Vec<_> = payload["foods"]
                .as_array()
                .unwrap()
                .iter()
                .map(|food| {
                    serde_json::from_value::<Uuid>(food["id"].clone())
                        .unwrap()
                        .as_u128()
                })
                .collect();
            actual.sort_unstable();
            expected.sort_unstable();
            assert_eq!(actual, expected, "{query}: {payload}");
            assert_eq!(payload["hasMore"], false);
        }
        let payload = fixture
            .success("search_foods", json!({"query": "chicken"}))
            .await;
        let foods = payload["foods"].as_array().unwrap();
        assert_eq!(foods[0]["id"], json!(Uuid::from_u128(1)));
        assert_eq!(foods[1]["id"], json!(Uuid::from_u128(4)));
        assert!(
            foods
                .iter()
                .any(|food| food["id"] == json!(Uuid::from_u128(3)))
        );
        assert!(
            foods
                .iter()
                .any(|food| food["id"] == json!(Uuid::from_u128(5)))
        );

        crate::connectors::user::cleanup_identity_test_database(&fixture.db, &schema).await;
    }

    #[tokio::test]
    async fn mcp_food_search_ranks_visible_rows_and_refines_partial_results() {
        let mut rows = vec![
            json!({"id": 1, "name": "Guayába"}),
            json!({"id": 2, "name": "Guayába"}),
            json!({"id": 3, "name": "Guayába", "user_id": 1}),
            json!({"id": 4, "name": "Z Bebida", "brand": "Guaya\u{301}ba"}),
            json!({"id": 5, "name": "A Bebida", "brand": "GUAYÁBA"}),
            json!({"id": 6, "name": "A Bebida", "brand": "Guayába"}),
            json!({"id": 7, "name": "A Agua", "brand": "Guayába", "user_id": 1}),
            json!({"id": 8, "name": "Z Guayaba", "user_id": 2, "official": true}),
            json!({"id": 9, "name": "A Guayaba"}),
            json!({"id": 10, "name": "A Guayaba"}),
            json!({"id": 11, "name": "A Guayaba", "user_id": 1}),
            json!({"id": 12, "name": "Guayába", "user_id": 2}),
            json!({"id": 13, "name": "Guayába", "deleted_at": 2}),
            json!({"id": 14, "name": "Guayába", "user_id": 1, "deleted_at": 2}),
            json!({"id": 15, "name": "GUAYABA"}),
        ];
        rows.extend(
            (1..=21).map(|lot| json!({"id": 100 + lot, "name": format!("Avena lote {lot:02}")})),
        );
        let Some((fixture, schema)) = food_search_fixture(json!(rows)).await else {
            return;
        };
        // Exact name variants sort by stored name according to the database locale.
        let exact_official: Vec<_> = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM meal_templates WHERE id = ANY($1) ORDER BY name, id",
        )
        .bind([1, 2, 15].map(Uuid::from_u128).as_slice())
        .fetch_all(&fixture.db.sync.pool)
        .await
        .unwrap()
        .into_iter()
        .map(|id| id.as_u128())
        .collect();
        for (args, exact, remaining) in [
            (
                json!({"query": "GUAYABA", "limit": 13}),
                exact_official.clone(),
                vec![3, 5, 6, 4, 7, 9, 10, 8, 11],
            ),
            (
                json!({"query": "GUAYABA", "source": "official", "limit": 9}),
                exact_official,
                vec![5, 6, 4, 9, 10, 8],
            ),
            (
                json!({"query": "GUAYABA", "source": "personal", "limit": 3}),
                vec![3],
                vec![7, 11],
            ),
        ] {
            let result = fixture.success("search_foods", args).await;
            assert_food_search_ids(&result, exact.into_iter().chain(remaining), false);
        }
        let other = dispatch(
            &fixture.db,
            &fixture.hub,
            2,
            "search_foods",
            json!({
                "query": "guayaba", "source": "personal"
            }),
        )
        .await;
        assert_food_search_ids(&other["structuredContent"], [12], false);

        for (args, count) in [
            (json!({"query": "avena lote"}), 10),
            (json!({"query": "avena lote", "limit": 1}), 1),
            (json!({"query": "avena lote", "limit": 20}), 20),
        ] {
            let (result, summary) = fixture.success_with_summary("search_foods", args).await;
            assert_food_search_ids(&result, 101..=100 + count, true);
            assert!(summary.starts_with(&format!(
                "Se muestran {count} alimentos. Hay más coincidencias."
            )));
            assert!(summary.contains("Refina la búsqueda por nombre, marca o `source`"));
            assert_eq!(summary.contains("aumentar `limit` hasta 20"), count < 20);
            assert!(!summary.contains("21"));
        }
        let refined = fixture
            .success("search_foods", json!({"query": "avena lote 21"}))
            .await;
        assert_food_search_ids(&refined, [121], false);
        crate::connectors::user::cleanup_identity_test_database(&fixture.db, &schema).await;
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
        let unwrap_success = |outcome: ToolCallOutcome| match outcome {
            ToolCallOutcome::Success {
                summary,
                structured,
            } => (summary, structured),
            ToolCallOutcome::StructuredError { .. } => panic!("expected ToolCallOutcome::Success"),
        };
        let op_branded = Uuid::new_v4();
        let unique_brand = format!("MarcaMcp{}", &op_branded.simple().to_string()[..8]);
        let (_, created_json) = unwrap_success(
            call_tool(
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
                &mut None,
            )
            .await
            .unwrap(),
        );
        assert_eq!(created_json["status"], "created");
        assert_eq!(created_json["food"]["details"]["brand"], unique_brand);

        let (_, search_json) = unwrap_success(
            call_tool(
                &db,
                1,
                "search_foods",
                json!({
                    "query": unique_brand.to_lowercase(),
                    "source": "personal",
                    "limit": 10
                }),
                &mut None,
            )
            .await
            .unwrap(),
        );
        let foods = search_json["foods"].as_array().unwrap();
        assert!(foods.iter().any(|f| {
            f["id"] == created_json["food"]["id"] && f["details"]["brand"] == unique_brand
        }));

        let op_plain = Uuid::new_v4();
        let (_, plain_json) = unwrap_success(
            call_tool(
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
                &mut None,
            )
            .await
            .unwrap(),
        );
        assert!(plain_json["food"]["details"].get("brand").is_none());

        let log_branded = Uuid::new_v4();
        let (_, logged_json) = unwrap_success(
            call_tool(
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
                &mut None,
            )
            .await
            .unwrap(),
        );
        assert_eq!(logged_json["log"]["brand"], unique_brand);

        let log_plain = Uuid::new_v4();
        let (_, logged_plain_json) = unwrap_success(
            call_tool(
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
                &mut None,
            )
            .await
            .unwrap(),
        );
        assert!(logged_plain_json["log"].get("brand").is_none());

        let (_, daily_json) = unwrap_success(
            call_tool(
                &db,
                1,
                "get_daily_log",
                json!({ "date": "2026-08-10" }),
                &mut None,
            )
            .await
            .unwrap(),
        );
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

    #[tokio::test]
    async fn mcp_mutation_replay_contract_postgres() {
        use crate::connectors::user::{
            NewUser, cleanup_identity_test_database, isolated_identity_test_database,
        };

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let oidc = OidcConfig::test_cached_subject_config().mcp_config();
        let user_a = db
            .user
            .provision_identity(
                oidc.issuer(),
                "mcp-replay-user-a",
                &NewUser {
                    email: "mcp-replay-a@example.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();
        let user_b = db
            .user
            .provision_identity(
                oidc.issuer(),
                "mcp-replay-user-b",
                &NewUser {
                    email: "mcp-replay-b@example.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();

        let fixture = ContractFixture::new(db, user_a.id);
        let mut events = fixture.hub.subscribe();

        // AC-1 & AC-7: schemas require operationId and descriptions cover retry/conflict contract.
        let tools = tool_definitions();
        for tool_name in ["create_food", "log_food"] {
            let def = tool_definition(&tools, tool_name);
            let required = def["inputSchema"]["required"].as_array().unwrap();
            assert!(required.iter().any(|field| field == "operationId"));
            let description = def["description"].as_str().unwrap();
            assert!(description.contains("operationId"));
            assert!(description.contains("conflict"));
            assert!(description.contains("opaco"));
        }

        // AC-2 & AC-7: create_food commit emits 1 mealTemplates invalidation; equivalent replay emits 0.
        let food_op = Uuid::new_v4();
        let food_payload = json!({
            "operationId": food_op,
            "name": "  Yogurt Replay  ",
            "canonicalUnit": "g",
            "calories": 60,
            "protein": 4.0,
            "carbs": 8.0,
            "fat": 0.0,
            "brand": "  Soprole  ",
            "portions": [
                { "id": "Pote", "name": "1 pote", "portionQuantity": 1, "canonicalQuantity": 125 }
            ],
            "chileanSeals": ["alto en azúcares"]
        });
        let created_food = fixture.success("create_food", food_payload.clone()).await;
        assert_eq!(created_food["status"], "created");
        let event = events.try_recv().unwrap();
        assert_eq!(event.user_id, user_a.id);
        assert_eq!(event.collection, "mealTemplates");
        assert_no_invalidation(&mut events);

        // Equivalent replay with normalized variants (-0.0, trimmed name/brand, float vs int).
        let equivalent_food_payload = json!({
            "operationId": food_op,
            "name": "Yogurt Replay",
            "canonicalUnit": "g",
            "calories": 60.0,
            "protein": 4,
            "carbs": 8,
            "fat": -0.0,
            "brand": "Soprole",
            "portions": [
                { "id": "Pote", "name": "1 pote", "portionQuantity": 1.0, "canonicalQuantity": 125.0 }
            ],
            "chileanSeals": ["alto en azúcares"]
        });
        let replayed_food = fixture
            .success("create_food", equivalent_food_payload)
            .await;
        assert_eq!(replayed_food["status"], "alreadyCreated");
        assert_eq!(replayed_food["food"], created_food["food"]);
        assert_no_invalidation(&mut events);

        // Changed intent on create_food returns conflict and emits 0 invalidations.
        let mut changed_food = food_payload.clone();
        changed_food["calories"] = json!(61.0);
        let conflict = fixture.call("create_food", changed_food).await;
        assert_tool_error(&conflict, "conflict");
        assert_no_invalidation(&mut events);

        // Original payload still replays cleanly after conflict.
        let replayed_again = fixture.success("create_food", food_payload.clone()).await;
        assert_eq!(replayed_again["status"], "alreadyCreated");
        assert_eq!(replayed_again["food"], created_food["food"]);
        assert_no_invalidation(&mut events);

        // AC-5: Independent tool namespaces — same UUID works for log_food too!
        let log_payload = json!({
            "operationId": food_op,
            "foodId": food_op,
            "quantity": 1,
            "portionId": "Pote",
            "date": "2026-08-10",
            "time": "09:30"
        });
        let created_log = fixture.success("log_food", log_payload.clone()).await;
        assert_eq!(created_log["status"], "logged");
        fixture.assert_meal_invalidation(&mut events);

        // Equivalent log_food replay emits 0 invalidations.
        let mut equivalent_log = log_payload.clone();
        equivalent_log["quantity"] = json!(1.0);
        let replayed_log = fixture.success("log_food", equivalent_log).await;
        assert_eq!(replayed_log["status"], "alreadyLogged");
        assert_eq!(replayed_log["log"], created_log["log"]);
        assert_no_invalidation(&mut events);

        // Changed intent on log_food returns conflict and emits 0 invalidations.
        let mut changed_log = log_payload.clone();
        changed_log["quantity"] = json!(2.0);
        let log_conflict = fixture.call("log_food", changed_log).await;
        assert_tool_error(&log_conflict, "conflict");
        assert_no_invalidation(&mut events);

        // Half-pair date/time returns invalid_arguments.
        let half_pair = fixture
            .call(
                "log_food",
                json!({
                    "operationId": Uuid::new_v4(),
                    "foodId": food_op,
                    "quantity": 1,
                    "date": "2026-08-10"
                }),
            )
            .await;
        assert_tool_error(&half_pair, "invalid_arguments");
        assert_no_invalidation(&mut events);

        // AC-4: Edit source food -> create_food replay conflicts, but log_food replay STILL succeeds!
        sqlx::query(
            "UPDATE meal_templates SET name = 'Yogurt Edited' WHERE id = $1 AND user_id = $2",
        )
        .bind(food_op)
        .bind(user_a.id)
        .execute(&fixture.db.sync.pool)
        .await
        .unwrap();
        let food_edited_conflict = fixture.call("create_food", food_payload.clone()).await;
        assert_tool_error(&food_edited_conflict, "conflict");
        assert_no_invalidation(&mut events);

        let log_after_source_edit = fixture.success("log_food", log_payload.clone()).await;
        assert_eq!(log_after_source_edit["status"], "alreadyLogged");
        assert_eq!(log_after_source_edit["log"]["name"], "Yogurt Replay");
        assert_no_invalidation(&mut events);

        // AC-4: Hard-delete source food (ON DELETE SET NULL) -> create_food conflicts, log_food replays with foodId: null!
        sqlx::query("DELETE FROM meal_templates WHERE id = $1 AND user_id = $2")
            .bind(food_op)
            .bind(user_a.id)
            .execute(&fixture.db.sync.pool)
            .await
            .unwrap();
        let food_deleted_conflict = fixture.call("create_food", food_payload).await;
        assert_tool_error(&food_deleted_conflict, "conflict");

        let log_after_source_delete = fixture.success("log_food", log_payload.clone()).await;
        assert_eq!(log_after_source_delete["status"], "alreadyLogged");
        assert_eq!(log_after_source_delete["log"]["foodId"], Value::Null);
        assert_eq!(log_after_source_delete["log"]["name"], "Yogurt Replay");
        assert_no_invalidation(&mut events);

        // AC-4: Edit log via update_food_log -> log_food replay conflicts.
        let updated = fixture
            .success(
                "update_food_log",
                json!({ "logId": food_op, "quantity": 2.0 }),
            )
            .await;
        assert_eq!(updated["status"], "updated");
        fixture.assert_meal_invalidation(&mut events);

        let log_edited_conflict = fixture.call("log_food", log_payload).await;
        assert_tool_error(&log_edited_conflict, "conflict");
        assert_no_invalidation(&mut events);

        // AC-4: Delete log via delete_food_log -> log_food replay conflicts without resurrecting.
        let food2_op = Uuid::new_v4();
        let food2 = fixture.success("create_food", create_args(food2_op)).await;
        assert_eq!(food2["status"], "created");
        let _ = events.try_recv().unwrap();

        let log2_op = Uuid::new_v4();
        let log2_payload = json!({
            "operationId": log2_op,
            "foodId": food2_op,
            "quantity": 50.0,
            "date": "2026-08-10",
            "time": "13:00"
        });
        let created_log2 = fixture.success("log_food", log2_payload.clone()).await;
        assert_eq!(created_log2["status"], "logged");
        fixture.assert_meal_invalidation(&mut events);

        let deleted_log2 = fixture
            .success("delete_food_log", json!({ "logId": log2_op }))
            .await;
        assert_eq!(deleted_log2["status"], "deleted");
        fixture.assert_meal_invalidation(&mut events);

        let log2_deleted_conflict = fixture.call("log_food", log2_payload).await;
        assert_tool_error(&log2_deleted_conflict, "conflict");
        assert_no_invalidation(&mut events);
        let deleted_at: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM meal_logs WHERE id = $1")
                .bind(log2_op)
                .fetch_one(&fixture.db.sync.pool)
                .await
                .unwrap();
        assert!(deleted_at.is_some());

        // AC-5: Official row collision, foreign user collision, and legacy log collision return generic conflict with zero leakage.
        let official_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at) \
             VALUES ($1, NULL, TRUE, 'Secret Official Item', $2, 1000)",
        )
        .bind(official_id)
        .bind(serde_json::to_value(iron_food_details()).unwrap())
        .execute(&fixture.db.sync.pool)
        .await
        .unwrap();
        let official_collision = fixture.call("create_food", create_args(official_id)).await;
        assert_tool_error(&official_collision, "conflict");
        assert!(
            !official_collision["structuredContent"]["error"]["message"]
                .as_str()
                .unwrap()
                .contains("Secret Official Item")
        );

        let foreign_food_id = Uuid::new_v4();
        fixture
            .db
            .sync
            .create_mcp_food(
                user_b.id,
                foreign_food_id,
                "Foreign Secret Food",
                &iron_food_details(),
            )
            .await
            .unwrap();
        let foreign_food_collision = fixture
            .call("create_food", create_args(foreign_food_id))
            .await;
        assert_tool_error(&foreign_food_collision, "conflict");
        assert!(
            !foreign_food_collision["structuredContent"]["error"]["message"]
                .as_str()
                .unwrap()
                .contains("Foreign Secret Food")
        );

        let foreign_log_id = Uuid::new_v4();
        fixture
            .db
            .sync
            .create_mcp_consumption(
                user_b.id,
                foreign_log_id,
                foreign_food_id,
                100.0,
                None,
                &LogFoodTimeIntent::Explicit {
                    date: "2026-08-10".into(),
                    time: "15:00".into(),
                },
            )
            .await
            .unwrap();
        let foreign_log_collision = fixture
            .call(
                "log_food",
                json!({
                    "operationId": foreign_log_id,
                    "foodId": food2_op,
                    "quantity": 100.0,
                    "date": "2026-08-10",
                    "time": "15:00"
                }),
            )
            .await;
        assert_tool_error(&foreign_log_collision, "conflict");
        assert!(
            !foreign_log_collision["structuredContent"]["error"]["message"]
                .as_str()
                .unwrap()
                .contains("Foreign Secret Food")
        );

        // Legacy owned meal_logs row (inserted without MCP receipt) -> generic conflict.
        let legacy_log_id = Uuid::new_v4();
        let epoch = fixture
            .db
            .sync
            .local_datetime_to_epoch("2026-08-10", "16:00")
            .await
            .unwrap();
        fixture
            .db
            .sync
            .create_consumption(user_a.id, legacy_log_id, food2_op, 80.0, None, epoch)
            .await
            .unwrap();
        let legacy_log_collision = fixture
            .call(
                "log_food",
                json!({
                    "operationId": legacy_log_id,
                    "foodId": food2_op,
                    "quantity": 80.0,
                    "date": "2026-08-10",
                    "time": "16:00"
                }),
            )
            .await;
        assert_tool_error(&legacy_log_collision, "conflict");
        assert_no_invalidation(&mut events);

        cleanup_identity_test_database(&fixture.db, &schema).await;
    }

    #[tokio::test]
    async fn bal081_create_food_mcp_contract() {
        use crate::connectors::user::{
            NewUser, cleanup_identity_test_database, isolated_identity_test_database,
        };

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let oidc = OidcConfig::test_cached_subject_config().mcp_config();
        let user_a = db
            .user
            .provision_identity(
                oidc.issuer(),
                "bal081-mcp-user-a",
                &NewUser {
                    email: "bal081-mcp-a@example.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();
        let user_b = db
            .user
            .provision_identity(
                oidc.issuer(),
                "bal081-mcp-user-b",
                &NewUser {
                    email: "bal081-mcp-b@example.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();

        let fixture = ContractFixture::new(db, user_a.id);
        let mut events = fixture.hub.subscribe();

        // AC-1 & AC-2: Inspect tools/list schema & description for create_food.
        let tools = tool_definitions();
        let create_def = tool_definition(&tools, "create_food");
        assert!(
            create_def
                .pointer("/inputSchema/properties/forceCreate")
                .is_none(),
            "forceCreate must remain absent from create_food inputSchema"
        );
        let desc = create_def["description"].as_str().unwrap();
        for token in [
            "duplicatePersonalFood",
            "candidates",
            "hasMoreCandidates",
            "search_foods",
            "log_food",
            "operationId",
            "conflict",
            "opaco",
            "solo después de confirmar",
        ] {
            assert!(
                desc.contains(token),
                "create_food description missing expected guidance '{token}': {desc}"
            );
        }

        // Reject forceCreate at both schema and dispatch layers.
        let force_op = Uuid::new_v4();
        let mut with_force = create_args(force_op);
        with_force["forceCreate"] = json!(true);
        assert!(!fixture.input["create_food"].is_valid(&with_force));
        let force_res = fixture.call("create_food", with_force).await;
        assert_tool_error(&force_res, "invalid_arguments");

        // AC-2: Created -> 1 mealTemplates invalidation, valid against outputSchema.
        let first_op = Uuid::new_v4();
        let base_payload = json!({
            "operationId": first_op,
            "name": "  Avena Proteica  ",
            "canonicalUnit": "g",
            "calories": 380,
            "protein": 22.0,
            "carbs": 52.0,
            "fat": 8.0,
            "sodiumMg": 120.0,
            "brand": "  Quaker Chile  ",
            "portions": [
                { "id": "taza", "name": "1 taza", "portionQuantity": 1, "canonicalQuantity": 45 }
            ],
            "chileanSeals": ["alto en calorías"],
            "category": "desayuno",
            "typicalTime": "08:00"
        });
        let created = fixture.success("create_food", base_payload.clone()).await;
        assert_eq!(created["status"], "created");
        assert_eq!(created["food"]["id"], first_op.to_string());
        let event = events.try_recv().unwrap();
        assert_eq!(event.user_id, user_a.id);
        assert_eq!(event.collection, "mealTemplates");
        assert_no_invalidation(&mut events);

        // BAL-078 replay -> alreadyCreated, 0 invalidations.
        let replayed = fixture.success("create_food", base_payload.clone()).await;
        assert_eq!(replayed["status"], "alreadyCreated");
        assert_eq!(replayed["food"]["id"], first_op.to_string());
        assert_no_invalidation(&mut events);

        // AC-2: Exact duplicate with new operationId (normalized name/brand + metadata-only diffs)
        // returns recoverable duplicatePersonalFood structured error with Spanish summary,
        // embedded_json == structuredContent, 0 invalidations, and losing operationId absent.
        let dup_op = Uuid::new_v4();
        let dup_payload = json!({
            "operationId": dup_op,
            "name": "avena proteica",
            "canonicalUnit": "g",
            "calories": 380.0,
            "protein": 22,
            "carbs": 52,
            "fat": 8,
            "sodiumMg": 120,
            "brand": "quaker chile",
            "portions": [
                { "id": "cucharada", "name": "1 cucharada", "portionQuantity": 1, "canonicalQuantity": 15 }
            ],
            "category": "colacion"
        });
        assert_valid(&fixture.input["create_food"], &dup_payload);
        let dup_result = fixture.call("create_food", dup_payload).await;
        assert_eq!(dup_result["isError"], true);
        let dup_structured = &dup_result["structuredContent"];
        assert_valid(&fixture.output["create_food"], dup_structured);
        assert_eq!(dup_structured["error"]["code"], "conflict");
        assert_eq!(dup_structured["error"]["reason"], "duplicatePersonalFood");
        assert_eq!(dup_structured["error"]["hasMoreCandidates"], false);
        let candidates = dup_structured["error"]["candidates"].as_array().unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0]["foodId"], first_op.to_string());
        assert_eq!(candidates[0]["name"], "Avena Proteica");
        assert_eq!(candidates[0]["brand"], "Quaker Chile");
        assert_eq!(candidates[0]["canonicalUnit"], "g");
        assert_eq!(candidates[0]["portions"].as_array().unwrap().len(), 1);

        let content = dup_result["content"].as_array().unwrap();
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        let text = content[0]["text"].as_str().unwrap();
        let embedded = embedded_json(text);
        let summary = text
            .strip_suffix(embedded)
            .unwrap()
            .strip_suffix("\n\n")
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(embedded).unwrap(),
            *dup_structured
        );
        assert!(summary.contains(&first_op.to_string()));
        assert!(summary.contains("log_food"));
        assert_no_invalidation(&mut events);

        let loser_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM meal_templates WHERE id = $1")
                .bind(dup_op)
                .fetch_one(&fixture.db.sync.pool)
                .await
                .unwrap();
        assert_eq!(loser_count, 0);

        // AC-2: Reuse returned candidate foodId directly in log_food.
        let log_op = Uuid::new_v4();
        let logged = fixture
            .success(
                "log_food",
                json!({
                    "operationId": log_op,
                    "foodId": candidates[0]["foodId"],
                    "quantity": 1,
                    "portionId": "taza",
                    "date": "2026-08-10",
                    "time": "08:15"
                }),
            )
            .await;
        assert_eq!(logged["status"], "logged");
        assert_eq!(logged["log"]["foodId"], first_op.to_string());
        let _ = events.try_recv().unwrap();
        assert_no_invalidation(&mut events);

        // AC-2: Observation privacy — duplicate structured error logs only metadata (error_code="conflict"),
        // never food payload strings.
        {
            use std::io::Write;
            use tracing::instrument::WithSubscriber;
            use tracing_subscriber::fmt::MakeWriter;

            #[derive(Clone, Default)]
            struct Bal081LogCapture(Arc<Mutex<Vec<u8>>>);
            struct Bal081LogWriter(Arc<Mutex<Vec<u8>>>);
            impl Write for Bal081LogWriter {
                fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                    self.0.lock().unwrap().extend_from_slice(buf);
                    Ok(buf.len())
                }
                fn flush(&mut self) -> std::io::Result<()> {
                    Ok(())
                }
            }
            impl<'a> MakeWriter<'a> for Bal081LogCapture {
                type Writer = Bal081LogWriter;
                fn make_writer(&'a self) -> Self::Writer {
                    Bal081LogWriter(self.0.clone())
                }
            }

            let obs_summary = summary.to_owned();
            let obs_structured = dup_structured.clone();
            let capture = Bal081LogCapture::default();
            let subscriber = tracing_subscriber::fmt()
                .with_env_filter(observation::logging_filter(None))
                .with_ansi(false)
                .with_writer(capture.clone())
                .finish();

            async {
                let router = observation::observe_routes(Router::new().route(
                    "/mcp",
                    post(
                        move |observation: Option<Extension<observation::Observation>>| {
                            let obs_summary = obs_summary.clone();
                            let obs_structured = obs_structured.clone();
                            async move {
                                let observation =
                                    observation.as_ref().map(|Extension(value)| value);
                                if let Some(observation) = observation {
                                    observation.request("tools/call", Some("create_food"));
                                }
                                tool_structured_error(
                                    json!(1),
                                    "conflict",
                                    &obs_summary,
                                    obs_structured,
                                    observation,
                                )
                            }
                        },
                    ),
                ));
                let response = router
                    .oneshot(rpc_request(json!({"method": "tools/call"}).to_string()))
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                let _ = to_bytes(response.into_body(), usize::MAX).await.unwrap();
                let logs = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
                assert!(
                    logs.lines().any(|line| {
                        line.contains("event=\"tool_result_prepared\"")
                            && line.contains("tool=\"create_food\"")
                            && line.contains("outcome=\"tool_error\"")
                            && line.contains("error_class=\"conflict\"")
                            && line.contains("first_text_json=\"matches\"")
                    }),
                    "expected conflict observation metadata in:\n{logs}"
                );
                assert!(!logs.contains("Avena Proteica"));
                assert!(!logs.contains("Quaker Chile"));
                assert!(!logs.contains(&first_op.to_string()));
            }
            .with_subscriber(subscriber)
            .await;
        }

        // AC-1: Distinct variant (fiber: 0.0 vs absent) succeeds cleanly.
        let fiber_variant_op = Uuid::new_v4();
        let mut fiber_variant = base_payload.clone();
        fiber_variant["operationId"] = json!(fiber_variant_op);
        fiber_variant["fiber"] = json!(0.0);
        let variant_created = fixture.success("create_food", fiber_variant).await;
        assert_eq!(variant_created["status"], "created");
        let _ = events.try_recv().unwrap();
        assert_no_invalidation(&mut events);

        // AC-4: Foreign user operationId collision returns generic conflict (no reason/candidates),
        // even though user_a has an active same-name duplicate row.
        let foreign_op = Uuid::new_v4();
        fixture
            .db
            .sync
            .create_mcp_food(
                user_b.id,
                foreign_op,
                "Foreign Private Food",
                &iron_food_details(),
            )
            .await
            .unwrap();
        let mut foreign_collision_args = base_payload.clone();
        foreign_collision_args["operationId"] = json!(foreign_op);
        let foreign_collision = fixture.call("create_food", foreign_collision_args).await;
        assert_tool_error(&foreign_collision, "conflict");
        assert!(
            foreign_collision["structuredContent"]["error"]
                .get("reason")
                .is_none()
        );
        assert!(
            foreign_collision["structuredContent"]["error"]
                .get("candidates")
                .is_none()
        );
        assert_no_invalidation(&mut events);

        // AC-5: Legacy multi-match ambiguity (4 identical rows -> 3 UUID-ascending candidates,
        // hasMoreCandidates=true, choice + search_foods prompt, 0 invalidations).
        let multi_details = iron_food_details();
        let multi_json = serde_json::to_value(&multi_details).unwrap();
        let mut multi_ids = [
            Uuid::parse_str("00000000-0000-4000-8000-000000000014").unwrap(),
            Uuid::parse_str("00000000-0000-4000-8000-000000000012").unwrap(),
            Uuid::parse_str("00000000-0000-4000-8000-000000000011").unwrap(),
            Uuid::parse_str("00000000-0000-4000-8000-000000000013").unwrap(),
        ];
        for id in multi_ids {
            sqlx::query(
                "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at) \
                 VALUES ($1, $2, FALSE, 'Multi Legacy MCP', $3, 1000, NULL)",
            )
            .bind(id)
            .bind(user_a.id)
            .bind(&multi_json)
            .execute(&fixture.db.sync.pool)
            .await
            .unwrap();
        }
        multi_ids.sort();
        let multi_req = json!({
            "operationId": Uuid::new_v4(),
            "name": "multi legacy mcp",
            "canonicalUnit": "g",
            "calories": multi_details.nutrition_per100.calories,
            "protein": multi_details.nutrition_per100.protein,
            "carbs": multi_details.nutrition_per100.carbs,
            "fat": multi_details.nutrition_per100.fat,
            "fiber": multi_details.nutrition_per100.fiber,
            "sodiumMg": multi_details.nutrition_per100.sodium_mg,
            "cholesterolMg": multi_details.nutrition_per100.cholesterol_mg,
            "brand": multi_details.brand
        });
        // Note: iron_food_details has extendedNutrition (ironMg), while create_food input has empty extendedNutrition,
        // so seed 4 rows with empty extendedNutrition to match create_food input.
        let mut plain_multi_details = multi_details.clone();
        plain_multi_details
            .nutrition_per100
            .extended_nutrition
            .clear();
        let plain_multi_json = serde_json::to_value(&plain_multi_details).unwrap();
        sqlx::query(
            "UPDATE meal_templates SET details = $1 WHERE user_id = $2 AND name = 'Multi Legacy MCP'",
        )
        .bind(&plain_multi_json)
        .bind(user_a.id)
        .execute(&fixture.db.sync.pool)
        .await
        .unwrap();

        let multi_res = fixture.call("create_food", multi_req).await;
        assert_eq!(multi_res["isError"], true);
        let multi_structured = &multi_res["structuredContent"];
        assert_valid(&fixture.output["create_food"], multi_structured);
        assert_eq!(multi_structured["error"]["reason"], "duplicatePersonalFood");
        assert_eq!(multi_structured["error"]["hasMoreCandidates"], true);
        let multi_candidates = multi_structured["error"]["candidates"].as_array().unwrap();
        assert_eq!(multi_candidates.len(), 3);
        let got_ids: Vec<String> = multi_candidates
            .iter()
            .map(|c| c["foodId"].as_str().unwrap().to_owned())
            .collect();
        let expected_ids: Vec<String> = multi_ids[..3].iter().map(Uuid::to_string).collect();
        assert_eq!(got_ids, expected_ids);
        let multi_text = multi_res["content"][0]["text"].as_str().unwrap();
        assert!(multi_text.contains("search_foods"));
        assert!(multi_text.contains("personal"));
        assert_no_invalidation(&mut events);

        // AC-5: Malformed in-scope same-name row returns sanitized internal_error with no insert.
        let bad_row_id = Uuid::new_v4();
        let bad_op = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at) \
             VALUES ($1, $2, FALSE, 'Malformed MCP Food', $3, 1000, NULL)",
        )
        .bind(bad_row_id)
        .bind(user_a.id)
        .bind(json!({ "broken": true }))
        .execute(&fixture.db.sync.pool)
        .await
        .unwrap();
        let mut bad_args = create_args(bad_op);
        bad_args["name"] = json!("malformed mcp food");
        let bad_res = fixture.call("create_food", bad_args).await;
        let bad_msg = assert_tool_error(&bad_res, "internal_error");
        assert_eq!(bad_msg, "Internal operation failed");
        assert_no_invalidation(&mut events);
        let bad_inserted: i64 =
            sqlx::query_scalar("SELECT count(*) FROM meal_templates WHERE id = $1")
                .bind(bad_op)
                .fetch_one(&fixture.db.sync.pool)
                .await
                .unwrap();
        assert_eq!(bad_inserted, 0);

        cleanup_identity_test_database(&fixture.db, &schema).await;
    }

    #[test]
    fn update_food_and_delete_food_schemas_and_patch_parsing() {
        let tools = tool_definitions();
        let get_tool = |name: &str| {
            tools
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t.get("name") == Some(&Value::String(name.into())))
                .unwrap()
        };

        let update_tool = get_tool("update_food");
        let delete_tool = get_tool("delete_food");

        assert_eq!(
            update_tool["annotations"],
            json!({
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            })
        );
        assert_eq!(
            delete_tool["annotations"],
            json!({
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            })
        );

        let update_validator = jsonschema::draft202012::new(&update_tool["inputSchema"]).unwrap();
        let delete_validator = jsonschema::draft202012::new(&delete_tool["inputSchema"]).unwrap();
        let food_id = Uuid::new_v4().to_string();

        // Valid partial patches & explicit clears
        assert_valid(
            &update_validator,
            &json!({ "foodId": food_id, "name": "Avena Nueva" }),
        );
        assert_valid(
            &update_validator,
            &json!({
                "foodId": food_id,
                "brand": null,
                "category": null,
                "typicalTime": null,
                "fiber": null,
                "sodiumMg": null,
                "cholesterolMg": null,
                "portions": [],
                "chileanSeals": []
            }),
        );
        assert_valid(&delete_validator, &json!({ "foodId": food_id }));

        // Invalid patches: empty patch, null non-nullable fields, unknown fields
        assert!(!update_validator.is_valid(&json!({ "foodId": food_id })));
        for non_null in [
            "name",
            "calories",
            "protein",
            "carbs",
            "fat",
            "portions",
            "chileanSeals",
        ] {
            assert!(
                !update_validator.is_valid(&json!({ "foodId": food_id, (non_null): null })),
                "schema should reject null for {non_null}"
            );
            let parsed: Result<UpdateFoodArgs, _> =
                serde_json::from_value(json!({ "foodId": food_id, (non_null): null }));
            assert!(
                parsed.is_err(),
                "serde should reject null for non-nullable field {non_null}"
            );
        }
        assert!(!update_validator.is_valid(&json!({
            "foodId": food_id,
            "canonicalUnit": "ml"
        })));
        assert!(!update_validator.is_valid(&json!({
            "foodId": food_id,
            "portions": [{
                "id": "p1",
                "name": "taza",
                "portionQuantity": 1,
                "canonicalQuantity": 40,
                "extra": true
            }]
        })));
        assert!(!delete_validator.is_valid(&json!({ "foodId": food_id, "extra": 1 })));

        // Tri-state serde deserialization: omitted vs explicit null vs value
        let parsed: UpdateFoodArgs = serde_json::from_value(json!({
            "foodId": food_id,
            "brand": null,
            "category": "desayuno"
        }))
        .unwrap();
        assert!(parsed.name.is_none());
        assert_eq!(parsed.brand, Some(None));
        assert_eq!(parsed.category, Some(Some("desayuno".into())));
        assert_eq!(parsed.typical_time, None);
        assert_eq!(parsed.fiber, None);
    }

    #[tokio::test]
    async fn mcp_update_and_delete_food_contract_postgres() {
        use crate::connectors::user::{
            NewUser, cleanup_identity_test_database, isolated_identity_test_database,
        };

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let user_a = db
            .user
            .provision_identity(
                "https://issuer.example.invalid",
                "bal103-mcp-user-a",
                &NewUser {
                    email: "mcp-uf-a@test.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();
        let user_b = db
            .user
            .provision_identity(
                "https://issuer.example.invalid",
                "bal103-mcp-user-b",
                &NewUser {
                    email: "mcp-uf-b@test.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();
        let fixture_a = ContractFixture::new(db.clone(), user_a.id);
        let mut events_a = fixture_a.hub.subscribe();

        // Seed an owned personal food with extendedNutrition, source_provider, external_id,
        // and > MAX_CREATE_SEALS legacy seals to verify partial update preservation.
        let food_id = Uuid::new_v4();
        let mut extended = std::collections::BTreeMap::new();
        extended.insert("ironMg".to_string(), 4.25);
        let seeded_details = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: NutritionValues {
                calories: 380.123456,
                protein: 13.5,
                carbs: 66.2,
                fat: 6.9,
                fiber: Some(10.1),
                sodium_mg: Some(15.0),
                cholesterol_mg: Some(0.0),
                extended_nutrition: extended,
            },
            portions: vec![PortionDefinition {
                id: "scoop".into(),
                name: "Cucharada".into(),
                portion_quantity: 1.0,
                canonical_quantity: 30.0,
            }],
            chilean_seals: vec![
                "alto_calorias".into(),
                "alto_azucares".into(),
                "alto_grasas".into(),
                "alto_sodio".into(),
                "legacy_extra_seal".into(),
            ],
            brand: Some("Marca Uno".into()),
            category: Some("desayuno".into()),
            typical_time: Some("08:00".into()),
        };
        let initial_ts = 1_700_000_000_000_i64;
        sqlx::query(
            "INSERT INTO meal_templates \
             (id, user_id, is_official, name, details, source_provider, external_id, updated_at, deleted_at) \
             VALUES ($1, $2, FALSE, 'Avena Personal', $3, 'custom_import', 'ext-123', $4, NULL)",
        )
        .bind(food_id)
        .bind(user_a.id)
        .bind(serde_json::to_value(&seeded_details).unwrap())
        .bind(initial_ts)
        .execute(&db.sync.pool)
        .await
        .unwrap();

        // Seed a second personal food for user A (duplicate name target), a foreign food,
        // an official food, and an ownerless non-official food.
        let other_food_id = Uuid::new_v4();
        let foreign_food_id = Uuid::new_v4();
        let official_food_id = Uuid::new_v4();
        let ownerless_food_id = Uuid::new_v4();
        let plain_details = serde_json::to_value(FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: NutritionValues {
                calories: 100.0,
                protein: 5.0,
                carbs: 15.0,
                fat: 2.0,
                fiber: None,
                sodium_mg: None,
                cholesterol_mg: None,
                extended_nutrition: Default::default(),
            },
            portions: vec![],
            chilean_seals: vec![],
            brand: None,
            category: None,
            typical_time: None,
        })
        .unwrap();
        sqlx::query(
            "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at) \
             VALUES ($1, $2, FALSE, 'Pan Integral', $3, $4, NULL), \
                    ($5, $6, FALSE, 'Ajeno', $3, $4, NULL), \
                    ($7, NULL, TRUE, 'Oficial', $3, $4, NULL), \
                    ($8, NULL, FALSE, 'Sin Dueno', $3, $4, NULL)",
        )
        .bind(other_food_id)
        .bind(user_a.id)
        .bind(&plain_details)
        .bind(initial_ts)
        .bind(foreign_food_id)
        .bind(user_b.id)
        .bind(official_food_id)
        .bind(ownerless_food_id)
        .execute(&db.sync.pool)
        .await
        .unwrap();

        // Log a historical meal using the original food & portion before any updates/deletes.
        let log_res = fixture_a
            .call(
                "log_food",
                json!({
                    "operationId": Uuid::new_v4(),
                    "foodId": food_id,
                    "quantity": 2.0,
                    "portionId": "scoop",
                    "date": "2026-04-10",
                    "time": "08:30"
                }),
            )
            .await;
        assert_eq!(log_res["isError"], false);
        let log_id = log_res["structuredContent"]["log"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let log_event = events_a.try_recv().unwrap();
        assert_eq!(log_event.user_id, user_a.id);
        assert_eq!(log_event.collection, "mealLogs");
        assert_no_invalidation(&mut events_a);

        // AC-1: Partial update succeeds, preserves omitted fields (including extendedNutrition,
        // source_provider, external_id, legacy >4 seals) and returns full precision FoodTemplate.
        let upd_res = fixture_a
            .call(
                "update_food",
                json!({
                    "foodId": food_id,
                    "name": "  Avena Mejorada  ",
                    "calories": 395.654321
                }),
            )
            .await;
        assert_eq!(upd_res["isError"], false);
        let upd_structured = &upd_res["structuredContent"];
        assert_valid(&fixture_a.output["update_food"], upd_structured);
        assert_eq!(upd_structured["status"], "updated");
        assert_eq!(upd_structured["food"]["name"], "Avena Mejorada");
        assert_eq!(
            upd_structured["food"]["details"]["nutritionPer100"]["calories"],
            395.654321
        );
        assert_eq!(
            upd_structured["food"]["details"]["nutritionPer100"]["extendedNutrition"]["ironMg"],
            4.25
        );
        assert_eq!(upd_structured["food"]["details"]["brand"], "Marca Uno");
        assert_eq!(
            upd_structured["food"]["details"]["chileanSeals"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        let ts_after_update = upd_structured["food"]["updatedAt"].as_i64().unwrap();
        assert!(ts_after_update > initial_ts);
        let upd_event = events_a.try_recv().unwrap();
        assert_eq!(upd_event.user_id, user_a.id);
        assert_eq!(upd_event.collection, "mealTemplates");
        assert_no_invalidation(&mut events_a);

        // Verify source_provider and external_id were preserved in DB.
        let (sp, ext): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT source_provider, external_id FROM meal_templates WHERE id = $1")
                .bind(food_id)
                .fetch_one(&db.sync.pool)
                .await
                .unwrap();
        assert_eq!(sp.as_deref(), Some("custom_import"));
        assert_eq!(ext.as_deref(), Some("ext-123"));

        // AC-1: Explicit null clears and [] list clears.
        let clear_res = fixture_a
            .call(
                "update_food",
                json!({
                    "foodId": food_id,
                    "brand": null,
                    "category": null,
                    "typicalTime": null,
                    "fiber": null,
                    "sodiumMg": null,
                    "cholesterolMg": null,
                    "portions": [],
                    "chileanSeals": []
                }),
            )
            .await;
        assert_eq!(clear_res["isError"], false);
        let clear_structured = &clear_res["structuredContent"];
        assert_valid(&fixture_a.output["update_food"], clear_structured);
        let clear_details = &clear_structured["food"]["details"];
        assert!(clear_details.get("brand").is_none());
        assert!(clear_details.get("category").is_none());
        assert!(clear_details.get("typicalTime").is_none());
        assert!(clear_details["nutritionPer100"].get("fiber").is_none());
        assert!(clear_details["nutritionPer100"].get("sodiumMg").is_none());
        assert!(
            clear_details["nutritionPer100"]
                .get("cholesterolMg")
                .is_none()
        );
        assert_eq!(clear_details["portions"], json!([]));
        assert_eq!(clear_details["chileanSeals"], json!([]));
        let ts_after_clear = clear_structured["food"]["updatedAt"].as_i64().unwrap();
        assert!(ts_after_clear > ts_after_update);
        let clear_event = events_a.try_recv().unwrap();
        assert_eq!(clear_event.user_id, user_a.id);
        assert_eq!(clear_event.collection, "mealTemplates");
        assert_no_invalidation(&mut events_a);

        // AC-1: Empty, no-op, and invalid patches fail with invalid_arguments and no invalidation.
        for bad_args in [
            json!({ "foodId": food_id }),
            json!({ "foodId": food_id, "name": "Avena Mejorada" }),
            json!({ "foodId": food_id, "brand": "   " }),
            json!({ "foodId": food_id, "name": "   " }),
            json!({ "foodId": food_id, "name": null }),
            json!({ "foodId": food_id, "calories": -1.0 }),
            json!({ "foodId": food_id, "typicalTime": "25:00" }),
            json!({ "foodId": food_id, "canonicalUnit": "ml" }),
            json!({ "foodId": food_id, "chileanSeals": ["1", "2", "3", "4", "5"] }),
        ] {
            let err_res = fixture_a.call("update_food", bad_args).await;
            assert_tool_error(&err_res, "invalid_arguments");
            assert_no_invalidation(&mut events_a);
        }

        // AC-2: Duplicate name conflict returns conflict with no invalidation.
        let dup_res = fixture_a
            .call(
                "update_food",
                json!({ "foodId": food_id, "name": "  pan integral  " }),
            )
            .await;
        assert_tool_error(&dup_res, "conflict");
        assert_no_invalidation(&mut events_a);

        // AC-2: Ownership boundary produces identical not_found for missing, foreign, official, ownerless.
        let missing_id = Uuid::new_v4();
        let mut expected_not_found: Option<String> = None;
        for target_id in [
            missing_id,
            foreign_food_id,
            official_food_id,
            ownerless_food_id,
        ] {
            let upd_err = fixture_a
                .call(
                    "update_food",
                    json!({ "foodId": target_id, "calories": 50.0 }),
                )
                .await;
            let msg = assert_tool_error(&upd_err, "not_found");
            if let Some(ref expected) = expected_not_found {
                assert_eq!(msg, expected.as_str());
            } else {
                expected_not_found = Some(msg.to_owned());
            }
            let del_err = fixture_a
                .call("delete_food", json!({ "foodId": target_id }))
                .await;
            assert_eq!(assert_tool_error(&del_err, "not_found"), msg);
            assert_no_invalidation(&mut events_a);
        }

        // AC-4: New log_food after update uses the updated food name and nutrition.
        let log_after_update = fixture_a
            .call(
                "log_food",
                json!({
                    "operationId": Uuid::new_v4(),
                    "foodId": food_id,
                    "quantity": 100.0,
                    "date": "2026-04-11",
                    "time": "09:00"
                }),
            )
            .await;
        assert_eq!(log_after_update["isError"], false);
        assert_eq!(
            log_after_update["structuredContent"]["log"]["name"],
            "Avena Mejorada"
        );
        let log_event = events_a.try_recv().unwrap();
        assert_eq!(log_event.user_id, user_a.id);
        assert_eq!(log_event.collection, "mealLogs");
        assert_no_invalidation(&mut events_a);

        // AC-3: First soft delete succeeds, advances updatedAt, emits mealTemplates invalidation.
        let del_res = fixture_a
            .call("delete_food", json!({ "foodId": food_id }))
            .await;
        assert_eq!(del_res["isError"], false);
        let del_structured = &del_res["structuredContent"];
        assert_valid(&fixture_a.output["delete_food"], del_structured);
        assert_eq!(del_structured["status"], "deleted");
        assert_eq!(del_structured["foodId"], food_id.to_string());
        let ts_after_delete = del_structured["updatedAt"].as_i64().unwrap();
        assert!(ts_after_delete > ts_after_clear);
        let del_event = events_a.try_recv().unwrap();
        assert_eq!(del_event.user_id, user_a.id);
        assert_eq!(del_event.collection, "mealTemplates");
        assert_no_invalidation(&mut events_a);

        // AC-3: Repeated delete is idempotent with stable updatedAt and NO invalidation.
        let del_retry = fixture_a
            .call("delete_food", json!({ "foodId": food_id }))
            .await;
        assert_eq!(del_retry["isError"], false);
        let del_retry_structured = &del_retry["structuredContent"];
        assert_valid(&fixture_a.output["delete_food"], del_retry_structured);
        assert_eq!(del_retry_structured["status"], "alreadyDeleted");
        assert_eq!(
            del_retry_structured["updatedAt"].as_i64().unwrap(),
            ts_after_delete
        );
        assert_no_invalidation(&mut events_a);

        // AC-2: Updating a soft-deleted food returns the identical not_found error.
        let upd_deleted = fixture_a
            .call(
                "update_food",
                json!({ "foodId": food_id, "calories": 10.0 }),
            )
            .await;
        assert_eq!(
            assert_tool_error(&upd_deleted, "not_found"),
            expected_not_found.unwrap()
        );
        assert_no_invalidation(&mut events_a);

        // AC-3: Checkpointed pull_meal_templates from ts_after_clear observes the tombstone.
        let pulled = db
            .sync
            .pull_meal_templates(user_a.id, ts_after_clear, Some(food_id), 10)
            .await
            .unwrap();
        assert!(
            pulled
                .iter()
                .any(|row| row.id == food_id && row.deleted_at == Some(ts_after_delete)),
            "checkpointed pull must expose soft-deleted tombstone"
        );

        // AC-4: New log_food on soft-deleted food fails with not_found.
        let log_deleted = fixture_a
            .call(
                "log_food",
                json!({
                    "operationId": Uuid::new_v4(),
                    "foodId": food_id,
                    "quantity": 50.0,
                    "date": "2026-04-12",
                    "time": "10:00"
                }),
            )
            .await;
        assert_tool_error(&log_deleted, "not_found");

        // AC-4: Historical meal log retains original name, nutrition, portion snapshot, and foodId.
        let daily = fixture_a
            .call("get_daily_log", json!({ "date": "2026-04-10" }))
            .await;
        assert_eq!(daily["isError"], false);
        let item = &daily["structuredContent"]["items"][0];
        assert_eq!(item["id"], log_id);
        assert_eq!(item["foodId"], food_id.to_string());
        assert_eq!(item["name"], "Avena Personal");
        assert_eq!(item["brand"], "Marca Uno");
        assert_eq!(item["canonicalQuantity"], 60.0);
        assert_eq!(item["entry"]["portionSnapshot"]["name"], "Cucharada");

        // Historical log can still be updated using its saved portion conversion.
        let upd_log = fixture_a
            .call(
                "update_food_log",
                json!({ "logId": log_id, "quantity": 3.0 }),
            )
            .await;
        assert_eq!(upd_log["isError"], false);
        assert_eq!(
            upd_log["structuredContent"]["log"]["canonicalQuantity"],
            90.0
        );
        assert_eq!(
            upd_log["structuredContent"]["log"]["foodId"],
            food_id.to_string()
        );

        cleanup_identity_test_database(&fixture_a.db, &schema).await;
    }

    #[tokio::test]
    async fn batch_delete_food_log_schema_and_pre_db_validation() {
        use crate::connectors::{
            imports::ImportDatasource, sync::SyncDatasource, user::UserDatasource,
        };

        let tools = tool_definitions();
        let tool = tools
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == "batch_delete_food_log")
            .expect("batch_delete_food_log tool must be registered");

        assert_eq!(tool["annotations"]["readOnlyHint"], false);
        assert_eq!(tool["annotations"]["destructiveHint"], true);
        assert_eq!(tool["annotations"]["idempotentHint"], true);
        assert_eq!(tool["annotations"]["openWorldHint"], false);

        let input_validator = validator(&tool["inputSchema"], true);
        let output_validator = validator(&tool["outputSchema"], true);

        let one_id = Uuid::new_v4().to_string();
        let thirty_ids: Vec<String> = (0..30).map(|_| Uuid::new_v4().to_string()).collect();
        let thirty_one_ids: Vec<String> = (0..31).map(|_| Uuid::new_v4().to_string()).collect();

        // Valid input boundaries.
        assert_valid(&input_validator, &json!({ "logIds": [one_id] }));
        assert_valid(&input_validator, &json!({ "logIds": thirty_ids }));

        // Invalid inputs rejected by Draft 2020-12 inputSchema.
        assert!(!input_validator.is_valid(&json!({})));
        assert!(!input_validator.is_valid(&json!({ "logIds": [] })));
        assert!(!input_validator.is_valid(&json!({ "logIds": thirty_one_ids })));
        assert!(!input_validator.is_valid(&json!({ "logIds": ["not-a-uuid"] })));
        assert!(!input_validator.is_valid(&json!({ "logIds": [one_id, one_id] })));
        assert!(!input_validator.is_valid(&json!({ "logIds": [one_id], "extra": true })));

        // Valid and invalid outputs against Draft 2020-12 outputSchema.
        assert_valid(
            &output_validator,
            &json!({
                "results": [
                    { "logId": one_id, "status": "deleted", "updatedAt": 1700000000001_i64 },
                    { "logId": Uuid::new_v4(), "status": "alreadyDeleted", "updatedAt": 1700000000000_i64 }
                ],
                "deletedCount": 1,
                "alreadyDeletedCount": 1
            }),
        );
        assert!(!output_validator.is_valid(&json!({
            "results": [],
            "deletedCount": 0,
            "alreadyDeletedCount": 0
        })));
        assert!(!output_validator.is_valid(&json!({
            "results": [{ "logId": one_id, "status": "unknown", "updatedAt": 1 }],
            "deletedCount": 1,
            "alreadyDeletedCount": 0
        })));
        assert!(!output_validator.is_valid(&json!({
            "results": [{ "logId": one_id, "status": "deleted", "updatedAt": 1, "extra": 1 }],
            "deletedCount": 1,
            "alreadyDeletedCount": 0
        })));
        assert!(!output_validator.is_valid(&json!({
            "results": [{ "logId": one_id, "status": "deleted", "updatedAt": 1 }],
            "deletedCount": -1,
            "alreadyDeletedCount": 0
        })));
        assert!(!output_validator.is_valid(&json!({
            "results": [{ "logId": one_id, "status": "deleted", "updatedAt": 1 }],
            "deletedCount": 1,
            "alreadyDeletedCount": 0,
            "extra": true
        })));

        // Pre-DB runtime validation using a lazy disconnected pool must return invalid_arguments
        // without touching PostgreSQL and emit zero SyncHub notifications.
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://synthetic@127.0.0.1:1/unused")
            .unwrap();
        let db = Arc::new(Database {
            user: UserDatasource { pool: pool.clone() },
            sync: SyncDatasource::new(pool.clone()),
            imports: ImportDatasource::new(pool),
        });
        let hub = SyncHub::default();
        let mut events = hub.subscribe();

        let dup_uuid = Uuid::new_v4();
        let dup_lower = dup_uuid.hyphenated().to_string();
        let dup_upper = dup_lower.to_uppercase();
        let dup_simple = dup_uuid.simple().to_string();

        let invalid_cases = vec![
            json!({}),
            json!({ "logIds": "not-an-array" }),
            json!({ "logIds": [] }),
            json!({ "logIds": thirty_one_ids }),
            json!({ "logIds": ["not-a-uuid"] }),
            json!({ "logIds": [dup_lower, dup_lower] }),
            json!({ "logIds": [dup_lower, dup_upper] }),
            json!({ "logIds": [dup_lower, dup_simple] }),
            json!({ "logIds": [dup_lower], "unexpected": 1 }),
        ];

        for case in invalid_cases {
            let res = dispatch(&db, &hub, 1, "batch_delete_food_log", case.clone()).await;
            assert_tool_error(&res, "invalid_arguments");
        }
        assert!(
            events.try_recv().is_err(),
            "validation failures must not emit SyncHub notifications"
        );
    }

    #[tokio::test]
    async fn batch_delete_food_log_contract_and_notifications_postgres() {
        use crate::connectors::user::{
            NewUser, cleanup_identity_test_database, isolated_identity_test_database,
        };

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let user_a = db
            .user
            .provision_identity(
                "https://issuer.example.invalid",
                "bal104-mcp-user-a",
                &NewUser {
                    email: "mcp-bdfl-a@test.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();
        let user_b = db
            .user
            .provision_identity(
                "https://issuer.example.invalid",
                "bal104-mcp-user-b",
                &NewUser {
                    email: "mcp-bdfl-b@test.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();

        let fixture = ContractFixture::new(db, user_a.id);
        let mut events = fixture.hub.subscribe();

        let food_id = Uuid::new_v4();
        fixture
            .seed_food(
                food_id,
                "Manzana Batch",
                &FoodDetails {
                    schema_version: FOOD_SCHEMA_VERSION,
                    canonical_unit: CanonicalUnit::G,
                    nutrition_per100: NutritionValues {
                        calories: 52.0,
                        protein: 0.3,
                        carbs: 14.0,
                        fat: 0.2,
                        fiber: Some(2.4),
                        sodium_mg: None,
                        cholesterol_mg: None,
                        extended_nutrition: Default::default(),
                    },
                    portions: vec![],
                    chilean_seals: vec![],
                    brand: None,
                    category: None,
                    typical_time: None,
                },
            )
            .await;

        async fn create_log(f: &ContractFixture, food_id: Uuid, date: &str, time: &str) -> Uuid {
            let op_id = Uuid::new_v4();
            let res = f
                .success(
                    "log_food",
                    json!({
                        "operationId": op_id,
                        "foodId": food_id,
                        "quantity": 100.0,
                        "date": date,
                        "time": time
                    }),
                )
                .await;
            Uuid::parse_str(res["log"]["id"].as_str().unwrap()).unwrap()
        }

        let log_1 = create_log(&fixture, food_id, "2026-04-15", "08:00").await;
        let log_2 = create_log(&fixture, food_id, "2026-04-15", "09:00").await;
        let log_3 = create_log(&fixture, food_id, "2026-04-15", "10:00").await;
        while events.try_recv().is_ok() {}

        // 1-item delete emits exactly one mealLogs notification.
        let single = fixture
            .success("batch_delete_food_log", json!({ "logIds": [log_1] }))
            .await;
        assert_eq!(single["deletedCount"], 1);
        assert_eq!(single["alreadyDeletedCount"], 0);
        assert_eq!(single["results"][0]["logId"], log_1.to_string());
        assert_eq!(single["results"][0]["status"], "deleted");
        let log_1_ts = single["results"][0]["updatedAt"].as_i64().unwrap();
        fixture.assert_meal_invalidation(&mut events);
        assert!(events.try_recv().is_err());

        // Replay of already-deleted row returns alreadyDeleted with preserved updatedAt and zero notifications.
        let single_replay = fixture
            .success("batch_delete_food_log", json!({ "logIds": [log_1] }))
            .await;
        assert_eq!(single_replay["deletedCount"], 0);
        assert_eq!(single_replay["alreadyDeletedCount"], 1);
        assert_eq!(single_replay["results"][0]["status"], "alreadyDeleted");
        assert_eq!(single_replay["results"][0]["updatedAt"], log_1_ts);
        assert!(
            events.try_recv().is_err(),
            "all-tombstone replay must emit zero SyncHub notifications"
        );

        // Mixed batch preserves request order, keeps tombstone timestamp, advances active rows, and emits 1 notification.
        let mixed = fixture
            .success(
                "batch_delete_food_log",
                json!({ "logIds": [log_3, log_1, log_2] }),
            )
            .await;
        assert_eq!(mixed["deletedCount"], 2);
        assert_eq!(mixed["alreadyDeletedCount"], 1);
        assert_eq!(mixed["results"][0]["logId"], log_3.to_string());
        assert_eq!(mixed["results"][0]["status"], "deleted");
        assert_eq!(mixed["results"][1]["logId"], log_1.to_string());
        assert_eq!(mixed["results"][1]["status"], "alreadyDeleted");
        assert_eq!(mixed["results"][1]["updatedAt"], log_1_ts);
        assert_eq!(mixed["results"][2]["logId"], log_2.to_string());
        assert_eq!(mixed["results"][2]["status"], "deleted");
        fixture.assert_meal_invalidation(&mut events);
        assert!(events.try_recv().is_err());

        // Missing ID or foreign-user ID mixed with valid active ID returns identical generic not_found,
        // performs zero writes, and emits zero notifications.
        let active_keep = create_log(&fixture, food_id, "2026-04-15", "11:00").await;
        while events.try_recv().is_ok() {}
        let foreign_log_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO meal_logs (id, user_id, template_id, name_snapshot, nutrition_snapshot, canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at) \
             VALUES ($1, $2, NULL, 'Foreign Log', '{\"calories\":10,\"protein\":1,\"carbs\":1,\"fat\":0}'::jsonb, 50.0, '{\"mode\":\"canonical\",\"canonicalUnit\":\"g\"}'::jsonb, 1700000000000, 1000, NULL)",
        )
        .bind(foreign_log_id)
        .bind(user_b.id)
        .execute(&fixture.db.sync.pool)
        .await
        .unwrap();

        let missing_id = Uuid::new_v4();
        let err_missing = fixture
            .call(
                "batch_delete_food_log",
                json!({ "logIds": [active_keep, missing_id] }),
            )
            .await;
        let err_foreign = fixture
            .call(
                "batch_delete_food_log",
                json!({ "logIds": [active_keep, foreign_log_id] }),
            )
            .await;
        assert_tool_error(&err_missing, "not_found");
        assert_tool_error(&err_foreign, "not_found");
        assert_eq!(err_missing["content"], err_foreign["content"]);
        let err_text = err_missing["content"][0]["text"].as_str().unwrap();
        assert!(!err_text.contains(&missing_id.to_string()));
        assert!(!err_text.contains(&foreign_log_id.to_string()));
        assert!(!err_text.contains(&active_keep.to_string()));
        assert!(
            events.try_recv().is_err(),
            "not_found rollback must emit zero SyncHub notifications"
        );
        let active_deleted_at: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM meal_logs WHERE id = $1")
                .bind(active_keep)
                .fetch_one(&fixture.db.sync.pool)
                .await
                .unwrap();
        assert_eq!(active_deleted_at, None);

        // 30-item batch succeeds, preserves order, emits 1 notification, and is visible in pull_meal_logs.
        let mut thirty_ids = Vec::with_capacity(MAX_BATCH_DELETE_FOOD_LOG_IDS);
        for idx in 0..MAX_BATCH_DELETE_FOOD_LOG_IDS {
            let id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO meal_logs (id, user_id, template_id, name_snapshot, nutrition_snapshot, canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at) \
                 VALUES ($1, $2, NULL, 'Batch Item', '{\"calories\":10,\"protein\":1,\"carbs\":1,\"fat\":0}'::jsonb, 10.0, '{\"mode\":\"canonical\",\"canonicalUnit\":\"g\"}'::jsonb, $3, 5000, NULL)",
            )
            .bind(id)
            .bind(user_a.id)
            .bind(1_700_000_000_000_i64 + idx as i64)
            .execute(&fixture.db.sync.pool)
            .await
            .unwrap();
            thirty_ids.push(id);
        }
        let batch_30 = fixture
            .success("batch_delete_food_log", json!({ "logIds": thirty_ids }))
            .await;
        assert_eq!(batch_30["deletedCount"], 30);
        assert_eq!(batch_30["alreadyDeletedCount"], 0);
        let returned_30: Vec<String> = batch_30["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["logId"].as_str().unwrap().to_owned())
            .collect();
        let expected_30: Vec<String> = thirty_ids.iter().map(Uuid::to_string).collect();
        assert_eq!(returned_30, expected_30);
        fixture.assert_meal_invalidation(&mut events);
        assert!(events.try_recv().is_err());

        let pulled = fixture
            .db
            .sync
            .pull_meal_logs(user_a.id, 5000, None, 100)
            .await
            .unwrap();
        for id in &thirty_ids {
            let row = pulled
                .iter()
                .find(|r| r.id == *id)
                .expect("row must be pulled");
            assert_eq!(row.deleted_at, Some(row.updated_at));
        }

        cleanup_identity_test_database(&fixture.db, &schema).await;
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
