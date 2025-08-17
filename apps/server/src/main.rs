use axum::{
    Router,
    extract::Extension,
    http::{
        HeaderValue, Method,
        header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    },
    middleware,
};
use config::openapi::ApiDoc;
use connectors::db::Database;
use modules::{
    auth::{middleware::auth, routes::auth_routes},
    food::routes::food_routes,
    meal::routes::meal_routes,
    user::routes::user_routes,
};
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod config;
mod connectors;
mod modules;
mod shared;

#[tokio::main]
async fn main() {
    dotenv::from_path("apps/server/.env").ok();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let db = Database::new(&database_url)
        .await
        .expect("Failed to connect to the database");

    let shared_db = Arc::new(db);

    let app = Router::new()
        .nest("/me", user_routes().route_layer(middleware::from_fn(auth)))
        .nest("/auth", auth_routes())
        .nest("/meals", meal_routes())
        .nest(
            "/foods",
            food_routes().route_layer(middleware::from_fn(auth)),
        )
        .layer(
            ServiceBuilder::new().layer(Extension(shared_db)).layer(
                CorsLayer::new()
                    .allow_methods([Method::GET, Method::POST, Method::PATCH])
                    .allow_headers([ACCEPT, AUTHORIZATION, CONTENT_TYPE])
                    .allow_origin("http://localhost:3000".parse::<HeaderValue>().unwrap())
                    .allow_credentials(true),
            ),
        )
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();

    println!("SERVER RUNNING ON http://localhost:8080");
    println!("VIEW DOCS ON http://localhost:8080/docs");

    axum::serve(listener, app).await.unwrap();
}
