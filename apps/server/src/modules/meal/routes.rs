use super::handlers::{create_meal, get_meals, update_meal};
use axum::{
    Router,
    routing::{get, patch, post},
};

pub fn meal_routes() -> Router {
    Router::new()
        .route("/", get(get_meals))
        .route("/create", post(create_meal))
        .route("/update", patch(update_meal))
}
