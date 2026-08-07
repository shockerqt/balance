use std::{
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;

#[derive(Clone)]
pub struct OidcConfig {
    issuer: String,
    jwks_url: String,
    http: reqwest::Client,
    audience: Vec<String>,
    jwks_cache: Arc<RwLock<Option<CachedJwks>>>,
}

struct CachedJwks {
    value: Arc<JwkSet>,
    fetched_at: Instant,
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
            .timeout(Duration::from_secs(5))
            .build()
            .context("building OIDC HTTP client")?;
        let audience = std::env::var("OIDC_AUDIENCE")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        Ok(Self {
            issuer,
            jwks_url,
            http,
            audience,
            jwks_cache: Arc::new(RwLock::new(None)),
        })
    }

    async fn fetch_jwks(&self) -> Result<Arc<JwkSet>> {
        let jwks = Arc::new(
            self.http
                .get(&self.jwks_url)
                .send()
                .await
                .context("fetching OIDC JWKS")?
                .error_for_status()
                .context("OIDC JWKS returned an error")?
                .json::<JwkSet>()
                .await
                .context("decoding OIDC JWKS")?,
        );
        *self
            .jwks_cache
            .write()
            .expect("OIDC JWKS cache lock poisoned") = Some(CachedJwks {
            value: jwks.clone(),
            fetched_at: Instant::now(),
        });
        Ok(jwks)
    }

    async fn jwks(&self, force_refresh: bool) -> Result<Arc<JwkSet>> {
        if !force_refresh {
            if let Some(cached) = self
                .jwks_cache
                .read()
                .expect("OIDC JWKS cache lock poisoned")
                .as_ref()
            {
                if cached.fetched_at.elapsed() < Duration::from_secs(300) {
                    return Ok(cached.value.clone());
                }
            }
        }
        self.fetch_jwks().await
    }

    pub async fn verify(&self, token: &str) -> Result<OidcClaims> {
        let header = decode_header(token).context("reading JWT header")?;
        let kid = header.kid.context("JWT is missing kid")?;
        let mut jwks = self.jwks(false).await?;
        if jwks.find(&kid).is_none() {
            jwks = self.jwks(true).await?;
        }
        let jwk = jwks.find(&kid).context("JWT signing key was not found")?;
        let key = DecodingKey::from_jwk(jwk).context("building JWT decoding key")?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.issuer]);
        if self.audience.is_empty() {
            validation.validate_aud = false;
        } else {
            let audiences: Vec<&str> = self.audience.iter().map(String::as_str).collect();
            validation.set_audience(&audiences);
        }
        Ok(decode::<OidcClaims>(token, &key, &validation)?.claims)
    }
}
