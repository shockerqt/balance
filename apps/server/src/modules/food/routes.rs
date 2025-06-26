use super::handlers::{create_food, get_foods, update_food};
use axum::{
    Router,
    routing::{get, patch, post},
};

pub fn food_routes() -> Router {
    Router::new()
        .route("/", get(get_foods))
        .route("/create", post(create_food))
        .route("/update", patch(update_food))
}
