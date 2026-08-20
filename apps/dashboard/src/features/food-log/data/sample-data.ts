import type { MealLogDoc, MealTemplateDoc, MealTemplateDetails } from '../../../types/meal-log.ts';
import { addDays, epochForChileDateTime, todayId } from '../domain/time.ts';

interface TemplateSeed {
  id: string;
  name: string;
  details: MealTemplateDetails;
}

const templateSeeds: TemplateSeed[] = [
  {
    id: 'food-oats',
    name: 'Avena tradicional',
    details: { schemaVersion: 1, baseAmount: 80, unit: 'g', nutrition: { calories: 311, protein: 10, carbs: 53, fat: 6 }, typicalTime: '07:00' },
  },
  {
    id: 'food-whey',
    name: 'Whey vainilla',
    details: { schemaVersion: 1, baseAmount: 30, unit: 'g', servingLabel: '1 scoop', gramsPerUnit: 30, nutrition: { calories: 118, protein: 24, carbs: 2, fat: 2 }, typicalTime: '07:00' },
  },
  {
    id: 'food-chicken',
    name: 'Pechuga de pollo',
    details: { schemaVersion: 1, baseAmount: 150, unit: 'g', nutrition: { calories: 248, protein: 46, carbs: 0, fat: 5 }, typicalTime: '13:00' },
  },
  {
    id: 'food-rice',
    name: 'Arroz integral',
    details: { schemaVersion: 1, baseAmount: 300, unit: 'g', nutrition: { calories: 390, protein: 8, carbs: 82, fat: 3 }, typicalTime: '13:00' },
  },
  {
    id: 'food-oil',
    name: 'Aceite de oliva',
    details: { schemaVersion: 1, baseAmount: 10, unit: 'g', nutrition: { calories: 90, protein: 0, carbs: 0, fat: 10 }, typicalTime: '13:00' },
  },
  {
    id: 'food-bread',
    name: 'Pan integral casero',
    details: { schemaVersion: 1, baseAmount: 200, unit: 'g', nutrition: { calories: 430, protein: 18, carbs: 74, fat: 7 }, typicalTime: '18:30' },
  },
  {
    id: 'food-potato',
    name: 'Papas cocidas',
    details: { schemaVersion: 1, baseAmount: 400, unit: 'g', nutrition: { calories: 348, protein: 8, carbs: 80, fat: 0 }, typicalTime: '13:00' },
  },
  {
    id: 'food-avocado',
    name: 'Palta',
    details: { schemaVersion: 1, baseAmount: 80, unit: 'g', nutrition: { calories: 128, protein: 2, carbs: 7, fat: 12 }, typicalTime: '20:00' },
  },
];

export function sampleTemplates(now = Date.now()): MealTemplateDoc[] {
  return templateSeeds.map((seed) => ({
    ...seed,
    details: structuredClone(seed.details),
    isOfficial: false,
    updatedAt: now,
    _deleted: false,
  }));
}

function log(
  template: MealTemplateDoc,
  dateId: string,
  time: string,
  quantity: number,
  sequence: number,
  now: number,
): MealLogDoc {
  const consumedAt = epochForChileDateTime(dateId, time);
  if (consumedAt === null) throw new Error(`Invalid sample timestamp ${dateId} ${time}`);
  return {
    id: `seed-${dateId}-${sequence}`,
    templateId: template.id,
    nameSnapshot: template.name,
    nutritionSnapshot: structuredClone(template.details),
    quantity,
    consumedAt,
    updatedAt: now + sequence,
    _deleted: false,
  };
}

export function sampleMealLogs(now = Date.now()): MealLogDoc[] {
  const templates = sampleTemplates(now);
  const byId = new Map(templates.map((template) => [template.id, template]));
  const get = (id: string) => {
    const template = byId.get(id);
    if (!template) throw new Error(`Missing sample template ${id}`);
    return template;
  };
  const today = todayId();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  return [
    log(get('food-oats'), yesterday, '07:05', 80, 1, now),
    log(get('food-whey'), yesterday, '07:12', 30, 2, now),
    log(get('food-chicken'), yesterday, '13:05', 180, 3, now),
    log(get('food-rice'), yesterday, '13:06', 320, 4, now),
    log(get('food-oats'), today, '06:40', 100, 5, now),
    log(get('food-whey'), today, '06:45', 40, 6, now),
    log(get('food-chicken'), today, '13:21', 150, 7, now),
    log(get('food-rice'), today, '13:22', 300, 8, now),
    log(get('food-oil'), today, '13:23', 10, 9, now),
    log(get('food-bread'), today, '18:42', 200, 10, now),
    log(get('food-avocado'), today, '20:15', 80, 11, now),
    log(get('food-bread'), tomorrow, '08:00', 200, 12, now),
    log(get('food-chicken'), tomorrow, '15:00', 200, 13, now),
  ];
}
