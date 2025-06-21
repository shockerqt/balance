use super::handlers::get_me;
use axum::{Router, routing::get};

pub fn user_routes() -> Router {
    Router::new().route("/", get(get_me))
}
