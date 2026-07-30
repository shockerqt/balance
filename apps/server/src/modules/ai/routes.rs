use axum::{
    Router,
    middleware::from_fn,
    routing::post,
};

use crate::modules::auth::middleware::auth;

use super::handlers::{parse_food_text, scan_nutrition_label};

pub fn ai_routes() -> Router {
    Router::new()
        .route("/parse-text", post(parse_food_text))
        .route("/scan-label", post(scan_nutrition_label))
        .layer(from_fn(auth))
}
