use super::imports::ImportDatasource;
use super::sync::SyncDatasource;
use super::user::UserDatasource;
use sqlx::postgres::PgPoolOptions;

#[derive(Clone)]
pub struct Database {
    pub user: UserDatasource,
    pub sync: SyncDatasource,
    pub imports: ImportDatasource,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;

        Ok(Self {
            imports: ImportDatasource::new(pool.clone()),
            user: UserDatasource { pool: pool.clone() },
            sync: SyncDatasource::new(pool.clone()),
        })
    }
}
