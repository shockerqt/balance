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

#[derive(Debug, Clone)]
pub struct UpdateUser {
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

    pub async fn update(&self, user_id: i32, user: &UpdateUser) -> Result<User, sqlx::Error> {
        let rec = sqlx::query_as!(
            User,
            r#"
            UPDATE users
            SET name = $1,
                family_name = $2,
                given_name = $3,
                picture = $4
            WHERE id = $5
            RETURNING id, email, name, created_at, family_name, given_name, picture
            "#,
            user.name,
            user.family_name,
            user.given_name,
            user.picture,
            user_id
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(rec)
    }
}
