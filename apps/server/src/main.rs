use axum::{
    Router,
    extract::{Extension, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use config::openapi::ApiDoc;
use connectors::{db::Database, gemini::GeminiClient};
use modules::{
    ai::routes::ai_routes,
    auth::{
        middleware::auth,
        oidc::{IdentityMode, OidcConfig},
        routes::auth_routes,
    },
    imports::import_routes,
    mcp::{PROTOCOL_VERSION_HEADER, mcp_metadata_routes, mcp_post, observation, supports_version},
    sync::routes::{
        WsAllowedOrigins, application_sync_routes, public_template_routes, sync_routes,
    },
    user::routes::user_routes,
};
use server::server_bind::server_bind_addr_from_env;
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::{cors::CorsLayer, services::ServeDir};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod config;
mod connectors;
mod modules;
mod shared;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env")).ok();

    tracing_subscriber::fmt()
        .with_env_filter(observation::logging_filter(
            std::env::var_os("RUST_LOG").as_deref(),
        ))
        .init();

    let oidc = OidcConfig::from_env().expect("Failed to configure OIDC");
    let mcp_origins = McpAllowedOrigins::from_env()?;
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let db = Database::new(&database_url)
        .await
        .expect("Failed to connect to the database");

    let shared_db = Arc::new(db);
    let sync_hub = modules::sync::hub::SyncHub::default();
    let gemini_api_key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
    let gemini_client = Arc::new(GeminiClient::new(gemini_api_key));

    let sync = if oidc.identity_mode() == IdentityMode::IssuerSubject {
        application_sync_routes(oidc.clone(), WsAllowedOrigins::from_env()?)
    } else {
        sync_routes().route_layer(middleware::from_fn_with_state(oidc.clone(), auth))
    };
    let app = application_router(oidc, mcp_origins, sync)
        .layer(
            ServiceBuilder::new()
                .layer(Extension(shared_db))
                .layer(Extension(gemini_client))
                .layer(Extension(sync_hub)),
        )
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()));

    let bind_addr = server_bind_addr_from_env()?;
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .map_err(|error| {
            anyhow::anyhow!("failed to bind Balance server to {bind_addr}: {error}")
        })?;

    tracing::info!("server running on http://{bind_addr}");
    tracing::info!("docs available at http://{bind_addr}/docs");
    tracing::info!("mockups available at http://{bind_addr}/mockups/");

    axum::serve(listener, app)
        .await
        .map_err(|error| anyhow::anyhow!("Balance server stopped unexpectedly: {error}"))?;

    Ok(())
}

#[derive(Clone, Default)]
struct McpAllowedOrigins(Vec<HeaderValue>);

impl McpAllowedOrigins {
    fn from_env() -> anyhow::Result<Self> {
        match std::env::var("MCP_ALLOWED_ORIGINS") {
            Ok(value) => Self::parse(&value),
            Err(std::env::VarError::NotPresent) => Ok(Self::default()),
            Err(std::env::VarError::NotUnicode(_)) => anyhow::bail!("invalid MCP_ALLOWED_ORIGINS"),
        }
    }

    fn parse(value: &str) -> anyhow::Result<Self> {
        if value.trim().is_empty() {
            return Ok(Self::default());
        }
        let origins = value
            .split(',')
            .map(str::trim)
            .map(|origin| {
                let invalid = || anyhow::anyhow!("invalid MCP_ALLOWED_ORIGINS");
                let url = reqwest::Url::parse(origin).map_err(|_| invalid())?;
                if !matches!(url.scheme(), "http" | "https")
                    || url.origin().ascii_serialization() != origin
                {
                    return Err(invalid());
                }
                HeaderValue::from_str(origin).map_err(|_| invalid())
            })
            .collect::<anyhow::Result<_>>()?;
        Ok(Self(origins))
    }
}

fn absent_or_matching(
    headers: &HeaderMap,
    name: HeaderName,
    matches: impl FnOnce(&HeaderValue) -> bool,
) -> bool {
    let values = headers.get_all(name);
    let mut values = values.iter();
    match values.next() {
        None => true,
        Some(value) => values.next().is_none() && matches(value),
    }
}

async fn mcp_guard(
    State(origins): State<McpAllowedOrigins>,
    request: Request,
    next: Next,
) -> Response {
    if !absent_or_matching(request.headers(), header::ORIGIN, |origin| {
        origins.0.contains(origin)
    }) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !absent_or_matching(
        request.headers(),
        HeaderName::from_static(PROTOCOL_VERSION_HEADER),
        supports_version,
    ) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    next.run(request).await
}

fn mcp_authenticated(oidc: OidcConfig) -> Router {
    Router::new().route(
        "/mcp",
        mcp_post().route_layer(middleware::from_fn_with_state(oidc, auth)),
    )
}

fn mcp_transport(observed: Router, origins: McpAllowedOrigins) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(origins.0.clone())
        .allow_methods([Method::POST])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            HeaderName::from_static(PROTOCOL_VERSION_HEADER),
        ])
        .expose_headers([header::WWW_AUTHENTICATE]);
    observed
        .route_layer(cors)
        .route_layer(middleware::from_fn_with_state(origins, mcp_guard))
}

fn application_router(oidc: OidcConfig, mcp_origins: McpAllowedOrigins, sync: Router) -> Router {
    let mcp_oidc = oidc.mcp_config();
    Router::new()
        .route("/health", axum::routing::get(health))
        .merge(public_template_routes()) // Public Unauthenticated Endpoint
        .merge(mcp_metadata_routes(&oidc, &mcp_oidc))
        .nest(
            "/me",
            user_routes().route_layer(middleware::from_fn_with_state(oidc.clone(), auth)),
        )
        .nest("/auth", auth_routes())
        .nest(
            "/ai",
            ai_routes().route_layer(middleware::from_fn_with_state(oidc.clone(), auth)),
        )
        .merge(import_routes().route_layer(middleware::from_fn_with_state(oidc.clone(), auth)))
        .merge(sync)
        .nest_service("/mockups", ServeDir::new("static/mockups"))
        .layer(CorsLayer::permissive())
        .merge(mcp_transport(
            observation::observe_routes(mcp_authenticated(mcp_oidc)),
            mcp_origins,
        ))
}

async fn health(axum::Extension(db): axum::Extension<Arc<Database>>) -> axum::http::StatusCode {
    match tokio::time::timeout(
        std::time::Duration::from_secs(1),
        sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&db.user.pool),
    )
    .await
    {
        Ok(Ok(1)) => axum::http::StatusCode::NO_CONTENT,
        _ => axum::http::StatusCode::SERVICE_UNAVAILABLE,
    }
}

#[cfg(test)]
mod readiness_tests {
    use super::*;

    #[tokio::test]
    async fn readiness_reports_fresh_database_failure_and_timeout() {
        let Ok(url) = std::env::var("BALANCE_TEST_DATABASE_URL") else {
            return;
        };
        let db = Arc::new(Database::new(&url).await.unwrap());
        assert_eq!(
            health(axum::Extension(db.clone())).await,
            axum::http::StatusCode::NO_CONTENT
        );
        let mut held = Vec::new();
        for _ in 0..5 {
            held.push(db.user.pool.acquire().await.unwrap());
        }
        let start = std::time::Instant::now();
        assert_eq!(
            health(axum::Extension(db.clone())).await,
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
        assert!(start.elapsed() < std::time::Duration::from_secs(3));
        drop(held);
        db.user.pool.close().await;
        assert_eq!(
            health(axum::Extension(db)).await,
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }
}

#[cfg(test)]
mod mcp_transport_tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    const ORIGIN: &str = "https://connector.example.invalid:8443";

    fn router(origins: McpAllowedOrigins) -> Router {
        use connectors::{imports::ImportDatasource, sync::SyncDatasource, user::UserDatasource};

        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://synthetic@127.0.0.1:1/unused")
            .unwrap();
        let db = Arc::new(Database {
            user: UserDatasource { pool: pool.clone() },
            sync: SyncDatasource::new(pool.clone()),
            imports: ImportDatasource::new(pool),
        });
        application_router(
            OidcConfig::test_cached_subject_config(),
            origins,
            Router::new(),
        )
        .layer(Extension(db))
    }

    fn request(method: Method, origins: &[&str], versions: &[&str]) -> Request<Body> {
        let mut builder = Request::builder()
            .method(method.clone())
            .uri("/mcp")
            .header(header::HOST, "connector.example.invalid:8443")
            .header("x-forwarded-host", "connector.example.invalid:8443")
            .header("x-forwarded-proto", "https")
            .header(
                "forwarded",
                "host=connector.example.invalid:8443;proto=https",
            );
        if method == Method::OPTIONS {
            builder = builder
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(
                    header::ACCESS_CONTROL_REQUEST_HEADERS,
                    "authorization, content-type, mcp-protocol-version",
                );
        }
        for origin in origins {
            builder = builder.header(header::ORIGIN, *origin);
        }
        for version in versions {
            builder = builder.header(PROTOCOL_VERSION_HEADER, *version);
        }
        builder.body(Body::from("invalid JSON")).unwrap()
    }

    fn has_token(headers: &HeaderMap, name: HeaderName, token: &str) -> bool {
        headers.get_all(name).iter().any(|value| {
            value
                .to_str()
                .unwrap()
                .split(',')
                .any(|part| part.trim().eq_ignore_ascii_case(token))
        })
    }

    fn assert_outer_rejection(response: &Response, status: StatusCode) {
        assert_eq!(response.status(), status);
        for header in [
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            header::ACCESS_CONTROL_ALLOW_METHODS,
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            header::WWW_AUTHENTICATE,
        ] {
            assert!(!response.headers().contains_key(header));
        }
    }

    #[tokio::test]
    async fn mcp_browser_preflight_uses_production_router() {
        let app = router(McpAllowedOrigins::parse(ORIGIN).unwrap());
        let response = app
            .clone()
            .oneshot(request(Method::OPTIONS, &[ORIGIN], &[]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            ORIGIN
        );
        assert!(has_token(
            response.headers(),
            header::ACCESS_CONTROL_ALLOW_METHODS,
            "POST"
        ));
        for name in ["Authorization", "Content-Type", "MCP-Protocol-Version"] {
            assert!(has_token(
                response.headers(),
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                name
            ));
        }

        for (origin, status) in [
            (ORIGIN, StatusCode::BAD_REQUEST),
            ("null", StatusCode::FORBIDDEN),
        ] {
            let response = app
                .clone()
                .oneshot(request(Method::OPTIONS, &[origin], &["invalid"]))
                .await
                .unwrap();
            assert_outer_rejection(&response, status);
        }

        let response = app
            .clone()
            .oneshot(request(Method::POST, &[ORIGIN], &[]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            ORIGIN
        );
        let oidc = OidcConfig::test_cached_subject_config().mcp_config();
        assert_eq!(
            response.headers()[header::WWW_AUTHENTICATE],
            *oidc.challenge()
        );
        assert!(
            response.headers()[header::WWW_AUTHENTICATE]
                .to_str()
                .unwrap()
                .starts_with("Bearer ")
        );
        assert!(has_token(
            response.headers(),
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "WWW-Authenticate"
        ));

        let response = app
            .oneshot(request(Method::GET, &[ORIGIN], &[]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(response.headers()[header::ALLOW], "POST");
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            ORIGIN
        );
    }

    #[tokio::test]
    async fn mcp_guards_run_on_every_method_and_are_exact_path() {
        let app = router(McpAllowedOrigins::parse(ORIGIN).unwrap());
        for (method, passing_status) in [
            (Method::POST, StatusCode::UNAUTHORIZED),
            (Method::GET, StatusCode::METHOD_NOT_ALLOWED),
            (Method::OPTIONS, StatusCode::OK),
        ] {
            for origins in [
                &["http://connector.example.invalid:8443"][..],
                &["https://different.example.invalid:8443"],
                &["https://connector.example.invalid"],
                &["null"],
                &["https://connector.example.invalid:8443/path"],
                &["malformed"],
                &[""],
                &[ORIGIN, ORIGIN],
                &["https://connector.example.invalid:8443, https://other.example.invalid"],
            ] {
                for versions in [&[][..], &["invalid"]] {
                    let response = app
                        .clone()
                        .oneshot(request(method.clone(), origins, versions))
                        .await
                        .unwrap();
                    assert_outer_rejection(&response, StatusCode::FORBIDDEN);
                }
            }
            for versions in [
                &["invalid"][..],
                &[""],
                &["2025-03-26"],
                &["2025-06-18", "2025-06-18"],
                &["2025-06-18, 2025-11-25"],
            ] {
                let response = app
                    .clone()
                    .oneshot(request(method.clone(), &[ORIGIN], versions))
                    .await
                    .unwrap();
                assert_outer_rejection(&response, StatusCode::BAD_REQUEST);
            }
            for origins in [&[][..], &[ORIGIN]] {
                for versions in [&[][..], &["2025-06-18"], &["2025-11-25"]] {
                    let response = app
                        .clone()
                        .oneshot(request(method.clone(), origins, versions))
                        .await
                        .unwrap();
                    assert_eq!(response.status(), passing_status);
                    assert_eq!(
                        response
                            .headers()
                            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                            .and_then(|value| value.to_str().ok()),
                        origins.first().copied()
                    );
                }
            }
        }

        let no_origins = router(McpAllowedOrigins::default());
        assert_outer_rejection(
            &no_origins
                .clone()
                .oneshot(request(Method::POST, &[ORIGIN], &[]))
                .await
                .unwrap(),
            StatusCode::FORBIDDEN,
        );
        let response = no_origins
            .oneshot(request(Method::POST, &[], &[]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        for (path, method) in [
            ("/.well-known/oauth-protected-resource/mcp", Method::GET),
            ("/health", Method::OPTIONS),
        ] {
            let mut req = request(method, &["https://other.example.invalid"], &["invalid"]);
            *req.uri_mut() = path.parse().unwrap();
            let response = app.clone().oneshot(req).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        }
        let mut req = request(Method::GET, &["null"], &["invalid"]);
        *req.uri_mut() = "/mcp/".parse().unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn mcp_startup_origin_configuration_is_exact_and_sanitized() {
        for input in [
            "null",
            "file://bad.example.invalid",
            "https://SECRET@bad.example.invalid",
            "https://bad.example.invalid/",
            "https://bad.example.invalid?SECRET",
            "https://bad.example.invalid#SECRET",
            "https://bad.example.invalid:443",
            "HTTPS://bad.example.invalid",
            "https://bad.example.invalid,,https://other.example.invalid",
        ] {
            assert_eq!(
                McpAllowedOrigins::parse(input).err().unwrap().to_string(),
                "invalid MCP_ALLOWED_ORIGINS",
                "{input}"
            );
        }
        assert!(McpAllowedOrigins::parse(" ").unwrap().0.is_empty());
        let parsed = McpAllowedOrigins::parse(
            " https://connector.example.invalid:8443 , http://localhost:8080 ",
        )
        .unwrap();
        assert_eq!(parsed.0, [ORIGIN, "http://localhost:8080"]);
    }
}
