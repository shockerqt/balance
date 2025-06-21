use chrono::{Duration, Utc};
use jsonwebtoken::{EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String, // subject: el ID del usuario
    exp: i64,    // fecha de expiración (timestamp)
    iat: i64,    // issued at (timestamp)
}

pub fn create_jwt_for_user(user_id: i32) -> Result<String, jsonwebtoken::errors::Error> {
    let secret = std::env::var("JWT_SECRET").expect("JWT_SECRET not set");

    let now = Utc::now();
    let exp = now + Duration::days(7); // Token válido por 7 días

    let claims = Claims {
        sub: user_id.to_string(),
        iat: now.timestamp(),
        exp: exp.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}
