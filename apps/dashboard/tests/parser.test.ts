import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyParserState } from '../src/features/food-log/commands/command.ts';
import { feedKey } from '../src/features/food-log/commands/parser.ts';

function parse(keys: string, mode: 'normal' | 'visual' = 'normal') {
  let state = emptyParserState();
  let command = null;
  for (const key of keys) {
    const result = feedKey(state, key, mode);
    state = result.state;
    if (result.command) command = result.command;
  }
  return { state, command };
}

test('parses counted direct delete', () => {
  assert.deepEqual(parse('5x').command, {
    type: 'operate',
    operator: 'delete',
    target: { type: 'current', count: 5 },
  });
});

test('parses inclusive operator motion distance', () => {
  assert.deepEqual(parse('d2j').command, {
    type: 'operate',
    operator: 'delete',
    target: { type: 'motion', motion: { type: 'item', direction: 1, count: 2 } },
  });
});

test('multiplies operator and motion counts', () => {
  assert.deepEqual(parse('2d3j').command, {
    type: 'operate',
    operator: 'delete',
    target: { type: 'motion', motion: { type: 'item', direction: 1, count: 6 } },
  });
});

test('parses hour block text object', () => {
  assert.deepEqual(parse('diw').command, {
    type: 'operate',
    operator: 'delete',
    target: { type: 'hour-block', count: 1 },
  });
});

test('parses block motion as an operator target', () => {
  assert.deepEqual(parse('d]').command, {
    type: 'operate',
    operator: 'delete',
    target: { type: 'motion', motion: { type: 'block', direction: 1, count: 1 } },
  });
});

test('visual delete operates immediately on selection', () => {
  assert.deepEqual(parse('d', 'visual').command, {
    type: 'operate',
    operator: 'delete',
    target: { type: 'selection' },
  });
});

test('gt returns to today while t remains time editing', () => {
  assert.deepEqual(parse('gt').command, { type: 'go-today' });
  assert.deepEqual(parse('t').command, { type: 'open-time-editor' });
});

test('numeric prefix on add is treated as a time literal', () => {
  assert.deepEqual(parse('1330a').command, {
    type: 'open-add',
    side: 'explicit',
    timeLiteral: '1330',
  });
});

test('visual text objects select the current hour block', () => {
  assert.deepEqual(parse('iw', 'visual').command, { type: 'select-hour-block' });
  assert.deepEqual(parse('ab', 'visual').command, { type: 'select-hour-block' });
});
