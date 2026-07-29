use bigdecimal::BigDecimal;
use sqlx::PgPool;
use std::env;

#[tokio::test]
async fn test_balance_database_connection() {
    dotenv::dotenv().ok();
    let db_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://meal_admin:password@localhost:5432/meal_logger".to_string());

    let pool = PgPool::connect(&db_url)
        .await
        .expect("Failed to connect to postgres");

    let row: (i32,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .expect("Query failed");

    assert_eq!(row.0, 1);
}

#[tokio::test]
async fn test_portion_scaling_calculation() {
    let base_quantity = BigDecimal::from(100);
    let consumed_quantity = BigDecimal::from(250);
    let ratio = &consumed_quantity / &base_quantity;

    let base_calories = 200;
    let base_protein = BigDecimal::from(20);

    let calculated_calories = ((base_calories as f64) * ratio.to_string().parse::<f64>().unwrap()) as i32;
    let calculated_protein = &base_protein * &ratio;

    assert_eq!(calculated_calories, 500);
    assert_eq!(calculated_protein, BigDecimal::from(50));
}
