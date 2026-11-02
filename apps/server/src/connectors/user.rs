use chrono::NaiveDateTime;
use sqlx::FromRow;
use sqlx::PgPool;

#[derive(FromRow, Debug, Clone)]
pub struct User {
    pub id: i32,
    pub email: String,
    pub name: Option<String>,
    pub family_name: Option<String>,
    pub given_name: Option<String>,
    pub picture: Option<String>,
    pub created_at: Option<NaiveDateTime>,
}

#[derive(Debug, Clone)]
pub struct NewUser {
    pub email: String,
    pub name: Option<String>,
    pub family_name: Option<String>,
    pub given_name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Clone)]
pub struct UserDatasource {
    pub pool: PgPool,
}

impl UserDatasource {
    pub async fn get(&self, id: i32) -> Result<User, sqlx::Error> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT id, email, name, created_at, family_name, given_name, picture
            FROM users
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(user)
    }

    pub async fn get_by_email(&self, email: &str) -> Result<Option<User>, sqlx::Error> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT id, email, name, created_at, family_name, given_name, picture
            FROM users WHERE email = $1
            "#,
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await?;
        Ok(user)
    }

    pub async fn create(&self, user: &NewUser) -> Result<User, sqlx::Error> {
        let rec = sqlx::query_as!(
            User,
            r#"
            INSERT INTO users (email, name, family_name, given_name, picture)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, email, name, created_at, family_name, given_name, picture"#,
            user.email,
            user.name,
            user.family_name,
            user.given_name,
            user.picture,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(rec)
    }

    pub async fn get_by_identity(
        &self,
        issuer: &str,
        subject: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>(
            "SELECT u.id, u.email, u.name, u.created_at, u.family_name, u.given_name, u.picture \
             FROM users u JOIN oidc_user_identities i ON i.user_id = u.id \
             WHERE i.issuer = $1 AND i.subject = $2",
        )
        .bind(issuer)
        .bind(subject)
        .fetch_optional(&self.pool)
        .await
    }

    /// Serialize first provisioning by identity. Never link a pre-existing email.
    pub async fn provision_identity(
        &self,
        issuer: &str,
        subject: &str,
        user: &NewUser,
    ) -> Result<User, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        // Length-prefixing avoids ambiguous composite strings; hash collisions
        // only serialize unrelated callers and cannot associate their identities.
        let lock_key = format!("{}:{issuer}{subject}", issuer.len());
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(lock_key)
            .execute(&mut *tx)
            .await?;
        let existing = sqlx::query_as::<_, User>(
            "SELECT u.id, u.email, u.name, u.created_at, u.family_name, u.given_name, u.picture \
             FROM users u JOIN oidc_user_identities i ON i.user_id = u.id \
             WHERE i.issuer = $1 AND i.subject = $2",
        )
        .bind(issuer)
        .bind(subject)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(existing) = existing {
            tx.commit().await?;
            return Ok(existing);
        }
        // A unique email collision aborts and rolls back this whole transaction.
        let created = sqlx::query_as::<_, User>(
            "INSERT INTO users (email, name, family_name, given_name, picture) \
             VALUES ($1, $2, $3, $4, $5) \
             RETURNING id, email, name, created_at, family_name, given_name, picture",
        )
        .bind(&user.email)
        .bind(&user.name)
        .bind(&user.family_name)
        .bind(&user.given_name)
        .bind(&user.picture)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO oidc_user_identities (issuer, subject, user_id) VALUES ($1, $2, $3)",
        )
        .bind(issuer)
        .bind(subject)
        .bind(created.id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(created)
    }
}

/// Isolate new provisioning tests from older tests with manually assigned IDs.
#[cfg(test)]
pub(crate) async fn isolated_identity_test_database() -> Option<(super::db::Database, String)> {
    let url = std::env::var("BALANCE_TEST_DATABASE_URL").ok()?;
    let admin = PgPool::connect(&url).await.unwrap();
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_ne!(
        database, "meal_logger",
        "test fixture cannot use production"
    );
    let schema = format!("identity_test_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE SCHEMA {schema}"))
        .execute(&admin)
        .await
        .unwrap();
    let search_path = schema.clone();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .after_connect(move |connection, _| {
            let schema = search_path.clone();
            Box::pin(async move {
                sqlx::query("SELECT set_config('search_path', $1, false)")
                    .bind(schema)
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    admin.close().await;
    Some((
        super::db::Database {
            imports: super::imports::ImportDatasource::new(pool.clone()),
            sync: super::sync::SyncDatasource::new(pool.clone()),
            user: UserDatasource { pool },
        },
        schema,
    ))
}

#[cfg(test)]
pub(crate) async fn cleanup_identity_test_database(db: &super::db::Database, schema: &str) {
    sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&db.user.pool)
        .await
        .unwrap();
    db.user.pool.close().await;
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    #[tokio::test]
    async fn provisioning_concurrency_collision_and_transaction_rollback() {
        // No fallback: the coordinator supplies only a fresh pg_virtualenv URL.
        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let ds = db.user.clone();
        let pool = ds.pool.clone();
        let suffix = uuid::Uuid::new_v4();
        let issuer = format!("https://identity-{suffix}.example.invalid");
        let user = NewUser {
            email: format!("identity-{suffix}@example.invalid"),
            name: None,
            family_name: None,
            given_name: None,
            picture: None,
        };
        let (first, second) = tokio::join!(
            ds.provision_identity(&issuer, "subject", &user),
            ds.provision_identity(&issuer, "subject", &user)
        );
        let first = first.unwrap();
        assert_eq!(first.id, second.unwrap().id);
        let (other_a, other_b) = tokio::join!(
            ds.provision_identity(&issuer, "other-a", &user),
            ds.provision_identity(&issuer, "other-b", &user)
        );
        assert!(other_a.is_err() && other_b.is_err());
        assert!(
            ds.get_by_identity(&issuer, "other-a")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            ds.get_by_identity(&issuer, "other-b")
                .await
                .unwrap()
                .is_none()
        );
        let collision_user = NewUser {
            email: format!("collision-{suffix}@example.invalid"),
            ..user.clone()
        };
        let (collision_a, collision_b) = tokio::join!(
            ds.provision_identity(&issuer, "collision-a", &collision_user),
            ds.provision_identity(&issuer, "collision-b", &collision_user)
        );
        assert_ne!(collision_a.is_ok(), collision_b.is_ok());
        let winner = collision_a.or(collision_b).unwrap();
        let association_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM oidc_user_identities WHERE user_id = $1")
                .bind(winner.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(association_count, 1);
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(winner.id)
            .execute(&pool)
            .await
            .unwrap();
        let different = NewUser {
            email: format!("rollback-{suffix}@example.invalid"),
            ..user.clone()
        };
        assert!(
            ds.provision_identity(&issuer, "", &different)
                .await
                .is_err()
        );
        assert!(ds.get_by_email(&different.email).await.unwrap().is_none());
        assert_eq!(
            ds.get_by_identity(&issuer, "subject")
                .await
                .unwrap()
                .unwrap()
                .id,
            first.id
        );
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(first.id)
            .execute(&pool)
            .await
            .unwrap();
        cleanup_identity_test_database(&db, &schema).await;
    }
}
