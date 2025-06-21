use super::handlers::{create_food, get_foods, update_food};
use axum::{
    routing::{get, post},
    Router,
};

pub fn food_routes() -> Router {
    Router::new()
        .route("/", get(get_foods))
        .route("/create", post(create_food))
        .route("/update", post(update_food))
}
