from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TYPES = ROOT / 'apps/dashboard/src/types/meal-log.ts'
STATE = ROOT / 'apps/dashboard/src/features/food-log/domain/food-log-state.ts'
COMMAND = ROOT / 'apps/dashboard/src/features/food-log/commands/command.ts'
EXEC = ROOT / 'apps/dashboard/src/features/food-log/commands/execute-command.ts'
CONTROLLER = ROOT / 'apps/dashboard/src/features/food-log/hooks/use-food-log-controller.ts'
PANEL = ROOT / 'apps/dashboard/src/features/food-log/components/command-panel/command-panel.tsx'
FOODLOG = ROOT / 'apps/dashboard/src/features/food-log/components/food-log/food-log.tsx'
SAMPLE = ROOT / 'apps/dashboard/src/features/food-log/data/sample-data.ts'
TEST = ROOT / 'apps/dashboard/tests/execute-command.test.ts'


def sub(text, pattern, new, label):
    out, n = re.subn(pattern, new, text, count=1, flags=re.S)
    if n != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {n}')
    return out

# ---- public dashboard types ----
TYPES.write_text('''export type CanonicalUnit = 'g' | 'ml';\n\nexport interface Nutrition {\n  calories: number; protein: number; carbs: number; fat: number; fiber?: number | null; sodiumMg?: number | null;\n  cholesterolMg?: number | null; extendedNutrition?: Partial<Record<string, number>> | null;\n}\n\nexport interface ImportProvenance { provider: 'macrofactor'; externalId: string; }\n\nexport interface PortionDefinition { id: string; name: string; portionQuantity: number; canonicalQuantity: number; }\n\nexport interface MealTemplateDetails {\n  schemaVersion: 2; canonicalUnit: CanonicalUnit; nutritionPer100: Nutrition; portions: PortionDefinition[];\n  chileanSeals?: string[]; category?: string | null; typicalTime?: string | null;\n}\n\nexport interface MealTemplateDoc {\n  id: string; name: string; isOfficial: boolean; details: MealTemplateDetails; provenance?: ImportProvenance | null;\n  updatedAt: number; _deleted: boolean;\n}\n\nexport interface NutritionSnapshot { schemaVersion: 2; canonicalUnit: CanonicalUnit; nutritionPer100: Nutrition; }\nexport interface PortionSnapshot { portionId?: string; name: string; portionQuantity: number; canonicalQuantity: number; }\nexport interface MealLogEntry { enteredQuantity: number; portionSnapshot?: PortionSnapshot | null; }\n\nexport interface MealLogDoc {\n  id: string; templateId: string | null; nameSnapshot: string; nutritionSnapshot: NutritionSnapshot;\n  provenance?: ImportProvenance | null; canonicalQuantity: number; entry: MealLogEntry; consumedAt: number; updatedAt: number; _deleted: boolean;\n}\n''')

# ---- terminal state math and register ----
text = STATE.read_text()
text = text.replace('import type { MealLogDoc, MealTemplateDetails }', 'import type { MealLogDoc, NutritionSnapshot, MealLogEntry }')
text = text.replace('  nutritionSnapshot: MealTemplateDetails;\n  provenance?: MealLogDoc[\'provenance\'];\n  quantity: number;', '  nutritionSnapshot: NutritionSnapshot;\n  provenance?: MealLogDoc[\'provenance\'];\n  canonicalQuantity: number;\n  entry: MealLogEntry;')
text = text.replace('    quantity: document.quantity,', '    canonicalQuantity: document.canonicalQuantity,\n    entry: structuredClone(document.entry),')
text = sub(text, r'export function nutritionForDocument\(document: MealLogDoc\): DisplayNutrition \{.*?\n\}', '''export function nutritionForDocument(document: MealLogDoc): DisplayNutrition {
  const nutrition = document.nutritionSnapshot.nutritionPer100;
  const factor = document.canonicalQuantity / 100;
  return {
    calories: nutrition.calories * factor,
    protein: nutrition.protein * factor,
    carbs: nutrition.carbs * factor,
    fat: nutrition.fat * factor,
  };
}''', 'dashboard nutrition math')
text = sub(text, r'export function displayRow\(document: MealLogDoc\): DisplayFoodRow \{.*?\n\}', '''export function displayRow(document: MealLogDoc): DisplayFoodRow {
  const portion = document.entry.portionSnapshot;
  return {
    document,
    time: timeInChile(document.consumedAt),
    quantityLabel: portion
      ? `${formatNumber(document.entry.enteredQuantity)} ${portion.name}`
      : `${formatNumber(document.canonicalQuantity)} ${document.nutritionSnapshot.canonicalUnit}`,
    nutrition: nutritionForDocument(document),
  };
}''', 'dashboard display row')
STATE.write_text(text)

# ---- command contract only exposes direct canonical editing for now ----
text = COMMAND.read_text().replace("import type { MealTemplateDoc, MealUnit }", "import type { CanonicalUnit, MealTemplateDoc }")
text = text.replace("{ type: 'set-quantity'; quantity: number; unit: MealUnit }", "{ type: 'set-quantity'; quantity: number; unit: CanonicalUnit }")
COMMAND.write_text(text)

# ---- command executor ----
text = EXEC.read_text()
text = text.replace('    quantity: item.quantity,', '    canonicalQuantity: item.canonicalQuantity,\n    entry: structuredClone(item.entry),')
text = sub(text, r'function createMealLogFromTemplate\(.*?\n\}', '''function createMealLogFromTemplate(
  template: MealTemplateDoc,
  consumedAt: number,
  context: ExecutionContext,
): MealLogDoc {
  return {
    id: context.createId(),
    templateId: template.id,
    nameSnapshot: template.name,
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: template.details.canonicalUnit,
      nutritionPer100: structuredClone(template.details.nutritionPer100),
    },
    ...(template.provenance === undefined ? {} : { provenance: template.provenance }),
    canonicalQuantity: 100,
    entry: { enteredQuantity: 100 },
    consumedAt,
    updatedAt: context.now(),
    _deleted: false,
  };
}''', 'create dashboard log')
text = sub(text, r'function executeReplace\(.*?\n\}\n\nfunction executeQuantity', '''function executeReplace(
  state: FoodLogState,
  command: Extract<FoodLogCommand, { type: 'replace-food' }>,
  context: ExecutionContext,
): ExecutionResult {
  const rows = documentsForSelectedDay(state);
  const current = rows.find((row) => row.id === state.cursorId);
  if (!current) return { state, message: 'no cursor', changedDocuments: false };
  const next = withHistory(state);
  const now = context.now();
  const compatible = current.nutritionSnapshot.canonicalUnit === command.template.details.canonicalUnit;
  const canonicalQuantity = compatible ? current.canonicalQuantity : 100;
  const replacement: MealLogDoc = {
    id: context.createId(),
    templateId: command.template.id,
    nameSnapshot: command.template.name,
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: command.template.details.canonicalUnit,
      nutritionPer100: structuredClone(command.template.details.nutritionPer100),
    },
    ...(command.template.provenance === undefined ? {} : { provenance: command.template.provenance }),
    canonicalQuantity,
    entry: { enteredQuantity: canonicalQuantity },
    consumedAt: current.consumedAt,
    updatedAt: now + 1,
    _deleted: false,
  };
  const documents = next.documents
    .map((document) => document.id === current.id ? { ...document, _deleted: true, updatedAt: now } : document)
    .concat(replacement);
  return {
    state: { ...next, documents, cursorId: replacement.id, lastChange: command },
    message: `${current.nameSnapshot} → ${command.template.name}`,
    changedDocuments: true,
  };
}

function executeQuantity''', 'replace tombstone')
text = sub(text, r'function executeQuantity\(.*?\n\}\n\nfunction executeTimeChange', '''function executeQuantity(
  state: FoodLogState,
  command: Extract<FoodLogCommand, { type: 'set-quantity' }>,
  context: ExecutionContext,
): ExecutionResult {
  const rows = documentsForSelectedDay(state);
  const current = rows.find((row) => row.id === state.cursorId);
  if (!current || command.quantity <= 0 || !Number.isFinite(command.quantity)) {
    return { state, message: 'invalid quantity', changedDocuments: false };
  }
  if (command.unit !== current.nutritionSnapshot.canonicalUnit) {
    return { state, message: `unit conversion unavailable: ${command.unit}`, changedDocuments: false };
  }
  const next = withHistory(state);
  const documents = next.documents.map((document) => document.id === current.id ? {
    ...document,
    canonicalQuantity: command.quantity,
    entry: { enteredQuantity: command.quantity },
    updatedAt: context.now(),
  } : document);
  return {
    state: { ...next, documents, lastChange: command },
    message: `${current.nameSnapshot} → ${command.quantity} ${command.unit}`,
    changedDocuments: true,
  };
}

function executeTimeChange''', 'quantity editor semantics')
EXEC.write_text(text)

# ---- controller types ----
text = CONTROLLER.read_text()
text = text.replace("import('../../../types/meal-log.ts').MealUnit", "import('../../../types/meal-log.ts').CanonicalUnit")
CONTROLLER.write_text(text)

# ---- picker display ----
text = PANEL.read_text()
text = text.replace('  const nutrition = template.details.nutrition;', '  const nutrition = template.details.nutritionPer100;')
text = text.replace('<span>{template.details.baseAmount} {template.details.unit}</span>', '<span>100 {template.details.canonicalUnit}</span>')
PANEL.write_text(text)

# ---- inline quantity editor, direct canonical unit only ----
text = FOODLOG.read_text()
text = text.replace("import type { MealLogDoc, MealUnit }", "import type { CanonicalUnit, MealLogDoc }")
text = sub(text, r'function InlineQuantityEditor\(\{ controller, document \}: InlineQuantityEditorProps\) \{.*?\n\}', '''function InlineQuantityEditor({ controller, document }: InlineQuantityEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(String(document.entry.enteredQuantity));
  const unit: CanonicalUnit = document.nutritionSnapshot.canonicalUnit;
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <span className={styles.inlineQuantity}>
      <input
        ref={inputRef}
        className={styles.inlineInput}
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/[^0-9.]/g, ''))}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); controller.closeOverlay(); }
          else if (event.key === 'Enter') { event.preventDefault(); controller.commitQuantity(value, unit); }
        }}
        aria-label="Edit quantity"
      />
      <b>{unit}</b>
    </span>
  );
}''', 'inline quantity editor')
FOODLOG.write_text(text)

# ---- sample data: all nutrition is per 100 canonical units ----
SAMPLE.write_text('''import type { MealLogDoc, MealTemplateDoc, MealTemplateDetails } from '../../../types/meal-log.ts';\nimport { addDays, epochForChileDateTime, todayId } from '../domain/time.ts';\n\ninterface TemplateSeed { id: string; name: string; details: MealTemplateDetails; }\nconst g = (nutritionPer100: MealTemplateDetails['nutritionPer100'], typicalTime: string): MealTemplateDetails => ({\n  schemaVersion: 2, canonicalUnit: 'g', nutritionPer100, portions: [], typicalTime,\n});\nconst templateSeeds: TemplateSeed[] = [\n  { id: 'food-oats', name: 'Avena tradicional', details: g({ calories: 388.75, protein: 12.5, carbs: 66.25, fat: 7.5 }, '07:00') },\n  { id: 'food-whey', name: 'Whey vainilla', details: { ...g({ calories: 393.333333, protein: 80, carbs: 6.666667, fat: 6.666667 }, '07:00'), portions: [{ id: 'scoop', name: 'scoop', portionQuantity: 1, canonicalQuantity: 30 }] } },\n  { id: 'food-chicken', name: 'Pechuga de pollo', details: g({ calories: 165.333333, protein: 30.666667, carbs: 0, fat: 3.333333 }, '13:00') },\n  { id: 'food-rice', name: 'Arroz integral', details: g({ calories: 130, protein: 2.666667, carbs: 27.333333, fat: 1 }, '13:00') },\n  { id: 'food-oil', name: 'Aceite de oliva', details: g({ calories: 900, protein: 0, carbs: 0, fat: 100 }, '13:00') },\n  { id: 'food-bread', name: 'Pan integral casero', details: g({ calories: 215, protein: 9, carbs: 37, fat: 3.5 }, '18:30') },\n  { id: 'food-potato', name: 'Papas cocidas', details: g({ calories: 87, protein: 2, carbs: 20, fat: 0 }, '13:00') },\n  { id: 'food-avocado', name: 'Palta', details: g({ calories: 160, protein: 2.5, carbs: 8.75, fat: 15 }, '20:00') },\n];\n\nexport function sampleTemplates(now = Date.now()): MealTemplateDoc[] {\n  return templateSeeds.map((seed) => ({ ...seed, details: structuredClone(seed.details), isOfficial: false, updatedAt: now, _deleted: false }));\n}\n\nfunction log(template: MealTemplateDoc, dateId: string, time: string, canonicalQuantity: number, sequence: number, now: number): MealLogDoc {\n  const consumedAt = epochForChileDateTime(dateId, time);\n  if (consumedAt === null) throw new Error(`Invalid sample timestamp ${dateId} ${time}`);\n  return {\n    id: `seed-${dateId}-${sequence}`, templateId: template.id, nameSnapshot: template.name,\n    nutritionSnapshot: { schemaVersion: 2, canonicalUnit: template.details.canonicalUnit, nutritionPer100: structuredClone(template.details.nutritionPer100) },\n    canonicalQuantity, entry: { enteredQuantity: canonicalQuantity }, consumedAt, updatedAt: now + sequence, _deleted: false,\n  };\n}\n\nexport function sampleMealLogs(now = Date.now()): MealLogDoc[] {\n  const templates = sampleTemplates(now);\n  const byId = new Map(templates.map((template) => [template.id, template]));\n  const get = (id: string) => { const template = byId.get(id); if (!template) throw new Error(`Missing sample template ${id}`); return template; };\n  const today = todayId(); const yesterday = addDays(today, -1); const tomorrow = addDays(today, 1);\n  return [\n    log(get('food-oats'), yesterday, '07:05', 80, 1, now), log(get('food-whey'), yesterday, '07:12', 30, 2, now),\n    log(get('food-chicken'), yesterday, '13:05', 180, 3, now), log(get('food-rice'), yesterday, '13:06', 320, 4, now),\n    log(get('food-oats'), today, '06:40', 100, 5, now), log(get('food-whey'), today, '06:45', 40, 6, now),\n    log(get('food-chicken'), today, '13:21', 150, 7, now), log(get('food-rice'), today, '13:22', 300, 8, now),\n    log(get('food-oil'), today, '13:23', 10, 9, now), log(get('food-bread'), today, '18:42', 200, 10, now),\n    log(get('food-avocado'), today, '20:15', 80, 11, now), log(get('food-bread'), tomorrow, '08:00', 200, 12, now),\n    log(get('food-chicken'), tomorrow, '15:00', 200, 13, now),\n  ];\n}\n''')

# ---- command tests fixture + historical replacement invariant ----
text = TEST.read_text()
text = text.replace('''    nutritionSnapshot: {
      schemaVersion: 1,
      baseAmount: 100,
      unit: 'g',
      nutrition: { calories: 100, protein: 10, carbs: 10, fat: 2 },
    },
    quantity: 100,''', '''    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: { calories: 100, protein: 10, carbs: 10, fat: 2 },
    },
    canonicalQuantity: 100,
    entry: { enteredQuantity: 100 },''')
text += '''\n\ntest('replace tombstones historical identity and creates a fresh log', () => {\n  const template = {\n    id: 'replacement', name: 'Arroz', isOfficial: false, updatedAt: 2, _deleted: false,\n    details: { schemaVersion: 2 as const, canonicalUnit: 'g' as const, nutritionPer100: { calories: 130, protein: 3, carbs: 28, fat: 1 }, portions: [] },\n  };\n  const result = executeFoodLogCommand(state(), { type: 'replace-food', template }, context);\n  const old = result.state.documents.find((doc) => doc.id === 'c');\n  const replacement = result.state.documents.find((doc) => doc.id.startsWith('new-'));\n  assert.equal(old?._deleted, true);\n  assert.equal(replacement?.templateId, 'replacement');\n  assert.equal(replacement?.canonicalQuantity, 100);\n  assert.notEqual(replacement?.id, old?.id);\n});\n'''
TEST.write_text(text)
