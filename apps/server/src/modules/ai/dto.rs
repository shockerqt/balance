use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
pub struct ParseTextRequest {
    pub prompt: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScanLabelRequest {
    pub image_base64: String,
    pub mime_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct NutritionalAnalysisResponse {
    pub name: String,
    pub serving_quantity: f64,
    pub serving_unit: String,
    pub calories: f64,
    pub proteins: f64,
    pub carbohydrates: f64,
    pub fats: f64,
    pub fiber: f64,
    pub sodium_mg: Option<f64>,
    pub confidence_score: Option<f64>,
    pub notes: Option<String>,
}
