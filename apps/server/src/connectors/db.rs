use super::food::FoodDatasource;
use super::meal::MealDatasource;
use super::user::UserDatasource;
use sqlx::postgres::PgPoolOptions;

#[derive(Clone)]
pub struct Database {
    pub user: UserDatasource,
    pub food: FoodDatasource,
    pub meal: MealDatasource,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;

        Ok(Self {
            user: UserDatasource { pool: pool.clone() },
            food: FoodDatasource { pool: pool.clone() },
            meal: MealDatasource { pool: pool.clone() },
        })
    }
}
