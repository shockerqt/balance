import { read, utils } from 'xlsx';
import { v5 as uuidv5 } from 'uuid';
import {
  ExtendedNutrientKey,
  ExtendedNutrition,
  ImportProvenance,
  MealLogDoc,
  MealTemplateDetails,
  MealTemplateDoc,
  MealUnit,
  Nutrition,
} from '../sync/types';

export const MACRO_FACTOR_HEADERS = [
  'Date',
  'Time',
  'Food Name',
  'Serving Size',
  'Serving Qty',
  'Serving Weight (g)',
  'Calories (kcal)',
  'Fat (g)',
  'Carbs (g)',
  'Protein (g)',
  'Alcohol (g)',
  'B12, Cobalamin (mcg)',
  'B1, Thiamine (mg)',
  'B2, Riboflavin (mg)',
  'B3, Niacin (mg)',
  'B5, Pantothenic Acid (mg)',
  'B6, Pyridoxine (mg)',
  'Caffeine (mg)',
  'Calcium (mg)',
  'Cholesterol (mg)',
  'Choline (mg)',
  'Copper (mg)',
  'Cysteine (g)',
  'Monounsaturated Fat (g)',
  'Polyunsaturated Fat (g)',
  'Saturated Fat (g)',
  'Trans Fat (g)',
  'Fiber (g)',
  'Folate (mcg)',
  'Histidine (g)',
  'Iron (mg)',
  'Isoleucine (g)',
  'Leucine (g)',
  'Lysine (g)',
  'Magnesium (mg)',
  'Manganese (mg)',
  'Methionine (g)',
  'Omega-3 ALA (g)',
  'Omega-3 DHA (g)',
  'Omega-3 EPA (g)',
  'Omega-3 (g)',
  'Omega-6 (g)',
  'Phenylalanine (g)',
  'Phosphorus (mg)',
  'Potassium (mg)',
  'Selenium (mcg)',
  'Sodium (mg)',
  'Starch (g)',
  'Sugars (g)',
  'Sugars Added (g)',
  'Threonine (g)',
  'Tryptophan (g)',
  'Tyrosine (g)',
  'Valine (g)',
  'Vitamin A (mcg)',
  'Vitamin C (mg)',
  'Vitamin D (mcg)',
  'Vitamin E (mg)',
  'Vitamin K (mcg)',
  'Water (g)',
  'Zinc (mg)',
] as const;

const EXTENDED_COLUMNS: ReadonlyArray<readonly [string, ExtendedNutrientKey]> = [
  ['Alcohol (g)', 'alcoholG'],
  ['B12, Cobalamin (mcg)', 'vitaminB12Mcg'],
  ['B1, Thiamine (mg)', 'thiamineMg'],
  ['B2, Riboflavin (mg)', 'riboflavinMg'],
  ['B3, Niacin (mg)', 'niacinMg'],
  ['B5, Pantothenic Acid (mg)', 'pantothenicAcidMg'],
  ['B6, Pyridoxine (mg)', 'pyridoxineMg'],
  ['Caffeine (mg)', 'caffeineMg'],
  ['Calcium (mg)', 'calciumMg'],
  ['Choline (mg)', 'cholineMg'],
  ['Copper (mg)', 'copperMg'],
  ['Cysteine (g)', 'cysteineG'],
  ['Monounsaturated Fat (g)', 'monounsaturatedFatG'],
  ['Polyunsaturated Fat (g)', 'polyunsaturatedFatG'],
  ['Saturated Fat (g)', 'saturatedFatG'],
  ['Trans Fat (g)', 'transFatG'],
  ['Folate (mcg)', 'folateMcg'],
  ['Histidine (g)', 'histidineG'],
  ['Iron (mg)', 'ironMg'],
  ['Isoleucine (g)', 'isoleucineG'],
  ['Leucine (g)', 'leucineG'],
  ['Lysine (g)', 'lysineG'],
  ['Magnesium (mg)', 'magnesiumMg'],
  ['Manganese (mg)', 'manganeseMg'],
  ['Methionine (g)', 'methionineG'],
  ['Omega-3 ALA (g)', 'omega3AlaG'],
  ['Omega-3 DHA (g)', 'omega3DhaG'],
  ['Omega-3 EPA (g)', 'omega3EpaG'],
  ['Omega-3 (g)', 'omega3G'],
  ['Omega-6 (g)', 'omega6G'],
  ['Phenylalanine (g)', 'phenylalanineG'],
  ['Phosphorus (mg)', 'phosphorusMg'],
  ['Potassium (mg)', 'potassiumMg'],
  ['Selenium (mcg)', 'seleniumMcg'],
  ['Starch (g)', 'starchG'],
  ['Sugars (g)', 'sugarsG'],
  ['Sugars Added (g)', 'addedSugarsG'],
  ['Threonine (g)', 'threonineG'],
  ['Tryptophan (g)', 'tryptophanG'],
  ['Tyrosine (g)', 'tyrosineG'],
  ['Valine (g)', 'valineG'],
  ['Vitamin A (mcg)', 'vitaminAMcg'],
  ['Vitamin C (mg)', 'vitaminCMg'],
  ['Vitamin D (mcg)', 'vitaminDMcg'],
  ['Vitamin E (mg)', 'vitaminEMg'],
  ['Vitamin K (mcg)', 'vitaminKMcg'],
  ['Water (g)', 'waterG'],
  ['Zinc (mg)', 'zincMg'],
];

const IMPORT_NAMESPACE = '0eb2f2da-398b-5b54-8783-699b58d8590f';

export interface MacroFactorRow {
  rowIndex: number;
  date: string;
  time: string;
  foodName: string;
  servingLabel: string;
  servingQuantity: number;
  gramsPerUnit: number | null;
  nutrition: Nutrition;
}

export interface MacroFactorRowError {
  rowIndex: number;
  message: string;
}

export interface MacroFactorParseResult {
  rows: MacroFactorRow[];
  errors: MacroFactorRowError[];
  dateStart: string | null;
  dateEnd: string | null;
  quickAddCount: number;
  extendedNutrientCount: number;
}

export interface ImportChangeSummary {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export interface MacroFactorDocumentPlan {
  templates: MealTemplateDoc[];
  logs: MealLogDoc[];
  templateSummary: ImportChangeSummary;
  logSummary: ImportChangeSummary;
}

function fixMojibake(text: string): string {
  if (!text || !/[ÃÂ]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(Array.from(text, (c) => c.charCodeAt(0) & 0xff));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

const cellText = (value: unknown): string => fixMojibake(value == null ? '' : String(value).trim());
const LEADING_BOM = /^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF|\uFFFD)+/;

function normalizeHeader(value: unknown): string {
  const text = cellText(value).replace(LEADING_BOM, '');
  return text === '"Date"' || text === '""Date""' ? 'Date' : text;
}

function parseNumber(value: unknown, required: boolean, label: string): number | null {
  const text = cellText(value);
  if (!text) {
    if (required) throw new Error(`${label} está vacío`);
    return null;
  }
  const number = typeof value === 'number' ? value : Number(text);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} no es un número válido`);
  return number;
}

function normalizeDate(value: unknown): string {
  const text = cellText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Date debe usar YYYY-MM-DD');
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Date no representa un día válido');
  }
  return text;
}

function normalizeTime(value: unknown): string {
  const text = cellText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error('Time debe usar H:MM o HH:MM');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Time no representa una hora válida');
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function rowFromCells(cells: unknown[], columns: Map<string, number>, rowIndex: number): MacroFactorRow {
  const get = (header: string) => cells[columns.get(header)!];
  const foodName = cellText(get('Food Name'));
  if (!foodName) throw new Error('Food Name está vacío');
  if (Array.from(foodName).length > 160) throw new Error('Food Name supera 160 caracteres');
  const servingLabel = cellText(get('Serving Size'));
  if (!servingLabel) throw new Error('Serving Size está vacío');
  if (Array.from(servingLabel).length > 120) throw new Error('Serving Size supera 120 caracteres');
  const servingQuantity = parseNumber(get('Serving Qty'), true, 'Serving Qty')!;
  if (servingQuantity <= 0) throw new Error('Serving Qty debe ser mayor que cero');
  const gramsPerUnit = parseNumber(get('Serving Weight (g)'), false, 'Serving Weight (g)');
  if (gramsPerUnit !== null && gramsPerUnit <= 0) {
    throw new Error('Serving Weight (g) debe ser mayor que cero');
  }

  const extendedNutrition: ExtendedNutrition = {};
  for (const [header, key] of EXTENDED_COLUMNS) {
    const value = parseNumber(get(header), false, header);
    if (value !== null) extendedNutrition[key] = value;
  }

  const optional = (header: string) => parseNumber(get(header), false, header);
  const fiber = optional('Fiber (g)');
  const sodiumMg = optional('Sodium (mg)');
  const cholesterolMg = optional('Cholesterol (mg)');
  return {
    rowIndex,
    date: normalizeDate(get('Date')),
    time: normalizeTime(get('Time')),
    foodName,
    servingLabel,
    servingQuantity,
    gramsPerUnit,
    nutrition: {
      calories: parseNumber(get('Calories (kcal)'), true, 'Calories (kcal)')!,
      fat: parseNumber(get('Fat (g)'), true, 'Fat (g)')!,
      carbs: parseNumber(get('Carbs (g)'), true, 'Carbs (g)')!,
      protein: parseNumber(get('Protein (g)'), true, 'Protein (g)')!,
      ...(fiber === null ? {} : { fiber }),
      ...(sodiumMg === null ? {} : { sodiumMg }),
      ...(cholesterolMg === null ? {} : { cholesterolMg }),
      ...(Object.keys(extendedNutrition).length ? { extendedNutrition } : {}),
    },
  };
}

export function parseMacroFactorTable(table: unknown[][]): MacroFactorParseResult {
  if (!table.length) throw new Error('El archivo no contiene filas');
  const columns = new Map<string, number>();
  table[0].forEach((value, index) => columns.set(normalizeHeader(value), index));
  const missing = MACRO_FACTOR_HEADERS.filter((header) => !columns.has(header));
  if (missing.length) throw new Error(`Faltan columnas de MacroFactor: ${missing.join(', ')}`);

  const rows: MacroFactorRow[] = [];
  const errors: MacroFactorRowError[] = [];
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index] ?? [];
    if (cells.every((value) => cellText(value) === '')) continue;
    try {
      rows.push(rowFromCells(cells, columns, index + 1));
    } catch (error) {
      errors.push({
        rowIndex: index + 1,
        message: error instanceof Error ? error.message : 'Fila inválida',
      });
    }
  }
  const dates = rows.map((row) => row.date).sort();
  const nutrientKeys = new Set(rows.flatMap((row) => Object.keys(row.nutrition.extendedNutrition ?? {})));
  return {
    rows,
    errors,
    dateStart: dates[0] ?? null,
    dateEnd: dates.at(-1) ?? null,
    quickAddCount: rows.filter((row) => row.foodName.trim().toLowerCase() === 'quick add').length,
    extendedNutrientCount: nutrientKeys.size,
  };
}

export function parseMacroFactorWorkbook(input: ArrayBuffer | Uint8Array): MacroFactorParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const workbook = isZip
    ? read(bytes, { type: 'array', cellDates: false })
    : read(new TextDecoder('utf-8').decode(bytes), { type: 'string', cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('El archivo no contiene hojas');
  const table = utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  return parseMacroFactorTable(table);
}

const normalizeIdentity = (value: string): string => value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');

const stableNumber = (value: number | null): string => (value === null ? '' : Number(value.toPrecision(12)).toString());

function templateExternalId(row: MacroFactorRow): string {
  return uuidv5(
    `${normalizeIdentity(row.foodName)}|${normalizeIdentity(row.servingLabel)}|${stableNumber(row.gramsPerUnit)}`,
    IMPORT_NAMESPACE,
  );
}

function documentId(kind: 'template' | 'log', namespace: string, externalId: string): string {
  return uuidv5(`${kind}|${namespace}|${externalId}`, IMPORT_NAMESPACE);
}

function mealUnit(label: string): MealUnit {
  const normalized = normalizeIdentity(label);
  if (normalized === 'g' || normalized === 'gram' || normalized === 'grams') return 'g';
  if (normalized === 'ml') return 'ml';
  if (normalized === 'cup' || normalized.startsWith('cup ')) return 'cup';
  if (normalized === 'unit' || normalized === 'units') return 'unit';
  return 'portion';
}

function scaleNutrition(nutrition: Nutrition, divisor: number): Nutrition {
  const divide = (value: number | null | undefined) => (value == null ? undefined : value / divisor);
  const extendedNutrition = Object.fromEntries(
    Object.entries(nutrition.extendedNutrition ?? {}).map(([key, value]) => [key, value / divisor]),
  ) as ExtendedNutrition;
  return {
    calories: nutrition.calories / divisor,
    protein: nutrition.protein / divisor,
    carbs: nutrition.carbs / divisor,
    fat: nutrition.fat / divisor,
    ...(divide(nutrition.fiber) === undefined ? {} : { fiber: divide(nutrition.fiber) }),
    ...(divide(nutrition.sodiumMg) === undefined ? {} : { sodiumMg: divide(nutrition.sodiumMg) }),
    ...(divide(nutrition.cholesterolMg) === undefined ? {} : { cholesterolMg: divide(nutrition.cholesterolMg) }),
    ...(Object.keys(extendedNutrition).length ? { extendedNutrition } : {}),
  };
}

function detailsForRow(row: MacroFactorRow, typicalTime: string): MealTemplateDetails {
  return {
    schemaVersion: 1,
    baseAmount: 1,
    unit: mealUnit(row.servingLabel),
    servingLabel: row.servingLabel,
    ...(row.gramsPerUnit === null ? {} : { gramsPerUnit: row.gramsPerUnit }),
    nutrition: scaleNutrition(row.nutrition, row.servingQuantity),
    typicalTime,
  };
}

function snapshotForRow(row: MacroFactorRow): NutritionSnapshot {
  return {
    schemaVersion: 1,
    baseAmount: 1,
    unit: mealUnit(row.servingLabel),
    servingLabel: row.servingLabel,
    ...(row.gramsPerUnit === null ? {} : { gramsPerUnit: row.gramsPerUnit }),
    nutrition: scaleNutrition(row.nutrition, row.servingQuantity),
  };
}

function chileOffsetAt(epochMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute) - epochMs;
}

function epochForChileDateTime(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let epoch = desired - chileOffsetAt(desired);
  epoch = desired - chileOffsetAt(epoch);
  return epoch;
}

function mostFrequentTime(rows: MacroFactorRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.time, (counts.get(row.time) ?? 0) + 1);
  return (
    Array.from(counts.entries()).sort(
      ([timeA, countA], [timeB, countB]) => countB - countA || timeA.localeCompare(timeB),
    )[0]?.[0] ?? '12:00'
  );
}

const sameWithoutTimestamp = (a: unknown, b: unknown): boolean => {
  const strip = (value: unknown) => {
    if (!value || typeof value !== 'object') return value;
    const { updatedAt: _updatedAt, ...rest } = value as Record<string, unknown>;
    return rest;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};

function reconcileDocuments<
  T extends {
    id: string;
    updatedAt: number;
    _deleted: boolean;
    provenance?: ImportProvenance | null;
  },
>(desired: T[], existing: T[], now: number): { documents: T[]; summary: ImportChangeSummary } {
  const currentSource = new Map(
    existing
      .filter((doc) => doc.provenance?.provider === 'macrofactor')
      .map((doc) => [doc.provenance!.externalId, doc]),
  );
  const documents: T[] = [];
  const summary: ImportChangeSummary = {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
  };
  for (const wanted of desired) {
    const current = currentSource.get(wanted.provenance!.externalId);
    currentSource.delete(wanted.provenance!.externalId);
    if (!current) {
      documents.push(wanted);
      summary.created += 1;
    } else if (sameWithoutTimestamp(current, wanted)) {
      documents.push(current);
      summary.unchanged += 1;
    } else {
      documents.push({
        ...wanted,
        id: current.id,
        updatedAt: Math.max(now, current.updatedAt + 1),
      });
      summary.updated += 1;
    }
  }
  for (const current of currentSource.values()) {
    if (current._deleted) {
      documents.push(current);
      summary.unchanged += 1;
    } else {
      documents.push({
        ...current,
        updatedAt: Math.max(now, current.updatedAt + 1),
        _deleted: true,
      });
      summary.deleted += 1;
    }
  }
  return { documents, summary };
}

export function buildMacroFactorDocumentPlan(
  rows: MacroFactorRow[],
  existingTemplates: MealTemplateDoc[],
  existingLogs: MealLogDoc[],
  namespace: string,
  now = Date.now(),
): MacroFactorDocumentPlan {
  const provenance = (externalId: string): ImportProvenance => ({
    provider: 'macrofactor',
    externalId,
  });
  const grouped = new Map<string, MacroFactorRow[]>();
  for (const row of rows) {
    if (normalizeIdentity(row.foodName) === 'quick add') continue;
    const key = templateExternalId(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const desiredTemplates: MealTemplateDoc[] = [];
  for (const [externalId, uses] of grouped) {
    const latest = uses
      .slice()
      .sort((a, b) =>
        `${a.date} ${a.time} ${String(a.rowIndex).padStart(8, '0')}`.localeCompare(
          `${b.date} ${b.time} ${String(b.rowIndex).padStart(8, '0')}`,
        ),
      )
      .at(-1)!;
    desiredTemplates.push({
      id: documentId('template', namespace, externalId),
      name: latest.foodName,
      isOfficial: false,
      details: detailsForRow(latest, mostFrequentTime(uses)),
      provenance: provenance(externalId),
      updatedAt: now,
      _deleted: false,
    });
  }

  const occurrences = new Map<string, number>();
  const consumedAtByLocalTime = new Map<string, number>();
  const desiredLogs: MealLogDoc[] = rows.map((row) => {
    const templateExternal = normalizeIdentity(row.foodName) === 'quick add' ? null : templateExternalId(row);
    const identity = `${row.date}|${row.time}|${templateExternal ?? 'quick-add'}`;
    const ordinal = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, ordinal);
    const externalId = uuidv5(`${identity}|${ordinal}`, IMPORT_NAMESPACE);
    const localTime = `${row.date}|${row.time}`;
    let consumedAt = consumedAtByLocalTime.get(localTime);
    if (consumedAt === undefined) {
      consumedAt = epochForChileDateTime(row.date, row.time);
      consumedAtByLocalTime.set(localTime, consumedAt);
    }
    return {
      id: documentId('log', namespace, externalId),
      templateId: templateExternal ? documentId('template', namespace, templateExternal) : null,
      nameSnapshot: row.foodName,
      nutritionSnapshot: snapshotForRow(row),
      quantity: row.servingQuantity,
      consumedAt,
      provenance: provenance(externalId),
      updatedAt: now,
      _deleted: false,
    };
  });

  const templates = reconcileDocuments(desiredTemplates, existingTemplates, now);
  const logs = reconcileDocuments(desiredLogs, existingLogs, now);
  return {
    templates: templates.documents,
    logs: logs.documents,
    templateSummary: templates.summary,
    logSummary: logs.summary,
  };
}
