use std::{
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, de::DeserializeOwned};
use tokio::sync::OnceCell;

const MAX_PROVIDER_BODY: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityMode {
    LegacyEmail,
    IssuerSubject,
}

#[derive(Clone)]
pub struct OidcConfig {
    issuer: String,
    jwks_url: String,
    http: reqwest::Client,
    audience: Vec<String>,
    mode: IdentityMode,
    mcp_resource: Option<String>,
    challenge: axum::http::HeaderValue,
    discovery: Arc<OnceCell<Discovery>>,
    jwks_cache: Arc<RwLock<Option<CachedJwks>>>,
}

struct CachedJwks {
    value: Arc<JwkSet>,
    fetched_at: Instant,
}

#[derive(Debug, Deserialize)]
struct Discovery {
    issuer: String,
    jwks_uri: String,
    userinfo_endpoint: String,
}

#[derive(Debug, Deserialize)]
pub struct OidcClaims {
    pub sub: String,
    pub email: Option<String>,
    pub exp: usize,
    pub iss: String,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserInfo {
    pub sub: String,
    pub email: String,
    pub email_verified: bool,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub picture: Option<String>,
}

fn pinned_endpoint(issuer: &str, endpoint: &str) -> Result<()> {
    let issuer = reqwest::Url::parse(issuer)?;
    let endpoint = reqwest::Url::parse(endpoint)?;
    if issuer.scheme() != "https"
        || endpoint.scheme() != "https"
        || issuer.origin() != endpoint.origin()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.fragment().is_some()
        || endpoint.query().is_some()
    {
        bail!("invalid provider endpoint");
    }
    Ok(())
}

fn validate_discovery(issuer: &str, metadata: &Discovery) -> Result<()> {
    if metadata.issuer != issuer {
        bail!("discovery issuer mismatch");
    }
    pinned_endpoint(issuer, &metadata.jwks_uri)?;
    pinned_endpoint(issuer, &metadata.userinfo_endpoint)?;
    Ok(())
}

// Identity values must already be canonical: never normalize an audience into
// another identity, nor allow header-sensitive characters or URL credentials.
fn validate_resource(resource: &str) -> Result<reqwest::Url> {
    if resource.len() > 2048
        || !resource.is_ascii()
        || resource
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        bail!("invalid OIDC resource");
    }
    let url = reqwest::Url::parse(resource)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.as_str() != resource
    {
        bail!("invalid OIDC resource");
    }
    Ok(url)
}

fn resource_challenge(resource: &str) -> Result<axum::http::HeaderValue> {
    let url = validate_resource(resource)?;
    let metadata = format!(
        "{}/.well-known/oauth-protected-resource{}",
        url.origin().ascii_serialization(),
        url.path()
    );
    Ok(axum::http::HeaderValue::from_str(&format!(
        "Bearer resource_metadata=\"{metadata}\""
    ))?)
}

async fn bounded_json<T: DeserializeOwned>(mut response: reqwest::Response) -> Result<T> {
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|len| len > MAX_PROVIDER_BODY as u64)
    {
        bail!("provider response rejected");
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > MAX_PROVIDER_BODY - body.len() {
            bail!("provider response too large");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}

impl OidcConfig {
    pub fn from_env() -> Result<Self> {
        let mode = match std::env::var("OIDC_IDENTITY_MODE").as_deref() {
            Err(std::env::VarError::NotPresent) | Ok("legacy_email") => IdentityMode::LegacyEmail,
            Ok("issuer_subject") => IdentityMode::IssuerSubject,
            _ => bail!("invalid OIDC identity mode"),
        };
        let issuer = std::env::var("OIDC_ISSUER")
            .unwrap_or_else(|_| "https://auth.shocker.cl/realms/balance".to_string());
        let jwks_url = std::env::var("OIDC_JWKS_URL")
            .unwrap_or_else(|_| format!("{issuer}/protocol/openid-connect/certs"));
        let raw_audience = std::env::var("OIDC_AUDIENCE").unwrap_or_default();
        let audience = if mode == IdentityMode::IssuerSubject {
            vec![raw_audience]
        } else {
            raw_audience
                .split(',')
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        };
        let mcp_resource = if mode == IdentityMode::IssuerSubject {
            Some(
                std::env::var("OIDC_MCP_RESOURCE")
                    .context("issuer_subject requires OIDC_MCP_RESOURCE")?,
            )
        } else {
            None
        };
        Self::new(issuer, jwks_url, audience, mode, mcp_resource)
    }

    fn new(
        issuer: String,
        jwks_url: String,
        audience: Vec<String>,
        mode: IdentityMode,
        mcp_resource: Option<String>,
    ) -> Result<Self> {
        if mode == IdentityMode::IssuerSubject {
            if audience.len() != 1 || validate_resource(&audience[0])?.path() != "/api" {
                bail!("issuer_subject requires one exact REST OIDC_AUDIENCE ending in /api");
            }
            let mcp = mcp_resource
                .as_deref()
                .context("issuer_subject requires OIDC_MCP_RESOURCE")?;
            let api_url = validate_resource(&audience[0])?;
            let mcp_url = validate_resource(mcp)?;
            if api_url.origin() != mcp_url.origin() || mcp != format!("{}/mcp", audience[0]) {
                bail!("OIDC_MCP_RESOURCE must be the REST resource followed by /mcp");
            }
            if issuer.len() > 2048 {
                bail!("issuer too long");
            }
            pinned_endpoint(&issuer, &issuer)?;
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .context("building OIDC HTTP client")?;
        let challenge = if mode == IdentityMode::IssuerSubject {
            resource_challenge(&audience[0])?
        } else {
            axum::http::HeaderValue::from_static(
                "Bearer resource_metadata=\"https://balance.shocker.cl/api/.well-known/oauth-protected-resource/mcp\"",
            )
        };
        Ok(Self {
            issuer,
            jwks_url,
            http,
            audience,
            mode,
            mcp_resource,
            challenge,
            discovery: Arc::new(OnceCell::new()),
            jwks_cache: Arc::new(RwLock::new(None)),
        })
    }

    pub fn mcp_config(&self) -> Self {
        let mut config = self.clone();
        if self.mode == IdentityMode::IssuerSubject {
            let resource = self
                .mcp_resource
                .as_ref()
                .expect("validated strict MCP resource");
            config.audience = vec![resource.clone()];
            config.challenge =
                resource_challenge(resource).expect("validated strict MCP challenge");
        }
        config
    }

    pub fn challenge(&self) -> &axum::http::HeaderValue {
        &self.challenge
    }
    pub fn resource(&self) -> Option<&str> {
        (self.mode == IdentityMode::IssuerSubject).then(|| self.audience[0].as_str())
    }
    pub fn issuer(&self) -> &str {
        &self.issuer
    }

    #[cfg(test)]
    pub(crate) fn test_cached_subject_config() -> Self {
        let config = Self::test_subject_config("https://issuer.example.invalid");
        *config.jwks_cache.write().unwrap() = Some(CachedJwks {
            value: Arc::new(
                serde_json::from_str(include_str!("fixtures/PUBLIC-TEST-ONLY-jwks.json")).unwrap(),
            ),
            fetched_at: Instant::now(),
        });
        config
    }

    #[cfg(test)]
    pub(super) fn test_subject_config(issuer: &str) -> Self {
        Self::new(
            issuer.into(),
            "unused".into(),
            vec!["https://api.example.invalid/api".into()],
            IdentityMode::IssuerSubject,
            Some("https://api.example.invalid/api/mcp".into()),
        )
        .unwrap()
    }

    #[cfg(test)]
    pub(super) fn test_userinfo_endpoint(&self, url: String) {
        self.discovery
            .set(Discovery {
                issuer: self.issuer.clone(),
                jwks_uri: url.clone(),
                userinfo_endpoint: url,
            })
            .unwrap();
    }

    pub fn identity_mode(&self) -> IdentityMode {
        self.mode
    }

    async fn discovery(&self) -> Result<&Discovery> {
        self.discovery
            .get_or_try_init(|| async {
                let url = format!(
                    "{}/.well-known/openid-configuration",
                    self.issuer.trim_end_matches('/')
                );
                let metadata: Discovery = bounded_json(self.http.get(&url).send().await?).await?;
                validate_discovery(&self.issuer, &metadata)?;
                Ok(metadata)
            })
            .await
    }

    async fn fetch_jwks(&self) -> Result<Arc<JwkSet>> {
        let url = if self.mode == IdentityMode::IssuerSubject {
            &self.discovery().await?.jwks_uri
        } else {
            &self.jwks_url
        };
        let jwks: Arc<JwkSet> = Arc::new(bounded_json(self.http.get(url).send().await?).await?);
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
        if !force_refresh
            && let Some(cached) = self
                .jwks_cache
                .read()
                .expect("OIDC JWKS cache lock poisoned")
                .as_ref()
            && cached.fetched_at.elapsed() < Duration::from_secs(300)
        {
            return Ok(cached.value.clone());
        }
        self.fetch_jwks().await
    }

    pub async fn verify(&self, token: &str) -> Result<OidcClaims> {
        let header = decode_header(token)?;
        if header.alg != Algorithm::RS256
            || self.mode == IdentityMode::IssuerSubject && header.typ.as_deref() != Some("at+jwt")
        {
            bail!("invalid access token type");
        }
        let kid = header.kid.context("JWT is missing kid")?;
        let mut jwks = self.jwks(false).await?;
        if jwks.find(&kid).is_none() {
            jwks = self.jwks(true).await?;
        }
        let jwk = jwks.find(&kid).context("JWT signing key was not found")?;
        let key = DecodingKey::from_jwk(jwk)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.issuer]);
        if self.mode == IdentityMode::IssuerSubject {
            validation.leeway = 0;
            validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        }
        if self.audience.is_empty() {
            validation.validate_aud = false;
        } else {
            validation.set_audience(&self.audience);
        }
        let claims = decode::<OidcClaims>(token, &key, &validation)?.claims;
        if self.mode == IdentityMode::IssuerSubject
            && claims.exp <= chrono::Utc::now().timestamp() as usize
        {
            bail!("access token expired");
        }
        if claims.sub.trim().is_empty() || claims.sub.trim() != claims.sub || claims.sub.len() > 255
        {
            bail!("invalid subject");
        }
        Ok(claims)
    }

    /// Only used for an unknown local identity, after local JWT verification.
    pub async fn userinfo(&self, token: &str, claims: &OidcClaims) -> Result<UserInfo> {
        if self.mode != IdentityMode::IssuerSubject {
            bail!("userinfo is not used in legacy mode");
        }
        let url = &self.discovery().await?.userinfo_endpoint;
        let info: UserInfo =
            bounded_json(self.http.get(url).bearer_auth(token).send().await?).await?;
        validate_userinfo(&info, &claims.sub)?;
        Ok(info)
    }
}

fn validate_userinfo(info: &UserInfo, subject: &str) -> Result<()> {
    if info.sub != subject
        || !info.email_verified
        || info.email.trim().is_empty()
        || info.email.len() > 320
        || info.email.chars().any(char::is_control)
        || [
            &info.name,
            &info.family_name,
            &info.given_name,
            &info.picture,
        ]
        .iter()
        .any(|v| v.as_ref().is_some_and(|v| v.len() > 4096))
    {
        bail!("invalid userinfo");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, routing::get};
    use std::sync::atomic::{AtomicUsize, Ordering};

    async fn provider(
        body: Arc<RwLock<String>>,
        calls: Arc<AtomicUsize>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(
            "/",
            get(move || {
                let body = body.clone();
                let calls = calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    body.read().unwrap().clone()
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, task)
    }

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("fixtures/public-tokens.json")).unwrap()
    }

    fn subject_config() -> OidcConfig {
        OidcConfig::new(
            "https://issuer.example.invalid".into(),
            "unused".into(),
            vec!["https://api.example.invalid/api".into()],
            IdentityMode::IssuerSubject,
            Some("https://api.example.invalid/api/mcp".into()),
        )
        .unwrap()
    }

    async fn mock_config(
        body: &str,
    ) -> (
        OidcConfig,
        Arc<RwLock<String>>,
        Arc<AtomicUsize>,
        tokio::task::JoinHandle<()>,
    ) {
        let body = Arc::new(RwLock::new(body.to_owned()));
        let calls = Arc::new(AtomicUsize::new(0));
        let (url, task) = provider(body.clone(), calls.clone()).await;
        let config = subject_config();
        // Only tests inject loopback metadata; production discovery pins HTTPS.
        config
            .discovery
            .set(Discovery {
                issuer: config.issuer.clone(),
                jwks_uri: url.clone(),
                userinfo_endpoint: url,
            })
            .unwrap();
        (config, body, calls, task)
    }

    #[test]
    fn strict_config_and_discovery_endpoint_policy() {
        assert!(
            OidcConfig::new(
                "https://issuer.example.invalid".into(),
                "unused".into(),
                vec![],
                IdentityMode::IssuerSubject,
                None,
            )
            .is_err()
        );
        for endpoint in [
            "http://issuer.example.invalid/jwks",
            "https://other.example.invalid/jwks",
            "https://issuer.example.invalid:444/jwks",
            "https://user@issuer.example.invalid/jwks",
            "https://issuer.example.invalid/jwks?secret=1",
            "https://issuer.example.invalid/jwks#x",
        ] {
            assert!(pinned_endpoint("https://issuer.example.invalid", endpoint).is_err());
        }
        assert!(
            pinned_endpoint(
                "https://issuer.example.invalid",
                "https://issuer.example.invalid/jwks"
            )
            .is_ok()
        );
        let issuer = "https://issuer.example.invalid";
        let mut discovery = Discovery {
            issuer: issuer.into(),
            jwks_uri: format!("{issuer}/jwks"),
            userinfo_endpoint: format!("{issuer}/userinfo"),
        };
        assert!(validate_discovery(issuer, &discovery).is_ok());
        discovery.issuer = "https://other.example.invalid".into();
        assert!(validate_discovery(issuer, &discovery).is_err());
        discovery.issuer = issuer.into();
        discovery.userinfo_endpoint = "https://other.example.invalid/userinfo".into();
        assert!(validate_discovery(issuer, &discovery).is_err());
    }

    #[test]
    fn strict_resources_reject_missing_multiple_and_noncanonical_configuration() {
        let config = |resources: Vec<String>, mcp: Option<String>, mode| {
            OidcConfig::new(
                "https://issuer.example.invalid".into(),
                "unused".into(),
                resources,
                mode,
                mcp,
            )
        };
        let api = "https://api.example.invalid/api";
        let mcp = "https://api.example.invalid/api/mcp";
        assert!(
            config(
                vec![api.into()],
                Some(mcp.into()),
                IdentityMode::IssuerSubject
            )
            .is_ok()
        );
        assert!(config(vec![api.into()], None, IdentityMode::IssuerSubject).is_err());
        assert!(
            config(
                vec![api.into(), mcp.into()],
                Some(mcp.into()),
                IdentityMode::IssuerSubject
            )
            .is_err()
        );
        for resource in [
            "",
            "http://api.example.invalid/api",
            "https://api.example.invalid/api,https://api.example.invalid/api/mcp",
            " https://api.example.invalid/api",
            "https://api.example.invalid/api\n",
            "https://api.example.invalid/api?x=1",
            "https://api.example.invalid/api#fragment",
            "https://user:password@api.example.invalid/api",
            "https://API.example.invalid/api",
            "https://api.example.invalid:443/api",
            "https://api.example.invalid/a/../api",
            "https://api.example.invalid/%61pi",
            "https://api.example.invalid/api/",
            "https://api.example.invalid/other",
            "https://api.example.invalid/api\r\nInjected: value",
        ] {
            assert!(
                config(
                    vec![resource.into()],
                    Some(mcp.into()),
                    IdentityMode::IssuerSubject
                )
                .is_err(),
                "{resource:?}"
            );
        }
        for resource in [
            "https://other.example.invalid/api/mcp",
            api,
            "https://api.example.invalid/api/mcp/",
            "https://api.example.invalid/api/mcp?x=1",
        ] {
            assert!(
                config(
                    vec![api.into()],
                    Some(resource.into()),
                    IdentityMode::IssuerSubject
                )
                .is_err()
            );
        }
        let legacy = config(
            vec!["first".into(), "second".into()],
            None,
            IdentityMode::LegacyEmail,
        )
        .unwrap();
        assert_eq!(legacy.mcp_config().audience, vec!["first", "second"]);
        assert_eq!(
            legacy.challenge().to_str().unwrap(),
            "Bearer resource_metadata=\"https://balance.shocker.cl/api/.well-known/oauth-protected-resource/mcp\""
        );
    }

    #[tokio::test]
    async fn route_audiences_share_discovery_and_unknown_kid_refresh_cache() {
        let fixture = fixture();
        let mut initial = fixture["jwks"].clone();
        initial["keys"].as_array_mut().unwrap().truncate(1);
        let (api, body, calls, task) = mock_config(&initial.to_string()).await;
        let mcp = api.mcp_config();
        let valid = fixture["tokens"]["valid"].as_str().unwrap();
        api.verify(valid).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(mcp.verify(valid).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        *body.write().unwrap() = fixture["jwks"].to_string();
        let rotated = fixture["tokens"]["rotated"].as_str().unwrap();
        // Even an audience rejection refreshes an unknown kid through the one
        // shared key cache; the REST verifier then consumes the rotated key.
        assert!(mcp.verify(rotated).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        api.verify(rotated).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(Arc::ptr_eq(&api.discovery, &mcp.discovery));
        assert!(Arc::ptr_eq(&api.jwks_cache, &mcp.jwks_cache));
        task.abort();
    }

    #[tokio::test]
    async fn thin_jwt_validation_and_cached_key_rotation() {
        let fixture = fixture();
        let all_jwks = fixture["jwks"].to_string();
        let mut initial = fixture["jwks"].clone();
        initial["keys"].as_array_mut().unwrap().truncate(1);
        let (config, body, calls, task) = mock_config(&initial.to_string()).await;
        let token = |name: &str| fixture["tokens"][name].as_str().unwrap().to_owned();
        let accepted = config.verify(&token("valid")).await.unwrap();
        assert_eq!(accepted.sub, "synthetic-subject");
        assert!(accepted.email.is_none());
        config.verify(&token("valid")).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        for name in [
            "wrong_typ",
            "wrong_alg",
            "wrong_issuer",
            "wrong_audience",
            "expired",
            "empty_subject",
            "missing_audience",
            "missing_subject",
            "missing_expiry",
            "missing_issuer",
            "missing_kid",
        ] {
            assert!(config.verify(&token(name)).await.is_err(), "{name}");
        }
        assert!(config.verify(&token("rotated")).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        *body.write().unwrap() = all_jwks;
        config.verify(&token("rotated")).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        let mut corrupted = token("valid");
        let position = corrupted.rfind('.').unwrap() + 1;
        corrupted.replace_range(position..position + 1, "!");
        assert!(config.verify(&corrupted).await.is_err());
        task.abort();
    }

    #[tokio::test]
    async fn userinfo_requires_matching_verified_profile_and_bounds() {
        let valid = serde_json::json!({"sub":"synthetic-subject","email":"test@example.invalid","email_verified":true});
        let (config, body, _, task) = mock_config(&valid.to_string()).await;
        let claims: OidcClaims = serde_json::from_value(
            serde_json::json!({"sub":"synthetic-subject","iss":config.issuer,"exp":4102444800_u64}),
        )
        .unwrap();
        assert!(config.userinfo("synthetic-bearer", &claims).await.is_ok());
        for invalid in [
            serde_json::json!({"sub":"different","email":"test@example.invalid","email_verified":true}),
            serde_json::json!({"sub":"synthetic-subject","email":"test@example.invalid","email_verified":false}),
            serde_json::json!({"sub":"synthetic-subject","email":" ","email_verified":true}),
            serde_json::json!({"sub":"synthetic-subject","email":"test@example.invalid"}),
        ] {
            *body.write().unwrap() = invalid.to_string();
            assert!(config.userinfo("synthetic-bearer", &claims).await.is_err());
        }
        *body.write().unwrap() = "not json".into();
        assert!(config.userinfo("synthetic-bearer", &claims).await.is_err());
        *body.write().unwrap() = "x".repeat(MAX_PROVIDER_BODY + 1);
        assert!(config.userinfo("synthetic-bearer", &claims).await.is_err());
        task.abort();
        assert!(config.userinfo("synthetic-bearer", &claims).await.is_err());
    }
}
