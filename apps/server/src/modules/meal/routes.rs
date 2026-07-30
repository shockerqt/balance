use super::handlers::{
    add_meal_food, compare_summary, create_meal, delete_meal, delete_meal_food, get_daily_summary,
    get_meal_by_id, get_meals, update_meal, update_meal_food,
};
use axum::{
    Router,
    routing::{get, patch, post, put},
};

pub fn meal_routes() -> Router {
    Router::new()
        .route("/", get(get_meals))
        .route("/daily-summary", get(get_daily_summary))
        .route("/compare-summary", get(compare_summary))
        .route("/create", post(create_meal))
        .route("/update", patch(update_meal))
        .route("/{id}", get(get_meal_by_id).delete(delete_meal))
        .route("/{meal_id}/items", post(add_meal_food))
        .route("/{meal_id}/items/{item_id}", put(update_meal_food).delete(delete_meal_food))
}
