//! Bounded, value-free MCP diagnostics. Never retain request/response payloads.

use std::{
    ffi::OsStr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    Router,
    extract::{Request, State},
    middleware::{self, Next},
    response::Response,
};
use serde_json::Value;
use tracing_subscriber::{EnvFilter, filter::LevelFilter};
use uuid::Uuid;

const TARGET: &str = "balance_mcp_observation";
const EVENTS_PER_WINDOW: u16 = 20;
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

impl Observer {
    fn new() -> Self {
        Self {
            budget: Mutex::new(EmissionBudget::new(Instant::now())),
        }
    }

    fn permit(&self) -> bool {
        if !tracing::enabled!(target: TARGET, tracing::Level::INFO) {
            return false;
        }
        let (allowed, suppressed) = self
            .budget
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .permit(Instant::now());
        if let Some(suppressed) = suppressed {
            let build = server::build_identity::compiled_identity();
            tracing::info!(target: TARGET, parent: None,
                event = "suppressed", source_sha = build.source_sha, build_run = build.build_run,
                suppressed_events = suppressed);
        }
        allowed
    }
}

struct EmissionBudget {
    started: Instant,
    emitted: u16,
    suppressed: u64,
}

impl EmissionBudget {
    fn new(now: Instant) -> Self {
        Self {
            started: now,
            emitted: 0,
            suppressed: 0,
        }
    }

    /// Both the carried suppression summary and this event consume the current
    /// window. Late completions have no reservation that can bypass this check.
    fn permit(&mut self, now: Instant) -> (bool, Option<u64>) {
        let mut summary = None;
        if now.saturating_duration_since(self.started) >= WINDOW {
            self.started = now;
            self.emitted = 0;
            if self.suppressed > 0 {
                summary = Some(std::mem::take(&mut self.suppressed));
                self.emitted = 1;
            }
        }
        if self.emitted < EVENTS_PER_WINDOW {
            self.emitted += 1;
            (true, summary)
        } else {
            self.suppressed = self.suppressed.saturating_add(1);
            (false, summary)
        }
    }
}

#[derive(Clone)]
pub(super) struct Observation(Arc<Mutex<Details>>);

#[derive(Clone, Copy)]
struct Details {
    method: &'static str,
    tool: &'static str,
    outcome: &'static str,
    error_class: &'static str,
    shape: Shape,
}

impl Default for Details {
    fn default() -> Self {
        Self {
            method: "not_observed",
            tool: "not_applicable",
            outcome: "http_rejected",
            error_class: "none",
            shape: Shape::default(),
        }
    }
}

impl Observation {
    pub(super) fn request(&self, method: &str, tool: Option<&str>) {
        let mut details = self.0.lock().unwrap_or_else(|e| e.into_inner());
        details.method = match method {
            "initialize" => "initialize",
            "notifications/initialized" => "initialized",
            "ping" => "ping",
            "tools/list" => "tools_list",
            "tools/call" => "tools_call",
            _ => "unknown",
        };
        details.tool = match tool {
            None => "not_applicable",
            Some("search_foods") => "search_foods",
            Some("get_daily_log") => "get_daily_log",
            Some("create_food") => "create_food",
            Some("log_food") => "log_food",
            Some("update_food_log") => "update_food_log",
            Some("delete_food_log") => "delete_food_log",
            Some("get_weight_history") => "get_weight_history",
            Some("set_weight") => "set_weight",
            Some("delete_weight_log") => "delete_weight_log",
            Some(_) => "unknown",
        };
        details.outcome = "protocol_success";
    }

    pub(super) fn outcome(&self, outcome: &'static str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).outcome = outcome;
    }

    pub(super) fn result(&self, result: &Value, error_class: &'static str) {
        let mut details = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let is_error = result.get("isError").and_then(Value::as_bool) == Some(true);
        details.outcome = if is_error {
            "tool_error"
        } else {
            "tool_success"
        };
        details.error_class = error_class;
        details.shape = Shape::inspect(result, details.tool);
    }
}

struct Completion {
    observer: Arc<Observer>,
    observation: Observation,
    correlation: Uuid,
    started: Instant,
    completed: bool,
}

impl Completion {
    fn emit(&self, event: &'static str, status: u16) {
        if !self.observer.permit() {
            return;
        }
        let details = *self.observation.0.lock().unwrap_or_else(|e| e.into_inner());
        let shape = details.shape;
        let build = server::build_identity::compiled_identity();
        let duration_ms = u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX);
        tracing::info!(target: TARGET, parent: None,
            event, correlation = %self.correlation,
            source_sha = build.source_sha, build_run = build.build_run,
            duration_ms, http_status = status, method = details.method, tool = details.tool,
            outcome = details.outcome, error_class = details.error_class,
            content_blocks = shape.content_blocks, text_blocks = shape.text_blocks,
            structured = shape.structured, collection_count = shape.collection_count,
            checked_entries = shape.checked_entries, entry_inspection = shape.entry_inspection,
            checked_date_strings = shape.date_strings, checked_weight_numbers = shape.weight_numbers,
            first_text_json = shape.first_text_json);
    }
}

impl Drop for Completion {
    fn drop(&mut self) {
        if !self.completed {
            self.observation.outcome("abandoned");
            self.emit("abandoned", 0);
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
        http::{Request as HttpRequest, StatusCode},
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

    #[tokio::test]
    async fn actual_handler_preserves_wire_and_redacts_unknown_labels_arguments_and_ids() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            for payload in [
                json!({"jsonrpc":"2.0","id":"ID_SECRET","method":"METHOD_SECRET","params":{"secret":"ARG_SECRET"}}),
                json!({"jsonrpc":"2.0","id":"ID_SECRET","method":"tools/call","params":{"name":"TOOL_SECRET","arguments":{"secret":"ARG_SECRET"}}}),
                json!({"jsonrpc":"bad","id":"ID_SECRET","method":"ping"}),
                json!({"jsonrpc":"2.0","id":"ID_SECRET","method":"tools/list"}),
            ] {
                let raw = payload.to_string();
                let baseline = handler_router().oneshot(request(&raw)).await.unwrap();
                let observed = observe_with(handler_router(), Arc::new(Observer::new())).oneshot(request(&raw)).await.unwrap();
                assert_eq!(baseline.status(), observed.status());
                assert_eq!(to_bytes(baseline.into_body(), usize::MAX).await.unwrap(), to_bytes(observed.into_body(), usize::MAX).await.unwrap());
            }
        }.with_subscriber(subscriber).await;
        let output = capture.text();
        for secret in [
            "URI_SECRET",
            "TOKEN_SECRET",
            "ID_SECRET",
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
    async fn real_auth_and_json_extractor_rejections_are_observed_without_changing_responses() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            let auth_router = || {
                super::super::mcp_routes()
                    .route_layer(middleware::from_fn_with_state(
                        OidcConfig::test_cached_subject_config().mcp_config(),
                        auth,
                    ))
                    .layer(Extension(lazy_database()))
            };
            let req = || {
                HttpRequest::builder()
                    .method("POST")
                    .uri("/mcp")
                    .body(Body::from("PRIVATE_BODY"))
                    .unwrap()
            };
            let baseline = auth_router().oneshot(req()).await.unwrap();
            let response = observe_with(auth_router(), Arc::new(Observer::new()))
                .oneshot(req())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(baseline.headers(), response.headers());
            assert_eq!(
                to_bytes(baseline.into_body(), usize::MAX).await.unwrap(),
                to_bytes(response.into_body(), usize::MAX).await.unwrap()
            );
            let malformed = "{\"jsonrpc\": [\"BODY_SECRET\"]}";
            let baseline = handler_router().oneshot(request(malformed)).await.unwrap();
            let observed = observe_with(handler_router(), Arc::new(Observer::new()))
                .oneshot(request(malformed))
                .await
                .unwrap();
            assert_eq!(baseline.status(), observed.status());
            assert_eq!(
                to_bytes(baseline.into_body(), usize::MAX).await.unwrap(),
                to_bytes(observed.into_body(), usize::MAX).await.unwrap()
            );
        }
        .with_subscriber(subscriber)
        .await;
        let output = capture.text();
        assert!(output.contains("http_status=401"));
        assert!(output.contains("outcome=\"http_rejected\""));
        assert!(output.contains("event=\"arrived\""));
        assert!(!output.contains("PRIVATE_BODY"));
        assert!(!output.contains("BODY_SECRET"));
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
                "success" => super::super::tool_success(
                    json!("RPC_SECRET"),
                    "SUMMARY_SECRET",
                    json!({"entries":[{"date":"2099-12-31", "weightKg": 123.4, "name":"VALUE_SECRET"}]}),
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
            for kind in ["success", "db", "internal"] {
                let router = || Router::new().route("/mcp", post(endpoint));
                let payload = json!({"kind":kind}).to_string();
                let baseline = router().oneshot(request(&payload)).await.unwrap();
                let response = observe_with(router(), Arc::new(Observer::new()))
                    .oneshot(request(&payload))
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                assert_eq!(
                    to_bytes(baseline.into_body(), usize::MAX).await.unwrap(),
                    to_bytes(response.into_body(), usize::MAX).await.unwrap()
                );
            }
        }
        .with_subscriber(subscriber)
        .await;
        let output = capture.text();
        for secret in [
            "RPC_SECRET",
            "SUMMARY_SECRET",
            "VALUE_SECRET",
            "DB_SECRET",
            "ERROR_SECRET",
            "2099-12-31",
            "123.4",
        ] {
            assert!(!output.contains(secret), "leaked {secret}");
        }
        for expected in [
            "content_blocks=2",
            "text_blocks=2",
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
        assert_eq!(ids.len(), 3);
        assert_ne!(ids[0], ids[1]);
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

    #[test]
    fn emission_budget_includes_late_completions_and_summary_under_concurrency() {
        let start = Instant::now();
        let budget = Arc::new(Mutex::new(EmissionBudget::new(start)));
        let allowed = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..40 {
                let budget = budget.clone();
                let allowed = &allowed;
                scope.spawn(move || {
                    if budget.lock().unwrap().permit(start).0 {
                        allowed.fetch_add(1, Ordering::Relaxed);
                    }
                });
            }
        });
        assert_eq!(
            allowed.load(Ordering::Relaxed),
            usize::from(EVENTS_PER_WINDOW)
        );
        let mut budget = budget.lock().unwrap();
        let (admitted, summary) = budget.permit(start + WINDOW);
        assert!(admitted);
        assert_eq!(summary, Some(20));
        let mut emissions = 2; // summary and the first late/current event
        for _ in 0..40 {
            if budget.permit(start + WINDOW).0 {
                emissions += 1;
            }
        }
        assert_eq!(emissions, EVENTS_PER_WINDOW);
        budget.suppressed = u64::MAX;
        assert!(!budget.permit(start + WINDOW).0);
        assert_eq!(budget.suppressed, u64::MAX);
    }

    #[tokio::test]
    async fn suppressed_requests_still_execute_without_context_and_abandonment_is_truthful() {
        async fn endpoint(observation: Option<Extension<Observation>>) -> StatusCode {
            if let Some(Extension(observation)) = observation {
                observation.request("ping", None);
            }
            StatusCode::ACCEPTED
        }
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(logging_filter(None))
            .with_ansi(false)
            .with_writer(capture.clone())
            .finish();
        async {
            let observer = Arc::new(Observer::new());
            observer.budget.lock().unwrap().emitted = EVENTS_PER_WINDOW;
            let response = observe_with(
                Router::new().route("/mcp", post(endpoint)),
                observer.clone(),
            )
            .oneshot(request("{}"))
            .await
            .unwrap();
            assert_eq!(response.status(), StatusCode::ACCEPTED);
            observer.budget.lock().unwrap().started -= WINDOW;
            observe_with(Router::new().route("/mcp", post(endpoint)), observer)
                .oneshot(request("{}"))
                .await
                .unwrap();
            async fn pending(observation: Option<Extension<Observation>>) -> Response {
                observation
                    .unwrap()
                    .0
                    .request("tools/call", Some("get_weight_history"));
                std::future::pending().await
            }
            let mut future = Box::pin(
                observe_with(
                    Router::new().route("/mcp", post(pending)),
                    Arc::new(Observer::new()),
                )
                .oneshot(request("{}")),
            );
            std::future::poll_fn(|cx| {
                assert!(future.as_mut().poll(cx).is_pending());
                std::task::Poll::Ready(())
            })
            .await;
            drop(future);
        }
        .with_subscriber(subscriber)
        .await;
        let output = capture.text();
        assert!(output.contains("event=\"suppressed\""));
        assert!(output.contains("suppressed_events=1"));
        assert!(output.contains("event=\"abandoned\""));
        assert!(output.contains("outcome=\"abandoned\""));
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
            let observation = Observation(Arc::new(Mutex::new(Details {
                method: "tools_call",
                tool: "delete_weight_log",
                outcome: "notification_accepted",
                error_class: "invalid_arguments",
                shape: Shape {
                    content_blocks: Some(usize::MAX),
                    text_blocks: Some(usize::MAX),
                    structured: true,
                    collection_count: Some(usize::MAX),
                    checked_entries: MAX_ENTRIES,
                    entry_inspection: "not_applicable",
                    date_strings: "not_applicable",
                    weight_numbers: "not_applicable",
                    first_text_json: "not_checked",
                },
            })));
            let mut completion = Completion {
                observer: Arc::new(Observer::new()),
                observation,
                correlation: Uuid::new_v4(),
                started: Instant::now(),
                completed: false,
            };
            let span =
                tracing::info_span!(target: TARGET, "private_parent", private = "SPAN_SECRET");
            let _entered = span.enter();
            completion.emit("response_prepared", 599);
            completion.completed = true;
        });
        let identity = server::build_identity::compiled_identity();
        // Include the maximum valid SHA/run, u64 duration (20 digits), longest
        // tool label and comparison label even in an unknown local build.
        let margin = 40 - identity.source_sha.len() + 20 - identity.build_run.len() + 22;
        let output = capture.text();
        assert_eq!(output.lines().count(), 1);
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
    if !observer.permit() {
        return next.run(request).await;
    }
    let correlation = Uuid::new_v4();
    let build = server::build_identity::compiled_identity();
    tracing::info!(target: TARGET, parent: None, event = "arrived", correlation = %correlation,
        source_sha = build.source_sha, build_run = build.build_run);
    let observation = Observation(Arc::new(Mutex::new(Details::default())));
    request.extensions_mut().insert(observation.clone());
    let mut completion = Completion {
        observer,
        observation,
        correlation,
        started: Instant::now(),
        completed: false,
    };
    let response = next.run(request).await;
    completion.emit("response_prepared", response.status().as_u16());
    completion.completed = true;
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
            shape.first_text_json = match serde_json::from_str::<Value>(text) {
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
