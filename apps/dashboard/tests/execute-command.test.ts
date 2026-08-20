import assert from 'node:assert/strict';
import test from 'node:test';
import type { MealLogDoc } from '../src/types/meal-log.ts';
import type { FoodLogState } from '../src/features/food-log/domain/food-log-state.ts';
import { documentsForSelectedDay } from '../src/features/food-log/domain/food-log-state.ts';
import { epochForChileDateTime } from '../src/features/food-log/domain/time.ts';
import { executeFoodLogCommand, type ExecutionContext } from '../src/features/food-log/commands/execute-command.ts';

const dateId = '2026-08-20';
const context: ExecutionContext = {
  now: () => 1_800_000_000_000,
  createId: (() => {
    let next = 0;
    return () => `new-${++next}`;
  })(),
};

function row(id: string, time: string, name: string): MealLogDoc {
  const consumedAt = epochForChileDateTime(dateId, time);
  if (consumedAt === null) throw new Error('bad test time');
  return {
    id,
    templateId: id,
    nameSnapshot: name,
    nutritionSnapshot: {
      schemaVersion: 1,
      baseAmount: 100,
      unit: 'g',
      nutrition: { calories: 100, protein: 10, carbs: 10, fat: 2 },
    },
    quantity: 100,
    consumedAt,
    updatedAt: 1,
    _deleted: false,
  };
}

function state(): FoodLogState {
  return {
    documents: [
      row('a', '07:00', 'Avena'),
      row('b', '13:02', 'Whey'),
      row('c', '13:08', 'Pan'),
      row('d', '13:15', 'Palta'),
      row('e', '14:00', 'Pollo'),
    ],
    selectedDateId: dateId,
    cursorId: 'c',
    selectionAnchorId: null,
    mode: 'normal',
    register: null,
    history: [],
    future: [],
    lastChange: null,
  };
}

test('delete through motion is inclusive and fills register', () => {
  const result = executeFoodLogCommand(state(), {
    type: 'operate',
    operator: 'delete',
    target: { type: 'motion', motion: { type: 'item', direction: 1, count: 2 } },
  }, context);
  assert.deepEqual(documentsForSelectedDay(result.state).map((doc) => doc.id), ['a', 'b']);
  assert.deepEqual(result.state.register?.items.map((item) => item.nameSnapshot), ['Pan', 'Palta', 'Pollo']);
});

test('D deletes cursor through end of current hour block', () => {
  const result = executeFoodLogCommand(state(), {
    type: 'operate',
    operator: 'delete',
    target: { type: 'block-tail' },
  }, context);
  assert.deepEqual(documentsForSelectedDay(result.state).map((doc) => doc.id), ['a', 'b', 'e']);
  assert.deepEqual(result.state.register?.items.map((item) => item.nameSnapshot), ['Pan', 'Palta']);
});

test('normal paste keeps register and generates fresh ids', () => {
  const yanked = executeFoodLogCommand(state(), {
    type: 'operate',
    operator: 'yank',
    target: { type: 'current', count: 1 },
  }, context).state;
  const pasted = executeFoodLogCommand(yanked, { type: 'paste', side: 'after', count: 2 }, context).state;
  assert.equal(pasted.register?.items.length, 1);
  assert.equal(documentsForSelectedDay(pasted).filter((doc) => doc.nameSnapshot === 'Pan').length, 3);
  assert.ok(pasted.documents.some((doc) => doc.id.startsWith('new-')));
});

test('visual paste swaps displaced selection into register', () => {
  let current = executeFoodLogCommand(state(), {
    type: 'operate',
    operator: 'yank',
    target: { type: 'current', count: 1 },
  }, context).state;
  current = { ...current, mode: 'visual', selectionAnchorId: 'd', cursorId: 'e' };
  const pasted = executeFoodLogCommand(current, { type: 'paste', side: 'after', count: 1 }, context).state;
  assert.deepEqual(pasted.register?.items.map((item) => item.nameSnapshot), ['Palta', 'Pollo']);
  assert.equal(documentsForSelectedDay(pasted).some((doc) => doc.nameSnapshot === 'Pan'), true);
});

test('undo and redo restore document mutations', () => {
  const deleted = executeFoodLogCommand(state(), {
    type: 'operate',
    operator: 'delete',
    target: { type: 'current', count: 1 },
  }, context).state;
  const undone = executeFoodLogCommand(deleted, { type: 'undo', count: 1 }, context).state;
  assert.deepEqual(documentsForSelectedDay(undone).map((doc) => doc.id), ['a', 'b', 'c', 'd', 'e']);
  const redone = executeFoodLogCommand(undone, { type: 'redo', count: 1 }, context).state;
  assert.deepEqual(documentsForSelectedDay(redone).map((doc) => doc.id), ['a', 'b', 'd', 'e']);
});
