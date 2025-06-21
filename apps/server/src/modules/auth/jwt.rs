use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, TokenData, Validation, decode, encode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: i32,
    pub email: String,
    pub exp: i64, // expiration date (timestamp)
    pub iat: i64, // issued at (timestamp)
}

pub fn create_jwt_for_user(
    user_id: i32,
    email: String,
) -> Result<String, jsonwebtoken::errors::Error> {
    let secret = std::env::var("JWT_SECRET").expect("JWT_SECRET not set");

    let now = Utc::now();
    let exp = now + Duration::days(7); // Token válido por 7 días

    let claims = Claims {
        user_id,
        email,
        iat: now.timestamp(),
        exp: exp.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

impl Claims {
    pub fn decode_jwt(token: &str) -> Result<TokenData<Claims>, jsonwebtoken::errors::Error> {
        let secret = std::env::var("JWT_SECRET").expect("JWT_SECRET not set");
        decode::<Claims>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &Validation::default(),
        )
    }
}
