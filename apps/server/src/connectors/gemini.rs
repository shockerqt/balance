use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct GeminiClient {
    api_key: String,
    client: Client,
}

#[derive(Debug, Serialize)]
pub struct GeminiPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inline_data: Option<InlineData>,
}

#[derive(Debug, Serialize)]
pub struct InlineData {
    pub mime_type: String,
    pub data: String,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: Client::new(),
        }
    }

    pub async fn generate_structured_content(&self, parts: Vec<GeminiPart>) -> Result<String> {
        let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

        let body = serde_json::json!({
            "contents": [{
                "parts": parts
            }],
            "generationConfig": {
                "response_mime_type": "application/json"
            }
        });

        let resp = self
            .client
            .post(url)
            .header("x-goog-api-key", &self.api_key)
            .json(&body)
            .send()
            .await
            .context("Failed to send request to Gemini API")?;

        if !resp.status().is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Gemini API error: {}", error_text);
        }

        let json: GeminiResponse = resp
            .json()
            .await
            .context("Failed to deserialize Gemini API response")?;

        let text = json
            .candidates
            .into_iter()
            .next()
            .and_then(|c| c.content.parts.into_iter().next())
            .and_then(|p| p.text)
            .ok_or_else(|| anyhow::anyhow!("No content returned from Gemini API"))?;

        Ok(text)
    }
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiResponsePart>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponsePart {
    text: Option<String>,
}
