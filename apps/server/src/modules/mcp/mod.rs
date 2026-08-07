use std::sync::Arc;

use axum::{
    Extension, Json, Router,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    connectors::{db::Database, gemini::GeminiClient},
    modules::{ai::dto::ParseTextRequest, auth::middleware::CurrentUser},
};

const MCP_URL: &str = "https://balance.shocker.cl/api/mcp";
const AUTHORIZATION_SERVER: &str = "https://auth.shocker.cl/realms/balance";

/// Protected Streamable HTTP endpoint. It deliberately does not expose the
/// legacy SSE/message endpoints or the separate stdio server.
pub fn mcp_routes() -> Router {
    Router::new().route("/mcp", post(mcp_post_handler))
}

/// RFC 9728 metadata lets MCP clients discover the Keycloak authorization
/// server before attempting an OAuth authorization-code flow.
pub fn mcp_metadata_routes() -> Router {
    Router::new().route(
        "/.well-known/oauth-protected-resource/mcp",
        get(oauth_protected_resource_metadata),
    )
}

async fn oauth_protected_resource_metadata() -> impl IntoResponse {
    Json(json!({
        "resource": MCP_URL,
        "authorization_servers": [AUTHORIZATION_SERVER],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["openid", "profile", "email"]
    }))
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

async fn mcp_post_handler(
    Extension(db): Extension<Arc<Database>>,
    Extension(gemini): Extension<Arc<GeminiClient>>,
    Extension(user): Extension<CurrentUser>,
    Json(payload): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    if payload.jsonrpc != "2.0" {
        return json_rpc_error(payload.id, -32600, "Invalid JSON-RPC version");
    }
    let id = payload.id.unwrap_or(serde_json::Value::Null);
    match payload.method.as_str() {
        "initialize" => Json(json!({
            "jsonrpc": "2.0", "id": id,
            "result": {
                "protocolVersion": "2025-11-25",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "balance", "version": env!("CARGO_PKG_VERSION") }
            }
        })).into_response(),
        "notifications/initialized" => StatusCode::ACCEPTED.into_response(),
        "tools/list" => Json(json!({
            "jsonrpc": "2.0", "id": id,
            "result": { "tools": [
                { "name": "get_foods", "description": "Lista los alimentos del usuario autenticado.", "inputSchema": {"type":"object","properties":{}}, "annotations": {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false} },
                { "name": "search_foods", "description": "Busca alimentos en la biblioteca del usuario.", "inputSchema": {"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}, "annotations": {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false} },
                { "name": "parse_food_text", "description": "Extrae información nutricional desde una descripción de comida.", "inputSchema": {"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]} },
                { "name": "get_official_templates", "description": "Obtiene las plantillas oficiales de alimentos.", "inputSchema": {"type":"object","properties":{}}, "annotations": {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false} }
            ]}
        })).into_response(),
        "tools/call" => {
            let params = payload.params.unwrap_or_else(|| json!({}));
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or_default();
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let text = match name {
                "get_foods" => match db.food.get_all(Some(user.id)).await {
                    Ok(foods) => serde_json::to_string(&foods).unwrap_or_else(|error| format!("No se pudieron serializar alimentos: {error}")),
                    Err(error) => format!("No se pudieron obtener alimentos: {error}"),
                },
                "search_foods" => {
                    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or_default();
                    match db.food.search(user.id, query).await {
                        Ok(foods) => serde_json::to_string(&foods).unwrap_or_else(|error| format!("No se pudieron serializar alimentos: {error}")),
                        Err(error) => format!("No se pudieron buscar alimentos: {error}"),
                    }
                }
                "parse_food_text" => {
                    let prompt = args.get("prompt").and_then(|v| v.as_str()).unwrap_or_default();
                    let request = ParseTextRequest { prompt: prompt.to_string() };
                    gemini.generate_structured_content(vec![crate::connectors::gemini::GeminiPart {
                        text: Some(format!("Parse this food into structured nutritional values and respond in JSON: {}", request.prompt)),
                        inline_data: None,
                    }]).await.unwrap_or_else(|error| format!("No se pudo analizar el texto: {error}"))
                }
                "get_official_templates" => match db.sync.get_official_templates().await {
                    Ok(templates) => serde_json::to_string(&templates).unwrap_or_else(|error| format!("No se pudieron serializar las plantillas: {error}")),
                    Err(error) => format!("No se pudieron obtener las plantillas: {error}"),
                },
                _ => return json_rpc_error(Some(id), -32602, "Unknown tool"),
            };
            Json(json!({"jsonrpc":"2.0", "id":id, "result":{"content":[{"type":"text","text":text}]}})).into_response()
        }
        _ => json_rpc_error(Some(id), -32601, "Method not found"),
    }
}

fn json_rpc_error(
    id: Option<serde_json::Value>,
    code: i32,
    message: &str,
) -> axum::response::Response {
    Json(json!({"jsonrpc":"2.0", "id":id.unwrap_or(serde_json::Value::Null), "error":{"code":code,"message":message}})).into_response()
}
