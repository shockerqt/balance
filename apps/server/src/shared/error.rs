use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

use super::response::ApiResponse;

#[derive(Debug)]
pub enum AppError {
    Db(sqlx::Error),
    NotFound(String),
    BadRequest(String),
    Conflict(String),
    Internal(String),
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub error: String,
    pub message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Always log the full error server-side so operators can diagnose.
        tracing::error!(error = ?self, "request failed");

        let (status, code, message) = match self {
            AppError::Db(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "db",
                "Database error".to_string(),
            ),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "conflict", msg),
            AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "Internal error".to_string(),
            ),
        };

        let response = ApiResponse::error(ErrorResponse {
            message,
            error: code.to_string(),
        });

        (status, Json(response)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        if let sqlx::Error::RowNotFound = err {
            AppError::NotFound("Resource not found".into())
        } else {
            AppError::Db(err)
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}
