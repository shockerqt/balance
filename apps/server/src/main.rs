use axum::{Router, extract::Extension, middleware};
use config::openapi::ApiDoc;
use connectors::{db::Database, gemini::GeminiClient};
use modules::{
    ai::routes::ai_routes,
    auth::{middleware::auth, oidc::OidcConfig, routes::auth_routes},
    food::routes::food_routes,
    mcp::{mcp_metadata_routes, mcp_routes},
    meal::routes::meal_routes,
    sync::routes::{public_template_routes, sync_routes},
    user::routes::user_routes,
};
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
async fn main() {
    dotenv::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env")).ok();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let db = Database::new(&database_url)
        .await
        .expect("Failed to connect to the database");

    let shared_db = Arc::new(db);
    let oidc = OidcConfig::from_env().expect("Failed to configure OIDC");

    let gemini_api_key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
    let gemini_client = Arc::new(GeminiClient::new(gemini_api_key));

    let app = Router::new()
        .merge(public_template_routes()) // Public Unauthenticated Endpoint
        .merge(mcp_metadata_routes())
        .merge(mcp_routes().route_layer(middleware::from_fn_with_state(oidc.clone(), auth)))
        .nest(
            "/me",
            user_routes().route_layer(middleware::from_fn_with_state(oidc.clone(), auth)),
        )
        .nest("/auth", auth_routes())
        .nest("/meals", meal_routes())
        .nest(
            "/foods",
            food_routes().route_layer(middleware::from_fn_with_state(oidc.clone(), auth)),
        )
        .nest(
            "/ai",
            ai_routes().route_layer(middleware::from_fn_with_state(oidc.clone(), auth)),
        )
        .merge(sync_routes().route_layer(middleware::from_fn_with_state(oidc, auth)))
        .nest_service("/mockups", ServeDir::new("static/mockups"))
        .layer(
            ServiceBuilder::new()
                .layer(Extension(shared_db))
                .layer(Extension(gemini_client))
                .layer(CorsLayer::permissive()),
        )
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();

    tracing::info!("server running on http://localhost:8080");
    tracing::info!("docs available at http://localhost:8080/docs");
    tracing::info!("mockups available at http://localhost:8080/mockups/");

    axum::serve(listener, app).await.unwrap();
}
