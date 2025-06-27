use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::FromRow;
use utoipa::ToSchema;

#[derive(Serialize, FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    pub id: i32,
    pub email: String,
    pub name: Option<String>,
    pub family_name: Option<String>,
    pub given_name: Option<String>,
    pub picture: Option<String>,
    pub created_at: Option<NaiveDateTime>,
}
