import type { MealLogDoc, MealTemplateDoc, MealTemplateDetails } from '../../../types/meal-log.ts';
import { addDays, epochForChileDateTime, todayId } from '../domain/time.ts';

interface TemplateSeed { id: string; name: string; details: MealTemplateDetails; }
const g = (nutritionPer100: MealTemplateDetails['nutritionPer100'], typicalTime: string): MealTemplateDetails => ({
  schemaVersion: 2, canonicalUnit: 'g', nutritionPer100, portions: [], typicalTime,
});
const templateSeeds: TemplateSeed[] = [
  { id: 'food-oats', name: 'Avena tradicional', details: g({ calories: 388.75, protein: 12.5, carbs: 66.25, fat: 7.5 }, '07:00') },
  { id: 'food-whey', name: 'Whey vainilla', details: { ...g({ calories: 393.333333, protein: 80, carbs: 6.666667, fat: 6.666667 }, '07:00'), portions: [{ id: 'scoop', name: 'scoop', portionQuantity: 1, canonicalQuantity: 30 }] } },
  { id: 'food-chicken', name: 'Pechuga de pollo', details: g({ calories: 165.333333, protein: 30.666667, carbs: 0, fat: 3.333333 }, '13:00') },
  { id: 'food-rice', name: 'Arroz integral', details: g({ calories: 130, protein: 2.666667, carbs: 27.333333, fat: 1 }, '13:00') },
  { id: 'food-oil', name: 'Aceite de oliva', details: g({ calories: 900, protein: 0, carbs: 0, fat: 100 }, '13:00') },
  { id: 'food-bread', name: 'Pan integral casero', details: g({ calories: 215, protein: 9, carbs: 37, fat: 3.5 }, '18:30') },
  { id: 'food-potato', name: 'Papas cocidas', details: g({ calories: 87, protein: 2, carbs: 20, fat: 0 }, '13:00') },
  { id: 'food-avocado', name: 'Palta', details: g({ calories: 160, protein: 2.5, carbs: 8.75, fat: 15 }, '20:00') },
];

export function sampleTemplates(now = Date.now()): MealTemplateDoc[] {
  return templateSeeds.map((seed) => ({ ...seed, details: structuredClone(seed.details), isOfficial: false, updatedAt: now, _deleted: false }));
}

function log(template: MealTemplateDoc, dateId: string, time: string, canonicalQuantity: number, sequence: number, now: number): MealLogDoc {
  const consumedAt = epochForChileDateTime(dateId, time);
  if (consumedAt === null) throw new Error(`Invalid sample timestamp ${dateId} ${time}`);
  return {
    id: `seed-${dateId}-${sequence}`, templateId: template.id, nameSnapshot: template.name,
    nutritionSnapshot: { schemaVersion: 2, canonicalUnit: template.details.canonicalUnit, nutritionPer100: structuredClone(template.details.nutritionPer100) },
    canonicalQuantity, entry: { enteredQuantity: canonicalQuantity }, consumedAt, updatedAt: now + sequence, _deleted: false,
  };
}

export function sampleMealLogs(now = Date.now()): MealLogDoc[] {
  const templates = sampleTemplates(now);
  const byId = new Map(templates.map((template) => [template.id, template]));
  const get = (id: string) => { const template = byId.get(id); if (!template) throw new Error(`Missing sample template ${id}`); return template; };
  const today = todayId(); const yesterday = addDays(today, -1); const tomorrow = addDays(today, 1);
  return [
    log(get('food-oats'), yesterday, '07:05', 80, 1, now), log(get('food-whey'), yesterday, '07:12', 30, 2, now),
    log(get('food-chicken'), yesterday, '13:05', 180, 3, now), log(get('food-rice'), yesterday, '13:06', 320, 4, now),
    log(get('food-oats'), today, '06:40', 100, 5, now), log(get('food-whey'), today, '06:45', 40, 6, now),
    log(get('food-chicken'), today, '13:21', 150, 7, now), log(get('food-rice'), today, '13:22', 300, 8, now),
    log(get('food-oil'), today, '13:23', 10, 9, now), log(get('food-bread'), today, '18:42', 200, 10, now),
    log(get('food-avocado'), today, '20:15', 80, 11, now), log(get('food-bread'), tomorrow, '08:00', 200, 12, now),
    log(get('food-chicken'), tomorrow, '15:00', 200, 13, now),
  ];
}
