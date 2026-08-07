use axum::{Extension, Json};
use std::sync::Arc;

use crate::{
    connectors::gemini::{GeminiClient, GeminiPart, InlineData},
    modules::{
        ai::dto::{NutritionalAnalysisResponse, ParseTextRequest, ScanLabelRequest},
        auth::middleware::CurrentUser,
    },
    shared::error::AppError,
};

#[utoipa::path(
    post,
    path = "/ai/parse-text",
    request_body = ParseTextRequest,
    responses(
        (status = 200, description = "Text parsed into nutritional values", body = NutritionalAnalysisResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "AI Processing Failed")
    ),
    security(("token" = []))
)]
pub async fn parse_food_text(
    Extension(_user): Extension<CurrentUser>,
    Extension(gemini): Extension<Arc<GeminiClient>>,
    Json(payload): Json<ParseTextRequest>,
) -> Result<Json<NutritionalAnalysisResponse>, AppError> {
    let prompt = format!(
        "You are an expert nutritionist assistant. Parse the following text input into structured nutritional values for a single serving. \
        Extract name, serving_quantity (number), serving_unit (string like 'g', 'ml', 'unit', 'cup', etc.), calories (kcal), proteins (g), carbohydrates (g), fats (g), fiber (g), and sodium_mg (mg, if mentioned). \
        If any macro is unknown, estimate accurately based on standard food databases. \
        Format your response as a valid JSON object matching these exact keys: \
        {{\"name\": string, \"serving_quantity\": number, \"serving_unit\": string, \"calories\": number, \"proteins\": number, \"carbohydrates\": number, \"fats\": number, \"fiber\": number, \"sodium_mg\": number, \"confidence_score\": number, \"notes\": string}}. \
        Input: \"{}\"",
        payload.prompt
    );

    let parts = vec![GeminiPart {
        text: Some(prompt),
        inline_data: None,
    }];

    let raw_json = gemini
        .generate_structured_content(parts)
        .await
        .map_err(|e| AppError::Internal(format!("AI service error: {}", e)))?;

    let parsed: NutritionalAnalysisResponse = serde_json::from_str(&raw_json).map_err(|e| {
        AppError::Internal(format!(
            "Failed to parse AI response: {}. Raw: {}",
            e, raw_json
        ))
    })?;

    Ok(Json(parsed))
}

#[utoipa::path(
    post,
    path = "/ai/scan-label",
    request_body = ScanLabelRequest,
    responses(
        (status = 200, description = "Nutrition label image scanned into values", body = NutritionalAnalysisResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "AI Vision Processing Failed")
    ),
    security(("token" = []))
)]
pub async fn scan_nutrition_label(
    Extension(_user): Extension<CurrentUser>,
    Extension(gemini): Extension<Arc<GeminiClient>>,
    Json(payload): Json<ScanLabelRequest>,
) -> Result<Json<NutritionalAnalysisResponse>, AppError> {
    let mime_type = payload
        .mime_type
        .unwrap_or_else(|| "image/jpeg".to_string());
    let prompt = "You are a specialized OCR nutritionist assistant. Analyze the provided image of a nutrition facts label (such as Chilean packaged foods or standard labels). \
        Extract the product name, serving size (serving_quantity and serving_unit like 'g', 'ml', 'unit'), calories, proteins (g), carbohydrates (g), total fats (g), dietary fiber (g), and sodium (mg) per serving. \
        Respond strictly with a JSON object with keys: \
        {\"name\": string, \"serving_quantity\": number, \"serving_unit\": string, \"calories\": number, \"proteins\": number, \"carbohydrates\": number, \"fats\": number, \"fiber\": number, \"sodium_mg\": number, \"confidence_score\": number, \"notes\": string}.".to_string();

    let parts = vec![
        GeminiPart {
            text: Some(prompt),
            inline_data: None,
        },
        GeminiPart {
            text: None,
            inline_data: Some(InlineData {
                mime_type,
                data: payload.image_base64,
            }),
        },
    ];

    let raw_json = gemini
        .generate_structured_content(parts)
        .await
        .map_err(|e| AppError::Internal(format!("AI vision service error: {}", e)))?;

    let parsed: NutritionalAnalysisResponse = serde_json::from_str(&raw_json).map_err(|e| {
        AppError::Internal(format!(
            "Failed to parse AI vision response: {}. Raw: {}",
            e, raw_json
        ))
    })?;

    Ok(Json(parsed))
}
