use utoipa::{
    Modify, OpenApi,
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
};

use crate::modules::ai::handlers::{__path_parse_food_text, __path_scan_nutrition_label};

#[derive(OpenApi)]
#[openapi(
    paths(
        parse_food_text,
        scan_nutrition_label,
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "user", description = "User endpoints"),
        (name = "auth", description = "Auth endpoints"),
        (name = "ai", description = "AI Nutritional Assistant endpoints"),
    )
)]
pub struct ApiDoc;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "cookieAuth",
                SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::new("token"))),
            );
        }
    }
}
