import type { MealLogDoc, MealTemplateDoc } from '../../../types/meal-log.ts';
import {
  createSnapshot,
  documentsForSelectedDay,
  ensureCursor,
  hourKey,
  registerItemFromDocument,
  restoreSnapshot,
  selectedRowIds,
  type FoodLogRegisterItem,
  type FoodLogState,
} from '../domain/food-log-state.ts';
import {
  addDays,
  chileDateParts,
  epochForChileDateTime,
  shiftEpochMinutes,
  timeInChile,
  todayId,
} from '../domain/time.ts';
import type { FoodLogCommand, Motion, Operator, Target } from './command.ts';

export interface ExecutionContext {
  now: () => number;
  createId: () => string;
}

export interface ExecutionResult {
  state: FoodLogState;
  message: string | null;
  changedDocuments: boolean;
}

const defaultContext: ExecutionContext = {
  now: () => Date.now(),
  createId: () => crypto.randomUUID(),
};

function withHistory(state: FoodLogState): FoodLogState {
  return {
    ...state,
    history: [...state.history.slice(-49), createSnapshot(state)],
    future: [],
  };
}

function cursorIndex(state: FoodLogState, rows = documentsForSelectedDay(state)): number {
  if (!state.cursorId) return -1;
  return rows.findIndex((row) => row.id === state.cursorId);
}

function indexForMotion(state: FoodLogState, motion: Motion): number {
  const rows = documentsForSelectedDay(state);
  if (!rows.length) return -1;
  const current = Math.max(0, cursorIndex(state, rows));

  if (motion.type === 'first') return 0;
  if (motion.type === 'last') return rows.length - 1;
  if (motion.type === 'index') return Math.max(0, Math.min(rows.length - 1, motion.index));
  if (motion.type === 'item') {
    return Math.max(0, Math.min(rows.length - 1, current + motion.direction * motion.count));
  }

  const currentHour = hourKey(rows[current]);
  const hours = Array.from(new Set(rows.map(hourKey)));
  const hourIndex = Math.max(0, hours.indexOf(currentHour));
  const targetHour = hours[Math.max(0, Math.min(hours.length - 1, hourIndex + motion.direction * motion.count))];
  const index = rows.findIndex((row) => hourKey(row) === targetHour);
  return index >= 0 ? index : current;
}

function rangeIds(rows: MealLogDoc[], from: number, to: number): string[] {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(rows.length - 1, Math.max(from, to));
  if (start > end) return [];
  return rows.slice(start, end + 1).map((row) => row.id);
}

function resolveTargetIds(state: FoodLogState, target: Target): string[] {
  const rows = documentsForSelectedDay(state);
  const current = cursorIndex(state, rows);
  if (current < 0) return [];

  if (target.type === 'selection') return selectedRowIds(state);
  if (target.type === 'current') return rows.slice(current, current + Math.max(1, target.count)).map((row) => row.id);
  if (target.type === 'motion') return rangeIds(rows, current, indexForMotion(state, target.motion));
  if (target.type === 'block-tail') {
    const hour = hourKey(rows[current]);
    let end = current;
    while (end + 1 < rows.length && hourKey(rows[end + 1]) === hour) end += 1;
    return rangeIds(rows, current, end);
  }

  const hours = Array.from(new Set(rows.map(hourKey)));
  const currentHour = hourKey(rows[current]);
  const start = Math.max(0, hours.indexOf(currentHour));
  const selectedHours = new Set(hours.slice(start, start + Math.max(1, target.count)));
  return rows.filter((row) => selectedHours.has(hourKey(row))).map((row) => row.id);
}

function setCursorByIndex(state: FoodLogState, index: number): FoodLogState {
  const rows = documentsForSelectedDay(state);
  if (!rows.length) return { ...state, cursorId: null, selectionAnchorId: null, mode: 'normal' };
  const bounded = Math.max(0, Math.min(rows.length - 1, index));
  return { ...state, cursorId: rows[bounded].id };
}

function mutateDocuments(
  state: FoodLogState,
  ids: Set<string>,
  mutation: (document: MealLogDoc) => MealLogDoc,
): MealLogDoc[] {
  return state.documents.map((document) => (ids.has(document.id) ? mutation(document) : document));
}

function normalAfterMutation(state: FoodLogState, preferredIndex: number): FoodLogState {
  const normal = ensureCursor({ ...state, mode: 'normal', selectionAnchorId: null });
  return setCursorByIndex(normal, preferredIndex);
}

function executeOperator(
  state: FoodLogState,
  operator: Operator,
  target: Target,
  context: ExecutionContext,
): ExecutionResult {
  const targetIds = resolveTargetIds(state, target);
  if (!targetIds.length) return { state, message: 'nothing selected', changedDocuments: false };
  const targetSet = new Set(targetIds);
  const rows = documentsForSelectedDay(state);
  const startIndex = Math.max(0, rows.findIndex((row) => targetSet.has(row.id)));
  const targetDocs = rows.filter((row) => targetSet.has(row.id));

  if (operator === 'yank') {
    return {
      state: {
        ...state,
        register: { items: targetDocs.map(registerItemFromDocument), source: 'yank' },
        mode: 'normal',
        selectionAnchorId: null,
      },
      message: `${targetDocs.length} yanked`,
      changedDocuments: false,
    };
  }

  if (operator === 'normalize') {
    const cursor = rows.find((row) => row.id === state.cursorId);
    if (!cursor) return { state, message: 'no cursor', changedDocuments: false };
    const next = withHistory(state);
    const now = context.now();
    const documents = mutateDocuments(next, targetSet, (document) => ({
      ...document,
      consumedAt: cursor.consumedAt,
      updatedAt: now,
    }));
    return {
      state: normalAfterMutation({ ...next, documents, lastChange: { type: 'operate', operator, target } }, startIndex),
      message: `${targetDocs.length} timestamps → ${timeInChile(cursor.consumedAt)}`,
      changedDocuments: true,
    };
  }

  const next = withHistory(state);
  const now = context.now();
  const documents = mutateDocuments(next, targetSet, (document) => ({ ...document, _deleted: true, updatedAt: now }));
  const deletedState: FoodLogState = {
    ...next,
    documents,
    register: { items: targetDocs.map(registerItemFromDocument), source: 'delete' },
    lastChange: { type: 'operate', operator, target },
  };
  return {
    state: normalAfterMutation(deletedState, startIndex),
    message: `${targetDocs.length} deleted`,
    changedDocuments: true,
  };
}

function relativeOffsets(items: FoodLogRegisterItem[]): number[] {
  const first = items[0]?.consumedAt ?? 0;
  return items.map((item) => item.consumedAt - first);
}

function createPastedDocuments(
  items: FoodLogRegisterItem[],
  baseEpoch: number,
  context: ExecutionContext,
): MealLogDoc[] {
  const offsets = relativeOffsets(items);
  const now = context.now();
  return items.map((item, index) => ({
    id: context.createId(),
    templateId: item.templateId,
    nameSnapshot: item.nameSnapshot,
    nutritionSnapshot: structuredClone(item.nutritionSnapshot),
    ...(item.provenance === undefined ? {} : { provenance: item.provenance }),
    canonicalQuantity: item.canonicalQuantity,
    entry: structuredClone(item.entry),
    consumedAt: baseEpoch + offsets[index],
    updatedAt: now + index,
    _deleted: false,
  }));
}

function pasteBaseEpoch(state: FoodLogState, side: 'before' | 'after', items: FoodLogRegisterItem[]): number {
  const rows = documentsForSelectedDay(state);
  const current = cursorIndex(state, rows);
  const cursor = current >= 0 ? rows[current] : null;
  if (cursor) {
    if (side === 'after') return cursor.consumedAt + 1;
    const span = (items.at(-1)?.consumedAt ?? items[0]?.consumedAt ?? 0) - (items[0]?.consumedAt ?? 0);
    return cursor.consumedAt - span - 1;
  }

  const sourceTime = items[0] ? timeInChile(items[0].consumedAt) : '12:00';
  return epochForChileDateTime(state.selectedDateId, sourceTime) ?? contextFallbackEpoch(state.selectedDateId);
}

function contextFallbackEpoch(dateId: string): number {
  return epochForChileDateTime(dateId, '12:00') ?? Date.now();
}

function executePaste(
  state: FoodLogState,
  command: Extract<FoodLogCommand, { type: 'paste' }>,
  context: ExecutionContext,
): ExecutionResult {
  if (!state.register?.items.length) return { state, message: 'register empty', changedDocuments: false };

  const repetitions = Math.max(1, command.count);
  const registerItems = Array.from({ length: repetitions }, () => state.register?.items ?? []).flat();
  const next = withHistory(state);

  if (state.mode === 'visual') {
    const selectedIds = selectedRowIds(state);
    const selectedSet = new Set(selectedIds);
    const rows = documentsForSelectedDay(state);
    const selectedDocs = rows.filter((row) => selectedSet.has(row.id));
    if (!selectedDocs.length) return { state, message: 'nothing selected', changedDocuments: false };
    const baseEpoch = selectedDocs[0].consumedAt;
    const pasted = createPastedDocuments(registerItems, baseEpoch, context);
    const now = context.now();
    const documents = next.documents
      .map((document) => selectedSet.has(document.id) ? { ...document, _deleted: true, updatedAt: now } : document)
      .concat(pasted);
    const nextState = ensureCursor({
      ...next,
      documents,
      cursorId: pasted[0]?.id ?? null,
      selectionAnchorId: null,
      mode: 'normal',
      register: { items: selectedDocs.map(registerItemFromDocument), source: 'visual-paste' },
      lastChange: command,
    });
    return {
      state: nextState,
      message: `replaced ${selectedDocs.length} with ${pasted.length}`,
      changedDocuments: true,
    };
  }

  const baseEpoch = pasteBaseEpoch(state, command.side, registerItems);
  const pasted = createPastedDocuments(registerItems, baseEpoch, context);
  return {
    state: ensureCursor({
      ...next,
      documents: [...next.documents, ...pasted],
      cursorId: pasted[0]?.id ?? state.cursorId,
      selectionAnchorId: null,
      mode: 'normal',
      lastChange: command,
    }),
    message: `${pasted.length} pasted`,
    changedDocuments: true,
  };
}

function executeMoveRows(
  state: FoodLogState,
  command: Extract<FoodLogCommand, { type: 'move-rows' }>,
  context: ExecutionContext,
): ExecutionResult {
  const rows = documentsForSelectedDay(state);
  const selectedIds = state.mode === 'visual' ? selectedRowIds(state) : state.cursorId ? [state.cursorId] : [];
  if (!selectedIds.length) return { state, message: 'nothing selected', changedDocuments: false };
  const selectedSet = new Set(selectedIds);
  let order = rows.map((row) => row.id);
  const moveOnce = () => {
    if (command.direction > 0) {
      for (let index = order.length - 2; index >= 0; index -= 1) {
        if (selectedSet.has(order[index]) && !selectedSet.has(order[index + 1])) {
          [order[index], order[index + 1]] = [order[index + 1], order[index]];
        }
      }
    } else {
      for (let index = 1; index < order.length; index += 1) {
        if (selectedSet.has(order[index]) && !selectedSet.has(order[index - 1])) {
          [order[index], order[index - 1]] = [order[index - 1], order[index]];
        }
      }
    }
  };
  for (let step = 0; step < Math.max(1, command.count); step += 1) moveOnce();

  const slots = rows.map((row) => row.consumedAt).sort((a, b) => a - b);
  const slotById = new Map(order.map((id, index) => [id, slots[index]]));
  const now = context.now();
  const next = withHistory(state);
  const documents = next.documents.map((document) => {
    const slot = slotById.get(document.id);
    return slot === undefined ? document : { ...document, consumedAt: slot, updatedAt: now };
  });

  return {
    state: { ...next, documents, lastChange: command },
    message: `moved ${selectedIds.length} ${command.direction > 0 ? 'down' : 'up'}`,
    changedDocuments: true,
  };
}

function moveCursor(state: FoodLogState, motion: Motion): FoodLogState {
  const rows = documentsForSelectedDay(state);
  const target = indexForMotion(state, motion);
  if (target < 0 || !rows[target]) return state;
  return { ...state, cursorId: rows[target].id };
}

function executeUndo(state: FoodLogState, count: number): ExecutionResult {
  if (!state.history.length) return { state, message: 'nothing to undo', changedDocuments: false };
  const history = [...state.history];
  const future = [...state.future];
  let current = state;
  let applied = 0;
  while (applied < Math.max(1, count) && history.length) {
    const previous = history.pop();
    if (!previous) break;
    future.push(createSnapshot(current));
    current = restoreSnapshot(current, previous);
    applied += 1;
  }
  return {
    state: ensureCursor({ ...current, history, future }),
    message: `${applied} undo${applied === 1 ? '' : 's'}`,
    changedDocuments: true,
  };
}

function executeRedo(state: FoodLogState, count: number): ExecutionResult {
  if (!state.future.length) return { state, message: 'nothing to redo', changedDocuments: false };
  const history = [...state.history];
  const future = [...state.future];
  let current = state;
  let applied = 0;
  while (applied < Math.max(1, count) && future.length) {
    const next = future.pop();
    if (!next) break;
    history.push(createSnapshot(current));
    current = restoreSnapshot(current, next);
    applied += 1;
  }
  return {
    state: ensureCursor({ ...current, history, future }),
    message: `${applied} redo${applied === 1 ? '' : 's'}`,
    changedDocuments: true,
  };
}

function timeForNowOnSelectedDay(state: FoodLogState, now: number): number {
  const parts = chileDateParts(now);
  const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  return epochForChileDateTime(state.selectedDateId, time) ?? now;
}

function createMealLogFromTemplate(
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
}

function executeAdd(
  state: FoodLogState,
  command: Extract<FoodLogCommand, { type: 'add-food' }>,
  context: ExecutionContext,
): ExecutionResult {
  const rows = documentsForSelectedDay(state);
  const current = cursorIndex(state, rows);
  const cursor = current >= 0 ? rows[current] : null;
  let consumedAt: number;
  if (command.side === 'now') consumedAt = timeForNowOnSelectedDay(state, context.now());
  else if (command.side === 'explicit' && command.time) consumedAt = epochForChileDateTime(state.selectedDateId, command.time) ?? timeForNowOnSelectedDay(state, context.now());
  else if (cursor) consumedAt = cursor.consumedAt + (command.side === 'before' ? -1 : 1);
  else consumedAt = timeForNowOnSelectedDay(state, context.now());

  const document = createMealLogFromTemplate(command.template, consumedAt, context);
  const next = withHistory(state);
  return {
    state: ensureCursor({ ...next, documents: [...next.documents, document], cursorId: document.id, mode: 'normal', selectionAnchorId: null, lastChange: command }),
    message: `${document.nameSnapshot} added`,
    changedDocuments: true,
  };
}

function executeReplace(
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

function executeQuantity(
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
  const portionSnapshot = current.entry.portionSnapshot ?? undefined;
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
  } : document);
  return {
    state: { ...next, documents, lastChange: command },
    message: `${current.nameSnapshot} → ${command.quantity} ${command.unit}`,
    changedDocuments: true,
  };
}

function executeTimeChange(
  state: FoodLogState,
  command: Extract<FoodLogCommand, { type: 'set-time' | 'shift-time' }>,
  context: ExecutionContext,
): ExecutionResult {
  const ids = resolveTargetIds(state, command.target);
  if (!ids.length) return { state, message: 'nothing selected', changedDocuments: false };
  const set = new Set(ids);
  const next = withHistory(state);
  const now = context.now();
  const documents = next.documents.map((document) => {
    if (!set.has(document.id)) return document;
    if (command.type === 'shift-time') return { ...document, consumedAt: shiftEpochMinutes(document.consumedAt, command.minutes), updatedAt: now };
    const nextEpoch = epochForChileDateTime(state.selectedDateId, command.time);
    return nextEpoch === null ? document : { ...document, consumedAt: nextEpoch, updatedAt: now };
  });
  const message = command.type === 'shift-time'
    ? `${ids.length} timestamp${ids.length === 1 ? '' : 's'} ${command.minutes >= 0 ? '+' : ''}${command.minutes}m`
    : `${ids.length} timestamp${ids.length === 1 ? '' : 's'} → ${command.time}`;
  return {
    state: normalAfterMutation({ ...next, documents, lastChange: command }, Math.max(0, cursorIndex(state))),
    message,
    changedDocuments: true,
  };
}

function executeSearch(state: FoodLogState, command: Extract<FoodLogCommand, { type: 'search' }>): ExecutionResult {
  const rows = documentsForSelectedDay(state);
  if (!rows.length || !command.query.trim()) return { state, message: 'no match', changedDocuments: false };
  const current = Math.max(0, cursorIndex(state, rows));
  const needle = command.query.trim().toLowerCase();
  const start = command.includeCurrent ? 0 : 1;
  for (let step = start; step <= rows.length; step += 1) {
    const index = (current + command.direction * step + rows.length * 2) % rows.length;
    if (rows[index].nameSnapshot.toLowerCase().includes(needle)) {
      return { state: { ...state, cursorId: rows[index].id }, message: `/${command.query}`, changedDocuments: false };
    }
  }
  return { state, message: `/${command.query} · no match`, changedDocuments: false };
}

function repeat(state: FoodLogState, context: ExecutionContext): ExecutionResult {
  if (!state.lastChange || state.lastChange.type === 'repeat') return { state, message: 'nothing to repeat', changedDocuments: false };
  return executeFoodLogCommand(state, state.lastChange, context);
}

export function executeFoodLogCommand(
  inputState: FoodLogState,
  command: FoodLogCommand,
  context: ExecutionContext = defaultContext,
): ExecutionResult {
  const state = ensureCursor(inputState);

  if (command.type === 'move-cursor') {
    return { state: moveCursor(state, command.motion), message: null, changedDocuments: false };
  }
  if (command.type === 'change-day') {
    const next = ensureCursor({ ...state, selectedDateId: addDays(state.selectedDateId, command.delta), mode: 'normal', selectionAnchorId: null });
    return { state: next, message: null, changedDocuments: false };
  }
  if (command.type === 'go-today') {
    return { state: ensureCursor({ ...state, selectedDateId: todayId(), mode: 'normal', selectionAnchorId: null }), message: 'today', changedDocuments: false };
  }
  if (command.type === 'toggle-visual') {
    if (state.mode === 'visual') return { state: { ...state, mode: 'normal', selectionAnchorId: null }, message: null, changedDocuments: false };
    return { state: { ...state, mode: 'visual', selectionAnchorId: state.cursorId }, message: null, changedDocuments: false };
  }
  if (command.type === 'select-hour-block') {
    const rows = documentsForSelectedDay(state);
    const current = cursorIndex(state, rows);
    if (current < 0) return { state, message: null, changedDocuments: false };
    const hour = hourKey(rows[current]);
    const indexes = rows.flatMap((row, index) => hourKey(row) === hour ? [index] : []);
    return {
      state: { ...state, mode: 'visual', selectionAnchorId: rows[indexes[0]].id, cursorId: rows[indexes[indexes.length - 1]].id },
      message: `${indexes.length} selected`,
      changedDocuments: false,
    };
  }
  if (command.type === 'cancel-mode') {
    return { state: { ...state, mode: 'normal', selectionAnchorId: null }, message: null, changedDocuments: false };
  }
  if (command.type === 'operate') return executeOperator(state, command.operator, command.target, context);
  if (command.type === 'paste') return executePaste(state, command, context);
  if (command.type === 'move-rows') return executeMoveRows(state, command, context);
  if (command.type === 'undo') return executeUndo(state, command.count);
  if (command.type === 'redo') return executeRedo(state, command.count);
  if (command.type === 'repeat') return repeat(state, context);
  if (command.type === 'add-food') return executeAdd(state, command, context);
  if (command.type === 'replace-food') return executeReplace(state, command, context);
  if (command.type === 'set-quantity') return executeQuantity(state, command, context);
  if (command.type === 'set-time' || command.type === 'shift-time') return executeTimeChange(state, command, context);
  if (command.type === 'search') return executeSearch(state, command);

  // UI-opening commands are intentionally interpreted by the React controller.
  return { state, message: null, changedDocuments: false };
}
