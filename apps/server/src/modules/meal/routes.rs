use super::handlers::{create_meal, get_meals, update_meal};
use axum::{
    routing::{get, post},
    Router,
};

pub fn meal_routes() -> Router {
    Router::new()
        .route("/", get(get_meals))
        .route("/create", post(create_meal))
        .route("/update", post(update_meal))
}
