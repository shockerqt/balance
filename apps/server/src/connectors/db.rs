use super::imports::ImportDatasource;
use super::sync::SyncDatasource;
use super::user::UserDatasource;
use sqlx::postgres::PgPoolOptions;
use std::{ffi::OsStr, time::Duration};

#[derive(Clone, Copy, Debug)]
pub struct PoolSettings {
    max_connections: u32,
}

impl PoolSettings {
    pub fn parse(max_connections: Option<&OsStr>) -> anyhow::Result<Self> {
        let Some(value) = max_connections else {
            return Ok(Self {
                max_connections: 20,
            });
        };
        let max_connections = value
            .to_str()
            .filter(|value| value.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|value| value.parse().ok())
            .filter(|value| (1..=50).contains(value))
            .ok_or_else(|| anyhow::anyhow!("DB_MAX_CONNECTIONS must be an integer in 1..=50"))?;
        Ok(Self { max_connections })
    }

    fn options(self) -> PgPoolOptions {
        PgPoolOptions::new()
            .max_connections(self.max_connections)
            .min_connections(self.max_connections.min(2))
            .acquire_timeout(Duration::from_secs(5))
    }
}

#[derive(Clone)]
pub struct Database {
    pub user: UserDatasource,
    pub sync: SyncDatasource,
    pub imports: ImportDatasource,
}

impl Database {
    pub async fn new(database_url: &str, settings: PoolSettings) -> Result<Self, sqlx::Error> {
        let pool = settings.options().connect(database_url).await?;

        Ok(Self {
            imports: ImportDatasource::new(pool.clone()),
            user: UserDatasource { pool: pool.clone() },
            sync: SyncDatasource::new(pool.clone()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_settings_parse_explicit_values() {
        for (input, max, min) in [(None, 20, 2), (Some("1"), 1, 1), (Some("50"), 50, 2)] {
            let options = PoolSettings::parse(input.map(OsStr::new))
                .unwrap()
                .options();
            assert_eq!(options.get_max_connections(), max);
            assert_eq!(options.get_min_connections(), min);
            assert_eq!(options.get_acquire_timeout(), Duration::from_secs(5));
        }

        for value in [
            "",
            "secret",
            " 20",
            "+1",
            "-1",
            "２",
            "0",
            "51",
            "4294967296",
        ] {
            assert_invalid(OsStr::new(value));
        }
    }

    fn assert_invalid(value: &OsStr) {
        assert_eq!(
            PoolSettings::parse(Some(value)).unwrap_err().to_string(),
            "DB_MAX_CONNECTIONS must be an integer in 1..=50",
        );
    }

    #[cfg(unix)]
    #[test]
    fn pool_settings_reject_non_unicode() {
        use std::os::unix::ffi::OsStrExt;
        assert_invalid(OsStr::from_bytes(b"20\xff"));
    }
}
