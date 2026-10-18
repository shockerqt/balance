import { canonicalQuantityForPortion, scaleNutrition } from '@balance/domain';
import { EXTENDED_NUTRIENT_KEYS, isMealLogDoc, isDateId, type MealLogDoc, type MealTemplateDoc, type Nutrition, type PortionSnapshot } from '@/services/sync/types';
import { epochForChileDateTime } from '@/lib/dates';

export const nutrientFields = [
  { key: 'calories', label: 'Energía', unit: 'kcal', required: true },
  { key: 'protein', label: 'Proteínas', unit: 'g', required: true },
  { key: 'carbs', label: 'Carbohidratos', unit: 'g', required: true },
  { key: 'fat', label: 'Grasas', unit: 'g', required: true },
  { key: 'fiber', label: 'Fibra', unit: 'g' },
  { key: 'sodiumMg', label: 'Sodio', unit: 'mg' },
  { key: 'cholesterolMg', label: 'Colesterol', unit: 'mg' },
  ...EXTENDED_NUTRIENT_KEYS.map(key => ({ key, label: extendedLabel(key), unit: key.endsWith('Mcg') ? 'µg' : key.endsWith('Mg') ? 'mg' : 'g' })),
];
function extendedLabel(key: string): string {
  const labels: Record<string, string> = {
    alcoholG: 'Alcohol', vitaminB12Mcg: 'Vitamina B12', thiamineMg: 'Tiamina (B1)', riboflavinMg: 'Riboflavina (B2)', niacinMg: 'Niacina (B3)', pantothenicAcidMg: 'Ácido pantoténico (B5)', pyridoxineMg: 'Vitamina B6', caffeineMg: 'Cafeína', calciumMg: 'Calcio', cholineMg: 'Colina', copperMg: 'Cobre', cysteineG: 'Cisteína', monounsaturatedFatG: 'Grasas monoinsaturadas', polyunsaturatedFatG: 'Grasas poliinsaturadas', saturatedFatG: 'Grasas saturadas', transFatG: 'Grasas trans', folateMcg: 'Folato', histidineG: 'Histidina', ironMg: 'Hierro', isoleucineG: 'Isoleucina', leucineG: 'Leucina', lysineG: 'Lisina', magnesiumMg: 'Magnesio', manganeseMg: 'Manganeso', methionineG: 'Metionina', omega3AlaG: 'Omega 3 ALA', omega3DhaG: 'Omega 3 DHA', omega3EpaG: 'Omega 3 EPA', omega3G: 'Omega 3', omega6G: 'Omega 6', phenylalanineG: 'Fenilalanina', phosphorusMg: 'Fósforo', potassiumMg: 'Potasio', seleniumMcg: 'Selenio', starchG: 'Almidón', sugarsG: 'Azúcares', addedSugarsG: 'Azúcares añadidos', threonineG: 'Treonina', tryptophanG: 'Triptófano', tyrosineG: 'Tirosina', valineG: 'Valina', vitaminAMcg: 'Vitamina A', vitaminCMg: 'Vitamina C', vitaminDMcg: 'Vitamina D', vitaminEMg: 'Vitamina E', vitaminKMcg: 'Vitamina K', waterG: 'Agua', zincMg: 'Zinc',
  };
  return labels[key] ?? key;
}
export function decimal(value: unknown, positive = false): number | null {
  if (typeof value !== 'string' || !/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const n = Number(value.trim().replace(',', '.'));
  return Number.isFinite(n) && (positive ? n > 0 : n >= 0) ? n : null;
}
function fail(message: string): never { throw new Error(message); }

/** Native input is untrusted. Reconstruct the backend document from canonical data. */
export function createFoodEntry(input: unknown, templates: MealTemplateDoc[], id: string, now = Date.now()): MealLogDoc {
  if (!input || typeof input !== 'object') return fail('Revisa los datos del alimento.');
  const p = input as Record<string, unknown>;
  if (typeof p.date !== 'string' || !isDateId(p.date) || typeof p.time !== 'string') return fail('Elige una fecha y hora válidas.');
  const consumedAt = epochForChileDateTime(p.date, p.time);
  if (consumedAt === null || consumedAt <= 0) return fail('Esa fecha y hora no existen en el horario de Chile.');
  const quantity = decimal(p.quantity, true);
  if (quantity === null) return fail('La cantidad debe ser mayor que cero.');
  let name: string, nutrition: Nutrition, unit: 'g' | 'ml', templateId: string | null = null;
  let portionSnapshot: PortionSnapshot | undefined;
  if (typeof p.templateId === 'string' && p.templateId) {
    const template = templates.find(t => t.id === p.templateId && !t._deleted);
    if (!template || template.updatedAt !== p.templateRevision) return fail('El alimento cambió. Vuelve a elegirlo en la biblioteca.');
    name = template.name; nutrition = { ...template.details.nutritionPer100 };
    if (nutrition.extendedNutrition === null) delete nutrition.extendedNutrition; unit = template.details.canonicalUnit; templateId = template.id;
    if (p.portionId !== '' && p.portionId != null) {
      const portion = template.details.portions.find(v => v.id === p.portionId);
      if (!portion) return fail('La porción ya no está disponible.');
      portionSnapshot = { portionId: portion.id, name: portion.name, portionQuantity: portion.portionQuantity, canonicalQuantity: portion.canonicalQuantity };
    }
  } else {
    if (p.templateId != null && p.templateId !== '') return fail('El alimento no es válido.');
    if (typeof p.name !== 'string') return fail('Escribe el nombre del alimento.');
    name = p.name.trim();
    if (p.unit !== 'g' && p.unit !== 'ml') return fail('Elige gramos o mililitros.');
    unit = p.unit;
    if (!p.nutrients || typeof p.nutrients !== 'object' || Array.isArray(p.nutrients)) return fail('Completa la información por 100.');
    const values = p.nutrients as Record<string, unknown>;
    const allowed = new Set(nutrientFields.map(v => v.key));
    if (Object.keys(values).some(k => !allowed.has(k))) return fail('Hay un nutriente no reconocido.');
    const parsed: Record<string, number> = {};
    for (const field of nutrientFields) {
      const raw = values[field.key];
      if (raw == null || raw === '') {
        if (field.required) return fail(`Completa ${field.label.toLowerCase()} por 100 ${unit}.`);
        continue;
      }
      const n = decimal(raw);
      if (n === null) return fail(`Revisa ${field.label.toLowerCase()}: usa un número mayor o igual a cero.`);
      parsed[field.key] = n;
    }
    const { calories, protein, carbs, fat, fiber, sodiumMg, cholesterolMg, ...extendedNutrition } = parsed;
    nutrition = { calories, protein, carbs, fat,
      ...(fiber === undefined ? {} : { fiber }), ...(sodiumMg === undefined ? {} : { sodiumMg }), ...(cholesterolMg === undefined ? {} : { cholesterolMg }),
      ...(Object.keys(extendedNutrition).length ? { extendedNutrition } : {}),
    };
  }
  if (!name.trim() || [...name.trim()].length > 160) return fail('El nombre debe tener entre 1 y 160 caracteres.');
  const canonicalQuantity = canonicalQuantityForPortion(quantity, portionSnapshot);
  if (canonicalQuantity === null) return fail('La cantidad o conversión es demasiado grande.');
  // Validate scaled values too: finite inputs can still overflow when multiplied.
  const scaled = scaleNutrition(nutrition, canonicalQuantity / 100);
  const numbers = Object.entries(scaled).flatMap(([k,v]) => k === 'extendedNutrition' && v ? Object.values(v) : [v]).filter(v => v != null);
  if (numbers.some(v => typeof v !== 'number' || !Number.isFinite(v))) return fail('La cantidad es demasiado grande.');
  const doc: MealLogDoc = { id, templateId, nameSnapshot: name.trim(), nutritionSnapshot: { schemaVersion: 2, canonicalUnit: unit, nutritionPer100: JSON.parse(JSON.stringify(nutrition)) },
    canonicalQuantity, entry: { enteredQuantity: quantity, ...(portionSnapshot ? { portionSnapshot } : {}) }, consumedAt, updatedAt: now, _deleted: false };
  if (!isMealLogDoc(doc)) return fail('Revisa los datos antes de registrar.');
  return doc;
}
export function acceptFoodEntryEvent(value: unknown, session: string, sequence: number): value is { session: string; sequence: number; action: 'save' | 'cancel'; input?: unknown } {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return e.session === session && Number.isSafeInteger(e.sequence) && (e.sequence as number) > sequence && (e.action === 'save' || e.action === 'cancel');
}
