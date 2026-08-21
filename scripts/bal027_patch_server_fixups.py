from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYNC = ROOT / 'apps/server/src/connectors/sync.rs'
WS = ROOT / 'apps/server/src/modules/sync/ws.rs'

sync = SYNC.read_text()
if 'pub struct NutritionValues {' not in sync:
    marker = '''#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortionDefinition {'''
    if marker not in sync:
        raise RuntimeError('NutritionValues insertion marker not found')
    nutrition = '''#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NutritionValues {
    pub calories: f64,
    pub protein: f64,
    pub carbs: f64,
    pub fat: f64,
    #[serde(default)]
    pub fiber: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sodium_mg: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cholesterol_mg: Option<f64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extended_nutrition: BTreeMap<String, f64>,
}

'''
    sync = sync.replace(marker, nutrition + marker, 1)
SYNC.write_text(sync)

ws = WS.read_text()
old = '''    if !document.quantity.is_finite() || document.quantity <= 0.0 {
        return Err(AppError::BadRequest(
            "mealLogs.quantity must be a finite number greater than zero".into(),
        ));
    }
'''
new = '''    document.entry.validate(document.canonical_quantity)?;
'''
if old not in ws:
    raise RuntimeError('meal log quantity validator marker not found')
ws = ws.replace(old, new, 1)
WS.write_text(ws)
