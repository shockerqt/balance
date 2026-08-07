use anyhow::{Context, Result};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;

#[derive(Clone)]
pub struct OidcConfig {
    issuer: String,
    jwks_url: String,
    http: reqwest::Client,
}

#[derive(Debug, Deserialize)]
pub struct OidcClaims {
    pub email: String,
    pub exp: usize,
    pub iss: String,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub picture: Option<String>,
}

impl OidcConfig {
    pub fn from_env() -> Result<Self> {
        let issuer = std::env::var("OIDC_ISSUER")
            .unwrap_or_else(|_| "https://auth.shocker.cl/realms/balance".to_string());
        let jwks_url = std::env::var("OIDC_JWKS_URL")
            .unwrap_or_else(|_| format!("{issuer}/protocol/openid-connect/certs"));
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .context("building OIDC HTTP client")?;
        Ok(Self {
            issuer,
            jwks_url,
            http,
        })
    }

    pub async fn verify(&self, token: &str) -> Result<OidcClaims> {
        let header = decode_header(token).context("reading JWT header")?;
        let kid = header.kid.context("JWT is missing kid")?;
        let jwks = self
            .http
            .get(&self.jwks_url)
            .send()
            .await
            .context("fetching OIDC JWKS")?
            .error_for_status()
            .context("OIDC JWKS returned an error")?
            .json::<JwkSet>()
            .await
            .context("decoding OIDC JWKS")?;
        let jwk = jwks.find(&kid).context("JWT signing key was not found")?;
        let key = DecodingKey::from_jwk(jwk).context("building JWT decoding key")?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.issuer]);
        validation.validate_aud = false;
        Ok(decode::<OidcClaims>(token, &key, &validation)?.claims)
    }
}
