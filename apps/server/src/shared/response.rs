use axum::Json;
use chrono::Utc;
use reqwest::StatusCode;
use serde::Serialize;
use std::collections::HashMap;
use utoipa::ToSchema;

use super::error::{AppError, ErrorResponse};

pub type ApiResult<T> = Result<Json<ApiResponse<T>>, AppError>;
pub type ApiResultWithCode<T> = Result<(StatusCode, Json<ApiResponse<T>>), AppError>;

#[derive(Serialize, ToSchema)]
pub struct ApiResponse<T> {
    pub data: Option<T>,
    pub error: Option<ErrorResponse>,
    pub meta: Option<HashMap<String, String>>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self::success_with_meta(data, None)
    }

    pub fn success_with_meta(data: T, meta: Option<HashMap<String, String>>) -> Self {
        let mut meta = meta.unwrap_or_default();
        meta.insert("timestamp".to_string(), Utc::now().to_rfc3339());

        Self {
            data: Some(data),
            error: None,
            meta: Some(meta),
        }
    }
}

impl ApiResponse<()> {
    pub fn error(error: ErrorResponse) -> Self {
        Self {
            data: None,
            error: Some(error),
            meta: None,
        }
    }
}
