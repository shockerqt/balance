use utoipa::{
    Modify, OpenApi,
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
};

use crate::modules::food::handlers::{__path_create_food, __path_get_foods, __path_update_food};

#[derive(OpenApi)]
#[openapi(
    paths(
        get_foods,
        create_food,
        update_food,
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "user", description = "User endpoints"),
        (name = "food", description = "Food endpoints"),
        (name = "meal", description = "Meal endpoints"),
        (name = "auth", description = "Auth endpoints"),
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
