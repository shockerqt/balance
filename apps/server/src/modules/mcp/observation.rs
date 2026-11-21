//! Bounded, value-free MCP diagnostics. Never retain request/response payloads.

use std::{
    ffi::OsStr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    Router,
    body::HttpBody,
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::Response,
};
use serde_json::Value;
use tracing_subscriber::{EnvFilter, filter::LevelFilter};
use uuid::Uuid;

const TARGET: &str = "balance_mcp_observation";
const WINDOW: Duration = Duration::from_secs(60);
const MAX_TEXT_BYTES: usize = 16_384;
const MAX_NODES: usize = 512;
const MAX_DEPTH: usize = 32;
const MAX_CONTENT_BLOCKS: usize = 16;
const MAX_ENTRIES: usize = 64;

/// Preserve the previous lossy ERROR fallback for every present environment
/// value. Only true absence adds the narrowly scoped informational target.
pub fn logging_filter(value: Option<&OsStr>) -> EnvFilter {
    let filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::ERROR.into())
        .parse_lossy(value.and_then(OsStr::to_str).unwrap_or_default());
    if value.is_none() {
        filter.add_directive(
            "balance_mcp_observation=info"
                .parse()
                .expect("static directive"),
        )
    } else {
        filter
    }
}

pub fn observe_routes(router: Router) -> Router {
    static OBSERVER: OnceLock<Arc<Observer>> = OnceLock::new();
    observe_with(
        router,
        OBSERVER.get_or_init(|| Arc::new(Observer::new())).clone(),
    )
}

fn observe_with(router: Router, observer: Arc<Observer>) -> Router {
    router.route_layer(middleware::from_fn_with_state(observer, observe_request))
}

struct Observer {
    budget: Mutex<EmissionBudget>,
}

#[derive(Clone, Copy)]
enum EventClass {
    Background,
    KnownToolSuccess,
    MethodNotAllowed,
    OtherClientError,
    ServerError,
    Abandoned,
    ToolError,
    JsonRpcError,
}

const CLASS_COUNT: usize = EventClass::JsonRpcError as usize + 1;
type Suppressions = [u64; CLASS_COUNT];

impl EventClass {
    const fn limit(self) -> u8 {
        match self {
            Self::KnownToolSuccess => 12,
            _ => 8,
        }
    }
}

impl Observer {
    fn new() -> Self {
        Self {
            budget: Mutex::new(EmissionBudget::new(Instant::now())),
        }
    }

    fn permit(&self, class: EventClass) -> bool {
        if !tracing::enabled!(target: TARGET, tracing::Level::INFO) {
            return false;
        }
        let (allowed, summary) = self
            .budget
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .permit(Instant::now(), class);
        if let Some(counts) = summary {
            write_summary(counts);
        }
        allowed
    }
}

fn write_summary(counts: Suppressions) {
    let build = server::build_identity::compiled_identity();
    tracing::info!(target: TARGET, parent: None,
        event = "suppressed", source_sha = build.source_sha, build_run = build.build_run,
        suppressed_background = counts[EventClass::Background as usize],
        suppressed_known_tool_success = counts[EventClass::KnownToolSuccess as usize],
        suppressed_method_not_allowed = counts[EventClass::MethodNotAllowed as usize],
        suppressed_other_client_error = counts[EventClass::OtherClientError as usize],
        suppressed_server_error = counts[EventClass::ServerError as usize],
        suppressed_abandoned = counts[EventClass::Abandoned as usize],
        suppressed_tool_error = counts[EventClass::ToolError as usize],
        suppressed_json_rpc_error = counts[EventClass::JsonRpcError as usize]);
}

struct EmissionBudget {
    started: Instant,
    admitted: [u8; CLASS_COUNT],
    suppressed: Suppressions,
}

impl EmissionBudget {
    fn new(now: Instant) -> Self {
        Self {
            started: now,
            admitted: [0; CLASS_COUNT],
            suppressed: [0; CLASS_COUNT],
        }
    }

    fn permit(&mut self, now: Instant, class: EventClass) -> (bool, Option<Suppressions>) {
        let mut summary = None;
        if now.saturating_duration_since(self.started) >= WINDOW {
            self.started = now;
            self.admitted = [0; CLASS_COUNT];
            let counts = std::mem::take(&mut self.suppressed);
            // At most one carried summary can be emitted at rollover.
            if counts.iter().any(|&count| count != 0) {
                summary = Some(counts);
            }
        }
        let index = class as usize;
        let allowed = self.admitted[index] < class.limit();
        if allowed {
            self.admitted[index] += 1;
        } else {
            self.suppressed[index] = self.suppressed[index].saturating_add(1);
        }
        (allowed, summary)
    }
}

#[derive(Clone)]
pub(super) struct Observation(Arc<RequestContext>);

struct RequestContext {
    observer: Arc<Observer>,
    correlation: Uuid,
    http_method: &'static str,
    started: Instant,
    details: Mutex<Details>,
}

#[derive(Clone, Copy)]
struct Details {
    method: &'static str,
    tool: &'static str,
    outcome: &'static str,
    error_class: &'static str,
    tool_preparation_attempted: bool,
}

impl Default for Details {
    fn default() -> Self {
        Self {
            method: "not_observed",
            tool: "not_applicable",
            outcome: "http_rejected",
            error_class: "none",
            tool_preparation_attempted: false,
        }
    }
}

impl Observation {
    fn new(observer: Arc<Observer>, method: &Method) -> Self {
        Self(Arc::new(RequestContext {
            observer,
            correlation: Uuid::new_v4(),
            http_method: match *method {
                Method::GET => "GET",
                Method::POST => "POST",
                Method::DELETE => "DELETE",
                Method::OPTIONS => "OPTIONS",
                _ => "other",
            },
            started: Instant::now(),
            details: Mutex::new(Details::default()),
        }))
    }

    fn elapsed_ms(&self) -> u64 {
        u64::try_from(self.0.started.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    pub(super) fn request(&self, method: &str, tool: Option<&str>) {
        let mut details = self.0.details.lock().unwrap_or_else(|e| e.into_inner());
        details.method = match method {
            "initialize" => "initialize",
            "notifications/initialized" => "initialized",
            "ping" => "ping",
            "tools/list" => "tools_list",
            "tools/call" => "tools_call",
            _ => "unknown",
        };
        details.tool = tool.map_or("not_applicable", |tool| {
            known_tool(tool).unwrap_or("unknown")
        });
        details.outcome = "protocol_success";
    }

    pub(super) fn outcome(&self, outcome: &'static str) {
        self.0
            .details
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .outcome = outcome;
    }

    pub(super) fn result(&self, response: &Response, result: &Value, error_class: &'static str) {
        self.with_result_inspector(response, result, error_class, Shape::inspect);
    }

    fn with_result_inspector(
        &self,
        response: &Response,
        result: &Value,
        error_class: &'static str,
        inspect: impl FnOnce(&Value, &str) -> Shape,
    ) {
        let duration_ms = self.elapsed_ms();
        let status = response.status();
        if status.is_client_error() || status.is_server_error() {
            return;
        }
        let is_error = result.get("isError").and_then(Value::as_bool) == Some(true);
        let details = {
            let mut details = self.0.details.lock().unwrap_or_else(|e| e.into_inner());
            if details.tool_preparation_attempted {
                return;
            }
            details.tool_preparation_attempted = true;
            details.outcome = if is_error {
                "tool_error"
            } else {
                "tool_success"
            };
            details.error_class = error_class;
            *details
        };
        let class = if is_error {
            EventClass::ToolError
        } else if details.method == "tools_call" && known_tool(details.tool).is_some() {
            EventClass::KnownToolSuccess
        } else {
            EventClass::Background
        };
        if self.0.observer.permit(class) {
            self.write_event(
                "tool_result_prepared",
                ResponseFields::from_response(response),
                details,
                inspect(result, details.tool),
                duration_ms,
            );
        }
    }

    fn response_prepared(&self, response: &Response) {
        let mut details = *self.0.details.lock().unwrap_or_else(|e| e.into_inner());
        let status = response.status();
        let class = if status.is_client_error() || status.is_server_error() {
            details.outcome = "http_rejected";
            details.error_class = match status {
                StatusCode::UNAUTHORIZED => "auth_unauthorized",
                StatusCode::FORBIDDEN => "http_forbidden",
                StatusCode::METHOD_NOT_ALLOWED => "method_not_allowed",
                _ if response
                    .extensions()
                    .get::<super::JsonExtractorRejected>()
                    .is_some() =>
                {
                    "json_rejected"
                }
                _ if status.is_client_error() => "http_client_error",
                _ => "http_server_error",
            };
            match status {
                StatusCode::METHOD_NOT_ALLOWED => EventClass::MethodNotAllowed,
                _ if status.is_client_error() => EventClass::OtherClientError,
                _ => EventClass::ServerError,
            }
        } else if details.tool_preparation_attempted {
            return;
        } else if details.outcome == "json_rpc_error" {
            EventClass::JsonRpcError
        } else {
            EventClass::Background
        };
        if self.0.observer.permit(class) {
            self.write_event(
                "response_prepared",
                ResponseFields::from_response(response),
                details,
                Shape::default(),
                self.elapsed_ms(),
            );
        }
    }

    fn abandoned(&self) {
        if self.0.observer.permit(EventClass::Abandoned) {
            let mut details = *self.0.details.lock().unwrap_or_else(|e| e.into_inner());
            details.outcome = "abandoned";
            details.error_class = "abandoned";
            self.write_event(
                "abandoned",
                ResponseFields::default(),
                details,
                Shape::default(),
                self.elapsed_ms(),
            );
        }
    }

    fn arrived(&self) {
        if self.0.observer.permit(EventClass::Background) {
            let build = server::build_identity::compiled_identity();
            tracing::info!(target: TARGET, parent: None,
                event = "arrived", correlation = %self.0.correlation,
                source_sha = build.source_sha, build_run = build.build_run,
                http_method = self.0.http_method);
        }
    }

    fn write_event(
        &self,
        event: &'static str,
        response: ResponseFields,
        details: Details,
        shape: Shape,
        duration_ms: u64,
    ) {
        let build = server::build_identity::compiled_identity();
        let entries_checked = shape.checked_entries > 0;
        tracing::info!(target: TARGET, parent: None,
            event, correlation = %self.0.correlation,
            source_sha = build.source_sha, build_run = build.build_run,
            duration_ms, http_method = self.0.http_method, http_status = response.status,
            response_bytes = response.bytes, method = details.method, tool = details.tool,
            outcome = details.outcome, error_class = details.error_class,
            content_blocks = shape.content_blocks, text_blocks = shape.text_blocks,
            structured = shape.structured, collection_count = shape.collection_count,
            checked_entries = entries_checked.then_some(shape.checked_entries),
            entry_inspection = entries_checked.then_some(shape.entry_inspection),
            checked_date_strings = entries_checked.then_some(shape.date_strings),
            checked_weight_numbers = entries_checked.then_some(shape.weight_numbers),
            first_text_json = shape.first_text_json);
    }
}

#[derive(Default)]
struct ResponseFields {
    status: Option<u16>,
    bytes: Option<u64>,
}

impl ResponseFields {
    fn from_response(response: &Response) -> Self {
        Self {
            status: Some(response.status().as_u16()),
            bytes: response.body().size_hint().exact(),
        }
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

struct Completion {
    observation: Observation,
    completed: bool,
}

impl Drop for Completion {
    fn drop(&mut self) {
        if !self.completed {
            self.observation.abandoned();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::{
        db::Database, imports::ImportDatasource, sync::SyncDatasource, user::UserDatasource,
    };
    use crate::modules::{
        auth::{
            middleware::{CurrentUser, auth},
            oidc::OidcConfig,
        },
        sync::hub::SyncHub,
    };
    use axum::{
        Extension, Json,
        body::{Body, to_bytes},
        http::{Request as HttpRequest, header},
        response::IntoResponse,
        routing::post,
    };
    use serde_json::json;
    use std::{
        io::{self, Write},
        sync::atomic::{AtomicUsize, Ordering},
    };
    use tower::ServiceExt;
    use tracing::instrument::WithSubscriber;

    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<u8>>>);
    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
        type Writer = Self;
        fn make_writer(&'a self) -> Self {
            self.clone()
        }
    }
    impl Capture {
        fn text(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }
    }

    fn request(body: &str) -> HttpRequest<Body> {
        HttpRequest::builder()
            .method("POST")
            .uri("/mcp?private=URI_SECRET")
            .header("content-type", "application/json")
            .header("authorization", "Bearer TOKEN_SECRET")
            .header("x-private", "HEADER_SECRET")
            .body(Body::from(body.to_owned()))
            .unwrap()
    }

    fn lazy_database() -> Arc<Database> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://synthetic@127.0.0.1:1/unused")
            .unwrap();
        Arc::new(Database {
            user: UserDatasource { pool: pool.clone() },
            sync: SyncDatasource::new(pool.clone()),
            imports: ImportDatasource::new(pool),
        })
    }

    fn handler_router() -> Router {
        super::super::mcp_routes()
            .layer(Extension(lazy_database()))
            .layer(Extension(SyncHub::default()))
            .layer(Extension(CurrentUser { id: 987654321 }))
    }

    // Protocol paths use the real handler; only the query result is supplied by
    // a synthetic fixture, then passed through the real final-result helper.
    async fn history_fixture_handler(
        db: Extension<Arc<Database>>,
        hub: Extension<SyncHub>,
        user: Extension<CurrentUser>,
        observation: Option<Extension<Observation>>,
        Json(payload): Json<super::super::JsonRpcRequest>,
    ) -> Response {
        if payload.method == "tools/call"
            && payload
                .params
                .as_ref()
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                == Some("get_weight_history")
        {
            let observation = observation.as_ref().map(|Extension(value)| value);
            if let Some(observation) = observation {
                observation.request("tools/call", Some("get_weight_history"));
            }
            return super::super::tool_success(
                payload.id.unwrap_or(Value::Null),
                "RESULT_SECRET",
                json!({"entries":[
                    {"date":"2099-01-01","weightKg":123.4},
                    {"date":"2099-01-02","weightKg":234.5},
                    {"date":"2099-01-03","weightKg":345.6}
                ]}),
                observation,
            );
        }
        super::super::mcp_post_handler(db, hub, user, observation, Ok(Json(payload)))
            .await
            .into_response()
    }

    fn history_fixture_router() -> Router {
        Router::new()
            .route("/mcp", post(history_fixture_handler))
            .layer(Extension(lazy_database()))
            .layer(Extension(SyncHub::default()))
            .layer(Extension(CurrentUser { id: 987654321 }))
    }

    fn auth_router() -> Router {
        super::super::mcp_routes()
            .route_layer(middleware::from_fn_with_state(
                OidcConfig::test_cached_subject_config().mcp_config(),
                auth,
            ))
            .layer(Extension(lazy_database()))
    }

    fn unauthenticated_request() -> HttpRequest<Body> {
        HttpRequest::post("/mcp?private=URI_SECRET")
            .body(Body::from("PRIVATE_BODY"))
            .unwrap()
    }

    async fn poll_and_drop(router: Router, body: &str) {
        let mut future = Box::pin(router.oneshot(request(body)));
        std::future::poll_fn(|cx| {
            assert!(future.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        drop(future);
    }

    async fn pending() -> Response {
        std::future::pending().await
    }

    async fn assert_wire(baseline: Response, observed: Response, status: StatusCode) -> usize {
        assert_eq!(observed.status(), status);
        assert_eq!(baseline.status(), status);
        assert_eq!(observed.headers(), baseline.headers());
        let body = to_bytes(observed.into_body(), usize::MAX).await.unwrap();
        let expected = to_bytes(baseline.into_body(), usize::MAX).await.unwrap();
        assert_eq!(body, expected);
        body.len()
    }

    fn assert_event(output: &str, fields: &[&str]) {
        assert!(
            output.lines().any(|line| fields
                .iter()
                .all(|field| line.split_whitespace().any(|token| token == *field))),
            "missing event with {fields:?} in {output}"
        );
    }

    #[tokio::test]
    async fn startup_and_method_rejections_cannot_hide_other_event_classes() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            let observer = Arc::new(Observer::new());
            let handler = observe_with(handler_router(), observer.clone());
            for _ in 0..10 {
                let response = handler.clone().oneshot(request(
                    r#"{"jsonrpc":"2.0","id":"RPC_SECRET","method":"initialize"}"#,
                )).await.unwrap();
                assert_eq!(response.status(), StatusCode::OK);
            }
            for attempt in 0..10 {
                let response = handler.clone().oneshot(
                    HttpRequest::get("/mcp").body(Body::empty()).unwrap(),
                ).await.unwrap();
                assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
                assert_eq!(
                    capture.text().matches("error_class=\"method_not_allowed\"").count(),
                    (attempt + 1).min(8),
                );
            }
            let auth = observe_with(auth_router(), observer.clone())
                .oneshot(unauthenticated_request()).await.unwrap();
            assert_eq!(auth.status(), StatusCode::UNAUTHORIZED);
            assert!(auth.headers().contains_key(header::WWW_AUTHENTICATE));

            for status in [StatusCode::FORBIDDEN, StatusCode::INTERNAL_SERVER_ERROR] {
                let router = Router::new().route("/mcp", post(move || async move { status }));
                let response = observe_with(router, observer.clone()).oneshot(request("{}")).await.unwrap();
                assert_eq!(response.status(), status);
            }
            let pending_router = Router::new().route("/mcp", post(pending));
            poll_and_drop(observe_with(pending_router, observer.clone()), "{}").await;

            for (body, status) in [
                ("[]", StatusCode::UNPROCESSABLE_ENTITY),
                (r#"{"jsonrpc":"2.0","id":"RPC_SECRET","method":"tools/call","params":{"name":"search_foods","arguments":{}}}"#, StatusCode::OK),
                (r#"{"jsonrpc":"2.0","id":"RPC_SECRET","method":"tools/call","params":{"name":"UNKNOWN_SECRET"}}"#, StatusCode::OK),
                (r#"{"jsonrpc":"2.0","id":"RPC_SECRET","method":"METHOD_SECRET"}"#, StatusCode::OK),
            ] {
                assert_eq!(handler.clone().oneshot(request(body)).await.unwrap().status(), status);
            }
            let response = observe_with(history_fixture_router(), observer.clone())
                .oneshot(request(r#"{"jsonrpc":"2.0","id":"RPC_SECRET","method":"tools/call","params":{"name":"get_weight_history","arguments":{"private":"ARG_SECRET"}}}"#))
                .await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap().len();
            assert_event(&capture.text(), &["outcome=\"tool_success\"", &format!("response_bytes={bytes}")]);
            assert_eq!(observer.budget.lock().unwrap().admitted, [8, 1, 8, 3, 1, 1, 2, 1]);
        }.with_subscriber(subscriber).await;

        let output = capture.text();
        for (status, class) in [
            (401, "auth_unauthorized"),
            (403, "http_forbidden"),
            (422, "json_rejected"),
            (500, "http_server_error"),
        ] {
            assert_event(
                &output,
                &[
                    &format!("http_status={status}"),
                    &format!("error_class=\"{class}\""),
                ],
            );
        }
        for tool in ["search_foods", "unknown"] {
            assert_event(
                &output,
                &[
                    "http_status=200",
                    "outcome=\"tool_error\"",
                    "error_class=\"invalid_arguments\"",
                    &format!("tool=\"{tool}\""),
                ],
            );
        }
        assert_event(&output, &["http_status=200", "outcome=\"json_rpc_error\""]);
        assert_event(&output, &["event=\"abandoned\""]);
        let terminal = output
            .lines()
            .find(|line| line.contains("outcome=\"tool_success\""))
            .unwrap();
        for expected in [
            "event=\"tool_result_prepared\"",
            "tool=\"get_weight_history\"",
            "content_blocks=1",
            "text_blocks=1",
            "structured=true",
            "collection_count=3",
            "checked_entries=3",
            "checked_date_strings=\"all\"",
            "checked_weight_numbers=\"all\"",
            "first_text_json=\"matches\"",
        ] {
            assert!(terminal.contains(expected), "missing safe field {expected}");
        }
        let correlation = terminal
            .split("correlation=")
            .nth(1)
            .unwrap()
            .split_whitespace()
            .next()
            .unwrap();
        assert!(
            !output
                .lines()
                .any(|line| line.contains("event=\"arrived\"") && line.contains(correlation))
        );
        for secret in [
            "RESULT_SECRET",
            "RPC_SECRET",
            "ARG_SECRET",
            "TOKEN_SECRET",
            "URI_SECRET",
            "HEADER_SECRET",
            "UNKNOWN_SECRET",
            "METHOD_SECRET",
            "2099-01-",
            "123.4",
            "234.5",
            "345.6",
        ] {
            assert!(!output.contains(secret), "private fixture leaked");
        }
    }

    #[tokio::test]
    async fn actual_handler_preserves_wire_and_redacts_unknown_labels_arguments_and_ids() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            for (payload, outcome) in [
                (json!({"jsonrpc":"2.0","id":"ID_SECRET","method":"METHOD_SECRET","params":{"secret":"ARG_SECRET"}}), "json_rpc_error"),
                (json!({"jsonrpc":"2.0","id":"ID_SECRET","method":"tools/call","params":{"name":"TOOL_SECRET","arguments":{"secret":"ARG_SECRET"}}}), "tool_error"),
                (json!({"jsonrpc":"bad","id":"ID_SECRET","method":"ping"}), "json_rpc_error"),
                (json!({"jsonrpc":"2.0","id":"ID_SECRET","method":"tools/list"}), "protocol_success"),
            ] {
                let raw = payload.to_string();
                let baseline = handler_router().oneshot(request(&raw)).await.unwrap();
                let observed = observe_with(handler_router(), Arc::new(Observer::new())).oneshot(request(&raw)).await.unwrap();
                let bytes = assert_wire(baseline, observed, StatusCode::OK).await;
                assert_event(&capture.text(), &["http_status=200", &format!("outcome=\"{outcome}\""),
                    &format!("response_bytes={bytes}")]);
            }
        }.with_subscriber(subscriber).await;
        let output = capture.text();
        for secret in [
            "URI_SECRET",
            "TOKEN_SECRET",
            "ID_SECRET",
            "HEADER_SECRET",
            "METHOD_SECRET",
            "TOOL_SECRET",
            "ARG_SECRET",
            "987654321",
        ] {
            assert!(!output.contains(secret), "leaked sentinel {secret}");
        }
        assert!(output.contains("method=\"unknown\""));
        assert!(output.contains("tool=\"unknown\""));
        assert!(output.contains("outcome=\"tool_error\""));
        assert!(output.contains("error_class=\"invalid_arguments\""));
        assert!(output.contains("outcome=\"json_rpc_error\""));
    }

    #[tokio::test]
    async fn http_metadata_preserves_stock_rejection_wire_and_distinguishes_the_extractor() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            let baseline = auth_router()
                .oneshot(unauthenticated_request())
                .await
                .unwrap();
            let response = observe_with(auth_router(), Arc::new(Observer::new()))
                .oneshot(unauthenticated_request())
                .await
                .unwrap();
            let config = OidcConfig::test_cached_subject_config().mcp_config();
            assert_eq!(
                response.headers()[header::WWW_AUTHENTICATE],
                *config.challenge()
            );
            let bytes = assert_wire(baseline, response, StatusCode::UNAUTHORIZED).await;
            assert_event(
                &capture.text(),
                &[
                    "http_method=\"POST\"",
                    "http_status=401",
                    "error_class=\"auth_unauthorized\"",
                    &format!("response_bytes={bytes}"),
                ],
            );

            for (body, status) in [
                (
                    "{\"jsonrpc\":, \"BODY_SECRET\": true}",
                    StatusCode::BAD_REQUEST,
                ),
                (
                    r#"[{"jsonrpc":"2.0","method":"BODY_SECRET"}]"#,
                    StatusCode::UNPROCESSABLE_ENTITY,
                ),
            ] {
                let stock = Router::new().route(
                    "/mcp",
                    post(|Json(_): Json<super::super::JsonRpcRequest>| async { StatusCode::OK }),
                );
                let baseline = stock.oneshot(request(body)).await.unwrap();
                let observed = observe_with(handler_router(), Arc::new(Observer::new()))
                    .oneshot(request(body))
                    .await
                    .unwrap();
                let bytes = assert_wire(baseline, observed, status).await;
                assert_event(
                    &capture.text(),
                    &[
                        &format!("http_status={}", status.as_u16()),
                        "error_class=\"json_rejected\"",
                        &format!("response_bytes={bytes}"),
                    ],
                );
            }

            let get = || HttpRequest::get("/mcp").body(Body::empty()).unwrap();
            let baseline = handler_router().oneshot(get()).await.unwrap();
            let observed = observe_with(handler_router(), Arc::new(Observer::new()))
                .oneshot(get())
                .await
                .unwrap();
            assert_eq!(observed.headers()[header::ALLOW], "POST");
            assert_wire(baseline, observed, StatusCode::METHOD_NOT_ALLOWED).await;
            assert_event(
                &capture.text(),
                &[
                    "http_method=\"GET\"",
                    "http_status=405",
                    "error_class=\"method_not_allowed\"",
                ],
            );

            for (method, label, status, class) in [
                (
                    Method::DELETE,
                    "DELETE",
                    StatusCode::FORBIDDEN,
                    "http_forbidden",
                ),
                (
                    Method::OPTIONS,
                    "OPTIONS",
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "http_server_error",
                ),
                (
                    Method::from_bytes(b"PRIVATE_METHOD").unwrap(),
                    "other",
                    StatusCode::METHOD_NOT_ALLOWED,
                    "method_not_allowed",
                ),
            ] {
                let router = || {
                    let endpoint = move || async move {
                        (
                            status,
                            [("x-private-response", "RESPONSE_HEADER_SECRET")],
                            "PAYLOAD_SECRET",
                        )
                    };
                    Router::new().route("/mcp", post(endpoint).delete(endpoint).options(endpoint))
                };
                let req = || {
                    HttpRequest::builder()
                        .method(method.clone())
                        .uri("/mcp")
                        .body(Body::empty())
                        .unwrap()
                };
                let baseline = router().oneshot(req()).await.unwrap();
                let observed = observe_with(router(), Arc::new(Observer::new()))
                    .oneshot(req())
                    .await
                    .unwrap();
                let bytes = assert_wire(baseline, observed, status).await;
                assert_event(
                    &capture.text(),
                    &[
                        &format!("http_method=\"{label}\""),
                        &format!("http_status={}", status.as_u16()),
                        &format!("error_class=\"{class}\""),
                        &format!("response_bytes={bytes}"),
                    ],
                );
            }

            let router =
                || Router::new().route("/mcp", post(|| async { StatusCode::UNPROCESSABLE_ENTITY }));
            assert_wire(
                router().oneshot(request("{}")).await.unwrap(),
                observe_with(router(), Arc::new(Observer::new()))
                    .oneshot(request("{}"))
                    .await
                    .unwrap(),
                StatusCode::UNPROCESSABLE_ENTITY,
            )
            .await;
            assert_event(
                &capture.text(),
                &["http_status=422", "error_class=\"http_client_error\""],
            );
        }
        .with_subscriber(subscriber)
        .await;

        let output = capture.text();
        for secret in [
            "PRIVATE_BODY",
            "BODY_SECRET",
            "PRIVATE_METHOD",
            "PAYLOAD_SECRET",
            "RESPONSE_HEADER_SECRET",
        ] {
            assert!(!output.contains(secret), "leaked {secret}");
        }
    }

    #[tokio::test]
    async fn exact_success_result_shape_and_safe_failure_classes_do_not_log_values() {
        async fn endpoint(
            observation: Option<Extension<Observation>>,
            Json(payload): Json<Value>,
        ) -> Response {
            let observation = observation.as_ref().map(|Extension(value)| value);
            if let Some(observation) = observation {
                observation.request("tools/call", Some("get_weight_history"));
            }
            match payload["kind"].as_str().unwrap() {
                "oversize" => super::super::tool_success(
                    json!("RPC_SECRET"),
                    &format!("LARGE_TEXT_SECRET{}", "x".repeat(MAX_TEXT_BYTES)),
                    json!({"entries":[]}),
                    observation,
                ),
                "success" => super::super::tool_success(
                    json!("RPC_SECRET"),
                    "SUMMARY_SECRET",
                    json!({"entries":[{"date":"2099-12-31", "weightKg": 123.4, "name":"VALUE_SECRET", "nutrition":987.654}]}),
                    observation,
                ),
                "bad_request" => super::super::tool_failure(
                    Value::Null,
                    crate::shared::error::AppError::BadRequest("RAW_ERROR_SECRET".into()),
                    observation,
                ),
                "db" => super::super::tool_failure(
                    Value::Null,
                    crate::shared::error::AppError::Db(sqlx::Error::Protocol("DB_SECRET".into())),
                    observation,
                ),
                _ => super::super::tool_failure(
                    Value::Null,
                    crate::shared::error::AppError::Internal("ERROR_SECRET".into()),
                    observation,
                ),
            }
        }
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            for kind in ["success", "oversize", "bad_request", "db", "internal"] {
                let router = || Router::new().route("/mcp", post(endpoint));
                let payload = json!({"kind":kind}).to_string();
                let baseline = router().oneshot(request(&payload)).await.unwrap();
                let response = observe_with(router(), Arc::new(Observer::new()))
                    .oneshot(request(&payload))
                    .await
                    .unwrap();
                let bytes = assert_wire(baseline, response, StatusCode::OK).await;
                let classification = match kind {
                    "oversize" => {
                        assert!(bytes > MAX_TEXT_BYTES);
                        "first_text_json=\"not_checked\""
                    }
                    "success" => "first_text_json=\"matches\"",
                    "bad_request" => "error_class=\"invalid_arguments\"",
                    "db" => "error_class=\"database_error\"",
                    _ => "error_class=\"internal_error\"",
                };
                assert_event(
                    &capture.text(),
                    &[
                        "event=\"tool_result_prepared\"",
                        "http_status=200",
                        &format!("response_bytes={bytes}"),
                        classification,
                    ],
                );
            }
        }
        .with_subscriber(subscriber)
        .await;
        let output = capture.text();
        for secret in [
            "RPC_SECRET",
            "SUMMARY_SECRET",
            "LARGE_TEXT_SECRET",
            "987.654",
            "VALUE_SECRET",
            "DB_SECRET",
            "ERROR_SECRET",
            "RAW_ERROR_SECRET",
            "2099-12-31",
            "123.4",
        ] {
            assert!(!output.contains(secret), "leaked {secret}");
        }
        for expected in [
            "content_blocks=1",
            "text_blocks=1",
            "collection_count=1",
            "checked_entries=1",
            "checked_date_strings=\"all\"",
            "checked_weight_numbers=\"all\"",
            "first_text_json=\"matches\"",
            "error_class=\"database_error\"",
            "error_class=\"internal_error\"",
        ] {
            assert!(output.contains(expected), "missing {expected}: {output}");
        }
        let ids: Vec<_> = output
            .lines()
            .filter(|line| line.contains("event=\"arrived\""))
            .map(|line| {
                line.split("correlation=")
                    .nth(1)
                    .unwrap()
                    .split_whitespace()
                    .next()
                    .unwrap()
            })
            .collect();
        assert_eq!(ids.len(), 5);
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            ids.len()
        );
        let identity = server::build_identity::compiled_identity();
        for line in output.lines() {
            let id = line
                .split("correlation=")
                .nth(1)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap();
            assert_eq!(Uuid::parse_str(id).unwrap().get_version_num(), 4);
            assert!(ids.contains(&id));
            assert!(line.contains(&format!("source_sha=\"{}\"", identity.source_sha)));
            assert!(line.contains(&format!("build_run=\"{}\"", identity.build_run)));
        }
    }

    #[test]
    fn shape_reads_json_embedded_after_the_summary_in_a_single_text_block() {
        let structured = json!({"entries":[{"date":"2026-11-10","weightKg":78.4,"updatedAt":1}]});
        let text = super::super::readable_tool_text("Hay 1 registro de peso.", &structured);
        let result =
            json!({"content":[{"type":"text","text":text}],"structuredContent":structured});
        let shape = Shape::inspect(&result, "get_weight_history");
        assert_eq!(shape.text_blocks, Some(1));
        assert_eq!(shape.first_text_json, "matches");
        assert_eq!(shape.date_strings, "all");
        assert_eq!(shape.weight_numbers, "all");
        let summary_only = json!({"content":[{"type":"text","text":"Hay 1 registro de peso."}],"structuredContent":structured});
        assert_eq!(
            Shape::inspect(&summary_only, "get_weight_history").first_text_json,
            "invalid_json"
        );
    }

    #[test]
    fn shape_checks_empty_invalid_mismatched_oversize_and_partial_results_honestly() {
        let result = |structured: Value, text: &str| json!({"content":[{"type":"text","text":text}],"structuredContent":structured});
        let shape = Shape::inspect(
            &result(json!({"entries":[]}), "{\"entries\":[]}"),
            "get_weight_history",
        );
        assert_eq!(shape.collection_count, Some(0));
        assert_eq!(shape.date_strings, "not_applicable");
        assert_eq!(shape.checked_entries, 0);
        assert_eq!(shape.first_text_json, "matches");
        assert_eq!(
            Shape::inspect(&result(json!({"entries":[]}), "{}"), "get_weight_history")
                .first_text_json,
            "differs"
        );
        assert_eq!(
            Shape::inspect(&result(Value::Null, "null"), "get_weight_history").first_text_json,
            "matches"
        );
        assert_eq!(
            Shape::inspect(&result(json!({}), "invalid"), "get_weight_history").first_text_json,
            "invalid_json"
        );
        assert_eq!(
            Shape::inspect(
                &result(json!({}), &"x".repeat(MAX_TEXT_BYTES + 1)),
                "get_weight_history"
            )
            .first_text_json,
            "not_checked"
        );
        let large =
            json!({"entries": vec![json!({"date":"SYNTHETIC", "weightKg":12.3}); MAX_ENTRIES + 1]});
        let shape = Shape::inspect(
            &result(large.clone(), &large.to_string()),
            "get_weight_history",
        );
        assert_eq!(shape.entry_inspection, "partial");
        assert_eq!(shape.checked_entries, MAX_ENTRIES);
        let bad_types = json!({"entries":[{"date":null,"weightKg":"not numeric"}]});
        let shape = Shape::inspect(
            &result(bad_types.clone(), &bad_types.to_string()),
            "get_weight_history",
        );
        assert_eq!(shape.date_strings, "not_all");
        assert_eq!(shape.weight_numbers, "not_all");
        let escaped = json!({"entries":[], "name":"quotes\"\n 🥣"});
        assert_eq!(
            Shape::inspect(
                &result(escaped.clone(), &escaped.to_string()),
                "get_weight_history"
            )
            .first_text_json,
            "matches"
        );
        assert!(!within_budget(&json!(vec![0; MAX_NODES + 1])));
        let mut deep = Value::Null;
        for _ in 0..MAX_DEPTH + 2 {
            deep = json!([deep]);
        }
        assert!(!within_budget(&deep));
    }

    const CLASSES: [(EventClass, u8); CLASS_COUNT] = [
        (EventClass::Background, 8),
        (EventClass::KnownToolSuccess, 12),
        (EventClass::MethodNotAllowed, 8),
        (EventClass::OtherClientError, 8),
        (EventClass::ServerError, 8),
        (EventClass::Abandoned, 8),
        (EventClass::ToolError, 8),
        (EventClass::JsonRpcError, 8),
    ];

    #[test]
    fn independent_exact_quota_boundaries_survive_concurrency_and_rollover() {
        let start = Instant::now();
        let budget = Mutex::new(EmissionBudget::new(start));
        let admitted: [AtomicUsize; CLASS_COUNT] = std::array::from_fn(|_| AtomicUsize::new(0));
        std::thread::scope(|scope| {
            for contender in 0..16 {
                let budget = &budget;
                let admitted = &admitted;
                scope.spawn(move || {
                    for (class, limit) in CLASSES {
                        for _ in (contender..limit + class as u8 + 1).step_by(16) {
                            let (allowed, summary) = budget.lock().unwrap().permit(start, class);
                            assert!(summary.is_none());
                            if allowed {
                                admitted[class as usize].fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                });
            }
        });
        let mut budget = budget.into_inner().unwrap();
        for (class, limit) in CLASSES {
            assert_eq!(
                admitted[class as usize].load(Ordering::Relaxed),
                usize::from(limit)
            );
        }
        let now = start + WINDOW;
        let (allowed, summary) = budget.permit(now, EventClass::Background);
        assert!(allowed);
        assert_eq!(summary, Some([1, 2, 3, 4, 5, 6, 7, 8]));
        for (class, limit) in CLASSES {
            for _ in budget.admitted[class as usize]..limit {
                assert_eq!(budget.permit(now, class), (true, None));
            }
            assert_eq!(budget.permit(now, class), (false, None));
        }
        assert_eq!(
            budget
                .admitted
                .iter()
                .map(|&count| usize::from(count))
                .sum::<usize>()
                + 1,
            69
        );
        budget.suppressed = [u64::MAX; CLASS_COUNT];
        for (class, _) in CLASSES {
            assert_eq!(budget.permit(now, class), (false, None));
        }
        assert_eq!(budget.suppressed, [u64::MAX; CLASS_COUNT]);
        assert_eq!(
            budget.permit(now + WINDOW, EventClass::Abandoned),
            (true, Some([u64::MAX; CLASS_COUNT]))
        );
        assert_eq!(
            budget.permit(now + WINDOW + WINDOW, EventClass::ServerError),
            (true, None)
        );
    }

    #[test]
    fn denied_or_duplicate_tool_hooks_skip_inspection_and_normal_completion() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            let observer = Arc::new(Observer::new());
            for class in [
                EventClass::Background,
                EventClass::KnownToolSuccess,
                EventClass::ToolError,
            ] {
                for _ in 0..class.limit() {
                    assert!(observer.permit(class));
                }
            }
            let response = Json(json!({"prepared":true})).into_response();
            for (method, tool, is_error) in [
                ("tools/call", "get_weight_history", false),
                ("tools/call", "UNKNOWN_SECRET", false),
                ("ping", "get_weight_history", false),
                ("tools/call", "get_weight_history", true),
                ("tools/call", "UNKNOWN_SECRET", true),
            ] {
                let observation = Observation::new(observer.clone(), &Method::POST);
                observation.request(method, Some(tool));
                let result = json!({"isError":is_error});
                for _ in 0..2 {
                    observation.with_result_inspector(&response, &result, "none", |_, _| {
                        panic!("denied or duplicate hook performed inspection")
                    });
                }
                observation.response_prepared(&response);
            }
            assert_eq!(
                observer.budget.lock().unwrap().suppressed,
                [2, 1, 0, 0, 0, 0, 2, 0]
            );
        });
        assert!(capture.text().is_empty());
    }

    #[test]
    fn late_tool_preparation_and_drop_use_current_window_and_emit_one_summary() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            let observer = Arc::new(Observer::new());
            let tool = Observation::new(observer.clone(), &Method::POST);
            tool.request("tools/call", Some("get_weight_history"));
            let completion = Completion {
                observation: Observation::new(observer.clone(), &Method::GET),
                completed: false,
            };
            {
                let mut budget = observer.budget.lock().unwrap();
                for (class, limit) in CLASSES {
                    budget.admitted[class as usize] = limit;
                }
                budget.suppressed = [1, 2, 3, 4, 5, 6, 7, 8];
                budget.started -= WINDOW;
            }
            let before = tool.elapsed_ms();
            let response = super::super::tool_success(
                Value::Null,
                "RESULT_SECRET",
                json!({"entries":[]}),
                Some(&tool),
            );
            let after = tool.elapsed_ms();
            tool.response_prepared(&response);
            drop(completion);
            assert_eq!(
                observer.budget.lock().unwrap().admitted,
                [0, 1, 0, 0, 0, 1, 0, 0]
            );

            let output = capture.text();
            let terminal = output
                .lines()
                .find(|line| line.contains("event=\"tool_result_prepared\""))
                .unwrap();
            let duration = terminal
                .split("duration_ms=")
                .nth(1)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap()
                .parse::<u64>()
                .unwrap();
            assert!((before..=after).contains(&duration));
        });
        let output = capture.text();
        assert_eq!(output.lines().count(), 3);
        assert_event(
            &output,
            &[
                "event=\"suppressed\"",
                "suppressed_background=1",
                "suppressed_known_tool_success=2",
                "suppressed_method_not_allowed=3",
                "suppressed_other_client_error=4",
                "suppressed_server_error=5",
                "suppressed_abandoned=6",
                "suppressed_tool_error=7",
                "suppressed_json_rpc_error=8",
            ],
        );
        let summary = output
            .lines()
            .find(|line| line.contains("event=\"suppressed\""))
            .unwrap();
        assert!(!summary.contains("correlation="));
        assert!(!output.contains("event=\"response_prepared\""));
        assert!(!output.contains("RESULT_SECRET"));
    }

    #[tokio::test]
    async fn route_completion_records_http_error_and_drop_independently_of_the_tool_hook() {
        fn prepare_tool(observation: &Observation) -> Response {
            observation.request("tools/call", Some("get_weight_history"));
            super::super::tool_success(
                Value::Null,
                "RESULT_SECRET",
                json!({"entries":[]}),
                Some(observation),
            )
        }

        async fn endpoint(
            Extension(observation): Extension<Observation>,
            Json(payload): Json<Value>,
        ) -> Response {
            if payload["action"] == "drop_before" {
                return pending().await;
            }
            if payload["action"] == "failed_conversion" {
                let response = StatusCode::INTERNAL_SERVER_ERROR.into_response();
                observation.with_result_inspector(&response, &Value::Null, "none", |_, _| {
                    panic!("HTTP errors must not be inspected at the tool hook")
                });
                return response;
            }
            let prepared = prepare_tool(&observation);
            match payload["action"].as_str() {
                Some("drop_after") => pending().await,
                Some("http_error") => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                _ => prepared,
            }
        }
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            let observer = Arc::new(Observer::new());
            let router = observe_with(
                Router::new().route("/mcp", post(endpoint)),
                observer.clone(),
            );
            for (limit, expected) in [(0, 1), (EventClass::KnownToolSuccess.limit(), 0)] {
                observer.budget.lock().unwrap().admitted[EventClass::KnownToolSuccess as usize] =
                    limit;
                let before = capture.text().len();
                let response = router.clone().oneshot(request("{}")).await.unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                let output = capture.text();
                let events = &output[before..];
                assert_eq!(
                    events.matches("event=\"tool_result_prepared\"").count(),
                    expected
                );
                assert!(!events.contains("event=\"response_prepared\""));
            }
            let before = capture.text().len();
            for action in ["failed_conversion", "http_error"] {
                for _ in 0..5 {
                    let response = router
                        .clone()
                        .oneshot(request(&json!({"action": action}).to_string()))
                        .await
                        .unwrap();
                    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
                }
            }
            assert!(!capture.text()[before..].contains("event=\"tool_result_prepared\""));
            let success = EventClass::KnownToolSuccess;
            observer.budget.lock().unwrap().admitted[success as usize] = success.limit() - 1;
            for (action, count) in [("drop_before", 4), ("drop_after", 6)] {
                let body = json!({"action": action}).to_string();
                for _ in 0..count {
                    poll_and_drop(router.clone(), &body).await;
                }
            }
            assert_eq!(
                capture.text()[before..]
                    .matches("event=\"tool_result_prepared\"")
                    .count(),
                1
            );
            let budget = observer.budget.lock().unwrap();
            for class in [EventClass::ServerError, EventClass::Abandoned] {
                assert_eq!(budget.admitted[class as usize], class.limit());
                assert_eq!(budget.suppressed[class as usize], 2);
            }
        }
        .with_subscriber(subscriber)
        .await;

        let output = capture.text();
        assert_eq!(
            output.matches("error_class=\"http_server_error\"").count(),
            8
        );
        let drops: Vec<_> = output
            .lines()
            .filter(|line| line.contains("event=\"abandoned\""))
            .collect();
        assert_eq!(drops.len(), 8);
        assert!(
            drops
                .iter()
                .any(|line| line.contains("tool=\"get_weight_history\""))
        );
        assert!(
            drops
                .iter()
                .any(|line| line.contains("tool=\"not_applicable\""))
        );
        for line in drops {
            assert!(line.contains("outcome=\"abandoned\""));
            assert!(line.contains("error_class=\"abandoned\""));
            assert!(!line.contains("http_status="));
            assert!(!line.contains("response_bytes="));
        }
    }

    #[tokio::test]
    async fn explicit_disabled_target_keeps_the_no_context_fast_path() {
        async fn endpoint(observation: Option<Extension<Observation>>) -> StatusCode {
            assert!(observation.is_none());
            StatusCode::ACCEPTED
        }
        let capture = Capture::default();
        let observer = Arc::new(Observer::new());
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(Some(OsStr::new("off"))))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            let response = observe_with(
                Router::new().route("/mcp", post(endpoint)),
                observer.clone(),
            )
            .oneshot(request("{}"))
            .await
            .unwrap();
            assert_eq!(response.status(), StatusCode::ACCEPTED);
        }
        .with_subscriber(subscriber)
        .await;
        assert_eq!(observer.budget.lock().unwrap().admitted, [0; CLASS_COUNT]);
        assert!(capture.text().is_empty());
    }

    #[tokio::test]
    async fn exact_empty_and_unknown_size_bodies_report_only_available_sizes() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            let router = observe_with(handler_router(), Arc::new(Observer::new()));
            let response = router
                .oneshot(request(
                    r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::ACCEPTED);
            assert!(
                to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap()
                    .is_empty()
            );
            let router = Router::new().route(
                "/mcp",
                post(|| async {
                    Body::from_stream(futures_util::stream::once(async {
                        Ok::<_, std::convert::Infallible>("STREAM_SECRET")
                    }))
                }),
            );
            let response = observe_with(router, Arc::new(Observer::new()))
                .oneshot(request("{}"))
                .await
                .unwrap();
            assert!(response.body().size_hint().exact().is_none());
            assert_eq!(
                to_bytes(response.into_body(), usize::MAX).await.unwrap(),
                "STREAM_SECRET"
            );
        }
        .with_subscriber(subscriber)
        .await;
        let output = capture.text();
        assert_event(
            &output,
            &[
                "event=\"response_prepared\"",
                "http_status=202",
                "response_bytes=0",
            ],
        );
        let unknown = output
            .lines()
            .find(|line| line.contains("http_status=200"))
            .unwrap();
        assert!(!unknown.contains("response_bytes="));
        assert!(!output.contains("STREAM_SECRET"));
    }

    #[test]
    fn shipped_filter_preserves_explicit_values_and_maximum_ansi_line_is_bounded() {
        fn emit() {
            tracing::info!(target: TARGET, "safe_target");
            tracing::info!(target: "other", "other_info");
            tracing::warn!(target: "other", "other_warn");
            tracing::error!(target: "other", "other_error");
        }
        for (value, target_enabled, errors_enabled) in [
            (None, true, true),
            (Some(OsStr::new("")), false, true),
            (Some(OsStr::new("off")), false, false),
            (Some(OsStr::new("[")), false, true),
            (
                Some(OsStr::new("error,balance_mcp_observation=off")),
                false,
                true,
            ),
            (
                Some(OsStr::new("error,balance_mcp_observation=info")),
                true,
                true,
            ),
        ] {
            let capture = Capture::default();
            let subscriber = tracing_subscriber::fmt()
                .with_env_filter(logging_filter(value))
                .with_ansi(false)
                .with_writer(capture.clone())
                .finish();
            tracing::subscriber::with_default(subscriber, emit);
            let output = capture.text();
            assert_eq!(output.contains("safe_target"), target_enabled);
            assert!(!output.contains("other_info"));
            assert!(!output.contains("other_warn"));
            assert_eq!(output.contains("other_error"), errors_enabled);
        }
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let capture = Capture::default();
            let subscriber = tracing_subscriber::fmt()
                .with_env_filter(logging_filter(Some(OsStr::from_bytes(b"\xff"))))
                .with_ansi(false)
                .with_writer(capture.clone())
                .finish();
            tracing::subscriber::with_default(subscriber, emit);
            assert!(!capture.text().contains("safe_target"));
            assert!(capture.text().contains("other_error"));
        }
        let capture = Capture::default();
        // Use the shipped formatter with ANSI explicitly ON as a conservative
        // upper bound, including its field-name decoration and timestamp.
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(true)
            .with_writer(capture.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            let observation = Observation::new(Arc::new(Observer::new()), &Method::DELETE);
            let request_details = Details {
                method: "not_observed",
                tool: "get_weight_history",
                outcome: "notification_accepted",
                error_class: "method_not_allowed",
                tool_preparation_attempted: false,
            };
            let tool_details = Details {
                method: "tools_call",
                tool: "get_weight_history",
                outcome: "tool_success",
                error_class: "none",
                tool_preparation_attempted: true,
            };
            let shape = Shape {
                content_blocks: Some(MAX_CONTENT_BLOCKS),
                text_blocks: Some(MAX_CONTENT_BLOCKS),
                structured: true,
                collection_count: Some(usize::MAX),
                checked_entries: MAX_ENTRIES,
                entry_inspection: "complete",
                date_strings: "not_all",
                weight_numbers: "not_all",
                first_text_json: "invalid_json",
            };
            let span =
                tracing::info_span!(target: TARGET, "private_parent", private = "SPAN_SECRET");
            let _entered = span.enter();
            observation.arrived();
            let fields = || ResponseFields {
                status: Some(599),
                bytes: Some(u64::MAX),
            };
            for shape in [
                shape,
                Shape {
                    content_blocks: Some(usize::MAX),
                    text_blocks: None,
                    ..shape
                },
            ] {
                observation.write_event(
                    "tool_result_prepared",
                    fields(),
                    tool_details,
                    shape,
                    u64::MAX,
                );
            }
            observation.write_event(
                "tool_result_prepared",
                fields(),
                Details {
                    outcome: "tool_error",
                    error_class: "invalid_arguments",
                    ..tool_details
                },
                Shape {
                    content_blocks: Some(usize::MAX),
                    first_text_json: "invalid_json",
                    structured: true,
                    ..Shape::default()
                },
                u64::MAX,
            );
            observation.write_event(
                "response_prepared",
                fields(),
                request_details,
                Shape::default(),
                u64::MAX,
            );
            observation.write_event(
                "abandoned",
                ResponseFields::default(),
                Details {
                    outcome: "abandoned",
                    error_class: "abandoned",
                    ..request_details
                },
                Shape::default(),
                u64::MAX,
            );
            write_summary([u64::MAX; CLASS_COUNT]);
        });
        let identity = server::build_identity::compiled_identity();
        // Duration, count widths and all labels already use conservative maxima;
        // account for full compile identity lengths in an unknown local build.
        let margin = 40 - identity.source_sha.len() + 20 - identity.build_run.len();
        let output = capture.text();
        assert_eq!(output.lines().count(), 7);
        assert!(!output.contains("SPAN_SECRET"));
        assert!(!output.contains("private_parent"));
        for line in output.lines() {
            eprintln!(
                "maximum ANSI terminal line bound: {} bytes including newline",
                line.len() + margin + 1
            );
            assert!(
                line.len() + margin < 1024,
                "ANSI line plus worst-case margin uses {} bytes",
                line.len() + margin + 1
            );
        }
    }
}

async fn observe_request(
    State(observer): State<Arc<Observer>>,
    mut request: Request,
    next: Next,
) -> Response {
    if !tracing::enabled!(target: TARGET, tracing::Level::INFO) {
        return next.run(request).await;
    }
    let observation = Observation::new(observer, request.method());
    observation.arrived();
    request.extensions_mut().insert(observation.clone());
    let mut completion = Completion {
        observation,
        completed: false,
    };
    let response = next.run(request).await;
    completion.completed = true;
    completion.observation.response_prepared(&response);
    response
}

#[derive(Clone, Copy)]
struct Shape {
    content_blocks: Option<usize>,
    text_blocks: Option<usize>,
    structured: bool,
    collection_count: Option<usize>,
    checked_entries: usize,
    entry_inspection: &'static str,
    date_strings: &'static str,
    weight_numbers: &'static str,
    first_text_json: &'static str,
}

impl Default for Shape {
    fn default() -> Self {
        Self {
            content_blocks: None,
            text_blocks: None,
            structured: false,
            collection_count: None,
            checked_entries: 0,
            entry_inspection: "not_applicable",
            date_strings: "not_applicable",
            weight_numbers: "not_applicable",
            first_text_json: "not_applicable",
        }
    }
}

impl Shape {
    fn inspect(result: &Value, tool: &str) -> Self {
        let mut shape = Self {
            structured: result.get("structuredContent").is_some(),
            first_text_json: "not_checked",
            ..Self::default()
        };
        let content = result.get("content").and_then(Value::as_array);
        if let Some(content) = content {
            shape.content_blocks = Some(content.len());
            if content.len() <= MAX_CONTENT_BLOCKS {
                shape.text_blocks = Some(
                    content
                        .iter()
                        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                        .count(),
                );
            }
        }
        let structured = result.get("structuredContent");
        let key = match tool {
            "search_foods" => Some("foods"),
            "get_daily_log" => Some("items"),
            "get_weight_history" => Some("entries"),
            _ => None,
        };
        if let Some(entries) = key.and_then(|key| structured?.get(key)?.as_array()) {
            shape.collection_count = Some(entries.len());
            if tool == "get_weight_history" && !entries.is_empty() {
                shape.checked_entries = entries.len().min(MAX_ENTRIES);
                shape.entry_inspection = if entries.len() <= MAX_ENTRIES {
                    "complete"
                } else {
                    "partial"
                };
                shape.date_strings = if entries
                    .iter()
                    .take(MAX_ENTRIES)
                    .all(|entry| entry.get("date").is_some_and(Value::is_string))
                {
                    "all"
                } else {
                    "not_all"
                };
                shape.weight_numbers = if entries
                    .iter()
                    .take(MAX_ENTRIES)
                    .all(|entry| entry.get("weightKg").is_some_and(Value::is_number))
                {
                    "all"
                } else {
                    "not_all"
                };
            }
        }
        if let (Some(text), Some(structured)) = (
            content
                .and_then(|c| c.first())
                .and_then(|b| b.get("text"))
                .and_then(Value::as_str),
            structured,
        ) && text.len() <= MAX_TEXT_BYTES
            && within_budget(structured)
        {
            shape.first_text_json = match serde_json::from_str::<Value>(super::embedded_json(text))
            {
                Ok(parsed) if within_budget(&parsed) => {
                    if parsed == *structured {
                        "matches"
                    } else {
                        "differs"
                    }
                }
                Ok(_) => "not_checked",
                Err(_) => "invalid_json",
            };
        }
        shape
    }
}

fn within_budget(value: &Value) -> bool {
    fn visit(value: &Value, nodes: &mut usize, bytes: &mut usize, depth: usize) -> bool {
        if depth > MAX_DEPTH || *nodes == 0 {
            return false;
        }
        *nodes -= 1;
        let charge = match value {
            Value::String(s) => s.len().saturating_mul(6),
            Value::Number(_) => 32,
            _ => 8,
        };
        if charge > *bytes {
            return false;
        }
        *bytes -= charge;
        match value {
            Value::Array(values) => {
                values.len() <= *nodes && values.iter().all(|v| visit(v, nodes, bytes, depth + 1))
            }
            Value::Object(values) => {
                values.len() <= *nodes
                    && values.iter().all(|(key, v)| {
                        let charge = key.len().saturating_mul(6);
                        if charge > *bytes {
                            return false;
                        }
                        *bytes -= charge;
                        visit(v, nodes, bytes, depth + 1)
                    })
            }
            _ => true,
        }
    }
    let mut nodes = MAX_NODES;
    let mut bytes = MAX_TEXT_BYTES;
    visit(value, &mut nodes, &mut bytes, 0)
}
