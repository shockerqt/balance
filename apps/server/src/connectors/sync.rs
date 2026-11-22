use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

use crate::shared::error::AppError;

pub const FOOD_SCHEMA_VERSION: i32 = 2;
pub const MCP_RECEIPT_SCHEMA_VERSION: i32 = 1;
pub const MAX_BRAND_CHARS: usize = 120;
pub const MAX_DUPLICATE_PERSONAL_FOOD_CANDIDATES: usize = 3;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePersonalFoodCandidate {
    pub food_id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    pub canonical_unit: CanonicalUnit,
    pub nutrition_per100: NutritionValues,
    pub portions: Vec<PortionDefinition>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DuplicatePersonalFood {
    pub candidates: Vec<DuplicatePersonalFoodCandidate>,
    pub has_more_candidates: bool,
}

#[derive(Debug, Clone)]
pub enum CreatePersonalFoodOutcome {
    Created(FoodTemplate),
    AlreadyCreated(FoodTemplate),
    Duplicate(DuplicatePersonalFood),
}

#[derive(Debug, Clone, Default)]
pub struct PersonalFoodPatch {
    pub name: Option<String>,
    pub calories: Option<f64>,
    pub protein: Option<f64>,
    pub carbs: Option<f64>,
    pub fat: Option<f64>,
    pub fiber: Option<Option<f64>>,
    pub sodium_mg: Option<Option<f64>>,
    pub cholesterol_mg: Option<Option<f64>>,
    pub portions: Option<Vec<PortionDefinition>>,
    pub chilean_seals: Option<Vec<String>>,
    pub brand: Option<Option<String>>,
    pub category: Option<Option<String>>,
    pub typical_time: Option<Option<String>>,
}

impl PersonalFoodPatch {
    pub fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.calories.is_none()
            && self.protein.is_none()
            && self.carbs.is_none()
            && self.fat.is_none()
            && self.fiber.is_none()
            && self.sodium_mg.is_none()
            && self.cholesterol_mg.is_none()
            && self.portions.is_none()
            && self.chilean_seals.is_none()
            && self.brand.is_none()
            && self.category.is_none()
            && self.typical_time.is_none()
    }
}

#[cfg(test)]
pub(crate) type AsyncTestHook = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpToolKind {
    CreateFood,
    LogFood,
}

impl McpToolKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CreateFood => "create_food",
            Self::LogFood => "log_food",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum LogFoodTimeIntent {
    Omitted,
    Explicit { date: String, time: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateFoodIntentV1 {
    name: String,
    details: FoodDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateFoodBaselineV1 {
    name: String,
    details: FoodDetails,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    external_id: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogFoodIntentV1 {
    food_id: Uuid,
    entered_quantity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    portion_id: Option<String>,
    time_intent: LogFoodTimeIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogFoodBaselineV1 {
    name_snapshot: String,
    nutrition_snapshot: NutritionSnapshot,
    canonical_quantity: f64,
    entry_snapshot: MealLogEntry,
    consumed_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    external_id: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Clone, FromRow)]
struct McpMutationReceiptRow {
    schema_version: i32,
    request_intent: Value,
    target_state: Value,
}

type SantiagoNowResolver = Box<dyn FnOnce() -> Result<(String, String), AppError> + Send>;

fn canonical_f64(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

fn canonical_nutrition_values(values: &NutritionValues) -> NutritionValues {
    NutritionValues {
        calories: canonical_f64(values.calories),
        protein: canonical_f64(values.protein),
        carbs: canonical_f64(values.carbs),
        fat: canonical_f64(values.fat),
        fiber: values.fiber.map(canonical_f64),
        sodium_mg: values.sodium_mg.map(canonical_f64),
        cholesterol_mg: values.cholesterol_mg.map(canonical_f64),
        extended_nutrition: values
            .extended_nutrition
            .iter()
            .map(|(key, value)| (key.clone(), canonical_f64(*value)))
            .collect(),
    }
}

fn canonical_food_details(details: &FoodDetails) -> FoodDetails {
    FoodDetails {
        schema_version: details.schema_version,
        canonical_unit: details.canonical_unit,
        nutrition_per100: canonical_nutrition_values(&details.nutrition_per100),
        portions: details
            .portions
            .iter()
            .map(|portion| PortionDefinition {
                id: portion.id.clone(),
                name: portion.name.clone(),
                portion_quantity: canonical_f64(portion.portion_quantity),
                canonical_quantity: canonical_f64(portion.canonical_quantity),
            })
            .collect(),
        chilean_seals: details.chilean_seals.clone(),
        brand: normalize_optional_brand(details.brand.clone()),
        category: details.category.clone(),
        typical_time: details.typical_time.clone(),
    }
}

fn canonical_nutrition_snapshot(snapshot: &NutritionSnapshot) -> NutritionSnapshot {
    NutritionSnapshot {
        schema_version: snapshot.schema_version,
        canonical_unit: snapshot.canonical_unit,
        nutrition_per100: canonical_nutrition_values(&snapshot.nutrition_per100),
        brand: normalize_optional_brand(snapshot.brand.clone()),
    }
}

fn canonical_meal_log_entry(entry: &MealLogEntry) -> MealLogEntry {
    MealLogEntry {
        entered_quantity: canonical_f64(entry.entered_quantity),
        portion_snapshot: entry
            .portion_snapshot
            .as_ref()
            .map(|portion| PortionSnapshot {
                portion_id: portion.portion_id.clone(),
                name: portion.name.clone(),
                portion_quantity: canonical_f64(portion.portion_quantity),
                canonical_quantity: canonical_f64(portion.canonical_quantity),
            }),
    }
}

impl CreateFoodIntentV1 {
    fn canonicalize(mut self) -> Self {
        self.details = canonical_food_details(&self.details);
        self
    }
}

impl CreateFoodBaselineV1 {
    fn canonicalize(mut self) -> Self {
        self.details = canonical_food_details(&self.details);
        self
    }
}

impl LogFoodIntentV1 {
    fn canonicalize(mut self) -> Self {
        self.entered_quantity = canonical_f64(self.entered_quantity);
        self
    }
}

impl LogFoodBaselineV1 {
    fn canonicalize(mut self) -> Self {
        self.nutrition_snapshot = canonical_nutrition_snapshot(&self.nutrition_snapshot);
        self.canonical_quantity = canonical_f64(self.canonical_quantity);
        self.entry_snapshot = canonical_meal_log_entry(&self.entry_snapshot);
        self
    }
}

fn normalize_optional_brand(brand: Option<String>) -> Option<String> {
    brand.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

pub(crate) fn deserialize_optional_brand<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(normalize_optional_brand(Option::<String>::deserialize(
        deserializer,
    )?))
}

pub(crate) fn validate_optional_brand(brand: Option<&str>) -> Result<(), AppError> {
    if let Some(brand) = brand
        && brand.trim().chars().count() > MAX_BRAND_CHARS
    {
        return Err(AppError::BadRequest(format!(
            "brand must not exceed {MAX_BRAND_CHARS} characters"
        )));
    }
    Ok(())
}

pub const EXTENDED_NUTRIENT_KEYS: &[&str] = &[
    "alcoholG",
    "vitaminB12Mcg",
    "thiamineMg",
    "riboflavinMg",
    "niacinMg",
    "pantothenicAcidMg",
    "pyridoxineMg",
    "caffeineMg",
    "calciumMg",
    "cholineMg",
    "copperMg",
    "cysteineG",
    "monounsaturatedFatG",
    "polyunsaturatedFatG",
    "saturatedFatG",
    "transFatG",
    "folateMcg",
    "histidineG",
    "ironMg",
    "isoleucineG",
    "leucineG",
    "lysineG",
    "magnesiumMg",
    "manganeseMg",
    "methionineG",
    "omega3AlaG",
    "omega3DhaG",
    "omega3EpaG",
    "omega3G",
    "omega6G",
    "phenylalanineG",
    "phosphorusMg",
    "potassiumMg",
    "seleniumMcg",
    "starchG",
    "sugarsG",
    "addedSugarsG",
    "threonineG",
    "tryptophanG",
    "tyrosineG",
    "valineG",
    "vitaminAMcg",
    "vitaminCMg",
    "vitaminDMcg",
    "vitaminEMg",
    "vitaminKMcg",
    "waterG",
    "zincMg",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CanonicalUnit {
    G,
    Ml,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NutritionValues {
    pub calories: f64,
    pub protein: f64,
    pub carbs: f64,
    pub fat: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fiber: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sodium_mg: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cholesterol_mg: Option<f64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extended_nutrition: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortionDefinition {
    pub id: String,
    pub name: String,
    pub portion_quantity: f64,
    pub canonical_quantity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoodDetails {
    pub schema_version: i32,
    pub canonical_unit: CanonicalUnit,
    pub nutrition_per100: NutritionValues,
    #[serde(default)]
    pub portions: Vec<PortionDefinition>,
    #[serde(default)]
    pub chilean_seals: Vec<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_brand",
        skip_serializing_if = "Option::is_none"
    )]
    pub brand: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typical_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NutritionSnapshot {
    pub schema_version: i32,
    pub canonical_unit: CanonicalUnit,
    pub nutrition_per100: NutritionValues,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_brand",
        skip_serializing_if = "Option::is_none"
    )]
    pub brand: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortionSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub portion_id: Option<String>,
    pub name: String,
    pub portion_quantity: f64,
    pub canonical_quantity: f64,
}

impl From<&PortionDefinition> for PortionSnapshot {
    fn from(value: &PortionDefinition) -> Self {
        Self {
            portion_id: Some(value.id.clone()),
            name: value.name.clone(),
            portion_quantity: value.portion_quantity,
            canonical_quantity: value.canonical_quantity,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MealLogEntry {
    pub entered_quantity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub portion_snapshot: Option<PortionSnapshot>,
}

impl PortionDefinition {
    fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() || self.id.chars().count() > 80 {
            return Err(AppError::BadRequest(
                "portion id must contain 1 to 80 characters".into(),
            ));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 120 {
            return Err(AppError::BadRequest(
                "portion name must contain 1 to 120 characters".into(),
            ));
        }
        validate_positive("portionQuantity", self.portion_quantity)?;
        validate_positive("canonicalQuantity", self.canonical_quantity)
    }
}

impl PortionSnapshot {
    fn validate(&self) -> Result<(), AppError> {
        if matches!(&self.portion_id, Some(id) if id.trim().is_empty() || id.chars().count() > 80) {
            return Err(AppError::BadRequest(
                "entry.portionSnapshot.portionId is invalid".into(),
            ));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 120 {
            return Err(AppError::BadRequest(
                "entry.portionSnapshot.name is invalid".into(),
            ));
        }
        validate_positive(
            "entry.portionSnapshot.portionQuantity",
            self.portion_quantity,
        )?;
        validate_positive(
            "entry.portionSnapshot.canonicalQuantity",
            self.canonical_quantity,
        )
    }
}

impl MealLogEntry {
    pub fn validate(&self, canonical_quantity: f64) -> Result<(), AppError> {
        validate_positive("entry.enteredQuantity", self.entered_quantity)?;
        validate_positive("canonicalQuantity", canonical_quantity)?;
        let expected = match &self.portion_snapshot {
            Some(portion) => {
                portion.validate()?;
                self.entered_quantity / portion.portion_quantity * portion.canonical_quantity
            }
            None => self.entered_quantity,
        };
        let tolerance = 1e-8_f64.max(expected.abs() * 1e-8);
        if (expected - canonical_quantity).abs() > tolerance {
            return Err(AppError::BadRequest(
                "entry conversion does not match canonicalQuantity".into(),
            ));
        }
        Ok(())
    }
}

impl FoodDetails {
    pub fn normalize(&mut self) {
        self.brand = normalize_optional_brand(self.brand.take());
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != FOOD_SCHEMA_VERSION {
            return Err(AppError::BadRequest(
                "Unsupported food schema version".into(),
            ));
        }
        self.nutrition_per100.validate()?;
        validate_optional_brand(self.brand.as_deref())?;
        let mut ids = std::collections::HashSet::new();
        for portion in &self.portions {
            portion.validate()?;
            if !ids.insert(portion.id.as_str()) {
                return Err(AppError::BadRequest("portion ids must be unique".into()));
            }
        }
        if let Some(time) = &self.typical_time {
            chrono::NaiveTime::parse_from_str(time, "%H:%M")
                .map_err(|_| AppError::BadRequest("typicalTime must use HH:MM".into()))?;
        }
        Ok(())
    }

    pub fn snapshot(&self) -> NutritionSnapshot {
        NutritionSnapshot {
            schema_version: self.schema_version,
            canonical_unit: self.canonical_unit,
            nutrition_per100: self.nutrition_per100.clone(),
            brand: normalize_optional_brand(self.brand.clone()),
        }
    }

    pub fn entry_for(
        &self,
        quantity: f64,
        portion_id: Option<&str>,
    ) -> Result<(f64, MealLogEntry), AppError> {
        validate_positive("quantity", quantity)?;
        if let Some(portion_id) = portion_id {
            let portion = self
                .portions
                .iter()
                .find(|portion| portion.id == portion_id)
                .ok_or_else(|| AppError::BadRequest("Unknown portionId for this food".into()))?;
            let canonical_quantity =
                quantity / portion.portion_quantity * portion.canonical_quantity;
            let entry = MealLogEntry {
                entered_quantity: quantity,
                portion_snapshot: Some(portion.into()),
            };
            entry.validate(canonical_quantity)?;
            Ok((canonical_quantity, entry))
        } else {
            let entry = MealLogEntry {
                entered_quantity: quantity,
                portion_snapshot: None,
            };
            entry.validate(quantity)?;
            Ok((quantity, entry))
        }
    }
}

impl NutritionSnapshot {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != FOOD_SCHEMA_VERSION {
            return Err(AppError::BadRequest(
                "Unsupported nutrition snapshot schema version".into(),
            ));
        }
        validate_optional_brand(self.brand.as_deref())?;
        self.nutrition_per100.validate()
    }
}

impl NutritionValues {
    pub(crate) fn validate(&self) -> Result<(), AppError> {
        let required = [
            ("calories", self.calories),
            ("protein", self.protein),
            ("carbs", self.carbs),
            ("fat", self.fat),
        ];
        for (name, value) in required {
            if !value.is_finite() || value < 0.0 {
                return Err(AppError::BadRequest(format!(
                    "{name} must be a finite non-negative number"
                )));
            }
        }
        for (name, value) in [
            ("fiber", self.fiber),
            ("sodiumMg", self.sodium_mg),
            ("cholesterolMg", self.cholesterol_mg),
        ] {
            if matches!(value, Some(value) if !value.is_finite() || value < 0.0) {
                return Err(AppError::BadRequest(format!(
                    "{name} must be a finite non-negative number"
                )));
            }
        }
        for (name, value) in &self.extended_nutrition {
            if !EXTENDED_NUTRIENT_KEYS.contains(&name.as_str()) {
                return Err(AppError::BadRequest(format!(
                    "Unknown extended nutrient: {name}"
                )));
            }
            if !value.is_finite() || *value < 0.0 {
                return Err(AppError::BadRequest(format!(
                    "extendedNutrition.{name} must be a finite non-negative number"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserPreferencesRow {
    pub id: i32,
    pub preferences: Value,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MealTemplateRow {
    pub id: Uuid,
    pub user_id: Option<i32>,
    pub is_official: bool,
    pub name: String,
    pub details: Value,
    pub source_provider: Option<String>,
    pub external_id: Option<String>,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MealLogRow {
    pub id: Uuid,
    pub user_id: i32,
    pub template_id: Option<Uuid>,
    pub name_snapshot: String,
    pub nutrition_snapshot: Value,
    pub source_provider: Option<String>,
    pub external_id: Option<String>,
    pub canonical_quantity: f64,
    pub entry_snapshot: Value,
    pub consumed_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct MealLogCopyIntent {
    pub source_id: Uuid,
    pub source_updated_at: i64,
    pub name_snapshot: String,
    pub nutrition_snapshot: NutritionSnapshot,
}

#[derive(Debug, Clone)]
pub struct MealTemplateMutation {
    pub id: Uuid,
    pub name: String,
    pub details: Value,
    pub source_provider: Option<String>,
    pub external_id: Option<String>,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct MealLogMutation {
    pub id: Uuid,
    pub template_id: Option<Uuid>,
    pub canonical_quantity: f64,
    pub entry: MealLogEntry,
    pub consumed_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub copy_source: Option<MealLogCopyIntent>,
}

#[derive(Debug, Clone, FromRow, PartialEq, Eq)]
pub struct WeightLogRow {
    pub user_id: i32,
    pub measured_on: NaiveDate,
    pub weight_grams: i32,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeightUpsertStatus {
    Created,
    Updated,
    Unchanged,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoodTemplate {
    pub id: Uuid,
    pub name: String,
    pub is_official: bool,
    pub details: FoodDetails,
    pub updated_at: i64,
}

pub struct FoodSearchResult {
    pub foods: Vec<FoodTemplate>,
    pub has_more: bool,
}

const FOOD_NAME_ALIASES: &[&[&str]] = &[
    &["pollo", "pollos", "chicken", "chickens"],
    &["papa", "papas", "patata", "patatas", "potato", "potatoes"],
    &[
        "palta",
        "paltas",
        "aguacate",
        "aguacates",
        "avocado",
        "avocados",
    ],
    // Proteins & seafood
    &["huevo", "huevos", "egg", "eggs"],
    &["vacuno", "carne de vacuno", "res", "carne de res", "beef"],
    &["cerdo", "chancho", "pork"],
    &["pavo", "pavos", "turkey", "turkeys"],
    &["cordero", "lamb"],
    &["jamon", "ham"],
    &["tocino", "panceta", "bacon"],
    &["atun", "tuna"],
    &["salmon", "salmones", "salmons"],
    &["sardina", "sardinas", "sardine", "sardines"],
    &["bacalao", "cod"],
    &[
        "camaron",
        "camarones",
        "gamba",
        "gambas",
        "shrimp",
        "shrimps",
        "prawn",
        "prawns",
    ],
    // Vegetables & legumes
    &["zanahoria", "zanahorias", "carrot", "carrots"],
    &["choclo", "choclos", "maiz", "elote", "elotes", "corn"],
    &[
        "zapallo",
        "zapallos",
        "calabaza",
        "calabazas",
        "pumpkin",
        "pumpkins",
    ],
    &[
        "zapallo italiano",
        "zapallos italianos",
        "calabacin",
        "calabacines",
        "zucchini",
        "zucchinis",
    ],
    &[
        "betarraga",
        "betarragas",
        "remolacha",
        "remolachas",
        "beet",
        "beets",
        "beetroot",
    ],
    &["poroto", "porotos", "frijol", "frijoles", "bean", "beans"],
    &[
        "poroto verde",
        "porotos verdes",
        "ejote",
        "ejotes",
        "judia verde",
        "judias verdes",
        "green bean",
        "green beans",
    ],
    &[
        "arveja",
        "arvejas",
        "guisante",
        "guisantes",
        "chicharo",
        "chicharos",
        "pea",
        "peas",
    ],
    &["lenteja", "lentejas", "lentil", "lentils"],
    &["garbanzo", "garbanzos", "chickpea", "chickpeas"],
    &[
        "tomate",
        "tomates",
        "jitomate",
        "jitomates",
        "tomato",
        "tomatoes",
    ],
    &["cebolla", "cebollas", "onion", "onions"],
    &["ajo", "ajos", "garlic"],
    &["lechuga", "lechugas", "lettuce"],
    &["espinaca", "espinacas", "spinach"],
    &["brocoli", "brocolis", "broccoli"],
    &["coliflor", "coliflores", "cauliflower"],
    &["repollo", "repollos", "col", "cabbage"],
    &["pepino", "pepinos", "cucumber", "cucumbers"],
    &[
        "pimenton",
        "pimentones",
        "pimiento",
        "pimientos",
        "morron",
        "morrones",
        "bell pepper",
        "bell peppers",
    ],
    &[
        "champinon",
        "champinones",
        "hongo",
        "hongos",
        "seta",
        "setas",
        "mushroom",
        "mushrooms",
    ],
    &["esparrago", "esparragos", "asparagus"],
    &["apio", "celery"],
    &[
        "rabano",
        "rabanos",
        "rabanito",
        "rabanitos",
        "radish",
        "radishes",
    ],
    &[
        "camote",
        "camotes",
        "batata",
        "batatas",
        "boniato",
        "boniatos",
        "sweet potato",
        "sweet potatoes",
    ],
    // Fruits
    &[
        "frutilla",
        "frutillas",
        "fresa",
        "fresas",
        "strawberry",
        "strawberries",
    ],
    &[
        "platano", "platanos", "banana", "bananas", "banano", "bananos",
    ],
    &["manzana", "manzanas", "apple", "apples"],
    &["naranja", "naranjas", "orange", "oranges"],
    &["limon", "limones", "lemon", "lemons", "lime", "limes"],
    &["pera", "peras", "pear", "pears"],
    &[
        "durazno",
        "duraznos",
        "melocoton",
        "melocotones",
        "peach",
        "peaches",
    ],
    &[
        "damasco",
        "damascos",
        "albaricoque",
        "albaricoques",
        "apricot",
        "apricots",
    ],
    &["uva", "uvas", "grape", "grapes"],
    &["sandia", "sandias", "watermelon", "watermelons"],
    &[
        "pina",
        "pinas",
        "anana",
        "ananas",
        "pineapple",
        "pineapples",
    ],
    &["arandano", "arandanos", "blueberry", "blueberries"],
    &["frambuesa", "frambuesas", "raspberry", "raspberries"],
    &["cereza", "cerezas", "cherry", "cherries"],
    &["mango", "mangos", "mangoes"],
    &["papaya", "papayas"],
    // Dairy, grains, nuts & seeds
    &["leche", "milk"],
    &["queso", "quesos", "cheese", "cheeses"],
    &["mantequilla", "manteca", "butter"],
    &["yogur", "yogurt", "yogures", "yogurts", "yoghurt"],
    &["arroz", "rice"],
    &["avena", "oat", "oats", "oatmeal"],
    &["pan", "panes", "bread", "breads"],
    &["trigo", "wheat"],
    &["cebada", "barley"],
    &["centeno", "rye"],
    &[
        "fideo",
        "fideos",
        "tallarin",
        "tallarines",
        "pasta",
        "noodle",
        "noodles",
    ],
    &[
        "mani",
        "cacahuate",
        "cacahuates",
        "cacahuete",
        "cacahuetes",
        "peanut",
        "peanuts",
    ],
    &["almendra", "almendras", "almond", "almonds"],
    &["nuez", "nueces", "walnut", "walnuts"],
    // Beverages, pantry, oils & condiments
    &["cafe", "cafes", "coffee", "coffees"],
    &["te negro", "black tea"],
    &["te verde", "green tea"],
    &["aceite de oliva", "olive oil"],
    &["miel", "honey"],
    &["azucar", "sugar", "sugars"],
];

const FOOD_SEARCH_SQL: &str = r#"
    SELECT id, user_id, is_official, name, details, source_provider, external_id,
           updated_at, deleted_at
    FROM meal_templates
    WHERE deleted_at IS NULL
      AND (user_id = $1 OR is_official = TRUE)
      AND (
            fold_food_search(name) LIKE $2 ESCAPE '\'
         OR fold_food_search(COALESCE(details->>'brand', '')) LIKE $2 ESCAPE '\'
         OR fold_food_search(name) ~ $6
      )
      AND (
            $3 = 'all'
         OR ($3 = 'personal' AND user_id = $1 AND is_official = FALSE)
         OR ($3 = 'official' AND is_official = TRUE)
      )
    ORDER BY CASE
                 WHEN fold_food_search(name) = $4 THEN 0
                 WHEN fold_food_search(COALESCE(details->>'brand', '')) = $4 THEN 1
                 ELSE 2
             END,
             is_official DESC,
             name ASC,
             id ASC
    LIMIT $5
"#;

struct FoodSearchQuery {
    folded: String,
    pattern: String,
    alias_pattern: Option<String>,
}

impl FoodSearchQuery {
    async fn new(pool: &PgPool, query: &str) -> Result<Self, sqlx::Error> {
        let folded: String = sqlx::query_scalar("SELECT fold_food_search($1)")
            .bind(query.trim())
            .fetch_one(pool)
            .await?;
        let escaped = folded
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let alias_pattern = FOOD_NAME_ALIASES
            .iter()
            .find(|group| group.contains(&folded.as_str()))
            .map(|group| format!("(^|[^[:alnum:]])({})([^[:alnum:]]|$)", group.join("|")));
        Ok(Self {
            folded,
            pattern: format!("%{escaped}%"),
            alias_pattern,
        })
    }

    fn bind<'a>(
        &'a self,
        user_id: i32,
        source: &'a str,
        limit: i64,
    ) -> sqlx::query::QueryAs<'a, Postgres, MealTemplateRow, sqlx::postgres::PgArguments> {
        sqlx::query_as(FOOD_SEARCH_SQL)
            .bind(user_id)
            .bind(&self.pattern)
            .bind(source)
            .bind(&self.folded)
            .bind(limit + 1)
            .bind(&self.alias_pattern)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Consumption {
    pub id: Uuid,
    pub template_id: Option<Uuid>,
    pub name: String,
    pub snapshot: NutritionSnapshot,
    pub canonical_quantity: f64,
    pub entry: MealLogEntry,
    pub consumed_at: i64,
    pub updated_at: i64,
}

impl Consumption {
    pub fn scaled_nutrition(&self) -> NutritionValues {
        let factor = self.canonical_quantity / 100.0;
        let nutrition = &self.snapshot.nutrition_per100;
        NutritionValues {
            calories: nutrition.calories * factor,
            protein: nutrition.protein * factor,
            carbs: nutrition.carbs * factor,
            fat: nutrition.fat * factor,
            fiber: nutrition.fiber.map(|value| value * factor),
            sodium_mg: nutrition.sodium_mg.map(|value| value * factor),
            cholesterol_mg: nutrition.cholesterol_mg.map(|value| value * factor),
            extended_nutrition: nutrition
                .extended_nutrition
                .iter()
                .map(|(name, value)| (name.clone(), value * factor))
                .collect(),
        }
    }
}

#[derive(Clone)]
pub struct SyncDatasource {
    pub pool: PgPool,
}

impl SyncDatasource {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // --- USER PREFERENCES ---
    pub async fn pull_user_preferences(
        &self,
        user_id: i32,
        checkpoint_updated_at: i64,
        limit: i64,
    ) -> Result<Vec<UserPreferencesRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, UserPreferencesRow>(
            r#"
            SELECT id, preferences, updated_at, deleted_at
            FROM user_preferences
            WHERE id = $1 AND updated_at > $2
            ORDER BY updated_at ASC
            LIMIT $3
            "#,
        )
        .bind(user_id)
        .bind(checkpoint_updated_at)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn push_user_preference(
        &self,
        user_id: i32,
        preferences: Value,
        updated_at: i64,
        deleted_at: Option<i64>,
    ) -> Result<Option<UserPreferencesRow>, sqlx::Error> {
        let existing = sqlx::query_as::<_, UserPreferencesRow>(
            "SELECT id, preferences, updated_at, deleted_at FROM user_preferences WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(ref current) = existing
            && current.updated_at >= updated_at
        {
            return Ok(Some(current.clone()));
        }

        let _ = sqlx::query(
            r#"
            INSERT INTO user_preferences (id, preferences, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
                preferences = EXCLUDED.preferences,
                updated_at = EXCLUDED.updated_at,
                deleted_at = EXCLUDED.deleted_at
            "#,
        )
        .bind(user_id)
        .bind(preferences)
        .bind(updated_at)
        .bind(deleted_at)
        .execute(&self.pool)
        .await?;

        Ok(None)
    }

    pub async fn weight_tracking_enabled(&self, user_id: i32) -> Result<bool, sqlx::Error> {
        let preferences = sqlx::query_scalar::<_, Value>(
            "SELECT preferences FROM user_preferences WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(preferences
            .as_ref()
            .and_then(|value| value.get("weightTrackingEnabled"))
            .and_then(Value::as_bool)
            .unwrap_or(true))
    }

    // --- MEAL TEMPLATES ---
    pub async fn get_official_templates(&self) -> Result<Vec<MealTemplateRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
            FROM meal_templates
            WHERE is_official = TRUE AND deleted_at IS NULL
            ORDER BY name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn pull_meal_templates(
        &self,
        user_id: i32,
        checkpoint_updated_at: i64,
        checkpoint_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<MealTemplateRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
            FROM meal_templates
            WHERE (user_id = $1 OR is_official = TRUE)
              AND (updated_at > $2 OR (updated_at = $2 AND id > COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)))
            ORDER BY updated_at ASC, id ASC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(checkpoint_updated_at)
        .bind(checkpoint_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn push_meal_template(
        &self,
        user_id: i32,
        mutation: MealTemplateMutation,
    ) -> Result<Option<MealTemplateRow>, AppError> {
        let MealTemplateMutation {
            id,
            name,
            details,
            source_provider,
            external_id,
            updated_at,
            deleted_at,
        } = mutation;
        let existing = sqlx::query_as::<_, MealTemplateRow>(
            "SELECT id, user_id, is_official, name, details, source_provider, external_id, updated_at, deleted_at FROM meal_templates WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(ref current) = existing {
            // Protection: Reject mutations on Official Templates
            if current.is_official {
                tracing::warn!("Blocked attempt to mutate official template id={}", id);
                return Ok(Some(current.clone()));
            }

            if current.user_id != Some(user_id) {
                return Err(AppError::Conflict(
                    "Template id is already owned by another user".into(),
                ));
            }

            if current.updated_at >= updated_at {
                return Ok(Some(current.clone()));
            }
        }

        let _res = sqlx::query(
            r#"
            INSERT INTO meal_templates
                (id, user_id, is_official, name, details, source_provider, external_id,
                 updated_at, deleted_at)
            VALUES ($1, $2, FALSE, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                details = EXCLUDED.details,
                source_provider = EXCLUDED.source_provider,
                external_id = EXCLUDED.external_id,
                updated_at = EXCLUDED.updated_at,
                deleted_at = EXCLUDED.deleted_at
            WHERE meal_templates.user_id = EXCLUDED.user_id
              AND meal_templates.is_official = FALSE
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(name)
        .bind(details)
        .bind(source_provider)
        .bind(external_id)
        .bind(updated_at)
        .bind(deleted_at)
        .execute(&self.pool)
        .await?;

        if _res.rows_affected() == 0 {
            return Err(AppError::Conflict(
                "Template id could not be written for this user".into(),
            ));
        }

        Ok(None)
    }

    // --- MEAL LOGS ---
    pub async fn pull_meal_logs(
        &self,
        user_id: i32,
        checkpoint_updated_at: i64,
        checkpoint_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<MealLogRow>, sqlx::Error> {
        sqlx::query_as::<_, MealLogRow>(
            r#"
            SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
                   source_provider, external_id, canonical_quantity, entry_snapshot,
                   consumed_at, updated_at, deleted_at
            FROM meal_logs
            WHERE user_id = $1
              AND (updated_at > $2 OR (updated_at = $2 AND id > COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)))
            ORDER BY updated_at ASC, id ASC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(checkpoint_updated_at)
        .bind(checkpoint_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn push_meal_log(
        &self,
        user_id: i32,
        mutation: MealLogMutation,
    ) -> Result<Option<MealLogRow>, AppError> {
        mutation.entry.validate(mutation.canonical_quantity)?;
        let mut tx = self.pool.begin().await?;
        let existing = lock_owned_meal_log(&mut tx, user_id, mutation.id).await?;
        let entry_snapshot = serde_json::to_value(&mutation.entry)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        if let Some(current) = existing {
            let result = apply_owned_meal_log_revision(
                &mut tx,
                user_id,
                &mutation,
                current,
                &entry_snapshot,
            )
            .await?;
            tx.commit().await?;
            return Ok(result);
        }

        let (template_id, name_snapshot, nutrition_snapshot) =
            if let Some(copy) = &mutation.copy_source {
                let unavailable =
                    || AppError::BadRequest("The copy source is no longer available".into());
                let source = sqlx::query_as::<_, MealLogRow>(
                    r#"
                    SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
                           source_provider, external_id, canonical_quantity, entry_snapshot,
                           consumed_at, updated_at, deleted_at
                    FROM meal_logs
                    WHERE id = $1 AND user_id = $2
                    FOR SHARE
                    "#,
                )
                .bind(copy.source_id)
                .bind(user_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(unavailable)?;

                if mutation.deleted_at.is_none() {
                    let canonical_snapshot: NutritionSnapshot =
                        serde_json::from_value(source.nutrition_snapshot.clone())
                            .map_err(|_| unavailable())?;
                    canonical_snapshot.validate().map_err(|_| unavailable())?;
                    if source.deleted_at.is_some()
                        || source.updated_at != copy.source_updated_at
                        || source.template_id != mutation.template_id
                        || source.name_snapshot.trim() != copy.name_snapshot.trim()
                        || canonical_snapshot != copy.nutrition_snapshot
                    {
                        return Err(unavailable());
                    }
                }

                // Preserve the stored JSON, including optional null/absence and
                // historical metadata; validation above does not reserialize it.
                (
                    source.template_id,
                    source.name_snapshot,
                    source.nutrition_snapshot,
                )
            } else {
                let template_id = mutation.template_id.ok_or_else(|| {
                    AppError::BadRequest("templateId is required for a new meal log".into())
                })?;
                let template = get_food_template_in_tx(&mut tx, user_id, template_id)
                    .await?
                    .ok_or_else(|| AppError::NotFound("Food not found".into()))?;
                let snapshot = serde_json::to_value(template.details.snapshot())
                    .map_err(|error| AppError::Internal(error.to_string()))?;
                (Some(template_id), template.name, snapshot)
            };
        let result = sqlx::query(
            r#"
            INSERT INTO meal_logs
                (id, user_id, template_id, name_snapshot, nutrition_snapshot,
                 canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(mutation.id)
        .bind(user_id)
        .bind(template_id)
        .bind(name_snapshot)
        .bind(nutrition_snapshot)
        .bind(mutation.canonical_quantity)
        .bind(&entry_snapshot)
        .bind(mutation.consumed_at)
        .bind(mutation.updated_at)
        .bind(mutation.deleted_at)
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() == 0 {
            // A missing-row FOR UPDATE cannot lock a future insert. Resolve a
            // concurrent winner through the same owned LWW path: a newer delete
            // or edit must not be discarded as a terminal copy rejection.
            let current = lock_owned_meal_log(&mut tx, user_id, mutation.id)
                .await?
                .ok_or_else(|| {
                    AppError::Conflict("Meal log id could not be written for this user".into())
                })?;
            let result = apply_owned_meal_log_revision(
                &mut tx,
                user_id,
                &mutation,
                current,
                &entry_snapshot,
            )
            .await?;
            tx.commit().await?;
            return Ok(result);
        }
        tx.commit().await?;
        Ok(None)
    }

    // --- WEIGHT LOGS ---

    pub async fn pull_weight_logs(
        &self,
        user_id: i32,
        checkpoint_updated_at: i64,
        checkpoint_date: Option<NaiveDate>,
        limit: i64,
    ) -> Result<Vec<WeightLogRow>, sqlx::Error> {
        sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1
              AND (
                    updated_at > $2
                 OR (updated_at = $2 AND measured_on > COALESCE($3, DATE '0001-01-01'))
              )
            ORDER BY updated_at ASC, measured_on ASC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(checkpoint_updated_at)
        .bind(checkpoint_date)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn push_weight_log(
        &self,
        user_id: i32,
        measured_on: NaiveDate,
        weight_grams: i32,
        updated_at: i64,
        deleted_at: Option<i64>,
    ) -> Result<Option<WeightLogRow>, AppError> {
        validate_weight_grams(weight_grams)?;
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1 AND measured_on = $2
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(ref current) = existing
            && current.updated_at >= updated_at
        {
            tx.commit().await?;
            return Ok(Some(current.clone()));
        }

        sqlx::query(
            r#"
            INSERT INTO weight_logs
                (user_id, measured_on, weight_grams, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, measured_on) DO UPDATE SET
                weight_grams = EXCLUDED.weight_grams,
                updated_at = EXCLUDED.updated_at,
                deleted_at = EXCLUDED.deleted_at
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .bind(weight_grams)
        .bind(updated_at)
        .bind(deleted_at)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(None)
    }

    pub async fn get_weight_history(
        &self,
        user_id: i32,
        start: Option<NaiveDate>,
        end: NaiveDate,
        limit: i64,
    ) -> Result<Vec<WeightLogRow>, AppError> {
        let mut rows = sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1
              AND deleted_at IS NULL
              AND measured_on <= $2
              AND ($3::date IS NULL OR measured_on >= $3)
            ORDER BY measured_on DESC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(end)
        .bind(start)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.reverse();
        Ok(rows)
    }

    pub async fn set_weight(
        &self,
        user_id: i32,
        measured_on: NaiveDate,
        weight_grams: i32,
    ) -> Result<(WeightLogRow, WeightUpsertStatus), AppError> {
        validate_weight_grams(weight_grams)?;
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1 AND measured_on = $2
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(current) = existing.as_ref()
            && current.deleted_at.is_none()
            && current.weight_grams == weight_grams
        {
            let current = current.clone();
            tx.commit().await?;
            return Ok((current, WeightUpsertStatus::Unchanged));
        }

        let status = if existing.is_some() {
            WeightUpsertStatus::Updated
        } else {
            WeightUpsertStatus::Created
        };
        let row = sqlx::query_as::<_, WeightLogRow>(
            r#"
            INSERT INTO weight_logs
                (user_id, measured_on, weight_grams, updated_at, deleted_at)
            VALUES (
                $1, $2, $3,
                floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                NULL
            )
            ON CONFLICT (user_id, measured_on) DO UPDATE SET
                weight_grams = EXCLUDED.weight_grams,
                updated_at = EXCLUDED.updated_at,
                deleted_at = NULL
            RETURNING user_id, measured_on, weight_grams, updated_at, deleted_at
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .bind(weight_grams)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((row, status))
    }

    pub async fn soft_delete_weight(
        &self,
        user_id: i32,
        measured_on: NaiveDate,
    ) -> Result<(WeightLogRow, bool), AppError> {
        let mut tx = self.pool.begin().await?;
        let current = sqlx::query_as::<_, WeightLogRow>(
            r#"
            SELECT user_id, measured_on, weight_grams, updated_at, deleted_at
            FROM weight_logs
            WHERE user_id = $1 AND measured_on = $2
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Weight measurement not found".into()))?;
        if current.deleted_at.is_some() {
            tx.commit().await?;
            return Ok((current, true));
        }
        let row = sqlx::query_as::<_, WeightLogRow>(
            r#"
            UPDATE weight_logs
            SET deleted_at = COALESCE(
                    deleted_at,
                    floor(extract(epoch from clock_timestamp()) * 1000)::bigint
                ),
                updated_at = CASE
                    WHEN deleted_at IS NULL
                    THEN floor(extract(epoch from clock_timestamp()) * 1000)::bigint
                    ELSE updated_at
                END
            WHERE user_id = $1 AND measured_on = $2
            RETURNING user_id, measured_on, weight_grams, updated_at, deleted_at
            "#,
        )
        .bind(user_id)
        .bind(measured_on)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((row, false))
    }

    pub async fn search_food_templates(
        &self,
        user_id: i32,
        query: &str,
        source: &str,
        limit: i64,
    ) -> Result<FoodSearchResult, AppError> {
        let query = FoodSearchQuery::new(&self.pool, query).await?;
        if query.folded.is_empty() {
            return Ok(FoodSearchResult {
                foods: Vec::new(),
                has_more: false,
            });
        }

        let mut rows = query
            .bind(user_id, source, limit)
            .fetch_all(&self.pool)
            .await?;
        let has_more = rows.len() > limit as usize;
        if has_more {
            rows.pop();
        }
        let foods = rows
            .into_iter()
            .map(food_template_from_row)
            .collect::<Result<_, _>>()?;
        Ok(FoodSearchResult { foods, has_more })
    }

    #[allow(dead_code)]
    pub async fn create_personal_food(
        &self,
        user_id: i32,
        id: Uuid,
        name: &str,
        details: &FoodDetails,
    ) -> Result<CreatePersonalFoodOutcome, AppError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
        let mut details = details.clone();
        details.normalize();
        details.validate()?;
        let details = canonical_food_details(&details);

        let mut tx = self.pool.begin().await?;
        lock_personal_food_create_key(&mut tx, user_id, name).await?;

        if let Some(duplicate) =
            find_duplicate_personal_foods_in_tx(&mut tx, user_id, name, id, &details).await?
        {
            return Ok(CreatePersonalFoodOutcome::Duplicate(duplicate));
        }

        let details_json = serde_json::to_value(&details)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let result = sqlx::query(
            r#"
            INSERT INTO meal_templates
                (id, user_id, is_official, name, details, updated_at, deleted_at)
            VALUES
                ($1, $2, FALSE, $3, $4,
                 floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                 NULL)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(name)
        .bind(details_json)
        .execute(&mut *tx)
        .await?;

        let row = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
            FROM meal_templates
            WHERE id = $1
              AND deleted_at IS NULL
              AND (user_id = $2 OR is_official = TRUE)
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?
        .map(food_template_from_row)
        .transpose()?
        .ok_or_else(|| AppError::Conflict("operationId is already in use".into()))?;
        tx.commit().await?;
        Ok(if result.rows_affected() == 1 {
            CreatePersonalFoodOutcome::Created(row)
        } else {
            CreatePersonalFoodOutcome::AlreadyCreated(row)
        })
    }

    pub async fn create_mcp_food(
        &self,
        user_id: i32,
        operation_id: Uuid,
        name: &str,
        details: &FoodDetails,
    ) -> Result<CreatePersonalFoodOutcome, AppError> {
        self.create_mcp_food_inner(
            user_id,
            operation_id,
            name,
            details,
            #[cfg(test)]
            None,
            #[cfg(test)]
            None,
            false,
        )
        .await
    }

    #[cfg(test)]
    pub(crate) async fn create_mcp_food_with_fault(
        &self,
        user_id: i32,
        operation_id: Uuid,
        name: &str,
        details: &FoodDetails,
        fail_before_commit: bool,
    ) -> Result<CreatePersonalFoodOutcome, AppError> {
        self.create_mcp_food_inner(
            user_id,
            operation_id,
            name,
            details,
            None,
            None,
            fail_before_commit,
        )
        .await
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn create_mcp_food_with_hooks(
        &self,
        user_id: i32,
        operation_id: Uuid,
        name: &str,
        details: &FoodDetails,
        before_name_lock: Option<AsyncTestHook>,
        after_name_lock: Option<AsyncTestHook>,
        fail_before_commit: bool,
    ) -> Result<CreatePersonalFoodOutcome, AppError> {
        self.create_mcp_food_inner(
            user_id,
            operation_id,
            name,
            details,
            before_name_lock,
            after_name_lock,
            fail_before_commit,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_mcp_food_inner(
        &self,
        user_id: i32,
        operation_id: Uuid,
        name: &str,
        details: &FoodDetails,
        #[cfg(test)] before_name_lock: Option<AsyncTestHook>,
        #[cfg(test)] after_name_lock: Option<AsyncTestHook>,
        fail_before_commit: bool,
    ) -> Result<CreatePersonalFoodOutcome, AppError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
        let mut details = details.clone();
        details.normalize();
        details.validate()?;
        let details = canonical_food_details(&details);
        let intent = CreateFoodIntentV1 {
            name: name.to_owned(),
            details: details.clone(),
        };

        let mut tx = self.pool.begin().await?;
        // Lock ordering: always acquire mcp_receipt lock before personal_food_create
        // lock so concurrent transactions remain strictly acyclic and deadlock-free.
        lock_mcp_receipt_key(&mut tx, user_id, McpToolKind::CreateFood, operation_id).await?;

        if let Some(receipt) =
            get_mcp_receipt_in_tx(&mut tx, user_id, McpToolKind::CreateFood, operation_id).await?
        {
            if receipt.schema_version != MCP_RECEIPT_SCHEMA_VERSION {
                return Err(AppError::Internal(
                    "Unsupported MCP receipt schema version".into(),
                ));
            }
            let stored_intent: CreateFoodIntentV1 =
                serde_json::from_value::<CreateFoodIntentV1>(receipt.request_intent)
                    .map_err(|error| {
                        AppError::Internal(format!(
                            "Invalid MCP create_food receipt intent: {error}"
                        ))
                    })?
                    .canonicalize();
            if stored_intent != intent {
                return Err(AppError::Conflict(
                    "This operationId was already used for a different create_food request. Reuse the original arguments to replay that operation, or confirm and generate a new operationId for a different food.".into(),
                ));
            }
            let stored_baseline: CreateFoodBaselineV1 =
                serde_json::from_value::<CreateFoodBaselineV1>(receipt.target_state)
                    .map_err(|error| {
                        AppError::Internal(format!(
                            "Invalid MCP create_food receipt target state: {error}"
                        ))
                    })?
                    .canonicalize();
            let row = sqlx::query_as::<_, MealTemplateRow>(
                r#"
                SELECT id, user_id, is_official, name, details, source_provider, external_id,
                       updated_at, deleted_at
                FROM meal_templates
                WHERE id = $1 AND user_id = $2 AND is_official = FALSE
                "#,
            )
            .bind(operation_id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
            let Some(row) = row else {
                return Err(AppError::Conflict(
                    "The food created by this operationId was deleted or modified. Inspect the current food catalog before making a new mutation with a new operationId.".into(),
                ));
            };
            if row.deleted_at.is_some() {
                return Err(AppError::Conflict(
                    "The food created by this operationId was deleted or modified. Inspect the current food catalog before making a new mutation with a new operationId.".into(),
                ));
            }
            let (food, current_baseline) = food_template_and_baseline_from_row(row)?;
            if current_baseline != stored_baseline {
                return Err(AppError::Conflict(
                    "The food created by this operationId was deleted or modified. Inspect the current food catalog before making a new mutation with a new operationId.".into(),
                ));
            }
            tx.commit().await?;
            return Ok(CreatePersonalFoodOutcome::AlreadyCreated(food));
        }

        #[cfg(test)]
        if let Some(hook) = before_name_lock {
            hook.await;
        }
        lock_personal_food_create_key(&mut tx, user_id, name).await?;
        #[cfg(test)]
        if let Some(hook) = after_name_lock {
            hook.await;
        }

        let operation_id_occupied: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM meal_templates WHERE id = $1)")
                .bind(operation_id)
                .fetch_one(&mut *tx)
                .await?;
        if operation_id_occupied {
            return Err(AppError::Conflict(
                "This operationId is already in use without a matching MCP receipt. Inspect current state and generate a new operationId for a new request.".into(),
            ));
        }

        if let Some(duplicate) =
            find_duplicate_personal_foods_in_tx(&mut tx, user_id, name, operation_id, &details)
                .await?
        {
            return Ok(CreatePersonalFoodOutcome::Duplicate(duplicate));
        }

        let details_json = serde_json::to_value(&details)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let inserted = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            INSERT INTO meal_templates
                (id, user_id, is_official, name, details, updated_at, deleted_at)
            VALUES
                ($1, $2, FALSE, $3, $4,
                 floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                 NULL)
            ON CONFLICT (id) DO NOTHING
            RETURNING id, user_id, is_official, name, details, source_provider, external_id,
                      updated_at, deleted_at
            "#,
        )
        .bind(operation_id)
        .bind(user_id)
        .bind(name)
        .bind(details_json)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = inserted else {
            return Err(AppError::Conflict(
                "This operationId is already in use without a matching MCP receipt. Inspect current state and generate a new operationId for a new request.".into(),
            ));
        };
        let (food, baseline) = food_template_and_baseline_from_row(row)?;
        let request_intent_json =
            serde_json::to_value(&intent).map_err(|error| AppError::Internal(error.to_string()))?;
        let target_state_json = serde_json::to_value(&baseline)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        insert_mcp_receipt_in_tx(
            &mut tx,
            user_id,
            McpToolKind::CreateFood,
            operation_id,
            &request_intent_json,
            &target_state_json,
        )
        .await?;

        if fail_before_commit {
            return Err(AppError::Internal(
                "Injected pre-commit failure for MCP receipt test".into(),
            ));
        }

        tx.commit().await?;
        Ok(CreatePersonalFoodOutcome::Created(food))
    }

    pub async fn update_personal_food(
        &self,
        user_id: i32,
        id: Uuid,
        patch: &PersonalFoodPatch,
    ) -> Result<FoodTemplate, AppError> {
        self.update_personal_food_inner(
            user_id,
            id,
            patch,
            #[cfg(test)]
            None,
        )
        .await
    }

    #[cfg(test)]
    pub(crate) async fn update_personal_food_with_hooks(
        &self,
        user_id: i32,
        id: Uuid,
        patch: &PersonalFoodPatch,
        after_name_lock: Option<AsyncTestHook>,
    ) -> Result<FoodTemplate, AppError> {
        self.update_personal_food_inner(user_id, id, patch, after_name_lock)
            .await
    }

    async fn update_personal_food_inner(
        &self,
        user_id: i32,
        id: Uuid,
        patch: &PersonalFoodPatch,
        #[cfg(test)] after_name_lock: Option<AsyncTestHook>,
    ) -> Result<FoodTemplate, AppError> {
        if patch.is_empty() {
            return Err(AppError::BadRequest(
                "At least one field must be provided".into(),
            ));
        }
        let trimmed_name = match &patch.name {
            Some(name) => {
                let trimmed = name.trim();
                if trimmed.is_empty() {
                    return Err(AppError::BadRequest("name cannot be empty".into()));
                }
                Some(trimmed.to_owned())
            }
            None => None,
        };

        let mut tx = self.pool.begin().await?;
        // Lock ordering: acquire personal_food_create name lock before meal_templates
        // row lock so concurrent create_food and update_food calls remain deadlock-free.
        if let Some(ref candidate_name) = trimmed_name {
            lock_personal_food_create_key(&mut tx, user_id, candidate_name).await?;
            #[cfg(test)]
            if let Some(hook) = after_name_lock {
                hook.await;
            }
        }

        let row = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
            FROM meal_templates
            WHERE id = $1 AND user_id = $2 AND is_official = FALSE
            FOR UPDATE
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = row else {
            return Err(AppError::NotFound("Food not found".into()));
        };
        if row.deleted_at.is_some() {
            return Err(AppError::NotFound("Food not found".into()));
        }

        let old_details: FoodDetails = serde_json::from_value(row.details)
            .map_err(|error| AppError::Internal(format!("Invalid food details: {error}")))?;
        let canonical_old = canonical_food_details(&old_details);

        let new_name = trimmed_name.unwrap_or_else(|| row.name.clone());
        let mut new_details = old_details;
        if let Some(calories) = patch.calories {
            new_details.nutrition_per100.calories = calories;
        }
        if let Some(protein) = patch.protein {
            new_details.nutrition_per100.protein = protein;
        }
        if let Some(carbs) = patch.carbs {
            new_details.nutrition_per100.carbs = carbs;
        }
        if let Some(fat) = patch.fat {
            new_details.nutrition_per100.fat = fat;
        }
        if let Some(fiber) = patch.fiber {
            new_details.nutrition_per100.fiber = fiber;
        }
        if let Some(sodium_mg) = patch.sodium_mg {
            new_details.nutrition_per100.sodium_mg = sodium_mg;
        }
        if let Some(cholesterol_mg) = patch.cholesterol_mg {
            new_details.nutrition_per100.cholesterol_mg = cholesterol_mg;
        }
        if let Some(portions) = &patch.portions {
            new_details.portions = portions.clone();
        }
        if let Some(chilean_seals) = &patch.chilean_seals {
            new_details.chilean_seals = chilean_seals.clone();
        }
        if let Some(brand) = &patch.brand {
            new_details.brand = normalize_optional_brand(brand.clone());
        }
        if let Some(category) = &patch.category {
            new_details.category = category.clone();
        }
        if let Some(typical_time) = &patch.typical_time {
            new_details.typical_time = typical_time.clone();
        }
        new_details.normalize();
        new_details.validate()?;

        let canonical_new = canonical_food_details(&new_details);
        if new_name == row.name && canonical_new == canonical_old {
            return Err(AppError::BadRequest("Patch produces no changes".into()));
        }

        if patch.name.is_some() && new_name.to_lowercase() != row.name.trim().to_lowercase() {
            let duplicate_exists: bool = sqlx::query_scalar(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM meal_templates
                    WHERE user_id = $1
                      AND is_official = FALSE
                      AND deleted_at IS NULL
                      AND lower(btrim(name)) = lower(btrim($2))
                      AND id <> $3
                )
                "#,
            )
            .bind(user_id)
            .bind(&new_name)
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
            if duplicate_exists {
                return Err(AppError::Conflict(
                    "A personal food with the same name already exists".into(),
                ));
            }
        }

        let details_json = serde_json::to_value(&canonical_new)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let updated = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            UPDATE meal_templates
            SET name = $3,
                details = $4,
                updated_at = GREATEST(
                    floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                    updated_at + 1
                )
            WHERE id = $1
              AND user_id = $2
              AND is_official = FALSE
              AND deleted_at IS NULL
            RETURNING id, user_id, is_official, name, details, source_provider, external_id,
                      updated_at, deleted_at
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(&new_name)
        .bind(details_json)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        food_template_from_row(updated)
    }

    pub async fn soft_delete_personal_food(
        &self,
        user_id: i32,
        id: Uuid,
    ) -> Result<(i64, bool), AppError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query_as::<_, (i64, Option<i64>)>(
            r#"
            SELECT updated_at, deleted_at
            FROM meal_templates
            WHERE id = $1 AND user_id = $2 AND is_official = FALSE
            FOR UPDATE
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;

        let Some((updated_at, deleted_at)) = row else {
            return Err(AppError::NotFound("Food not found".into()));
        };
        if deleted_at.is_some() {
            tx.commit().await?;
            return Ok((updated_at, true));
        }

        let new_ts: i64 = sqlx::query_scalar(
            r#"
            WITH next_ts AS (
                SELECT GREATEST(
                    floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                    $3::bigint + 1
                ) AS ts
            )
            UPDATE meal_templates
            SET deleted_at = next_ts.ts,
                updated_at = next_ts.ts
            FROM next_ts
            WHERE meal_templates.id = $1
              AND meal_templates.user_id = $2
              AND meal_templates.is_official = FALSE
              AND meal_templates.deleted_at IS NULL
            RETURNING meal_templates.updated_at
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(updated_at)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((new_ts, false))
    }

    #[allow(dead_code)]
    pub async fn get_food_template(
        &self,
        user_id: i32,
        id: Uuid,
    ) -> Result<Option<FoodTemplate>, AppError> {
        let row = sqlx::query_as::<_, MealTemplateRow>(
            r#"
            SELECT id, user_id, is_official, name, details, source_provider, external_id,
                   updated_at, deleted_at
            FROM meal_templates
            WHERE id = $1
              AND deleted_at IS NULL
              AND (user_id = $2 OR is_official = TRUE)
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(food_template_from_row).transpose()
    }

    #[allow(dead_code)]
    pub async fn create_consumption(
        &self,
        user_id: i32,
        id: Uuid,
        template_id: Uuid,
        quantity: f64,
        portion_id: Option<&str>,
        consumed_at: i64,
    ) -> Result<(Consumption, bool), AppError> {
        let mut tx = self.pool.begin().await?;
        let template = get_food_template_in_tx(&mut tx, user_id, template_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Food not found".into()))?;
        let (canonical_quantity, entry) = template.details.entry_for(quantity, portion_id)?;
        let snapshot = serde_json::to_value(template.details.snapshot())
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let entry_snapshot =
            serde_json::to_value(&entry).map_err(|error| AppError::Internal(error.to_string()))?;
        let result = sqlx::query(
            r#"
            INSERT INTO meal_logs
                (id, user_id, template_id, name_snapshot, nutrition_snapshot,
                 canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8,
                 floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                 NULL)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(template_id)
        .bind(&template.name)
        .bind(snapshot)
        .bind(canonical_quantity)
        .bind(entry_snapshot)
        .bind(consumed_at)
        .execute(&mut *tx)
        .await?;

        let row = get_consumption_in_tx(&mut tx, user_id, id)
            .await?
            .ok_or_else(|| AppError::Conflict("operationId is already in use".into()))?;
        tx.commit().await?;
        Ok((row, result.rows_affected() == 1))
    }

    pub async fn create_mcp_consumption(
        &self,
        user_id: i32,
        operation_id: Uuid,
        template_id: Uuid,
        quantity: f64,
        portion_id: Option<&str>,
        time_intent: &LogFoodTimeIntent,
    ) -> Result<(Consumption, bool), AppError> {
        self.create_mcp_consumption_inner(
            user_id,
            operation_id,
            template_id,
            quantity,
            portion_id,
            time_intent,
            None,
            false,
        )
        .await
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn create_mcp_consumption_with_hooks(
        &self,
        user_id: i32,
        operation_id: Uuid,
        template_id: Uuid,
        quantity: f64,
        portion_id: Option<&str>,
        time_intent: &LogFoodTimeIntent,
        now_resolver: Option<SantiagoNowResolver>,
        fail_before_commit: bool,
    ) -> Result<(Consumption, bool), AppError> {
        self.create_mcp_consumption_inner(
            user_id,
            operation_id,
            template_id,
            quantity,
            portion_id,
            time_intent,
            now_resolver,
            fail_before_commit,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_mcp_consumption_inner(
        &self,
        user_id: i32,
        operation_id: Uuid,
        template_id: Uuid,
        quantity: f64,
        portion_id: Option<&str>,
        time_intent: &LogFoodTimeIntent,
        now_resolver: Option<SantiagoNowResolver>,
        fail_before_commit: bool,
    ) -> Result<(Consumption, bool), AppError> {
        validate_positive("quantity", quantity)?;
        if let Some(portion_id) = portion_id
            && (portion_id.trim().is_empty() || portion_id.chars().count() > 80)
        {
            return Err(AppError::BadRequest(
                "portionId must contain between 1 and 80 characters and cannot be blank".into(),
            ));
        }
        let explicit_consumed_at = match time_intent {
            LogFoodTimeIntent::Omitted => None,
            LogFoodTimeIntent::Explicit { date, time } => {
                Some(self.local_datetime_to_epoch(date, time).await?)
            }
        };
        let intent = LogFoodIntentV1 {
            food_id: template_id,
            entered_quantity: canonical_f64(quantity),
            portion_id: portion_id.map(str::to_owned),
            time_intent: time_intent.clone(),
        };

        let mut tx = self.pool.begin().await?;
        lock_mcp_receipt_key(&mut tx, user_id, McpToolKind::LogFood, operation_id).await?;

        if let Some(receipt) =
            get_mcp_receipt_in_tx(&mut tx, user_id, McpToolKind::LogFood, operation_id).await?
        {
            if receipt.schema_version != MCP_RECEIPT_SCHEMA_VERSION {
                return Err(AppError::Internal(
                    "Unsupported MCP receipt schema version".into(),
                ));
            }
            let stored_intent: LogFoodIntentV1 =
                serde_json::from_value::<LogFoodIntentV1>(receipt.request_intent)
                    .map_err(|error| {
                        AppError::Internal(format!("Invalid MCP log_food receipt intent: {error}"))
                    })?
                    .canonicalize();
            if stored_intent != intent {
                return Err(AppError::Conflict(
                    "This operationId was already used for a different log_food request. Reuse the original arguments to replay that operation, or confirm and generate a new operationId for a different log.".into(),
                ));
            }
            let stored_baseline: LogFoodBaselineV1 =
                serde_json::from_value::<LogFoodBaselineV1>(receipt.target_state)
                    .map_err(|error| {
                        AppError::Internal(format!(
                            "Invalid MCP log_food receipt target state: {error}"
                        ))
                    })?
                    .canonicalize();
            let row = sqlx::query_as::<_, MealLogRow>(
                r#"
                SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
                       source_provider, external_id, canonical_quantity, entry_snapshot,
                       consumed_at, updated_at, deleted_at
                FROM meal_logs
                WHERE id = $1 AND user_id = $2
                "#,
            )
            .bind(operation_id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
            let Some(row) = row else {
                return Err(AppError::Conflict(
                    "The food log created by this operationId was deleted or modified. Inspect the daily log before making a new mutation with a new operationId.".into(),
                ));
            };
            if row.deleted_at.is_some() {
                return Err(AppError::Conflict(
                    "The food log created by this operationId was deleted or modified. Inspect the daily log before making a new mutation with a new operationId.".into(),
                ));
            }
            let (consumption, current_baseline) = consumption_and_baseline_from_row(row)?;
            if current_baseline != stored_baseline {
                return Err(AppError::Conflict(
                    "The food log created by this operationId was deleted or modified. Inspect the daily log before making a new mutation with a new operationId.".into(),
                ));
            }
            tx.commit().await?;
            return Ok((consumption, false));
        }

        let template = get_food_template_in_tx(&mut tx, user_id, template_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Food not found".into()))?;
        let (canonical_quantity, entry) = template.details.entry_for(quantity, portion_id)?;
        let consumed_at = match explicit_consumed_at {
            Some(consumed_at) => consumed_at,
            None => {
                let (date, time) = match now_resolver {
                    Some(resolver) => resolver()?,
                    None => current_santiago_datetime_in_tx(&mut tx).await?,
                };
                local_datetime_to_epoch_in_tx(&mut tx, &date, &time).await?
            }
        };
        let snapshot = serde_json::to_value(template.details.snapshot())
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let entry_snapshot =
            serde_json::to_value(&entry).map_err(|error| AppError::Internal(error.to_string()))?;
        let inserted = sqlx::query_as::<_, MealLogRow>(
            r#"
            INSERT INTO meal_logs
                (id, user_id, template_id, name_snapshot, nutrition_snapshot,
                 canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8,
                 floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                 NULL)
            ON CONFLICT (id) DO NOTHING
            RETURNING id, user_id, template_id, name_snapshot, nutrition_snapshot,
                      source_provider, external_id, canonical_quantity, entry_snapshot,
                      consumed_at, updated_at, deleted_at
            "#,
        )
        .bind(operation_id)
        .bind(user_id)
        .bind(template_id)
        .bind(&template.name)
        .bind(snapshot)
        .bind(canonical_quantity)
        .bind(entry_snapshot)
        .bind(consumed_at)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = inserted else {
            return Err(AppError::Conflict(
                "This operationId is already in use without a matching MCP receipt. Inspect current state and generate a new operationId for a new request.".into(),
            ));
        };
        let (consumption, baseline) = consumption_and_baseline_from_row(row)?;
        let request_intent_json =
            serde_json::to_value(&intent).map_err(|error| AppError::Internal(error.to_string()))?;
        let target_state_json = serde_json::to_value(&baseline)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        insert_mcp_receipt_in_tx(
            &mut tx,
            user_id,
            McpToolKind::LogFood,
            operation_id,
            &request_intent_json,
            &target_state_json,
        )
        .await?;

        if fail_before_commit {
            return Err(AppError::Internal(
                "Injected pre-commit failure for MCP receipt test".into(),
            ));
        }

        tx.commit().await?;
        Ok((consumption, true))
    }

    pub async fn get_daily_consumptions(
        &self,
        user_id: i32,
        date: &str,
    ) -> Result<Vec<Consumption>, AppError> {
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| AppError::BadRequest("date must use YYYY-MM-DD".into()))?;
        let (start, end) = self.day_bounds(date).await?;
        let rows = sqlx::query_as::<_, MealLogRow>(
            r#"
            SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
                   source_provider, external_id, canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at
            FROM meal_logs
            WHERE user_id = $1
              AND deleted_at IS NULL
              AND consumed_at >= $2
              AND consumed_at < $3
            ORDER BY consumed_at ASC, id ASC
            "#,
        )
        .bind(user_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(consumption_from_row).collect()
    }

    pub async fn update_consumption(
        &self,
        user_id: i32,
        id: Uuid,
        quantity: Option<f64>,
        consumed_at: Option<i64>,
    ) -> Result<Consumption, AppError> {
        if quantity.is_none() && consumed_at.is_none() {
            return Err(AppError::BadRequest(
                "At least one of quantity or consumedAt is required".into(),
            ));
        }
        let mut tx = self.pool.begin().await?;
        let current = get_consumption_in_tx(&mut tx, user_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Consumption not found".into()))?;
        let (canonical_quantity, entry) = if let Some(quantity) = quantity {
            validate_positive("quantity", quantity)?;
            match &current.entry.portion_snapshot {
                Some(portion) => {
                    let canonical =
                        quantity / portion.portion_quantity * portion.canonical_quantity;
                    let entry = MealLogEntry {
                        entered_quantity: quantity,
                        portion_snapshot: Some(portion.clone()),
                    };
                    entry.validate(canonical)?;
                    (canonical, entry)
                }
                None => {
                    let entry = MealLogEntry {
                        entered_quantity: quantity,
                        portion_snapshot: None,
                    };
                    entry.validate(quantity)?;
                    (quantity, entry)
                }
            }
        } else {
            (current.canonical_quantity, current.entry.clone())
        };
        let entry_snapshot =
            serde_json::to_value(&entry).map_err(|error| AppError::Internal(error.to_string()))?;
        let row = sqlx::query_as::<_, MealLogRow>(
            r#"
            UPDATE meal_logs
            SET canonical_quantity = $3,
                entry_snapshot = $4,
                consumed_at = COALESCE($5, consumed_at),
                updated_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
            WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
            RETURNING id, user_id, template_id, name_snapshot,
                      nutrition_snapshot, source_provider, external_id,
                      canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(canonical_quantity)
        .bind(entry_snapshot)
        .bind(consumed_at)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        consumption_from_row(row)
    }

    pub async fn soft_delete_consumption(
        &self,
        user_id: i32,
        id: Uuid,
    ) -> Result<Consumption, AppError> {
        let row = sqlx::query_as::<_, MealLogRow>(
            r#"
            UPDATE meal_logs
            SET deleted_at = COALESCE(
                    deleted_at,
                    floor(extract(epoch from clock_timestamp()) * 1000)::bigint
                ),
                updated_at = CASE
                    WHEN deleted_at IS NULL
                    THEN floor(extract(epoch from clock_timestamp()) * 1000)::bigint
                    ELSE updated_at
                END
            WHERE id = $1 AND user_id = $2
            RETURNING id, user_id, template_id, name_snapshot,
                      nutrition_snapshot, source_provider, external_id, canonical_quantity, entry_snapshot,
                      consumed_at, updated_at, deleted_at
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Consumption not found".into()))?;
        consumption_from_row(row)
    }

    pub async fn current_santiago_date(&self) -> Result<String, AppError> {
        let date = sqlx::query_scalar::<_, String>(
            "SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(date)
    }

    #[allow(dead_code)]
    pub async fn current_santiago_datetime(&self) -> Result<(String, String), AppError> {
        let result = sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT
                to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD'),
                to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago', 'HH24:MI')
            "#,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(result)
    }

    pub async fn local_datetime_to_epoch(&self, date: &str, time: &str) -> Result<i64, AppError> {
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| AppError::BadRequest("date must use YYYY-MM-DD".into()))?;
        chrono::NaiveTime::parse_from_str(time, "%H:%M")
            .map_err(|_| AppError::BadRequest("time must use HH:MM".into()))?;
        let (epoch, round_trip) = sqlx::query_as::<_, (i64, String)>(
            r#"
            SELECT
                floor(extract(epoch from (($1::date + $2::time)
                    AT TIME ZONE 'America/Santiago')) * 1000)::bigint,
                to_char(
                    ((($1::date + $2::time) AT TIME ZONE 'America/Santiago')
                        AT TIME ZONE 'America/Santiago'),
                    'YYYY-MM-DD HH24:MI'
                )
            "#,
        )
        .bind(date)
        .bind(time)
        .fetch_one(&self.pool)
        .await?;
        if round_trip != format!("{date} {time}") {
            return Err(AppError::BadRequest(
                "The local date/time does not exist in America/Santiago".into(),
            ));
        }
        Ok(epoch)
    }

    async fn day_bounds(&self, date: &str) -> Result<(i64, i64), AppError> {
        let bounds = sqlx::query_as::<_, (i64, i64)>(
            r#"
            SELECT
                floor(extract(epoch from ($1::date::timestamp
                    AT TIME ZONE 'America/Santiago')) * 1000)::bigint,
                floor(extract(epoch from (($1::date + 1)::timestamp
                    AT TIME ZONE 'America/Santiago')) * 1000)::bigint
            "#,
        )
        .bind(date)
        .fetch_one(&self.pool)
        .await?;
        Ok(bounds)
    }
}

fn food_template_from_row(row: MealTemplateRow) -> Result<FoodTemplate, AppError> {
    let details: FoodDetails = serde_json::from_value(row.details)
        .map_err(|error| AppError::Internal(format!("Invalid food details: {error}")))?;
    details.validate()?;
    Ok(FoodTemplate {
        id: row.id,
        name: row.name,
        is_official: row.is_official,
        details,
        updated_at: row.updated_at,
    })
}

fn decode_stored_food_template(row: MealTemplateRow) -> Result<FoodTemplate, AppError> {
    let details: FoodDetails = serde_json::from_value(row.details)
        .map_err(|_| AppError::Internal("Stored personal food details are invalid".into()))?;
    details
        .validate()
        .map_err(|_| AppError::Internal("Stored personal food details are invalid".into()))?;
    Ok(FoodTemplate {
        id: row.id,
        name: row.name,
        is_official: row.is_official,
        details,
        updated_at: row.updated_at,
    })
}

fn personal_food_matches_identity(candidate: &FoodDetails, incoming: &FoodDetails) -> bool {
    let candidate_brand =
        normalize_optional_brand(candidate.brand.clone()).map(|brand| brand.to_lowercase());
    let incoming_brand =
        normalize_optional_brand(incoming.brand.clone()).map(|brand| brand.to_lowercase());
    candidate_brand == incoming_brand
        && candidate.canonical_unit == incoming.canonical_unit
        && canonical_nutrition_values(&candidate.nutrition_per100)
            == canonical_nutrition_values(&incoming.nutrition_per100)
}

async fn lock_personal_food_create_key(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    name: &str,
) -> Result<(), AppError> {
    // 64-bit hash via hashtextextended; rare collisions between unrelated keys
    // only serialize those two transactions without affecting correctness.
    sqlx::query(
        r#"
        SELECT pg_advisory_xact_lock(
            hashtextextended('personal_food_create:' || $1::text || ':' || lower(btrim($2)), 0)
        )
        "#,
    )
    .bind(user_id)
    .bind(name)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn find_duplicate_personal_foods_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    name: &str,
    exclude_id: Uuid,
    details: &FoodDetails,
) -> Result<Option<DuplicatePersonalFood>, AppError> {
    let rows = sqlx::query_as::<_, MealTemplateRow>(
        r#"
        SELECT id, user_id, is_official, name, details, source_provider, external_id,
               updated_at, deleted_at
        FROM meal_templates
        WHERE user_id = $1
          AND is_official = FALSE
          AND deleted_at IS NULL
          AND lower(btrim(name)) = lower(btrim($2))
          AND id <> $3
        ORDER BY id ASC
        "#,
    )
    .bind(user_id)
    .bind(name)
    .bind(exclude_id)
    .fetch_all(&mut **tx)
    .await?;

    let mut matches = Vec::new();
    for row in rows {
        let food = decode_stored_food_template(row)?;
        if personal_food_matches_identity(&food.details, details) {
            matches.push(food);
        }
    }

    if matches.is_empty() {
        return Ok(None);
    }

    let has_more_candidates = matches.len() > MAX_DUPLICATE_PERSONAL_FOOD_CANDIDATES;
    let candidates = matches
        .into_iter()
        .take(MAX_DUPLICATE_PERSONAL_FOOD_CANDIDATES)
        .map(|food| DuplicatePersonalFoodCandidate {
            food_id: food.id,
            name: food.name,
            brand: normalize_optional_brand(food.details.brand),
            canonical_unit: food.details.canonical_unit,
            nutrition_per100: canonical_nutrition_values(&food.details.nutrition_per100),
            portions: food.details.portions,
        })
        .collect();

    Ok(Some(DuplicatePersonalFood {
        candidates,
        has_more_candidates,
    }))
}

fn food_template_and_baseline_from_row(
    row: MealTemplateRow,
) -> Result<(FoodTemplate, CreateFoodBaselineV1), AppError> {
    let source_provider = row.source_provider.clone();
    let external_id = row.external_id.clone();
    let food = food_template_from_row(row)?;
    let baseline = CreateFoodBaselineV1 {
        name: food.name.clone(),
        details: canonical_food_details(&food.details),
        source_provider,
        external_id,
        updated_at: food.updated_at,
    };
    Ok((food, baseline))
}

fn consumption_from_row(row: MealLogRow) -> Result<Consumption, AppError> {
    let snapshot: NutritionSnapshot = serde_json::from_value(row.nutrition_snapshot)
        .map_err(|error| AppError::Internal(format!("Invalid nutrition snapshot: {error}")))?;
    snapshot.validate().map_err(|error| match error {
        AppError::BadRequest(message) => AppError::Internal(message),
        other => other,
    })?;
    let entry: MealLogEntry = serde_json::from_value(row.entry_snapshot)
        .map_err(|error| AppError::Internal(format!("Invalid meal log entry snapshot: {error}")))?;
    entry
        .validate(row.canonical_quantity)
        .map_err(|error| match error {
            AppError::BadRequest(message) => AppError::Internal(message),
            other => other,
        })?;
    Ok(Consumption {
        id: row.id,
        template_id: row.template_id,
        name: row.name_snapshot,
        snapshot,
        canonical_quantity: row.canonical_quantity,
        entry,
        consumed_at: row.consumed_at,
        updated_at: row.updated_at,
    })
}

fn consumption_and_baseline_from_row(
    row: MealLogRow,
) -> Result<(Consumption, LogFoodBaselineV1), AppError> {
    let source_provider = row.source_provider.clone();
    let external_id = row.external_id.clone();
    let consumption = consumption_from_row(row)?;
    // Deliberately exclude template_id so a live, otherwise unchanged log
    // survives source template hard deletion (ON DELETE SET NULL) and replays
    // with foodId: null.
    let baseline = LogFoodBaselineV1 {
        name_snapshot: consumption.name.clone(),
        nutrition_snapshot: canonical_nutrition_snapshot(&consumption.snapshot),
        canonical_quantity: canonical_f64(consumption.canonical_quantity),
        entry_snapshot: canonical_meal_log_entry(&consumption.entry),
        consumed_at: consumption.consumed_at,
        source_provider,
        external_id,
        updated_at: consumption.updated_at,
    };
    Ok((consumption, baseline))
}

async fn lock_mcp_receipt_key(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    tool: McpToolKind,
    operation_id: Uuid,
) -> Result<(), AppError> {
    // 64-bit hash via hashtextextended; rare collisions between unrelated keys
    // only serialize those two transactions without affecting correctness.
    let key = format!("mcp_receipt:{user_id}:{}:{operation_id}", tool.as_str());
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(key)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn get_mcp_receipt_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    tool: McpToolKind,
    operation_id: Uuid,
) -> Result<Option<McpMutationReceiptRow>, AppError> {
    Ok(sqlx::query_as::<_, McpMutationReceiptRow>(
        r#"
        SELECT schema_version, request_intent, target_state
        FROM mcp_mutation_receipts
        WHERE user_id = $1 AND tool_name = $2 AND operation_id = $3
        "#,
    )
    .bind(user_id)
    .bind(tool.as_str())
    .bind(operation_id)
    .fetch_optional(&mut **tx)
    .await?)
}

async fn insert_mcp_receipt_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    tool: McpToolKind,
    operation_id: Uuid,
    request_intent: &Value,
    target_state: &Value,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO mcp_mutation_receipts
            (user_id, tool_name, operation_id, schema_version, request_intent, target_state)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(user_id)
    .bind(tool.as_str())
    .bind(operation_id)
    .bind(MCP_RECEIPT_SCHEMA_VERSION)
    .bind(request_intent)
    .bind(target_state)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn current_santiago_datetime_in_tx(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(String, String), AppError> {
    let result = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT
            to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD'),
            to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago', 'HH24:MI')
        "#,
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(result)
}

async fn local_datetime_to_epoch_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    date: &str,
    time: &str,
) -> Result<i64, AppError> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("date must use YYYY-MM-DD".into()))?;
    chrono::NaiveTime::parse_from_str(time, "%H:%M")
        .map_err(|_| AppError::BadRequest("time must use HH:MM".into()))?;
    let (epoch, round_trip) = sqlx::query_as::<_, (i64, String)>(
        r#"
        SELECT
            floor(extract(epoch from (($1::date + $2::time)
                AT TIME ZONE 'America/Santiago')) * 1000)::bigint,
            to_char(
                ((($1::date + $2::time) AT TIME ZONE 'America/Santiago')
                    AT TIME ZONE 'America/Santiago'),
                'YYYY-MM-DD HH24:MI'
            )
        "#,
    )
    .bind(date)
    .bind(time)
    .fetch_one(&mut **tx)
    .await?;
    if round_trip != format!("{date} {time}") {
        return Err(AppError::BadRequest(
            "The local date/time does not exist in America/Santiago".into(),
        ));
    }
    Ok(epoch)
}

async fn lock_owned_meal_log(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    id: Uuid,
) -> Result<Option<MealLogRow>, AppError> {
    Ok(sqlx::query_as::<_, MealLogRow>(
        r#"
        SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
               source_provider, external_id, canonical_quantity, entry_snapshot,
               consumed_at, updated_at, deleted_at
        FROM meal_logs
        WHERE id = $1 AND user_id = $2
        FOR UPDATE
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?)
}

async fn apply_owned_meal_log_revision(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    mutation: &MealLogMutation,
    current: MealLogRow,
    entry_snapshot: &Value,
) -> Result<Option<MealLogRow>, AppError> {
    if current.updated_at >= mutation.updated_at {
        return Ok(Some(current));
    }
    sqlx::query(
        r#"
        UPDATE meal_logs
        SET canonical_quantity = $3,
            entry_snapshot = $4,
            consumed_at = $5,
            updated_at = $6,
            deleted_at = $7
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(mutation.id)
    .bind(user_id)
    .bind(mutation.canonical_quantity)
    .bind(entry_snapshot)
    .bind(mutation.consumed_at)
    .bind(mutation.updated_at)
    .bind(mutation.deleted_at)
    .execute(&mut **tx)
    .await?;
    Ok(None)
}

async fn get_food_template_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    id: Uuid,
) -> Result<Option<FoodTemplate>, AppError> {
    let row = sqlx::query_as::<_, MealTemplateRow>(
        r#"
        SELECT id, user_id, is_official, name, details, source_provider, external_id,
               updated_at, deleted_at
        FROM meal_templates
        WHERE id = $1
          AND deleted_at IS NULL
          AND (user_id = $2 OR is_official = TRUE)
        FOR SHARE
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(food_template_from_row).transpose()
}

async fn get_consumption_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i32,
    id: Uuid,
) -> Result<Option<Consumption>, AppError> {
    let row = sqlx::query_as::<_, MealLogRow>(
        r#"
        SELECT id, user_id, template_id, name_snapshot, nutrition_snapshot,
               source_provider, external_id, canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at
        FROM meal_logs
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(consumption_from_row).transpose()
}

fn validate_positive(name: &str, value: f64) -> Result<(), AppError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(AppError::BadRequest(format!(
            "{name} must be a finite number greater than zero"
        )));
    }
    Ok(())
}

pub fn validate_weight_grams(weight_grams: i32) -> Result<(), AppError> {
    if !(1_000..=500_000).contains(&weight_grams) || weight_grams % 100 != 0 {
        return Err(AppError::BadRequest(
            "weight must be between 1.0 and 500.0 kg in 0.1 kg increments".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_unit_serde_rejects_noncanonical_units() {
        assert_eq!(
            serde_json::from_str::<CanonicalUnit>("\"g\"").unwrap(),
            CanonicalUnit::G
        );
        assert_eq!(
            serde_json::from_str::<CanonicalUnit>("\"ml\"").unwrap(),
            CanonicalUnit::Ml
        );
        assert!(serde_json::from_str::<CanonicalUnit>("\"unit\"").is_err());
        assert!(serde_json::from_str::<CanonicalUnit>("\"portion\"").is_err());
    }

    #[test]
    fn weight_grams_are_exact_and_bounded() {
        assert!(validate_weight_grams(1_000).is_ok());
        assert!(validate_weight_grams(72_400).is_ok());
        assert!(validate_weight_grams(500_000).is_ok());
        assert!(validate_weight_grams(900).is_err());
        assert!(validate_weight_grams(72_450).is_err());
        assert!(validate_weight_grams(500_100).is_err());
    }

    #[test]
    fn test_nutrition_values_validation() {
        let valid = NutritionValues {
            calories: 100.0,
            protein: 10.0,
            carbs: 20.0,
            fat: 5.0,
            fiber: Some(2.0),
            sodium_mg: Some(150.0),
            cholesterol_mg: Some(10.0),
            extended_nutrition: Default::default(),
        };
        assert!(valid.validate().is_ok());

        let mut invalid = valid.clone();
        invalid.calories = -1.0;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.protein = -0.1;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.carbs = -5.0;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.fat = -0.01;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.fiber = Some(-1.0);
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.fiber = Some(f64::NAN);
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.sodium_mg = Some(-10.0);
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.cholesterol_mg = Some(-1.0);
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.calories = f64::NAN;
        assert!(invalid.validate().is_err());

        let mut invalid = valid.clone();
        invalid.protein = f64::INFINITY;
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn canonical_portions_scale_and_snapshot_history() {
        let nutrition = NutritionValues {
            calories: 400.0,
            protein: 30.0,
            carbs: 40.0,
            fat: 12.0,
            fiber: Some(0.0),
            sodium_mg: None,
            cholesterol_mg: None,
            extended_nutrition: BTreeMap::from([("vitaminCMg".into(), 10.0)]),
        };
        let details = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: nutrition,
            portions: vec![
                PortionDefinition {
                    id: "bar".into(),
                    name: "barra".into(),
                    portion_quantity: 1.0,
                    canonical_quantity: 30.0,
                },
                PortionDefinition {
                    id: "tbsp".into(),
                    name: "cucharada".into(),
                    portion_quantity: 5.0,
                    canonical_quantity: 30.0,
                },
            ],
            chilean_seals: vec![],
            brand: None,
            category: None,
            typical_time: None,
        };
        details.validate().unwrap();
        let (canonical, entry) = details.entry_for(2.0, Some("bar")).unwrap();
        assert_eq!(canonical, 60.0);
        assert_eq!(
            entry.portion_snapshot.as_ref().unwrap().canonical_quantity,
            30.0
        );
        let (one_spoon, _) = details.entry_for(1.0, Some("tbsp")).unwrap();
        assert_eq!(one_spoon, 6.0);
        let consumption = Consumption {
            id: Uuid::new_v4(),
            template_id: None,
            name: "fixture".into(),
            snapshot: details.snapshot(),
            canonical_quantity: canonical,
            entry,
            consumed_at: 1,
            updated_at: 1,
        };
        let scaled = consumption.scaled_nutrition();
        assert_eq!(scaled.calories, 240.0);
        assert_eq!(scaled.fiber, Some(0.0));
        assert_eq!(scaled.extended_nutrition["vitaminCMg"], 6.0);

        let mut unknown_fiber = consumption;
        unknown_fiber.snapshot.nutrition_per100.fiber = None;
        assert_eq!(unknown_fiber.scaled_nutrition().fiber, None);
    }

    #[test]
    fn test_nutrition_values_serde_deny_unknown() {
        let json_data = serde_json::json!({
            "calories": 100.0,
            "protein": 10.0,
            "carbs": 20.0,
            "fat": 5.0,
            "fiber": 1.0,
            "sodiumMg": 50.0,
            "cholesterolMg": 0.0,
            "extraField": "not_allowed"
        });
        assert!(serde_json::from_value::<NutritionValues>(json_data).is_err());
    }

    #[test]
    fn optional_nutrition_fields_are_omitted_and_missing_fields_deserialize() {
        let nutrition = NutritionValues {
            calories: 100.0,
            protein: 10.0,
            carbs: 20.0,
            fat: 5.0,
            fiber: None,
            sodium_mg: None,
            cholesterol_mg: None,
            extended_nutrition: Default::default(),
        };
        let serialized = serde_json::to_value(&nutrition).unwrap();
        assert!(serialized.get("fiber").is_none());
        assert!(serialized.get("sodiumMg").is_none());
        assert!(serialized.get("cholesterolMg").is_none());

        let deserialized: NutritionValues = serde_json::from_value(json!({
            "calories": 100.0,
            "protein": 10.0,
            "carbs": 20.0,
            "fat": 5.0
        }))
        .unwrap();
        assert_eq!(deserialized.fiber, None);
        assert_eq!(deserialized.sodium_mg, None);
        assert_eq!(deserialized.cholesterol_mg, None);

        let zero: NutritionValues = serde_json::from_value(json!({
            "calories": 100.0,
            "protein": 10.0,
            "carbs": 20.0,
            "fat": 5.0,
            "fiber": 0.0
        }))
        .unwrap();
        assert_eq!(zero.fiber, Some(0.0));
        assert_eq!(serde_json::to_value(&zero).unwrap()["fiber"], json!(0.0));

        let existing_numeric: NutritionValues = serde_json::from_value(json!({
            "calories": 100.0,
            "protein": 10.0,
            "carbs": 20.0,
            "fat": 5.0,
            "fiber": 3.5
        }))
        .unwrap();
        assert_eq!(existing_numeric.fiber, Some(3.5));
    }

    #[tokio::test]
    async fn test_canonical_lax_flow_and_cross_user_isolation() {
        let Ok(database_url) = std::env::var("BALANCE_TEST_DATABASE_URL") else {
            return;
        };
        let pool = PgPool::connect(&database_url).await.unwrap();
        sqlx::query(
            "INSERT INTO users (id, email) VALUES (2, 'bal011-user2@example.invalid') ON CONFLICT (id) DO NOTHING",
        )
        .execute(&pool)
        .await
        .unwrap();
        let datasource = SyncDatasource::new(pool);
        let food_id = Uuid::new_v4();
        let details = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: NutritionValues {
                calories: 52.0,
                protein: 0.3,
                carbs: 14.0,
                fat: 0.2,
                fiber: Some(2.4),
                sodium_mg: None,
                cholesterol_mg: None,
                extended_nutrition: Default::default(),
            },
            portions: vec![],
            chilean_seals: vec![],
            brand: None,
            category: Some("fruit".into()),
            typical_time: None,
        };
        let CreatePersonalFoodOutcome::Created(food) = datasource
            .create_personal_food(1, food_id, "Manzana BAL-011", &details)
            .await
            .unwrap()
        else {
            panic!("expected created personal food");
        };
        assert_eq!(food.id, food_id);
        assert!(
            datasource
                .get_food_template(2, food_id)
                .await
                .unwrap()
                .is_none()
        );

        let template_collision = datasource
            .push_meal_template(
                2,
                MealTemplateMutation {
                    id: food_id,
                    name: "Intento ajeno".into(),
                    details: serde_json::to_value(&details).unwrap(),
                    source_provider: None,
                    external_id: None,
                    updated_at: i64::MAX - 1,
                    deleted_at: None,
                },
            )
            .await;
        assert!(matches!(template_collision, Err(AppError::Conflict(_))));

        let consumed_at = datasource
            .local_datetime_to_epoch("2026-08-09", "12:30")
            .await
            .unwrap();
        let log_id = Uuid::new_v4();
        let (log, logged) = datasource
            .create_consumption(1, log_id, food_id, 150.0, None, consumed_at)
            .await
            .unwrap();
        assert!(logged);
        assert_eq!(log.scaled_nutrition().calories, 78.0);
        assert!((log.scaled_nutrition().fiber.unwrap() - 3.6).abs() < 1e-12);
        assert_eq!(
            datasource
                .get_daily_consumptions(1, "2026-08-09")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(
            datasource
                .get_daily_consumptions(2, "2026-08-09")
                .await
                .unwrap()
                .is_empty()
        );

        let mobile_log_id = Uuid::new_v4();
        assert!(
            datasource
                .push_meal_log(
                    1,
                    MealLogMutation {
                        id: mobile_log_id,
                        template_id: Some(food_id),
                        canonical_quantity: 200.0,
                        entry: MealLogEntry {
                            entered_quantity: 200.0,
                            portion_snapshot: None,
                        },
                        consumed_at: consumed_at + 60_000,
                        updated_at: 1_786_233_600_000,
                        deleted_at: None,
                        copy_source: None,
                    },
                )
                .await
                .unwrap()
                .is_none()
        );
        let mobile_log = datasource
            .get_daily_consumptions(1, "2026-08-09")
            .await
            .unwrap()
            .into_iter()
            .find(|item| item.id == mobile_log_id)
            .unwrap();
        assert_eq!(mobile_log.snapshot, details.snapshot());
        assert_eq!(mobile_log.scaled_nutrition().calories, 104.0);

        let first_date = NaiveDate::from_ymd_opt(2026, 8, 8).unwrap();
        let second_date = NaiveDate::from_ymd_opt(2026, 8, 9).unwrap();
        let (first_weight, first_status) =
            datasource.set_weight(1, first_date, 72_600).await.unwrap();
        assert_eq!(first_status, WeightUpsertStatus::Created);
        assert_eq!(first_weight.weight_grams, 72_600);
        let (_, unchanged) = datasource.set_weight(1, first_date, 72_600).await.unwrap();
        assert_eq!(unchanged, WeightUpsertStatus::Unchanged);
        let (_, updated) = datasource.set_weight(1, first_date, 72_400).await.unwrap();
        assert_eq!(updated, WeightUpsertStatus::Updated);
        datasource.set_weight(1, second_date, 72_100).await.unwrap();
        datasource.set_weight(2, second_date, 99_900).await.unwrap();
        let history = datasource
            .get_weight_history(1, Some(first_date), second_date, 30)
            .await
            .unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].measured_on, first_date);
        assert_eq!(history[1].measured_on, second_date);
        assert_eq!(
            datasource
                .get_weight_history(2, Some(first_date), second_date, 30)
                .await
                .unwrap()
                .len(),
            1
        );

        let (_, already_deleted) = datasource.soft_delete_weight(1, second_date).await.unwrap();
        assert!(!already_deleted);
        let (_, already_deleted) = datasource.soft_delete_weight(1, second_date).await.unwrap();
        assert!(already_deleted);
        assert_eq!(
            datasource
                .get_weight_history(1, Some(first_date), second_date, 30)
                .await
                .unwrap()
                .len(),
            1
        );
        datasource.set_weight(1, second_date, 72_000).await.unwrap();
        assert_eq!(
            datasource
                .get_weight_history(1, Some(first_date), second_date, 30)
                .await
                .unwrap()
                .len(),
            2
        );

        assert!(datasource.weight_tracking_enabled(1).await.unwrap());
        datasource
            .push_user_preference(
                1,
                json!({ "weightTrackingEnabled": false }),
                i64::MAX - 2,
                None,
            )
            .await
            .unwrap();
        assert!(!datasource.weight_tracking_enabled(1).await.unwrap());
    }

    #[test]
    fn food_name_aliases_are_curated_valid_and_unique() {
        assert!(
            (60..=80).contains(&FOOD_NAME_ALIASES.len()),
            "expected 60..=80 alias groups, got {}",
            FOOD_NAME_ALIASES.len()
        );
        assert_eq!(
            FOOD_NAME_ALIASES[0],
            &["pollo", "pollos", "chicken", "chickens"]
        );
        assert_eq!(
            FOOD_NAME_ALIASES[1],
            &["papa", "papas", "patata", "patatas", "potato", "potatoes"]
        );
        assert_eq!(
            FOOD_NAME_ALIASES[2],
            &[
                "palta",
                "paltas",
                "aguacate",
                "aguacates",
                "avocado",
                "avocados",
            ]
        );

        let mut seen = std::collections::HashSet::new();
        for (group_index, group) in FOOD_NAME_ALIASES.iter().enumerate() {
            assert!(
                group.len() >= 2,
                "alias group {group_index} must contain at least 2 terms"
            );
            for &term in *group {
                assert_eq!(
                    term,
                    term.trim(),
                    "alias term {term:?} in group {group_index} must not have surrounding whitespace"
                );
                assert!(
                    !term.contains("  "),
                    "alias term {term:?} in group {group_index} must not contain consecutive spaces"
                );
                assert!(
                    term.bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte == b' '),
                    "alias term {term:?} in group {group_index} must use only lowercase ASCII letters and single spaces"
                );
                let letter_count = term
                    .bytes()
                    .filter(|byte| byte.is_ascii_lowercase())
                    .count();
                assert!(
                    letter_count >= 3,
                    "alias term {term:?} in group {group_index} must have at least 3 letters"
                );
                assert!(
                    seen.insert(term),
                    "duplicate alias term {term:?} found in group {group_index}"
                );
            }
        }
    }
}

#[cfg(test)]
mod food_search_tests {
    use super::*;
    use crate::connectors::user::{
        cleanup_identity_test_database, isolated_identity_test_database,
    };
    use sqlx::Connection;

    #[tokio::test]
    #[ignore = "requires isolated PostgreSQL 17 and measures the production query plan"]
    async fn food_search_index_plan() {
        let (db, schema) = isolated_identity_test_database()
            .await
            .expect("set BALANCE_TEST_DATABASE_URL to an isolated PostgreSQL 17 database");
        let pool = &db.sync.pool;
        sqlx::raw_sql(
            r#"
            INSERT INTO meal_templates (id, name, details, updated_at, is_official)
            SELECT md5(n::text)::uuid, 'Producto lote ' || n || ' %_',
                   jsonb_build_object('brand', 'Marca lote ' || (n % 1000)), 1, true
            FROM generate_series(1, 50000) AS n;
            INSERT INTO meal_templates (id, name, details, updated_at, is_official)
            VALUES ('00000000-0000-0000-0000-000000000001', 'Quínoa selectiva', '{}', 1, true),
                   ('00000000-0000-0000-0000-000000000002', 'Bebida', '{"brand":"Viñedo singular"}', 1, true),
                   ('00000000-0000-0000-0000-000000000003', 'Chicken fillet', '{}', 1, true);
            "#,
        )
        .execute(pool)
        .await
        .unwrap();
        // Match the state after an index build by draining the bulk insert's GIN pending lists.
        sqlx::query("VACUUM (ANALYZE) meal_templates")
            .execute(pool)
            .await
            .unwrap();

        let mut connection = pool.acquire().await.unwrap();
        let settings: (String, String, String) = sqlx::query_as(
            "SELECT current_setting('plan_cache_mode'), current_setting('enable_seqscan'),
                    current_setting('server_version_num')",
        )
        .fetch_one(&mut *connection)
        .await
        .unwrap();
        assert_eq!(settings.0, "auto");
        assert_eq!(settings.1, "on");
        assert!(settings.2.starts_with("17"), "{settings:?}");

        for source in ["official", "all"] {
            for (literal, expected) in [
                ("quinoa", Some((1, "idx_meal_templates_search_name"))),
                (
                    "vinedo singular",
                    Some((2, "idx_meal_templates_search_brand")),
                ),
                ("pollo", Some((3, "idx_meal_templates_search_name"))),
                ("lote", None),
                ("lo", None),
                ("%_", None),
            ] {
                connection.clear_cached_statements().await.unwrap();
                let query = FoodSearchQuery::new(pool, literal).await.unwrap();
                let rows = query
                    .bind(1, source, 20)
                    .fetch_all(&mut *connection)
                    .await
                    .unwrap();
                if let Some((id, _)) = expected {
                    assert_eq!(
                        rows.iter().map(|row| row.id).collect::<Vec<_>>(),
                        [Uuid::from_u128(id)]
                    );
                } else {
                    assert_eq!(rows.len(), 21);
                }

                let explain: String = sqlx::query_scalar(
                    "SELECT format('EXPLAIN (ANALYZE, BUFFERS) EXECUTE %I(%L, %L, %L, %L, %L, %L)',
                                   name, 1, $2::text, $3::text, $4::text, 21, $5::text)
                     FROM pg_prepared_statements WHERE statement = $1",
                )
                .bind(FOOD_SEARCH_SQL)
                .bind(&query.pattern)
                .bind(source)
                .bind(&query.folded)
                .bind(&query.alias_pattern)
                .fetch_one(&mut *connection)
                .await
                .unwrap();

                for phase in ["initial", "reused"] {
                    if phase == "reused" {
                        for _ in 0..8 {
                            query
                                .bind(1, source, 20)
                                .fetch_all(&mut *connection)
                                .await
                                .unwrap();
                        }
                    }
                    let plan = sqlx::query_scalar::<_, String>(&explain)
                        .persistent(false)
                        .fetch_all(&mut *connection)
                        .await
                        .unwrap()
                        .join("\n");
                    let counts: (i64, i64) = sqlx::query_as(
                        "SELECT custom_plans, generic_plans FROM pg_prepared_statements WHERE statement = $1",
                    )
                    .bind(FOOD_SEARCH_SQL)
                    .fetch_one(&mut *connection)
                    .await
                    .unwrap();
                    println!("{source} {literal:?} {phase} (custom, generic)={counts:?}\n{plan}");
                    if let Some((_, index)) = expected {
                        assert!(plan.contains(index), "{plan}");
                        assert!(
                            !plan
                                .lines()
                                .any(|line| line.contains("Seq Scan")
                                    && line.contains("meal_templates")),
                            "{plan}"
                        );
                    }
                }
            }
        }
        drop(connection);
        cleanup_identity_test_database(&db, &schema).await;
    }
}

#[cfg(test)]
mod copy_tests {
    use super::*;
    use crate::connectors::{
        db::Database,
        user::{cleanup_identity_test_database, isolated_identity_test_database},
    };
    use serde_json::json;

    async fn fixture() -> Option<(Database, String, MealLogRow)> {
        let (db, schema) = isolated_identity_test_database().await?;
        sqlx::query(
            "INSERT INTO users (id, email) VALUES (1, 'copy-first@example.invalid'), (2, 'copy-second@example.invalid')",
        )
        .execute(&db.user.pool)
        .await
        .unwrap();
        let source_id = Uuid::new_v4();
        let snapshot = json!({
            "schemaVersion":2, "canonicalUnit":"g",
            "nutritionPer100":{
                "calories":123.125, "protein":7.25, "carbs":11.5, "fat":3.75,
                "fiber":null, "sodiumMg":0,
                "extendedNutrition":{"ironMg":1.123456789}
            }
        });
        let entry = json!({
            "enteredQuantity":2,
            "portionSnapshot":{
                "portionId":"historical", "name":"Porción histórica",
                "portionQuantity":1, "canonicalQuantity":37.5
            }
        });
        sqlx::query(
            "INSERT INTO meal_logs (id,user_id,template_id,name_snapshot,nutrition_snapshot,canonical_quantity,entry_snapshot,consumed_at,updated_at,source_provider,external_id) VALUES ($1,1,NULL,'Historical food',$2,75,$3,1786233600000,100,'macrofactor','source-row')",
        )
        .bind(source_id)
        .bind(snapshot)
        .bind(entry)
        .execute(&db.user.pool)
        .await
        .unwrap();
        let source = row(&db, source_id).await;
        Some((db, schema, source))
    }

    async fn row(db: &Database, id: Uuid) -> MealLogRow {
        sqlx::query_as(
            "SELECT id,user_id,template_id,name_snapshot,nutrition_snapshot,source_provider,external_id,canonical_quantity,entry_snapshot,consumed_at,updated_at,deleted_at FROM meal_logs WHERE id=$1",
        )
        .bind(id)
        .fetch_one(&db.user.pool)
        .await
        .unwrap()
    }

    fn copy(source: &MealLogRow, id: Uuid, revision: i64) -> MealLogMutation {
        MealLogMutation {
            id,
            template_id: source.template_id,
            canonical_quantity: source.canonical_quantity,
            entry: serde_json::from_value(source.entry_snapshot.clone()).unwrap(),
            consumed_at: source.consumed_at + 86_400_000,
            updated_at: revision,
            deleted_at: None,
            copy_source: Some(MealLogCopyIntent {
                source_id: source.id,
                source_updated_at: source.updated_at,
                name_snapshot: source.name_snapshot.clone(),
                nutrition_snapshot: serde_json::from_value(source.nutrition_snapshot.clone())
                    .unwrap(),
            }),
        }
    }

    #[tokio::test]
    async fn copy_insert_collisions_resolve_owned_lww_in_both_revision_orders() {
        let Some((db, schema, source)) = fixture().await else {
            return;
        };
        for (winner_revision, winner_deleted, incoming_revision, incoming_deleted) in [
            (200, None, 200, None),
            (200, None, 201, Some(201)),
            (201, Some(201), 200, None),
            (200, None, 201, None),
            (201, None, 200, None),
        ] {
            let id = Uuid::new_v4();
            let mut winner_tx = db.user.pool.begin().await.unwrap();
            sqlx::query("INSERT INTO meal_logs(id,user_id,template_id,name_snapshot,nutrition_snapshot,canonical_quantity,entry_snapshot,consumed_at,updated_at,deleted_at) VALUES ($1,1,NULL,$2,$3,75,$4,$5,$6,$7)")
                .bind(id).bind(&source.name_snapshot).bind(&source.nutrition_snapshot)
                .bind(&source.entry_snapshot).bind(source.consumed_at + 86_400_000)
                .bind(winner_revision).bind(winner_deleted)
                .execute(&mut *winner_tx).await.unwrap();
            let search_path = schema.clone();
            let incoming_pool = sqlx::postgres::PgPoolOptions::new()
                .max_connections(1)
                .after_connect(move |connection, _| {
                    let search_path = search_path.clone();
                    Box::pin(async move {
                        sqlx::query("SELECT set_config('search_path',$1,false)")
                            .bind(search_path)
                            .execute(connection)
                            .await?;
                        Ok(())
                    })
                })
                .connect(&std::env::var("BALANCE_TEST_DATABASE_URL").unwrap())
                .await
                .unwrap();
            let incoming_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&incoming_pool)
                .await
                .unwrap();
            let mut incoming = copy(&source, id, incoming_revision);
            incoming.deleted_at = incoming_deleted;
            if incoming_revision > winner_revision && incoming_deleted.is_none() {
                incoming.canonical_quantity = 150.0;
                incoming.entry.entered_quantity = 4.0;
            }
            let incoming_datasource = SyncDatasource::new(incoming_pool.clone());
            let incoming_task =
                tokio::spawn(async move { incoming_datasource.push_meal_log(1, incoming).await });
            // Hold an actual uncommitted destination insert until the real push
            // waits at its unique index, after its absent-row lookup. No timing
            // sleep or production-only hook substitutes for this SQL barrier.
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    let waiting: bool = sqlx::query_scalar("SELECT COALESCE(wait_event_type='Lock' AND query LIKE '%INSERT INTO meal_logs%',false) FROM pg_stat_activity WHERE pid=$1")
                        .bind(incoming_pid).fetch_one(&db.user.pool).await.unwrap();
                    if waiting { break; }
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
            }).await.expect("push must reach the blocked insert collision");
            winner_tx.commit().await.unwrap();
            let result = incoming_task.await.unwrap().unwrap();
            let current = row(&db, id).await;
            if incoming_revision > winner_revision {
                assert!(result.is_none());
                assert_eq!(current.updated_at, incoming_revision);
                assert_eq!(current.deleted_at, incoming_deleted);
                if incoming_deleted.is_none() {
                    assert_eq!(current.canonical_quantity, 150.0);
                }
            } else {
                assert_eq!(result.unwrap().updated_at, winner_revision);
                assert_eq!(current.updated_at, winner_revision);
                assert_eq!(current.deleted_at, winner_deleted);
            }
            assert_eq!(current.nutrition_snapshot, source.nutrition_snapshot);
            incoming_pool.close().await;
        }
        cleanup_identity_test_database(&db, &schema).await;
    }

    #[tokio::test]
    async fn copy_preserves_raw_history_and_pending_quantity_portion_time_edits() {
        let Some((db, schema, source)) = fixture().await else {
            return;
        };
        let id = Uuid::new_v4();
        let mut mutation = copy(&source, id, 200);
        mutation.canonical_quantity = 112.5;
        mutation.entry.entered_quantity = 3.0;
        mutation.consumed_at += 3 * 3_600_000;
        let destination_time = mutation.consumed_at;
        assert!(db.sync.push_meal_log(1, mutation).await.unwrap().is_none());
        let created = row(&db, id).await;
        assert_eq!(created.name_snapshot, source.name_snapshot);
        assert_eq!(created.nutrition_snapshot, source.nutrition_snapshot);
        assert!(created.nutrition_snapshot["nutritionPer100"]["fiber"].is_null());
        assert!(
            created.nutrition_snapshot["nutritionPer100"]
                .get("cholesterolMg")
                .is_none()
        );
        assert_eq!(
            created.nutrition_snapshot["nutritionPer100"]["sodiumMg"],
            json!(0)
        );
        assert_eq!(created.template_id, None);
        assert_eq!(created.canonical_quantity, 112.5);
        assert_eq!(created.entry_snapshot["enteredQuantity"], json!(3.0));
        let created_entry: MealLogEntry =
            serde_json::from_value(created.entry_snapshot.clone()).unwrap();
        let mut expected_entry: MealLogEntry =
            serde_json::from_value(source.entry_snapshot.clone()).unwrap();
        expected_entry.entered_quantity = 3.0;
        assert_eq!(created_entry, expected_entry);
        assert_eq!(created.consumed_at, destination_time);
        assert!(created.source_provider.is_none() && created.external_id.is_none());
        assert_eq!(
            serde_json::to_value(row(&db, source.id).await).unwrap(),
            serde_json::to_value(&source).unwrap()
        );

        // A current/deleted template is not the authority for historical food.
        let template = Uuid::new_v4();
        sqlx::query("INSERT INTO meal_templates(id,user_id,name,details,updated_at,deleted_at) VALUES ($1,1,'Changed current template',$2,400,400)")
            .bind(template)
            .bind(json!({"schemaVersion":2,"canonicalUnit":"g","nutritionPer100":{"calories":999,"protein":99,"carbs":99,"fat":99},"portions":[]}))
            .execute(&db.user.pool).await.unwrap();
        sqlx::query("UPDATE meal_logs SET template_id=$2 WHERE id=$1")
            .bind(source.id)
            .bind(template)
            .execute(&db.user.pool)
            .await
            .unwrap();
        let source_with_template = row(&db, source.id).await;
        let second = Uuid::new_v4();
        db.sync
            .push_meal_log(1, copy(&source_with_template, second, 201))
            .await
            .unwrap();
        let second = row(&db, second).await;
        assert_eq!(second.template_id, Some(template));
        assert_eq!(second.nutrition_snapshot, source.nutrition_snapshot);
        cleanup_identity_test_database(&db, &schema).await;
    }

    #[tokio::test]
    async fn copy_retry_and_tombstone_keep_identity_after_source_edit_or_delete() {
        let Some((db, schema, source)) = fixture().await else {
            return;
        };
        let id = Uuid::new_v4();
        let mutation = copy(&source, id, 200);
        db.sync.push_meal_log(1, mutation.clone()).await.unwrap();
        sqlx::query("UPDATE meal_logs SET name_snapshot='Changed source',nutrition_snapshot=$2,updated_at=300,deleted_at=300 WHERE id=$1")
            .bind(source.id)
            .bind(json!({"schemaVersion":2,"canonicalUnit":"g","nutritionPer100":{"calories":999,"protein":99,"carbs":99,"fat":99}}))
            .execute(&db.user.pool).await.unwrap();
        // The first ACK was lost; source checks must not reject the saved UUID.
        let retried = db
            .sync
            .push_meal_log(1, mutation.clone())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(retried.id, id);
        assert_eq!(retried.nutrition_snapshot, source.nutrition_snapshot);
        let mut edit = mutation;
        edit.updated_at = 400;
        edit.canonical_quantity = 150.0;
        edit.entry.entered_quantity = 4.0;
        db.sync.push_meal_log(1, edit).await.unwrap();
        assert_eq!(row(&db, id).await.canonical_quantity, 150.0);
        assert_eq!(
            row(&db, id).await.nutrition_snapshot,
            source.nutrition_snapshot
        );

        let cancelled_id = Uuid::new_v4();
        let earlier_create = copy(&source, cancelled_id, 500);
        let mut tombstone = earlier_create.clone();
        tombstone.updated_at = 501;
        tombstone.deleted_at = Some(501);
        tombstone.template_id = Some(Uuid::new_v4());
        tombstone.copy_source.as_mut().unwrap().name_snapshot = "Cancelled payload".into();
        db.sync.push_meal_log(1, tombstone).await.unwrap();
        let cancelled = row(&db, cancelled_id).await;
        assert_eq!(cancelled.deleted_at, Some(501));
        assert_eq!(cancelled.updated_at, 501);
        assert_eq!(cancelled.name_snapshot, "Changed source");
        assert_eq!(cancelled.template_id, None);
        let late = db
            .sync
            .push_meal_log(1, earlier_create)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(late.deleted_at, Some(501));
        assert_eq!(row(&db, cancelled_id).await.deleted_at, Some(501));
        cleanup_identity_test_database(&db, &schema).await;
    }

    #[tokio::test]
    async fn copy_rejects_stale_changed_deleted_missing_and_foreign_sources() {
        let Some((db, schema, source)) = fixture().await else {
            return;
        };
        let mut mismatch = copy(&source, Uuid::new_v4(), 200);
        mismatch
            .copy_source
            .as_mut()
            .unwrap()
            .nutrition_snapshot
            .nutrition_per100
            .calories += 1.0;
        assert!(matches!(
            db.sync.push_meal_log(1, mismatch).await,
            Err(AppError::BadRequest(_))
        ));
        let mut stale = copy(&source, Uuid::new_v4(), 201);
        stale.copy_source.as_mut().unwrap().source_updated_at -= 1;
        assert!(matches!(
            db.sync.push_meal_log(1, stale).await,
            Err(AppError::BadRequest(_))
        ));
        // Same source revision is insufficient when authoritative food changed.
        sqlx::query("UPDATE meal_logs SET name_snapshot='Changed at same revision' WHERE id=$1")
            .bind(source.id)
            .execute(&db.user.pool)
            .await
            .unwrap();
        assert!(matches!(
            db.sync
                .push_meal_log(1, copy(&source, Uuid::new_v4(), 202))
                .await,
            Err(AppError::BadRequest(_))
        ));
        sqlx::query("UPDATE meal_logs SET name_snapshot=$2,deleted_at=203 WHERE id=$1")
            .bind(source.id)
            .bind(&source.name_snapshot)
            .execute(&db.user.pool)
            .await
            .unwrap();
        assert!(matches!(
            db.sync
                .push_meal_log(1, copy(&source, Uuid::new_v4(), 203))
                .await,
            Err(AppError::BadRequest(_))
        ));

        let foreign = db
            .sync
            .push_meal_log(2, copy(&source, Uuid::new_v4(), 204))
            .await
            .unwrap_err();
        let mut missing = copy(&source, Uuid::new_v4(), 205);
        missing.copy_source.as_mut().unwrap().source_id = Uuid::new_v4();
        let missing = db.sync.push_meal_log(1, missing).await.unwrap_err();
        assert_eq!(format!("{foreign:?}"), format!("{missing:?}"));
        let mut foreign_tombstone = copy(&source, Uuid::new_v4(), 206);
        foreign_tombstone.deleted_at = Some(206);
        assert!(matches!(
            db.sync.push_meal_log(2, foreign_tombstone).await,
            Err(AppError::BadRequest(_))
        ));
        let own_second_source = Uuid::new_v4();
        sqlx::query("INSERT INTO meal_logs(id,user_id,name_snapshot,nutrition_snapshot,canonical_quantity,entry_snapshot,consumed_at,updated_at) SELECT $2,2,name_snapshot,nutrition_snapshot,canonical_quantity,entry_snapshot,consumed_at,100 FROM meal_logs WHERE id=$1")
            .bind(source.id).bind(own_second_source).execute(&db.user.pool).await.unwrap();
        let second_source = row(&db, own_second_source).await;
        let foreign_destination_before = row(&db, source.id).await;
        assert!(matches!(
            db.sync
                .push_meal_log(2, copy(&second_source, source.id, 400))
                .await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            serde_json::to_value(row(&db, source.id).await).unwrap(),
            serde_json::to_value(foreign_destination_before).unwrap()
        );
        cleanup_identity_test_database(&db, &schema).await;
    }

    #[test]
    fn food_details_and_snapshot_brand_serde_normalization_and_validation() {
        let legacy_details: FoodDetails = serde_json::from_value(json!({
            "schemaVersion": FOOD_SCHEMA_VERSION,
            "canonicalUnit": "g",
            "nutritionPer100": { "calories": 100.0, "protein": 10.0, "carbs": 20.0, "fat": 5.0 },
            "portions": []
        }))
        .unwrap();
        assert_eq!(legacy_details.brand, None);
        legacy_details.validate().unwrap();
        let legacy_json = serde_json::to_value(&legacy_details).unwrap();
        assert!(legacy_json.get("brand").is_none());
        assert_eq!(legacy_details.snapshot().brand, None);

        let trimmed_details: FoodDetails = serde_json::from_value(json!({
            "schemaVersion": FOOD_SCHEMA_VERSION,
            "canonicalUnit": "g",
            "nutritionPer100": { "calories": 100.0, "protein": 10.0, "carbs": 20.0, "fat": 5.0 },
            "portions": [],
            "brand": "  Soprole  "
        }))
        .unwrap();
        assert_eq!(trimmed_details.brand.as_deref(), Some("Soprole"));
        trimmed_details.validate().unwrap();
        assert_eq!(
            serde_json::to_value(&trimmed_details).unwrap()["brand"],
            json!("Soprole")
        );
        let snapshot = trimmed_details.snapshot();
        assert_eq!(snapshot.brand.as_deref(), Some("Soprole"));
        assert_eq!(
            serde_json::to_value(&snapshot).unwrap()["brand"],
            json!("Soprole")
        );

        let blank_details: FoodDetails = serde_json::from_value(json!({
            "schemaVersion": FOOD_SCHEMA_VERSION,
            "canonicalUnit": "g",
            "nutritionPer100": { "calories": 100.0, "protein": 10.0, "carbs": 20.0, "fat": 5.0 },
            "portions": [],
            "brand": "   "
        }))
        .unwrap();
        assert_eq!(blank_details.brand, None);
        assert!(
            serde_json::to_value(&blank_details)
                .unwrap()
                .get("brand")
                .is_none()
        );

        let null_snapshot: NutritionSnapshot = serde_json::from_value(json!({
            "schemaVersion": FOOD_SCHEMA_VERSION,
            "canonicalUnit": "g",
            "nutritionPer100": { "calories": 100.0, "protein": 10.0, "carbs": 20.0, "fat": 5.0 },
            "brand": null
        }))
        .unwrap();
        assert_eq!(null_snapshot.brand, None);
        assert!(
            serde_json::to_value(&null_snapshot)
                .unwrap()
                .get("brand")
                .is_none()
        );

        assert!(
            serde_json::from_value::<FoodDetails>(json!({
                "schemaVersion": FOOD_SCHEMA_VERSION,
                "canonicalUnit": "g",
                "nutritionPer100": { "calories": 100.0, "protein": 10.0, "carbs": 20.0, "fat": 5.0 },
                "portions": [],
                "unknownField": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<NutritionSnapshot>(json!({
                "schemaVersion": FOOD_SCHEMA_VERSION,
                "canonicalUnit": "g",
                "nutritionPer100": { "calories": 100.0, "protein": 10.0, "carbs": 20.0, "fat": 5.0 },
                "unknownField": true
            }))
            .is_err()
        );

        let max_brand = "á".repeat(MAX_BRAND_CHARS);
        let mut exact_max_details = legacy_details.clone();
        exact_max_details.brand = Some(format!("  {max_brand}  "));
        exact_max_details.normalize();
        exact_max_details.validate().unwrap();
        assert_eq!(exact_max_details.brand.as_deref(), Some(max_brand.as_str()));

        let mut too_long_details = legacy_details;
        too_long_details.brand = Some("a".repeat(MAX_BRAND_CHARS + 1));
        assert!(matches!(
            too_long_details.validate(),
            Err(AppError::BadRequest(_))
        ));

        let mut too_long_snapshot = null_snapshot;
        too_long_snapshot.brand = Some("a".repeat(MAX_BRAND_CHARS + 1));
        assert!(matches!(
            too_long_snapshot.validate(),
            Err(AppError::BadRequest(_))
        ));
    }

    #[tokio::test]
    async fn mcp_receipt_clock_isolation_and_explicit_vs_omitted_postgres() {
        use crate::connectors::user::NewUser;
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let user = db
            .user
            .provision_identity(
                "https://issuer.example.invalid",
                "mcp-receipt-clock-user",
                &NewUser {
                    email: "mcp-receipt-clock@example.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();

        let food_id = Uuid::new_v4();
        let details = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: NutritionValues {
                calories: 250.0,
                protein: 10.0,
                carbs: 30.0,
                fat: 8.0,
                fiber: Some(4.0),
                sodium_mg: Some(120.0),
                cholesterol_mg: None,
                extended_nutrition: BTreeMap::new(),
            },
            portions: vec![],
            chilean_seals: vec![],
            brand: None,
            category: None,
            typical_time: None,
        };
        let outcome = db
            .sync
            .create_mcp_food(user.id, food_id, "Clock Test Food", &details)
            .await
            .unwrap();
        assert!(matches!(outcome, CreatePersonalFoodOutcome::Created(_)));

        // Initial omitted-time log at 2026-08-10 23:59 Santiago.
        let op_omitted = Uuid::new_v4();
        let initial_calls = Arc::new(AtomicUsize::new(0));
        let initial_calls_clone = Arc::clone(&initial_calls);
        let (first, created) = db
            .sync
            .create_mcp_consumption_with_hooks(
                user.id,
                op_omitted,
                food_id,
                100.0,
                None,
                &LogFoodTimeIntent::Omitted,
                Some(Box::new(move || {
                    initial_calls_clone.fetch_add(1, Ordering::SeqCst);
                    Ok(("2026-08-10".to_owned(), "23:59".to_owned()))
                })),
                false,
            )
            .await
            .unwrap();
        assert!(created);
        assert_eq!(initial_calls.load(Ordering::SeqCst), 1);

        // Replay across a Santiago minute and day boundary: now resolver MUST NOT be called.
        let replay_calls = Arc::new(AtomicUsize::new(0));
        let replay_calls_clone = Arc::clone(&replay_calls);
        let (replay, created) = db
            .sync
            .create_mcp_consumption_with_hooks(
                user.id,
                op_omitted,
                food_id,
                100.0,
                None,
                &LogFoodTimeIntent::Omitted,
                Some(Box::new(move || {
                    replay_calls_clone.fetch_add(1, Ordering::SeqCst);
                    Ok(("2026-08-11".to_owned(), "00:01".to_owned()))
                })),
                false,
            )
            .await
            .unwrap();
        assert!(!created);
        assert_eq!(replay_calls.load(Ordering::SeqCst), 0);
        assert_eq!(replay.consumed_at, first.consumed_at);
        assert_eq!(replay.updated_at, first.updated_at);

        // Explicit mode matching the exact resolved instant is still a distinct intent -> Conflict.
        let conflict = db
            .sync
            .create_mcp_consumption(
                user.id,
                op_omitted,
                food_id,
                100.0,
                None,
                &LogFoodTimeIntent::Explicit {
                    date: "2026-08-10".into(),
                    time: "23:59".into(),
                },
            )
            .await;
        assert!(matches!(conflict, Err(AppError::Conflict(_))));

        // Reverse direction: Explicit committed first, Omitted replay -> Conflict.
        let op_explicit = Uuid::new_v4();
        let (_, created) = db
            .sync
            .create_mcp_consumption(
                user.id,
                op_explicit,
                food_id,
                50.0,
                None,
                &LogFoodTimeIntent::Explicit {
                    date: "2026-08-10".into(),
                    time: "12:00".into(),
                },
            )
            .await
            .unwrap();
        assert!(created);

        let omitted_conflict = db
            .sync
            .create_mcp_consumption(
                user.id,
                op_explicit,
                food_id,
                50.0,
                None,
                &LogFoodTimeIntent::Omitted,
            )
            .await;
        assert!(matches!(omitted_conflict, Err(AppError::Conflict(_))));

        cleanup_identity_test_database(&db, &schema).await;
    }

    #[tokio::test]
    async fn mcp_receipt_concurrency_and_rollback_postgres() {
        use crate::connectors::user::NewUser;

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let user = db
            .user
            .provision_identity(
                "https://issuer.example.invalid",
                "mcp-receipt-concurrency-user",
                &NewUser {
                    email: "mcp-receipt-concurrency@example.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();

        let details = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: NutritionValues {
                calories: 180.0,
                protein: 12.0,
                carbs: 20.0,
                fat: 5.0,
                fiber: None,
                sodium_mg: None,
                cholesterol_mg: None,
                extended_nutrition: BTreeMap::new(),
            },
            portions: vec![],
            chilean_seals: vec![],
            brand: None,
            category: None,
            typical_time: None,
        };

        // 1. Pre-commit rollback leaves zero orphaned food or receipt, and retry succeeds.
        let rollback_food_id = Uuid::new_v4();
        let err = db
            .sync
            .create_mcp_food_with_fault(user.id, rollback_food_id, "Rollback Food", &details, true)
            .await;
        assert!(matches!(err, Err(AppError::Internal(_))));
        let (food_count, receipt_count): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM meal_templates WHERE id = $1), \
                    (SELECT count(*) FROM mcp_mutation_receipts WHERE operation_id = $1)",
        )
        .bind(rollback_food_id)
        .fetch_one(&db.sync.pool)
        .await
        .unwrap();
        assert_eq!((food_count, receipt_count), (0, 0));

        let CreatePersonalFoodOutcome::Created(food) = db
            .sync
            .create_mcp_food(user.id, rollback_food_id, "Rollback Food", &details)
            .await
            .unwrap()
        else {
            panic!("expected created food after rollback retry");
        };
        assert_eq!(food.id, rollback_food_id);

        // 2. Pre-commit rollback on log_food leaves zero orphaned log or receipt, and retry succeeds.
        let rollback_log_id = Uuid::new_v4();
        let explicit = LogFoodTimeIntent::Explicit {
            date: "2026-08-10".into(),
            time: "14:30".into(),
        };
        let err = db
            .sync
            .create_mcp_consumption_with_hooks(
                user.id,
                rollback_log_id,
                rollback_food_id,
                75.0,
                None,
                &explicit,
                None,
                true,
            )
            .await;
        assert!(matches!(err, Err(AppError::Internal(_))));
        let (log_count, receipt_count): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM meal_logs WHERE id = $1), \
                    (SELECT count(*) FROM mcp_mutation_receipts WHERE operation_id = $1)",
        )
        .bind(rollback_log_id)
        .fetch_one(&db.sync.pool)
        .await
        .unwrap();
        assert_eq!((log_count, receipt_count), (0, 0));

        let (log, created) = db
            .sync
            .create_mcp_consumption(
                user.id,
                rollback_log_id,
                rollback_food_id,
                75.0,
                None,
                &explicit,
            )
            .await
            .unwrap();
        assert!(created);
        assert_eq!(log.id, rollback_log_id);

        // 3. Concurrent identical create_mcp_food calls over independent connections converge.
        let concurrent_food_id = Uuid::new_v4();
        let (res_a, res_b) = tokio::join!(
            db.sync
                .create_mcp_food(user.id, concurrent_food_id, "Concurrent Food", &details),
            db.sync
                .create_mcp_food(user.id, concurrent_food_id, "Concurrent Food", &details),
        );
        match (res_a.unwrap(), res_b.unwrap()) {
            (
                CreatePersonalFoodOutcome::Created(food_a),
                CreatePersonalFoodOutcome::AlreadyCreated(food_b),
            )
            | (
                CreatePersonalFoodOutcome::AlreadyCreated(food_a),
                CreatePersonalFoodOutcome::Created(food_b),
            ) => {
                assert_eq!(food_a.id, food_b.id);
                assert_eq!(food_a.updated_at, food_b.updated_at);
            }
            other => panic!("expected one Created and one AlreadyCreated, got {other:?}"),
        }

        // 4. Concurrent competing-intent create_mcp_consumption calls: one commits, one conflicts.
        let competing_log_id = Uuid::new_v4();
        let (log_a, log_b) = tokio::join!(
            db.sync.create_mcp_consumption(
                user.id,
                competing_log_id,
                concurrent_food_id,
                100.0,
                None,
                &explicit,
            ),
            db.sync.create_mcp_consumption(
                user.id,
                competing_log_id,
                concurrent_food_id,
                200.0,
                None,
                &explicit,
            ),
        );
        match (log_a, log_b) {
            (Ok((winner, true)), Err(AppError::Conflict(_))) => {
                assert_eq!(winner.canonical_quantity, 100.0);
            }
            (Err(AppError::Conflict(_)), Ok((winner, true))) => {
                assert_eq!(winner.canonical_quantity, 200.0);
            }
            other => panic!("expected one winner and one conflict, got {other:?}"),
        }

        // 5. Account deletion cascades to mcp_mutation_receipts.
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user.id)
            .execute(&db.sync.pool)
            .await
            .unwrap();
        let remaining_receipts: i64 =
            sqlx::query_scalar("SELECT count(*) FROM mcp_mutation_receipts WHERE user_id = $1")
                .bind(user.id)
                .fetch_one(&db.sync.pool)
                .await
                .unwrap();
        assert_eq!(remaining_receipts, 0);

        cleanup_identity_test_database(&db, &schema).await;
    }

    #[tokio::test]
    async fn bal081_create_food_concurrency() {
        use crate::connectors::user::NewUser;
        use std::time::Duration;
        use tokio::sync::oneshot;

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let provision = |sub: &str, email: &str| {
            let db_user = db.user.clone();
            let sub = sub.to_owned();
            let email = email.to_owned();
            async move {
                db_user
                    .provision_identity(
                        "https://issuer.example.invalid",
                        &sub,
                        &NewUser {
                            email,
                            name: None,
                            given_name: None,
                            family_name: None,
                            picture: None,
                        },
                    )
                    .await
                    .unwrap()
            }
        };
        let user_a = provision("bal081-user-a", "bal081-a@example.invalid").await;
        let user_b = provision("bal081-user-b", "bal081-b@example.invalid").await;

        let base_details = |brand: Option<&str>, unit: CanonicalUnit| FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: unit,
            nutrition_per100: NutritionValues {
                calories: 120.0,
                protein: 10.0,
                carbs: 12.0,
                fat: 3.5,
                fiber: None,
                sodium_mg: Some(45.0),
                cholesterol_mg: None,
                extended_nutrition: BTreeMap::new(),
            },
            portions: vec![PortionDefinition {
                id: "pote".into(),
                name: "1 pote".into(),
                portion_quantity: 1.0,
                canonical_quantity: 125.0,
            }],
            chilean_seals: vec!["alto en azúcares".into()],
            brand: brand.map(str::to_owned),
            category: Some("lacteos".into()),
            typical_time: Some("08:30".into()),
        };

        // AC-3: Official and tombstoned rows with identical name/details do NOT block creation.
        let official_id = Uuid::new_v4();
        let tombstoned_id = Uuid::new_v4();
        let initial_details = base_details(Some("  Lácteos Ñuble  "), CanonicalUnit::G);
        let initial_json = serde_json::to_value(&initial_details).unwrap();
        sqlx::query(
            "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at) \
             VALUES ($1, NULL, TRUE, 'Yogurt Griego', $2, 1000, NULL), \
                    ($3, $4, FALSE, 'Yogurt Griego', $2, 1000, 1001)",
        )
        .bind(official_id)
        .bind(&initial_json)
        .bind(tombstoned_id)
        .bind(user_a.id)
        .execute(&db.sync.pool)
        .await
        .unwrap();

        // AC-3: Deterministic two-connection contention on the same (user_id, lower(btrim(name)))
        // advisory lock yields one Created winner and one Duplicate pointing to the winner.
        let op_race_a = Uuid::new_v4();
        let op_race_b = Uuid::new_v4();
        let (lock_acquired_tx, lock_acquired_rx) = oneshot::channel::<()>();
        let (release_lock_tx, release_lock_rx) = oneshot::channel::<()>();

        let sync_a = db.sync.clone();
        let details_a = initial_details.clone();
        let task_a = tokio::spawn(async move {
            sync_a
                .create_mcp_food_with_hooks(
                    user_a.id,
                    op_race_a,
                    "  Yogurt Griego  ",
                    &details_a,
                    None,
                    Some(Box::pin(async move {
                        let _ = lock_acquired_tx.send(());
                        let _ = tokio::time::timeout(Duration::from_secs(5), release_lock_rx).await;
                    })),
                    false,
                )
                .await
        });

        tokio::time::timeout(Duration::from_secs(5), lock_acquired_rx)
            .await
            .expect("task A should acquire advisory lock")
            .unwrap();

        let sync_b = db.sync.clone();
        let mut details_b = base_details(Some("lácteos ñuble"), CanonicalUnit::G);
        details_b.portions.clear();
        details_b.chilean_seals.clear();
        details_b.category = Some("otro".into());
        details_b.typical_time = None;
        let task_b = tokio::spawn(async move {
            sync_b
                .create_mcp_food(user_a.id, op_race_b, "yogurt griego", &details_b)
                .await
        });

        // Prove task B is genuinely waiting on PostgreSQL's advisory lock.
        let mut saw_waiting_lock = false;
        for _ in 0..100 {
            let waiting: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
            )
            .fetch_one(&db.sync.pool)
            .await
            .unwrap();
            if waiting >= 1 {
                saw_waiting_lock = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            saw_waiting_lock,
            "expected second connection to block on personal_food_create advisory lock"
        );

        let _ = release_lock_tx.send(());
        let outcome_a = task_a.await.unwrap().unwrap();
        let outcome_b = task_b.await.unwrap().unwrap();
        let CreatePersonalFoodOutcome::Created(winner) = outcome_a else {
            panic!("expected task A to win creation, got {outcome_a:?}");
        };
        assert_eq!(winner.id, op_race_a);
        let CreatePersonalFoodOutcome::Duplicate(dup) = outcome_b else {
            panic!("expected task B to see duplicate, got {outcome_b:?}");
        };
        assert!(!dup.has_more_candidates);
        assert_eq!(dup.candidates.len(), 1);
        assert_eq!(dup.candidates[0].food_id, winner.id);
        assert_eq!(dup.candidates[0].brand.as_deref(), Some("Lácteos Ñuble"));
        assert_eq!(dup.candidates[0].portions.len(), 1);

        // Losing operationId must not exist in meal_templates or mcp_mutation_receipts.
        let (loser_foods, loser_receipts): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM meal_templates WHERE id = $1), \
                    (SELECT count(*) FROM mcp_mutation_receipts WHERE operation_id = $1)",
        )
        .bind(op_race_b)
        .fetch_one(&db.sync.pool)
        .await
        .unwrap();
        assert_eq!((loser_foods, loser_receipts), (0, 0));

        // AC-3: Separate owner receives independent Created for identical food.
        let user_b_food = Uuid::new_v4();
        let outcome_user_b = db
            .sync
            .create_mcp_food(user_b.id, user_b_food, "Yogurt Griego", &initial_details)
            .await
            .unwrap();
        assert!(matches!(
            outcome_user_b,
            CreatePersonalFoodOutcome::Created(ref food) if food.id == user_b_food
        ));

        // AC-1: Exact identity normalization & distinct variant preservation.
        // -0.0 vs 0.0 and metadata-only differences match as Duplicate.
        let mut neg_zero_details = initial_details.clone();
        neg_zero_details.nutrition_per100.calories = 120.0;
        neg_zero_details.brand = Some("LÁCTEOS ÑUBLE".into());
        neg_zero_details.portions.clear();
        let dup_case = db
            .sync
            .create_mcp_food(
                user_a.id,
                Uuid::new_v4(),
                "YOGURT GRIEGO",
                &neg_zero_details,
            )
            .await
            .unwrap();
        assert!(matches!(dup_case, CreatePersonalFoodOutcome::Duplicate(_)));

        // Distinct variants MUST succeed:
        // 1) Different brand, 2) Missing brand vs branded, 3) Different unit (ml vs g),
        // 4) Optional fiber None vs Some(0.0), 5) Extended nutrition absent vs 0.0,
        // 6) Accent difference, 7) Substring difference.
        let mut diff_brand = initial_details.clone();
        diff_brand.brand = Some("Otra Marca".into());
        let mut no_brand = initial_details.clone();
        no_brand.brand = None;
        let diff_unit = base_details(Some("Lácteos Ñuble"), CanonicalUnit::Ml);
        let mut fiber_zero = initial_details.clone();
        fiber_zero.nutrition_per100.fiber = Some(0.0);
        let mut extended_zero = initial_details.clone();
        extended_zero
            .nutrition_per100
            .extended_nutrition
            .insert("ironMg".into(), 0.0);

        for (label, name, variant) in [
            ("diff_brand", "Yogurt Griego", diff_brand),
            ("no_brand", "Yogurt Griego", no_brand),
            ("diff_unit", "Yogurt Griego", diff_unit),
            ("fiber_zero", "Yogurt Griego", fiber_zero),
            ("extended_zero", "Yogurt Griego", extended_zero),
            ("accent", "Yogúrt Griego", initial_details.clone()),
            (
                "substring",
                "Yogurt Griego Natural",
                initial_details.clone(),
            ),
        ] {
            let op_id = Uuid::new_v4();
            let outcome = db
                .sync
                .create_mcp_food(user_a.id, op_id, name, &variant)
                .await
                .unwrap();
            assert!(
                matches!(outcome, CreatePersonalFoodOutcome::Created(ref f) if f.id == op_id),
                "variant {label} should create cleanly, got {outcome:?}"
            );
        }

        // Blank brand ("   ") matches None brand as Duplicate.
        let mut blank_brand = initial_details.clone();
        blank_brand.brand = Some("   ".into());
        let blank_dup = db
            .sync
            .create_mcp_food(user_a.id, Uuid::new_v4(), "Yogurt Griego", &blank_brand)
            .await
            .unwrap();
        assert!(matches!(blank_dup, CreatePersonalFoodOutcome::Duplicate(_)));

        // AC-4: BAL-078 replay & operationId collision precedence even when an active same-name
        // duplicate row exists.
        let replay = db
            .sync
            .create_mcp_food(user_a.id, op_race_a, "Yogurt Griego", &initial_details)
            .await
            .unwrap();
        assert!(matches!(
            replay,
            CreatePersonalFoodOutcome::AlreadyCreated(ref f) if f.id == op_race_a
        ));

        let mut changed = initial_details.clone();
        changed.nutrition_per100.calories = 150.0;
        let changed_replay = db
            .sync
            .create_mcp_food(user_a.id, op_race_a, "Yogurt Griego", &changed)
            .await;
        assert!(matches!(changed_replay, Err(AppError::Conflict(_))));

        // Collisions against foreign, official, deleted, and legacy (no-receipt) IDs return
        // generic AppError::Conflict (never Duplicate).
        let legacy_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at) \
             VALUES ($1, $2, FALSE, 'Otro Alimento Legacy', $3, 1000, NULL)",
        )
        .bind(legacy_id)
        .bind(user_a.id)
        .bind(&initial_json)
        .execute(&db.sync.pool)
        .await
        .unwrap();
        for (label, colliding_id) in [
            ("foreign", user_b_food),
            ("official", official_id),
            ("deleted", tombstoned_id),
            ("legacy", legacy_id),
        ] {
            let err = db
                .sync
                .create_mcp_food(user_a.id, colliding_id, "Yogurt Griego", &initial_details)
                .await;
            assert!(
                matches!(err, Err(AppError::Conflict(_))),
                "collision {label} must return generic Conflict, got {err:?}"
            );
        }

        // AC-5: Legacy multi-match ambiguity (4 rows -> top 3 UUID-ascending, has_more_candidates=true;
        // 2 rows -> 2 items, has_more_candidates=false), preserving existing rows untouched.
        let multi_details = base_details(Some("LegacyBrand"), CanonicalUnit::G);
        let multi_json = serde_json::to_value(&multi_details).unwrap();
        let mut legacy_ids = [
            Uuid::parse_str("00000000-0000-4000-8000-000000000004").unwrap(),
            Uuid::parse_str("00000000-0000-4000-8000-000000000002").unwrap(),
            Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap(),
            Uuid::parse_str("00000000-0000-4000-8000-000000000003").unwrap(),
        ];
        for id in legacy_ids {
            sqlx::query(
                "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at) \
                 VALUES ($1, $2, FALSE, 'Pan Legacy Multi', $3, 1000, NULL)",
            )
            .bind(id)
            .bind(user_a.id)
            .bind(&multi_json)
            .execute(&db.sync.pool)
            .await
            .unwrap();
        }
        legacy_ids.sort();
        let multi_op = Uuid::new_v4();
        let CreatePersonalFoodOutcome::Duplicate(multi_dup) = db
            .sync
            .create_mcp_food(user_a.id, multi_op, "pan legacy multi", &multi_details)
            .await
            .unwrap()
        else {
            panic!("expected multi-match Duplicate");
        };
        assert!(multi_dup.has_more_candidates);
        assert_eq!(multi_dup.candidates.len(), 3);
        let returned_ids: Vec<Uuid> = multi_dup.candidates.iter().map(|c| c.food_id).collect();
        assert_eq!(returned_ids, legacy_ids[..3]);

        // All 4 legacy rows remain untouched and multi_op was not inserted.
        let multi_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM meal_templates WHERE user_id = $1 AND name = 'Pan Legacy Multi' AND deleted_at IS NULL",
        )
        .bind(user_a.id)
        .fetch_one(&db.sync.pool)
        .await
        .unwrap();
        assert_eq!(multi_count, 4);

        // AC-5: Malformed in-scope same-name row fails closed with AppError::Internal and no insert.
        let malformed_id = Uuid::new_v4();
        let malformed_op = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at) \
             VALUES ($1, $2, FALSE, 'Corrupt Food', $3, 1000, NULL)",
        )
        .bind(malformed_id)
        .bind(user_a.id)
        .bind(serde_json::json!({
            "schemaVersion": 999,
            "canonicalUnit": "g",
            "nutritionPer100": { "calories": -10.0, "protein": 1.0, "carbs": 1.0, "fat": 1.0 },
            "portions": [],
            "chileanSeals": []
        }))
        .execute(&db.sync.pool)
        .await
        .unwrap();
        let malformed_err = db
            .sync
            .create_mcp_food(user_a.id, malformed_op, "corrupt food", &initial_details)
            .await;
        assert!(
            matches!(malformed_err, Err(AppError::Internal(_))),
            "expected AppError::Internal for malformed stored row, got {malformed_err:?}"
        );
        let malformed_inserted: i64 =
            sqlx::query_scalar("SELECT count(*) FROM meal_templates WHERE id = $1")
                .bind(malformed_op)
                .fetch_one(&db.sync.pool)
                .await
                .unwrap();
        assert_eq!(malformed_inserted, 0);

        cleanup_identity_test_database(&db, &schema).await;
    }

    #[tokio::test]
    async fn update_and_soft_delete_personal_food_locking_and_concurrency_postgres() {
        use crate::connectors::user::NewUser;
        use std::time::Duration;
        use tokio::sync::oneshot;

        let Some((db, schema)) = isolated_identity_test_database().await else {
            return;
        };
        let user_a = db
            .user
            .provision_identity(
                "https://issuer.example.invalid",
                "bal103-sync-user-a",
                &NewUser {
                    email: "sync-uf-a@test.invalid".into(),
                    name: None,
                    given_name: None,
                    family_name: None,
                    picture: None,
                },
            )
            .await
            .unwrap();

        let details = FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: NutritionValues {
                calories: 200.0,
                protein: 10.0,
                carbs: 20.0,
                fat: 5.0,
                fiber: Some(3.0),
                sodium_mg: None,
                cholesterol_mg: None,
                extended_nutrition: Default::default(),
            },
            portions: vec![],
            chilean_seals: vec![],
            brand: None,
            category: None,
            typical_time: None,
        };

        let existing_id = Uuid::new_v4();
        let CreatePersonalFoodOutcome::Created(created) = db
            .sync
            .create_mcp_food(user_a.id, existing_id, "Original Name", &details)
            .await
            .unwrap()
        else {
            panic!("expected Created");
        };

        // Case-only rename on the same row succeeds.
        let case_renamed = db
            .sync
            .update_personal_food(
                user_a.id,
                existing_id,
                &PersonalFoodPatch {
                    name: Some("original name".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(case_renamed.name, "original name");
        assert!(case_renamed.updated_at > created.updated_at);

        // Deterministic two-connection contention: update_personal_food renaming to "Shared Name"
        // holds the per-user advisory lock while create_mcp_food tries to create "Shared Name".
        let (lock_acquired_tx, lock_acquired_rx) = oneshot::channel::<()>();
        let (release_lock_tx, release_lock_rx) = oneshot::channel::<()>();

        let sync_a = db.sync.clone();
        let rename_task = tokio::spawn(async move {
            sync_a
                .update_personal_food_with_hooks(
                    user_a.id,
                    existing_id,
                    &PersonalFoodPatch {
                        name: Some("Shared Name".into()),
                        ..Default::default()
                    },
                    Some(Box::pin(async move {
                        let _ = lock_acquired_tx.send(());
                        let _ = tokio::time::timeout(Duration::from_secs(5), release_lock_rx).await;
                    })),
                )
                .await
        });

        tokio::time::timeout(Duration::from_secs(5), lock_acquired_rx)
            .await
            .expect("rename task should acquire advisory lock")
            .unwrap();

        let sync_b = db.sync.clone();
        let details_b = details.clone();
        let create_op_id = Uuid::new_v4();
        let create_task = tokio::spawn(async move {
            sync_b
                .create_mcp_food(user_a.id, create_op_id, "  shared name  ", &details_b)
                .await
        });

        let mut saw_waiting_lock = false;
        for _ in 0..100 {
            let waiting: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
            )
            .fetch_one(&db.sync.pool)
            .await
            .unwrap();
            if waiting >= 1 {
                saw_waiting_lock = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            saw_waiting_lock,
            "expected create_mcp_food to block on advisory lock held by update_personal_food"
        );

        let _ = release_lock_tx.send(());
        let renamed = rename_task.await.unwrap().unwrap();
        assert_eq!(renamed.name, "Shared Name");
        let create_outcome = create_task.await.unwrap().unwrap();
        assert!(
            matches!(create_outcome, CreatePersonalFoodOutcome::Duplicate(_)),
            "expected concurrent create_mcp_food to see Duplicate after rename committed, got {create_outcome:?}"
        );

        // Monotonic updated_at even when stored updated_at is in the far future.
        let future_ts = i64::MAX / 4;
        sqlx::query("UPDATE meal_templates SET updated_at = $1 WHERE id = $2")
            .bind(future_ts)
            .bind(existing_id)
            .execute(&db.sync.pool)
            .await
            .unwrap();
        let updated_future = db
            .sync
            .update_personal_food(
                user_a.id,
                existing_id,
                &PersonalFoodPatch {
                    calories: Some(250.0),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(updated_future.updated_at, future_ts + 1);

        let (deleted_ts, already_deleted) = db
            .sync
            .soft_delete_personal_food(user_a.id, existing_id)
            .await
            .unwrap();
        assert!(!already_deleted);
        assert_eq!(deleted_ts, future_ts + 2);

        // soft_delete_personal_food succeeds even when stored details JSON is malformed.
        let malformed_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO meal_templates (id, user_id, is_official, name, details, updated_at, deleted_at) \
             VALUES ($1, $2, FALSE, 'Broken JSON Food', $3, 5000, NULL)",
        )
        .bind(malformed_id)
        .bind(user_a.id)
        .bind(serde_json::json!({ "broken": true }))
        .execute(&db.sync.pool)
        .await
        .unwrap();
        let (broken_ts, broken_already) = db
            .sync
            .soft_delete_personal_food(user_a.id, malformed_id)
            .await
            .unwrap();
        assert!(!broken_already);
        assert!(broken_ts > 5000);
        let (broken_ts_2, broken_already_2) = db
            .sync
            .soft_delete_personal_food(user_a.id, malformed_id)
            .await
            .unwrap();
        assert!(broken_already_2);
        assert_eq!(broken_ts_2, broken_ts);

        cleanup_identity_test_database(&db, &schema).await;
    }
}
