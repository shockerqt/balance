use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

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
        let (status, message) = match &self {
            AppError::Db(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Database error"),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.as_str()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.as_str()),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.as_str()),
        };

        let body = Json(ErrorResponse {
            error: format!("{:?}", self).to_lowercase(),
            message: message.to_string(),
        });

        (status, body).into_response()
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
