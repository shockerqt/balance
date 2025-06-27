use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

use super::response::ApiResponse;

#[derive(Debug)]
pub enum AppError {
    Db(sqlx::Error),
    NotFound(String),
    BadRequest(String),
    Internal(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub error: String,
    pub message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message, code) = match &self {
            AppError::Db(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Database error", "db"),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "Resource not found", "not_found"),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "Bad request", "bad_request"),
            AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal error",
                "internal",
            ),
        };

        let response = ApiResponse::error(ErrorResponse {
            message: message.to_string(),
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
