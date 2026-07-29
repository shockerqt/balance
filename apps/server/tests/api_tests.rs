use bigdecimal::BigDecimal;
use chrono::NaiveDateTime;
use sqlx::PgPool;
use std::env;
use std::str::FromStr;

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
async fn test_food_creation_and_search() {
    dotenv::dotenv().ok();
    let db_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://meal_admin:password@localhost:5432/meal_logger".to_string());
    let pool = PgPool::connect(&db_url).await.expect("DB connection failed");

    let test_user_id = 1;
    let food_name = format!("Integration Test Avocado {}", chrono::Utc::now().timestamp_millis());

    // 1. Insert food_versions
    let fv = sqlx::query!(
        r#"
        INSERT INTO food_versions (
            name, calories, proteins, carbs, fat, fiber, sodium, cholesterol,
            created_by, serving_name, serving_quantity, serving_unit_type, version, is_verified
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text::serving_unit_type, 1, true)
        RETURNING id
        "#,
        food_name,
        160,
        BigDecimal::from_str("2.0").unwrap(),
        BigDecimal::from_str("8.5").unwrap(),
        BigDecimal::from_str("14.7").unwrap(),
        Some(BigDecimal::from_str("6.7").unwrap()),
        Some(7),
        Some(0),
        test_user_id,
        "100g",
        BigDecimal::from_str("100.0").unwrap(),
        "weight"
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to insert food_version");

    // 2. Insert food header
    let food = sqlx::query!(
        r#"
        INSERT INTO foods (created_by, current_version_id)
        VALUES ($1, $2)
        RETURNING id
        "#,
        test_user_id,
        fv.id
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to insert food");

    assert!(food.id > 0);

    // 3. Search food by ILIKE pattern
    let results = sqlx::query!(
        r#"
        SELECT fv.name, fv.calories, fv.fiber
        FROM foods f
        JOIN food_versions fv ON f.current_version_id = fv.id
        WHERE fv.name = $1
        "#,
        food_name
    )
    .fetch_all(&pool)
    .await
    .expect("Failed to search food");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].calories, 160);
    assert_eq!(results[0].fiber, Some(BigDecimal::from_str("6.700").unwrap()));
}

#[tokio::test]
async fn test_meal_creation_and_portion_scaling() {
    dotenv::dotenv().ok();
    let db_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://meal_admin:password@localhost:5432/meal_logger".to_string());
    let pool = PgPool::connect(&db_url).await.expect("DB connection failed");

    let test_user_id = 1;
    let now = NaiveDateTime::parse_from_str("2026-07-29 08:30:00", "%Y-%m-%d %H:%M:%S").unwrap();

    // 1. Create food version: 100g base = 200 kcal, 20g protein
    let fv = sqlx::query!(
        r#"
        INSERT INTO food_versions (
            name, calories, proteins, carbs, fat,
            created_by, serving_name, serving_quantity, serving_unit_type, version
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::serving_unit_type, 1)
        RETURNING id
        "#,
        "Integration Test Oatmeal",
        200,
        BigDecimal::from_str("20.0").unwrap(),
        BigDecimal::from_str("35.0").unwrap(),
        BigDecimal::from_str("4.0").unwrap(),
        test_user_id,
        "100g",
        BigDecimal::from_str("100.0").unwrap(),
        "weight"
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to insert food_version");

    // 2. Create meal: breakfast
    let meal = sqlx::query!(
        r#"
        INSERT INTO meals (user_id, meal_type, eaten_at)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
        test_user_id,
        "breakfast",
        now
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to insert meal");

    // 3. Add 250g item (2.5x base portion)
    let item = sqlx::query!(
        r#"
        INSERT INTO meal_foods (meal_id, food_version_id, serving_name, serving_quantity)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
        meal.id,
        fv.id,
        "250g",
        BigDecimal::from_str("250.0").unwrap()
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to insert meal_food");

    assert!(item.id > 0);

    // 4. Verify proportional scaling calculation:
    // 250g / 100g = 2.5 -> 200 * 2.5 = 500 kcal, 20 * 2.5 = 50g protein
    let rec = sqlx::query!(
        r#"
        SELECT mf.serving_quantity, fv.calories, fv.proteins, fv.serving_quantity as base_qty
        FROM meal_foods mf
        JOIN food_versions fv ON mf.food_version_id = fv.id
        WHERE mf.id = $1
        "#,
        item.id
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch item");

    let ratio = rec.serving_quantity / rec.base_qty;
    let cal = ((rec.calories as f64) * ratio.to_string().parse::<f64>().unwrap()) as i32;
    let protein = rec.proteins * ratio;

    assert_eq!(cal, 500);
    assert_eq!(protein, BigDecimal::from_str("50.00").unwrap());

    // Clean up
    sqlx::query!("DELETE FROM meals WHERE id = $1", meal.id)
        .execute(&pool)
        .await
        .ok();
}
