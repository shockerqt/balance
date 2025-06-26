use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct GeminiClient {
    api_key: String,
    client: Client,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: Client::new(),
        }
    }

    pub async fn generate_content(&self, prompt: &str) -> Result<String> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}",
            self.api_key
        );

        let body = serde_json::json!({
            "contents": [
                {
                    "parts": [
                        { "text": prompt }
                    ]
                }
            ]
        });

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("Failed to send request to Gemini")?; // convierte reqwest::Error en anyhow::Error con contexto

        let json: GeminiResponse = resp
            .json()
            .await
            .context("Failed to deserialize Gemini response")?;

        let Some(text) = json
            .contents
            .get(0)
            .and_then(|c| c.parts.get(0))
            .and_then(|p| p.text.clone())
        else {
            anyhow::bail!("No text content returned from Gemini");
        };

        Ok(text)
    }
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    contents: Vec<GeminiContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}
