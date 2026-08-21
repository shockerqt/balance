from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TYPES = ROOT / 'apps/mobile/src/services/sync/types.ts'
ADAPTERS = ROOT / 'apps/mobile/src/services/sync/adapters.ts'
PORTIONS = ROOT / 'apps/mobile/src/lib/food-portions.ts'
IMPORT = ROOT / 'apps/mobile/src/services/import/macro-factor.ts'
STORE = ROOT / 'apps/mobile/src/hooks/use-meal-store.tsx'


def sub(text, pattern, new, label):
    out, n = re.subn(pattern, new, text, count=1, flags=re.S)
    if n != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {n}')
    return out

# ---- canonical sync document types ----
text = TYPES.read_text()
text = text.replace("export type MealUnit = 'g' | 'ml' | 'unit' | 'portion' | 'cup';", "export type CanonicalUnit = 'g' | 'ml';")
text = sub(text, r'export interface MealTemplateDetails \{.*?\n\}\n\nexport interface MealTemplateDoc', '''export interface PortionDefinition {
  id: string;
  name: string;
  portionQuantity: number;
  canonicalQuantity: number;
}

export interface MealTemplateDetails {
  schemaVersion: 2;
  canonicalUnit: CanonicalUnit;
  nutritionPer100: Nutrition;
  portions: PortionDefinition[];
  chileanSeals?: string[];
  category?: string | null;
  typicalTime?: string | null;
}

export interface MealTemplateDoc''', 'mobile template details')
text = text.replace('export interface NutritionSnapshot extends MealTemplateDetails {}', '''export interface NutritionSnapshot {
  schemaVersion: 2;
  canonicalUnit: CanonicalUnit;
  nutritionPer100: Nutrition;
}

export interface PortionSnapshot {
  portionId?: string;
  name: string;
  portionQuantity: number;
  canonicalQuantity: number;
}

export interface MealLogEntry {
  enteredQuantity: number;
  portionSnapshot?: PortionSnapshot | null;
}''')
text = sub(text, r'export interface MealLogDoc \{.*?\n\}', '''export interface MealLogDoc {
  id: string;
  templateId: string | null;
  nameSnapshot: string;
  nutritionSnapshot: NutritionSnapshot;
  provenance?: ImportProvenance | null;
  canonicalQuantity: number;
  entry: MealLogEntry;
  consumedAt: number;
  updatedAt: number;
  _deleted: boolean;
}''', 'mobile log doc')
text = sub(text, r'export function isMealUnit\(value: unknown\): value is MealUnit \{.*?\n\}', '''export function isCanonicalUnit(value: unknown): value is CanonicalUnit {
  return value === 'g' || value === 'ml';
}''', 'canonical unit validator')
text = sub(text, r'export function isMealTemplateDetails\(value: unknown\): value is MealTemplateDetails \{.*?\n\}', '''function isPortionDefinition(value: unknown): value is PortionDefinition {
  if (!value || typeof value !== 'object') return false;
  const portion = value as Record<string, unknown>;
  return (
    typeof portion.id === 'string' && portion.id.trim().length > 0 && portion.id.length <= 80 &&
    typeof portion.name === 'string' && portion.name.trim().length > 0 && portion.name.length <= 120 &&
    typeof portion.portionQuantity === 'number' && Number.isFinite(portion.portionQuantity) && portion.portionQuantity > 0 &&
    typeof portion.canonicalQuantity === 'number' && Number.isFinite(portion.canonicalQuantity) && portion.canonicalQuantity > 0
  );
}

export function isMealTemplateDetails(value: unknown): value is MealTemplateDetails {
  if (!value || typeof value !== 'object') return false;
  const details = value as Record<string, unknown>;
  if (!Array.isArray(details.portions) || !details.portions.every(isPortionDefinition)) return false;
  const ids = new Set(details.portions.map((portion) => (portion as PortionDefinition).id));
  return (
    details.schemaVersion === 2 &&
    isCanonicalUnit(details.canonicalUnit) &&
    isNutrition(details.nutritionPer100) &&
    ids.size === details.portions.length &&
    (details.typicalTime === undefined || details.typicalTime === null || /^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(details.typicalTime)))
  );
}''', 'template validator')
text = sub(text, r'export function isMealLogDoc\(value: unknown\): value is MealLogDoc \{.*?\n\}', '''function isNutritionSnapshot(value: unknown): value is NutritionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.schemaVersion === 2 && isCanonicalUnit(snapshot.canonicalUnit) && isNutrition(snapshot.nutritionPer100);
}

function isMealLogEntry(value: unknown, canonicalQuantity: number): value is MealLogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.enteredQuantity !== 'number' || !Number.isFinite(entry.enteredQuantity) || entry.enteredQuantity <= 0) return false;
  let expected = entry.enteredQuantity;
  if (entry.portionSnapshot !== undefined && entry.portionSnapshot !== null) {
    if (!entry.portionSnapshot || typeof entry.portionSnapshot !== 'object') return false;
    const portion = entry.portionSnapshot as Record<string, unknown>;
    if (
      (portion.portionId !== undefined && (typeof portion.portionId !== 'string' || portion.portionId.length > 80)) ||
      typeof portion.name !== 'string' || !portion.name.trim() || portion.name.length > 120 ||
      typeof portion.portionQuantity !== 'number' || !Number.isFinite(portion.portionQuantity) || portion.portionQuantity <= 0 ||
      typeof portion.canonicalQuantity !== 'number' || !Number.isFinite(portion.canonicalQuantity) || portion.canonicalQuantity <= 0
    ) return false;
    expected = entry.enteredQuantity / portion.portionQuantity * portion.canonicalQuantity;
  }
  const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-8);
  return Math.abs(expected - canonicalQuantity) <= tolerance;
}

export function isMealLogDoc(value: unknown): value is MealLogDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.id === 'string' &&
    (doc.templateId === null || typeof doc.templateId === 'string') &&
    typeof doc.nameSnapshot === 'string' &&
    isNutritionSnapshot(doc.nutritionSnapshot) &&
    typeof doc.canonicalQuantity === 'number' &&
    Number.isFinite(doc.canonicalQuantity) &&
    doc.canonicalQuantity > 0 &&
    isMealLogEntry(doc.entry, doc.canonicalQuantity) &&
    typeof doc.consumedAt === 'number' && Number.isFinite(doc.consumedAt) &&
    typeof doc.updatedAt === 'number' &&
    typeof doc._deleted === 'boolean' &&
    isImportProvenance(doc.provenance)
  );
}''', 'log validator')
TYPES.write_text(text)

# ---- legacy UI adapters: expose canonical 100g/100ml until named-portion UI exists ----
ADAPTERS.write_text('''import type {\n  CanonicalUnit,\n  MealLogDoc,\n  MealTemplateDetails,\n  MealTemplateDoc,\n  Nutrition,\n  NutritionSnapshot,\n} from './types';\nimport { parseFoodPortion } from '@/lib/food-portions';\n\nexport interface LibraryFoodAdapter {\n  id: string; name: string; portion: string; calories: number; protein: number; carbs: number; fat: number;\n  fiber?: number; sodiumMg?: number; cholesterolMg?: number; typicalTime: string; chileanSeals?: string[];\n  category?: string; isOfficial?: boolean; updatedAt?: number;\n}\n\nexport interface LoggedFoodAdapter {\n  id: string; templateId?: string; name: string; portion: string; calories: number; protein: number; carbs: number; fat: number;\n  fiber?: number; time: string; chileanSeals?: string[];\n}\n\nexport const formatPortion = (amount: number, unit: CanonicalUnit) => `${amount}${unit}`;\n\nexport function templateToLibraryFood(doc: MealTemplateDoc, frequency = 0): LibraryFoodAdapter & { frequency: number } {\n  const n = doc.details.nutritionPer100;\n  return {\n    id: doc.id, name: doc.name, portion: formatPortion(100, doc.details.canonicalUnit),\n    calories: n.calories, protein: n.protein, carbs: n.carbs, fat: n.fat,\n    fiber: n.fiber == null ? undefined : n.fiber, sodiumMg: n.sodiumMg == null ? undefined : n.sodiumMg,\n    cholesterolMg: n.cholesterolMg == null ? undefined : n.cholesterolMg,\n    typicalTime: doc.details.typicalTime == null ? '12:00' : doc.details.typicalTime, frequency,\n    chileanSeals: doc.details.chileanSeals, category: doc.details.category == null ? undefined : doc.details.category,\n    isOfficial: doc.isOfficial, updatedAt: doc.updatedAt,\n  };\n}\n\nfunction scaleNutrition(n: Nutrition, factor: number) {\n  return {\n    calories: n.calories * factor, protein: n.protein * factor, carbs: n.carbs * factor, fat: n.fat * factor,\n    ...(n.fiber == null ? {} : { fiber: n.fiber * factor }),\n    ...(n.sodiumMg == null ? {} : { sodiumMg: n.sodiumMg * factor }),\n    ...(n.cholesterolMg == null ? {} : { cholesterolMg: n.cholesterolMg * factor }),\n  };\n}\n\nfunction timeInChile(epochMs: number): string {\n  try {\n    return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(epochMs));\n  } catch {\n    const date = new Date(epochMs);\n    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;\n  }\n}\n\nexport function logToLoggedFood(doc: MealLogDoc): LoggedFoodAdapter {\n  const nutrition = scaleNutrition(doc.nutritionSnapshot.nutritionPer100, doc.canonicalQuantity / 100);\n  const portion = doc.entry.portionSnapshot\n    ? `${doc.entry.enteredQuantity} ${doc.entry.portionSnapshot.name}`\n    : formatPortion(doc.canonicalQuantity, doc.nutritionSnapshot.canonicalUnit);\n  return { id: doc.id, templateId: doc.templateId ?? undefined, name: doc.nameSnapshot, portion, ...nutrition, time: timeInChile(doc.consumedAt) };\n}\n\nfunction nutritionPer100(nutrition: Nutrition, amount: number): Nutrition {\n  const factor = 100 / amount;\n  const extendedNutrition = nutrition.extendedNutrition\n    ? Object.fromEntries(Object.entries(nutrition.extendedNutrition).map(([key, value]) => [key, value == null ? value : value * factor]))\n    : undefined;\n  return {\n    calories: Math.max(0, nutrition.calories) * factor, protein: Math.max(0, nutrition.protein) * factor,\n    carbs: Math.max(0, nutrition.carbs) * factor, fat: Math.max(0, nutrition.fat) * factor,\n    ...(nutrition.fiber == null ? {} : { fiber: Math.max(0, nutrition.fiber) * factor }),\n    ...(nutrition.sodiumMg == null ? {} : { sodiumMg: Math.max(0, nutrition.sodiumMg) * factor }),\n    ...(nutrition.cholesterolMg == null ? {} : { cholesterolMg: Math.max(0, nutrition.cholesterolMg) * factor }),\n    ...(extendedNutrition ? { extendedNutrition } : {}),\n  };\n}\n\nexport function detailsFromLibraryFood(food: Omit<LibraryFoodAdapter, 'id'>): MealTemplateDetails {\n  const portion = parseFoodPortion(food.portion);\n  if (!portion) throw new Error('INVALID_FOOD_PORTION');\n  const nutrition: Nutrition = { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat,\n    ...(food.fiber === undefined ? {} : { fiber: food.fiber }), ...(food.sodiumMg === undefined ? {} : { sodiumMg: food.sodiumMg }),\n    ...(food.cholesterolMg === undefined ? {} : { cholesterolMg: food.cholesterolMg }) };\n  return { schemaVersion: 2, canonicalUnit: portion.unit, nutritionPer100: nutritionPer100(nutrition, portion.canonicalQuantity), portions: [],\n    ...(food.chileanSeals?.length ? { chileanSeals: food.chileanSeals } : {}), ...(food.category ? { category: food.category } : {}),\n    ...(food.typicalTime ? { typicalTime: food.typicalTime } : {}) };\n}\n\nexport function snapshotFromDisplayFood(food: { calories: number; protein: number; carbs: number; fat: number; fiber?: number; portion: string }): NutritionSnapshot {\n  const portion = parseFoodPortion(food.portion);\n  if (!portion) throw new Error('INVALID_FOOD_PORTION');\n  return { schemaVersion: 2, canonicalUnit: portion.unit, nutritionPer100: nutritionPer100({\n    calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, ...(food.fiber === undefined ? {} : { fiber: food.fiber })\n  }, portion.canonicalQuantity) };\n}\n''')

PORTIONS.write_text('''import type { CanonicalUnit } from '@/services/sync/types';\n\nconst PORTION_PATTERN = /^([0-9]+(?:[.,][0-9]+)?)\\s*(g|ml)$/i;\n\nexport interface ParsedFoodPortion {\n  canonicalQuantity: number;\n  unit: CanonicalUnit;\n  normalized: string;\n}\n\nexport function parseFoodPortion(value: string): ParsedFoodPortion | null {\n  const match = value.trim().match(PORTION_PATTERN);\n  if (!match) return null;\n  const canonicalQuantity = Number(match[1].replace(',', '.'));\n  if (!Number.isFinite(canonicalQuantity) || canonicalQuantity <= 0) return null;\n  const unit = match[2].toLowerCase() as CanonicalUnit;\n  return { canonicalQuantity, unit, normalized: `${canonicalQuantity}${unit}` };\n}\n''')

# ---- MacroFactor: source nutrition is total for servingQuantity; weight column gives g per unit ----
text = IMPORT.read_text()
text = text.replace('  MealUnit,\n', '')
text = sub(text, r'function mealUnit\(label: string\): MealUnit \{.*?\n\}\n\nfunction scaleNutrition', 'function scaleNutrition', 'remove mealUnit')
text = sub(text, r'function detailsForRow\(row: MacroFactorRow, typicalTime: string\): MealTemplateDetails \{.*?\n\}\n\nfunction snapshotForRow\(row: MacroFactorRow\): NutritionSnapshot \{.*?\n\}', '''function canonicalWeight(row: MacroFactorRow): number {
  if (row.gramsPerUnit === null || row.gramsPerUnit <= 0) {
    throw new Error(`Fila ${row.rowIndex}: Serving Weight (g) es obligatorio para convertir a unidad canónica`);
  }
  return row.servingQuantity * row.gramsPerUnit;
}

function nutritionPer100ForRow(row: MacroFactorRow): Nutrition {
  return scaleNutrition(row.nutrition, canonicalWeight(row) / 100);
}

const canonicalServingLabel = (label: string) => /^(?:g|gram|grams)$/i.test(normalizeIdentity(label));

function portionForRow(row: MacroFactorRow) {
  if (canonicalServingLabel(row.servingLabel)) return [];
  return [{ id: 'macrofactor-serving', name: row.servingLabel, portionQuantity: 1, canonicalQuantity: row.gramsPerUnit! }];
}

function detailsForRow(row: MacroFactorRow, typicalTime: string): MealTemplateDetails {
  canonicalWeight(row);
  return {
    schemaVersion: 2,
    canonicalUnit: 'g',
    nutritionPer100: nutritionPer100ForRow(row),
    portions: portionForRow(row),
    typicalTime,
  };
}

function snapshotForRow(row: MacroFactorRow): NutritionSnapshot {
  canonicalWeight(row);
  return { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: nutritionPer100ForRow(row) };
}

function entryForRow(row: MacroFactorRow) {
  const canonicalQuantity = canonicalWeight(row);
  if (canonicalServingLabel(row.servingLabel)) return { canonicalQuantity, entry: { enteredQuantity: canonicalQuantity } };
  return {
    canonicalQuantity,
    entry: {
      enteredQuantity: row.servingQuantity,
      portionSnapshot: {
        portionId: 'macrofactor-serving',
        name: row.servingLabel,
        portionQuantity: 1,
        canonicalQuantity: row.gramsPerUnit!,
      },
    },
  };
}''', 'MacroFactor V2 details')
text = text.replace('      nutritionSnapshot: snapshotForRow(row),\n      quantity: row.servingQuantity,', '      nutritionSnapshot: snapshotForRow(row),\n      ...entryForRow(row),')
IMPORT.write_text(text)

# ---- meal store logs direct canonical quantities; named portion editing is intentionally not exposed yet ----
text = STORE.read_text()
text = text.replace('MealLogDoc, MealUnit, NutritionSnapshot, SyncDocument, isMealLogDoc', 'MealLogDoc, NutritionSnapshot, SyncDocument, isMealLogDoc')
text = sub(text, r'function normalizeUnit\(unit: string\): MealUnit \{.*?\n\}\n\n', '', 'remove meal unit normalization')
old = '''  const quantity = parsed.quantity > 0 ? parsed.quantity : 1;
  const unit = normalizeUnit(parsed.unit);
  const normalizedPortion = `${quantity}${unit}`;
  const snapshot: NutritionSnapshot = snapshotFromDisplayFood({ ...food, portion: normalizedPortion });'''
new = '''  const quantity = parsed.quantity > 0 ? parsed.quantity : 1;
  const normalizedPortion = `${quantity}${parsed.unit}`;
  let snapshot: NutritionSnapshot;
  try {
    snapshot = snapshotFromDisplayFood({ ...food, portion: normalizedPortion });
  } catch {
    return null;
  }'''
if old not in text:
    raise RuntimeError('meal store docFromFood marker not found')
text = text.replace(old, new, 1)
text = text.replace('    nutritionSnapshot: { ...snapshot, baseAmount: quantity, unit },\n    quantity,', '    nutritionSnapshot: snapshot,\n    canonicalQuantity: quantity,\n    entry: { enteredQuantity: quantity },')
STORE.write_text(text)
