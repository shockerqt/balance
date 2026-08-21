from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
IMPORTS = ROOT / 'apps/server/src/connectors/imports.rs'
MCP = ROOT / 'apps/server/src/modules/mcp/mod.rs'


def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    return text.replace(old, new, 1)


def sub(text, pattern, new, label):
    text2, count = re.subn(pattern, new, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return text2

# ---- staged MacroFactor import server ----
text = IMPORTS.read_text()
text = text.replace('connectors::sync::{FoodDetails, NutritionSnapshot}', 'connectors::sync::{FoodDetails, MealLogEntry, NutritionSnapshot}')
text = once(text, '''    pub nutrition_snapshot: NutritionSnapshot,
    pub quantity: f64,
    pub consumed_at: i64,''', '''    pub nutrition_snapshot: NutritionSnapshot,
    pub canonical_quantity: f64,
    pub entry: MealLogEntry,
    pub consumed_at: i64,''', 'import log document')
text = once(text, '''    nutrition_snapshot: Value,
    quantity: f64,
    consumed_at: i64,''', '''    nutrition_snapshot: Value,
    canonical_quantity: f64,
    entry_snapshot: Value,
    consumed_at: i64,''', 'existing import log')
text = once(text, '''    if log.deleted
        || log.name_snapshot.trim().is_empty()
        || log.name_snapshot.chars().count() > 160
        || !log.quantity.is_finite()
        || log.quantity <= 0.0
        || log.consumed_at <= 0
    {
        return Err(AppError::BadRequest("Invalid imported meal log".into()));
    }
    Ok(())''', '''    if log.deleted
        || log.name_snapshot.trim().is_empty()
        || log.name_snapshot.chars().count() > 160
        || log.consumed_at <= 0
    {
        return Err(AppError::BadRequest("Invalid imported meal log".into()));
    }
    log.entry.validate(log.canonical_quantity)''', 'import log validation')
text = text.replace('nutrition_snapshot, quantity,\n               consumed_at', 'nutrition_snapshot, canonical_quantity, entry_snapshot,\n               consumed_at')
text = once(text, '''        let snapshot = serde_json::to_value(&log.nutrition_snapshot)
            .map_err(|error| AppError::Internal(error.to_string()))?;''', '''        let snapshot = serde_json::to_value(&log.nutrition_snapshot)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let entry_snapshot = serde_json::to_value(&log.entry)
            .map_err(|error| AppError::Internal(error.to_string()))?;''', 'import serialize entry')
text = text.replace('|| current.quantity != log.quantity', '|| current.canonical_quantity != log.canonical_quantity\n                || current.entry_snapshot != entry_snapshot')
text = text.replace('nutrition_snapshot = $5, quantity = $6, consumed_at = $7,\n                        updated_at = $8', 'nutrition_snapshot = $5, canonical_quantity = $6, entry_snapshot = $7, consumed_at = $8,\n                        updated_at = $9')
text = text.replace('.bind(snapshot)\n                .bind(log.quantity)\n                .bind(log.consumed_at)\n                .bind(now)', '.bind(snapshot)\n                .bind(log.canonical_quantity)\n                .bind(entry_snapshot.clone())\n                .bind(log.consumed_at)\n                .bind(now)')
text = text.replace('source_provider, external_id, quantity, consumed_at, updated_at, deleted_at)', 'source_provider, external_id, canonical_quantity, entry_snapshot, consumed_at, updated_at, deleted_at)')
text = text.replace('VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)', 'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)')
text = text.replace('.bind(&log.provenance.external_id)\n            .bind(log.quantity)\n            .bind(log.consumed_at)\n            .bind(now)', '.bind(&log.provenance.external_id)\n            .bind(log.canonical_quantity)\n            .bind(entry_snapshot)\n            .bind(log.consumed_at)\n            .bind(now)')

# Replace V1 fixture helper and log fixture in connector tests.
text = sub(text, r'    use crate::connectors::sync::\{FOOD_SCHEMA_VERSION, FoodUnit, NutritionValues\};.*?\n    fn details\(\) -> FoodDetails \{.*?\n    \}\n', '''    use crate::connectors::sync::{CanonicalUnit, FOOD_SCHEMA_VERSION, MealLogEntry, NutritionValues, PortionDefinition};
    use std::collections::BTreeMap;

    fn details() -> FoodDetails {
        FoodDetails {
            schema_version: FOOD_SCHEMA_VERSION,
            canonical_unit: CanonicalUnit::G,
            nutrition_per100: NutritionValues {
                calories: 200.0,
                protein: 20.0,
                carbs: 10.0,
                fat: 8.0,
                fiber: 2.0,
                sodium_mg: Some(50.0),
                cholesterol_mg: None,
                extended_nutrition: BTreeMap::from([("vitaminCMg".into(), 12.0)]),
            },
            portions: vec![PortionDefinition {
                id: "serving".into(),
                name: "serving".into(),
                portion_quantity: 1.0,
                canonical_quantity: 100.0,
            }],
            chilean_seals: vec![],
            category: None,
            typical_time: Some("08:00".into()),
        }
    }
''', 'import test details')
text = text.replace('quantity: 1.0,\n            consumed_at:', 'canonical_quantity: 100.0,\n            entry: MealLogEntry { entered_quantity: 1.0, portion_snapshot: Some((&template.details.portions[0]).into()) },\n            consumed_at:')
IMPORTS.write_text(text)

# ---- MCP boundary ----
text = MCP.read_text()
text = text.replace('Consumption, FOOD_SCHEMA_VERSION, FoodDetails, FoodUnit, NutritionValues, WeightLogRow,\n            WeightUpsertStatus,', 'CanonicalUnit, Consumption, FOOD_SCHEMA_VERSION, FoodDetails, NutritionValues, PortionDefinition,\n            WeightLogRow, WeightUpsertStatus,')

text = sub(text, r'#\[derive\(Debug, Deserialize\)\]\n#\[serde\(rename_all = "camelCase", deny_unknown_fields\)\]\nstruct CreateFoodArgs \{.*?\n\}\n\n#\[derive\(Debug, Deserialize\)\]\n#\[serde\(rename_all = "camelCase", deny_unknown_fields\)\]\nstruct LogFoodArgs \{.*?\n\}', '''#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortionInput {
    id: String,
    name: String,
    portion_quantity: f64,
    canonical_quantity: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateFoodArgs {
    operation_id: Uuid,
    name: String,
    canonical_unit: CanonicalUnit,
    calories: f64,
    protein: f64,
    carbs: f64,
    fat: f64,
    #[serde(default)]
    fiber: f64,
    sodium_mg: Option<f64>,
    cholesterol_mg: Option<f64>,
    #[serde(default)]
    portions: Vec<PortionInput>,
    #[serde(default)]
    chilean_seals: Vec<String>,
    category: Option<String>,
    typical_time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogFoodArgs {
    operation_id: Uuid,
    food_id: Uuid,
    quantity: f64,
    portion_id: Option<String>,
    date: Option<String>,
    time: Option<String>,
}''', 'MCP food args')

text = sub(text, r'            let details = FoodDetails \{.*?\n            \};\n            let \(food, created\)', '''            let details = FoodDetails {
                schema_version: FOOD_SCHEMA_VERSION,
                canonical_unit: args.canonical_unit,
                nutrition_per100: NutritionValues {
                    calories: args.calories,
                    protein: args.protein,
                    carbs: args.carbs,
                    fat: args.fat,
                    fiber: args.fiber,
                    sodium_mg: args.sodium_mg,
                    cholesterol_mg: args.cholesterol_mg,
                    extended_nutrition: Default::default(),
                },
                portions: args.portions.into_iter().map(|portion| PortionDefinition {
                    id: portion.id,
                    name: portion.name,
                    portion_quantity: portion.portion_quantity,
                    canonical_quantity: portion.canonical_quantity,
                }).collect(),
                chilean_seals: args.chilean_seals,
                category: args.category,
                typical_time: args.typical_time,
            };
            let (food, created)''', 'MCP create details')
text = once(text, '''                    args.quantity,
                    args.unit,
                    consumed_at,''', '''                    args.quantity,
                    args.portion_id.as_deref(),
                    consumed_at,''', 'MCP log call')
text = sub(text, r'fn consumption_output\(consumption: &Consumption\) -> Value \{.*?\n\}', '''fn consumption_output(consumption: &Consumption) -> Value {
    json!({
        "id": consumption.id,
        "foodId": consumption.template_id,
        "name": consumption.name,
        "canonicalQuantity": public_number(consumption.canonical_quantity),
        "canonicalUnit": consumption.snapshot.canonical_unit,
        "entry": consumption.entry,
        "consumedAt": consumption.consumed_at,
        "updatedAt": consumption.updated_at,
        "nutrition": nutrition_output(&consumption.scaled_nutrition())
    })
}''', 'MCP consumption output')

# Tool declaration: canonical quantity by default; optional named portion id.
text = text.replace('"description": "Crea un alimento personal solo después de confirmar una porción base y valores nutricionales completos. No estima ni completa datos faltantes."', '"description": "Crea un alimento personal con nutrición siempre expresada por 100 g o 100 ml. Las porciones nombradas son conversiones opcionales y explícitas."')
text = text.replace('"unit": unit_schema(),\n                    "date":', '"portionId": { "type": "string", "minLength": 1, "maxLength": 80 },\n                    "date":')
text = text.replace('"required": ["operationId", "foodId", "quantity", "unit"]', '"required": ["operationId", "foodId", "quantity"]')

text = sub(text, r'fn create_food_input_schema\(\) -> Value \{.*?\n\}\n\nfn foods_output_schema', '''fn portion_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": { "type": "string", "minLength": 1, "maxLength": 80 },
            "name": { "type": "string", "minLength": 1, "maxLength": 120 },
            "portionQuantity": positive_number_schema(),
            "canonicalQuantity": positive_number_schema()
        },
        "required": ["id", "name", "portionQuantity", "canonicalQuantity"],
        "additionalProperties": false
    })
}

fn entry_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "enteredQuantity": positive_number_schema(),
            "portionSnapshot": { "anyOf": [portion_schema(), { "type": "null" }] }
        },
        "required": ["enteredQuantity"],
        "additionalProperties": false
    })
}

fn create_food_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "operationId": uuid_schema(),
            "name": { "type": "string", "minLength": 1, "maxLength": 160 },
            "canonicalUnit": canonical_unit_schema(),
            "calories": non_negative_number_schema(),
            "protein": non_negative_number_schema(),
            "carbs": non_negative_number_schema(),
            "fat": non_negative_number_schema(),
            "fiber": non_negative_number_schema(),
            "sodiumMg": non_negative_number_schema(),
            "cholesterolMg": non_negative_number_schema(),
            "portions": { "type": "array", "items": portion_schema(), "maxItems": 50 },
            "chileanSeals": { "type": "array", "items": { "type": "string" }, "maxItems": 4 },
            "category": { "type": "string", "maxLength": 80 },
            "typicalTime": { "type": "string", "pattern": "^(?:[01]\\\\d|2[0-3]):[0-5]\\\\d$" }
        },
        "required": ["operationId", "name", "canonicalUnit", "calories", "protein", "carbs", "fat"],
        "additionalProperties": false
    })
}

fn foods_output_schema''', 'MCP create schema')

text = sub(text, r'fn food_schema\(\) -> Value \{.*?\n\}\n\nfn consumption_schema', '''fn food_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": uuid_schema(),
            "name": { "type": "string" },
            "isOfficial": { "type": "boolean" },
            "details": {
                "type": "object",
                "properties": {
                    "schemaVersion": { "type": "integer", "const": FOOD_SCHEMA_VERSION },
                    "canonicalUnit": canonical_unit_schema(),
                    "nutritionPer100": nutrition_schema(),
                    "portions": { "type": "array", "items": portion_schema() },
                    "chileanSeals": { "type": "array", "items": { "type": "string" } },
                    "category": { "type": "string" },
                    "typicalTime": { "type": "string" }
                },
                "required": ["schemaVersion", "canonicalUnit", "nutritionPer100", "portions", "chileanSeals"],
                "additionalProperties": false
            },
            "updatedAt": { "type": "integer" }
        },
        "required": ["id", "name", "isOfficial", "details", "updatedAt"],
        "additionalProperties": false
    })
}

fn consumption_schema''', 'MCP food schema')

text = sub(text, r'fn consumption_schema\(\) -> Value \{.*?\n\}\n\nfn log_mutation_output_schema', '''fn consumption_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": uuid_schema(),
            "foodId": { "type": ["string", "null"], "format": "uuid" },
            "name": { "type": "string" },
            "canonicalQuantity": positive_number_schema(),
            "canonicalUnit": canonical_unit_schema(),
            "entry": entry_schema(),
            "consumedAt": { "type": "integer" },
            "updatedAt": { "type": "integer" },
            "nutrition": nutrition_schema()
        },
        "required": ["id", "foodId", "name", "canonicalQuantity", "canonicalUnit", "entry", "consumedAt", "updatedAt", "nutrition"],
        "additionalProperties": false
    })
}

fn log_mutation_output_schema''', 'MCP consumption schema')

text = text.replace('fn unit_schema() -> Value {\n    json!({ "type": "string", "enum": ["g", "ml", "unit", "portion", "cup"] })\n}', 'fn canonical_unit_schema() -> Value {\n    json!({ "type": "string", "enum": ["g", "ml"] })\n}')
MCP.write_text(text)
