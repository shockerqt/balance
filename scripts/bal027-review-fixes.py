from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "apps/dashboard/src/features/food-log/commands/execute-command.ts",
    """  const next = withHistory(state);
  const documents = next.documents.map((document) => document.id === current.id ? {
    ...document,
    canonicalQuantity: command.quantity,
    entry: { enteredQuantity: command.quantity },
    updatedAt: context.now(),
  } : document);""",
    """  const portionSnapshot = current.entry.portionSnapshot ?? undefined;
  const entry = portionSnapshot
    ? { enteredQuantity: command.quantity, portionSnapshot: structuredClone(portionSnapshot) }
    : { enteredQuantity: command.quantity };
  const canonicalQuantity = portionSnapshot
    ? command.quantity / portionSnapshot.portionQuantity * portionSnapshot.canonicalQuantity
    : command.quantity;
  const next = withHistory(state);
  const documents = next.documents.map((document) => document.id === current.id ? {
    ...document,
    canonicalQuantity,
    entry,
    updatedAt: context.now(),
  } : document);""",
    "dashboard quantity semantics",
)

replace_once(
    "apps/dashboard/src/features/food-log/components/food-log/food-log.tsx",
    """  const [value, setValue] = useState(String(document.entry.enteredQuantity));
  const unit: CanonicalUnit = document.nutritionSnapshot.canonicalUnit;
  useEffect(() => { inputRef.current?.focus(); }, []);""",
    """  const [value, setValue] = useState(String(document.entry.enteredQuantity));
  const canonicalUnit: CanonicalUnit = document.nutritionSnapshot.canonicalUnit;
  const unitLabel = document.entry.portionSnapshot?.name ?? canonicalUnit;
  useEffect(() => { inputRef.current?.focus(); }, []);""",
    "dashboard quantity editor label",
)
replace_once(
    "apps/dashboard/src/features/food-log/components/food-log/food-log.tsx",
    """          else if (event.key === 'Enter') { event.preventDefault(); controller.commitQuantity(value, unit); }""",
    """          else if (event.key === 'Enter') { event.preventDefault(); controller.commitQuantity(value, canonicalUnit); }""",
    "dashboard quantity editor commit",
)
replace_once(
    "apps/dashboard/src/features/food-log/components/food-log/food-log.tsx",
    """      <b>{unit}</b>""",
    """      <b>{unitLabel}</b>""",
    "dashboard quantity editor unit label",
)

replace_once(
    "apps/mobile/src/lib/food-library-documents.ts",
    """export function nextTemplateTimestamp(previousUpdatedAt: number, now = Date.now()): number {
  return Math.max(now, previousUpdatedAt + 1);
}
""",
    """export function nextTemplateTimestamp(previousUpdatedAt: number, now = Date.now()): number {
  return Math.max(now, previousUpdatedAt + 1);
}

export function mergeEditedTemplateDetails(
  current: MealTemplateDetails,
  edited: MealTemplateDetails
): MealTemplateDetails {
  return {
    ...current,
    ...edited,
    nutritionPer100: { ...current.nutritionPer100, ...edited.nutritionPer100 },
    portions: current.canonicalUnit === edited.canonicalUnit
      ? current.portions.map((portion) => ({ ...portion }))
      : edited.portions,
  };
}
""",
    "mobile template merge helper",
)

replace_once(
    "apps/mobile/src/hooks/use-food-library-store.tsx",
    """  createPersonalTemplate,
  deletePersonalTemplate,
  updatePersonalTemplate,
} from '@/lib/food-library-documents';""",
    """  createPersonalTemplate,
  deletePersonalTemplate,
  mergeEditedTemplateDetails,
  updatePersonalTemplate,
} from '@/lib/food-library-documents';""",
    "mobile library helper import",
)
replace_once(
    "apps/mobile/src/hooks/use-food-library-store.tsx",
    """    const editedDetails = detailsFromLibraryFood(foodData);
    const details = current ? {
      ...current.details,
      ...editedDetails,
      nutritionPer100: { ...current.details.nutritionPer100, ...editedDetails.nutritionPer100 },
    } : editedDetails;""",
    """    const editedDetails = detailsFromLibraryFood(foodData);
    const details = current ? mergeEditedTemplateDetails(current.details, editedDetails) : editedDetails;""",
    "mobile library preserve portions",
)

replace_once(
    "apps/mobile/src/lib/food-portions.ts",
    "import type { CanonicalUnit } from '@/services/sync/types';",
    "import type { CanonicalUnit, MealLogDoc, MealLogEntry } from '@/services/sync/types';",
    "mobile portion type imports",
)
replace_once(
    "apps/mobile/src/lib/food-portions.ts",
    """export function parseFoodPortion(value: string): ParsedFoodPortion | null {
  const match = value.trim().match(PORTION_PATTERN);
  if (!match) return null;
  const canonicalQuantity = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(canonicalQuantity) || canonicalQuantity <= 0) return null;
  const unit = match[2].toLowerCase() as CanonicalUnit;
  return { canonicalQuantity, unit, normalized: `${canonicalQuantity}${unit}` };
}
""",
    """export function parseFoodPortion(value: string): ParsedFoodPortion | null {
  const match = value.trim().match(PORTION_PATTERN);
  if (!match) return null;
  const canonicalQuantity = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(canonicalQuantity) || canonicalQuantity <= 0) return null;
  const unit = match[2].toLowerCase() as CanonicalUnit;
  return { canonicalQuantity, unit, normalized: `${canonicalQuantity}${unit}` };
}

export interface ResolvedMealLogPortion {
  canonicalQuantity: number;
  entry: MealLogEntry;
}

const NAMED_PORTION_PATTERN = /^([0-9]+(?:[.,][0-9]+)?)\\s+(.+)$/;

export function resolveMealLogPortion(doc: MealLogDoc, value: string): ResolvedMealLogPortion | null {
  const canonical = parseFoodPortion(value);
  if (canonical) {
    if (canonical.unit !== doc.nutritionSnapshot.canonicalUnit) return null;
    return {
      canonicalQuantity: canonical.canonicalQuantity,
      entry: { enteredQuantity: canonical.canonicalQuantity },
    };
  }

  const snapshot = doc.entry.portionSnapshot;
  if (!snapshot) return null;
  const match = value.trim().match(NAMED_PORTION_PATTERN);
  if (!match) return null;
  const enteredQuantity = Number(match[1].replace(',', '.'));
  const name = match[2].trim();
  if (!Number.isFinite(enteredQuantity) || enteredQuantity <= 0) return null;
  if (name.localeCompare(snapshot.name, undefined, { sensitivity: 'accent' }) !== 0) return null;

  const portionSnapshot = { ...snapshot };
  return {
    canonicalQuantity: enteredQuantity / portionSnapshot.portionQuantity * portionSnapshot.canonicalQuantity,
    entry: { enteredQuantity, portionSnapshot },
  };
}
""",
    "mobile portion resolver",
)

replace_once(
    "apps/mobile/src/hooks/use-meal-store.tsx",
    """import { MealLogDoc, NutritionSnapshot, SyncDocument, isMealLogDoc } from '@/services/sync/types';
import { parsePortion } from '@/lib/portion';""",
    """import { MealLogDoc, NutritionSnapshot, SyncDocument, isMealLogDoc } from '@/services/sync/types';
import { resolveMealLogPortion } from '@/lib/food-portions';
import { parsePortion } from '@/lib/portion';""",
    "mobile meal portion resolver import",
)
replace_once(
    "apps/mobile/src/hooks/use-meal-store.tsx",
    """      const display = logToLoggedFood(current);
      const merged = { ...display, ...updated, id: foodId };
      const nextDoc = docFromFood(dateId, merged, foodId);
      if (!nextDoc) return previous;
      const next = mergeLogs(previous, [nextDoc]);""",
    """      const display = logToLoggedFood(current);
      const merged = { ...display, ...updated, id: foodId };
      const consumedAt = epochForChileDateTime(dateId, merged.time);
      if (consumedAt === null) return previous;
      const resolvedPortion = resolveMealLogPortion(current, merged.portion);
      if (!resolvedPortion) return previous;

      const nutritionChanged =
        (updated.calories !== undefined && updated.calories !== display.calories) ||
        (updated.protein !== undefined && updated.protein !== display.protein) ||
        (updated.carbs !== undefined && updated.carbs !== display.carbs) ||
        (updated.fat !== undefined && updated.fat !== display.fat) ||
        (updated.fiber !== undefined && updated.fiber !== display.fiber);
      let nutritionSnapshot = current.nutritionSnapshot;
      if (nutritionChanged) {
        try {
          nutritionSnapshot = snapshotFromDisplayFood({
            ...merged,
            portion: `${resolvedPortion.canonicalQuantity}${current.nutritionSnapshot.canonicalUnit}`,
          });
        } catch {
          return previous;
        }
      }

      const nextDoc: MealLogDoc = {
        ...current,
        nameSnapshot: merged.name,
        nutritionSnapshot,
        canonicalQuantity: resolvedPortion.canonicalQuantity,
        entry: resolvedPortion.entry,
        consumedAt,
        updatedAt: Date.now(),
      };
      const next = mergeLogs(previous, [nextDoc]);""",
    "mobile meal edit preserves snapshot",
)

dashboard_test = Path("apps/dashboard/tests/execute-command.test.ts")
text = dashboard_test.read_text()
if "quantity edit preserves named portion semantics" in text:
    raise SystemExit("dashboard regression test already exists")
text = text.rstrip() + """


test('quantity edit preserves named portion semantics', () => {
  const current = state();
  current.cursorId = 'c';
  current.documents = current.documents.map((document) => document.id === 'c' ? {
    ...document,
    canonicalQuantity: 110,
    entry: {
      enteredQuantity: 4,
      portionSnapshot: { portionId: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5 },
    },
  } : document);

  const result = executeFoodLogCommand(current, { type: 'set-quantity', quantity: 4, unit: 'g' }, context);
  const updated = result.state.documents.find((document) => document.id === 'c');
  assert.equal(updated?.canonicalQuantity, 110);
  assert.equal(updated?.entry.enteredQuantity, 4);
  assert.deepEqual(updated?.entry.portionSnapshot, {
    portionId: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5,
  });
});
"""
dashboard_test.write_text(text)

mobile_test = Path("apps/mobile/tests/food-library-documents.test.mjs")
text = mobile_test.read_text()
if "resolves named portion edits from the immutable meal-log snapshot" in text:
    raise SystemExit("mobile regression tests already exist")
text = text.replace(
    """  nextTemplateTimestamp,
  updatePersonalTemplate""",
    """  mergeEditedTemplateDetails,
  nextTemplateTimestamp,
  updatePersonalTemplate""",
    1,
)
text = text.replace(
    "import { parseFoodPortion } from '../src/lib/food-portions.ts';",
    "import { parseFoodPortion, resolveMealLogPortion } from '../src/lib/food-portions.ts';",
    1,
)
text = text.rstrip() + """


test('preserves named portions when editing a template in the same canonical unit', () => {
  const portions = [{ id: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5 }];
  const current = { ...details, portions };
  const edited = {
    ...details,
    nutritionPer100: { ...details.nutritionPer100, calories: 170 },
    portions: []
  };
  const merged = mergeEditedTemplateDetails(current, edited);
  assert.deepEqual(merged.portions, portions);
  assert.equal(merged.nutritionPer100.calories, 170);
});

test('resolves named portion edits from the immutable meal-log snapshot', () => {
  const doc = {
    id: 'log-1',
    templateId: 'food-1',
    nameSnapshot: 'Pan',
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: details.nutritionPer100
    },
    canonicalQuantity: 110,
    entry: {
      enteredQuantity: 4,
      portionSnapshot: { portionId: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5 }
    },
    consumedAt: 1,
    updatedAt: 1,
    _deleted: false
  };
  assert.deepEqual(resolveMealLogPortion(doc, '4 slice'), {
    canonicalQuantity: 110,
    entry: {
      enteredQuantity: 4,
      portionSnapshot: { portionId: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5 }
    }
  });
  assert.equal(resolveMealLogPortion(doc, '5 slice')?.canonicalQuantity, 137.5);
});
"""
mobile_test.write_text(text)
