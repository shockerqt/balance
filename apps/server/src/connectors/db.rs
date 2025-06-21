use sqlx::postgres::PgPool;
use sqlx::postgres::PgPoolOptions;

use super::user::UserDatasource;

#[derive(Clone)]
pub struct Database {
    pub pool: PgPool,
    pub user: UserDatasource,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;

        Ok(Self {
            user: UserDatasource { pool: pool.clone() },
            pool,
        })
    }
}
