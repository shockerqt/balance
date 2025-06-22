use super::error::AppError;

pub trait Validate {
    fn validate(&self) -> Result<(), AppError>;
}
