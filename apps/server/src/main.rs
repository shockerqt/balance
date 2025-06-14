use axum::{extract::Extension, http::Method, Router};
use connectors::db::Database;
use modules::{food::routes::food_routes, meal::routes::meal_routes};
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};

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
        .nest("/meals", meal_routes())
        .nest("/foods", food_routes())
        .layer(
            // https://docs.rs/axum/latest/axum/middleware/index.html
            ServiceBuilder::new().layer(Extension(shared_db)).layer(
                CorsLayer::new()
                    .allow_methods([Method::GET, Method::POST])
                    .allow_origin(Any),
            ),
        );
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
