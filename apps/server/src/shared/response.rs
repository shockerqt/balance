use chrono::Utc;
use serde::Serialize;
use std::collections::HashMap;

use super::error::ErrorResponse;

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub data: Option<T>,
    pub error: Option<ErrorResponse>,
    pub meta: Option<HashMap<String, String>>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        let mut meta = HashMap::new();
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
