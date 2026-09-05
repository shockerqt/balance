import {
  emptyParserState,
  type FoodLogCommand,
  type Operator,
  type ParserOutput,
  type ParserState,
  type PendingOperator,
} from './command.ts';
import type { FoodLogMode } from '../domain/food-log-state.ts';

const operatorKeyMap: Record<string, Operator | undefined> = {
  d: 'delete',
  y: 'yank',
  '=': 'normalize',
};

function countValue(raw: string): number {
  return Number.parseInt(raw, 10) || 1;
}

function reset(command: FoodLogCommand | null, consumed = true): ParserOutput {
  return { state: emptyParserState(), command, consumed };
}

function withState(state: ParserState, command: FoodLogCommand | null = null): ParserOutput {
  return { state, command, consumed: true };
}

function operatorKey(operator: Operator): string {
  if (operator === 'delete') return 'd';
  if (operator === 'yank') return 'y';
  return '=';
}

function completePendingOperator(
  pending: PendingOperator,
  key: string,
): FoodLogCommand | null | 'pending' {
  const motionCount = countValue(pending.motionCount);
  const combined = Math.max(1, pending.operatorCount * motionCount);

  if (pending.awaitingG) {
    if (key === 'g') {
      return { type: 'operate', operator: pending.operator, target: { type: 'motion', motion: { type: 'first' } } };
    }
    return null;
  }

  if ((key === 'i' || key === 'a') && !pending.objectPrefix) return 'pending';

  if (pending.objectPrefix && (key === 'w' || key === 'b')) {
    return { type: 'operate', operator: pending.operator, target: { type: 'hour-block', count: combined } };
  }

  if (key === operatorKey(pending.operator) && pending.operator !== 'normalize') {
    return { type: 'operate', operator: pending.operator, target: { type: 'current', count: combined } };
  }

  if (key === 'j' || key === 'k') {
    return {
      type: 'operate',
      operator: pending.operator,
      target: {
        type: 'motion',
        motion: { type: 'item', direction: key === 'j' ? 1 : -1, count: combined },
      },
    };
  }

  if (key === '[' || key === ']') {
    return {
      type: 'operate',
      operator: pending.operator,
      target: {
        type: 'motion',
        motion: { type: 'block', direction: key === ']' ? 1 : -1, count: combined },
      },
    };
  }

  if (key === 'G') {
    return { type: 'operate', operator: pending.operator, target: { type: 'motion', motion: { type: 'last' } } };
  }

  if (key === 'g') return 'pending';
  return null;
}

export function feedKey(current: ParserState, key: string, mode: FoodLogMode): ParserOutput {
  if (current.visualObjectPrefix) {
    if (mode === 'visual' && (key === 'w' || key === 'b')) {
      return reset({ type: 'select-hour-block' });
    }
    if (key === 'Escape') return reset(null);
    return reset(null);
  }

  if (current.pendingOperator) {
    const pending = current.pendingOperator;
    if (key === 'Escape') return reset(null);
    if (/^\d$/.test(key)) {
      return withState({
        ...current,
        pendingOperator: { ...pending, motionCount: `${pending.motionCount}${key}`.slice(0, 4) },
      });
    }

    const completed = completePendingOperator(pending, key);
    if (completed === 'pending') {
      if ((key === 'i' || key === 'a') && !pending.objectPrefix) {
        return withState({
          ...current,
          pendingOperator: { ...pending, objectPrefix: key === 'i' ? 'inner' : 'around' },
        });
      }
      if (key === 'g' && !pending.awaitingG) {
        return withState({ ...current, pendingOperator: { ...pending, awaitingG: true } });
      }
      return withState(current);
    }
    return reset(completed);
  }

  if (current.pendingG) {
    if (key === 'g') return reset({ type: 'move-cursor', motion: { type: 'first' } });
    if (key === 't') return reset({ type: 'go-today' });
    if (key === 'Escape') return reset(null);
    return reset(null);
  }

  if (/^[1-9]$/.test(key) || (/^0$/.test(key) && current.count.length > 0)) {
    return withState({ ...current, count: `${current.count}${key}`.slice(0, 4) });
  }

  const count = countValue(current.count);
  const rawCount = current.count;

  if (key === 'Escape') return reset({ type: 'cancel-mode' });
  if (key === ' ' || key === 'v') return reset({ type: 'toggle-visual' });
  if (key === 'V') return reset({ type: 'select-hour-block' });
  if (mode === 'visual' && (key === 'i' || key === 'a')) {
    return withState({
      ...emptyParserState(),
      visualObjectPrefix: key === 'i' ? 'inner' : 'around',
    });
  }

  if (key === 'h' || key === 'l' || key === 'H' || key === 'L') {
    const direction = key === 'h' || key === 'H' ? -1 : 1;
    const unit = key === 'H' || key === 'L' ? 7 : 1;
    return reset({ type: 'change-day', delta: direction * unit * count });
  }

  if (key === 'j' || key === 'k') {
    return reset({
      type: 'move-cursor',
      motion: { type: 'item', direction: key === 'j' ? 1 : -1, count },
    });
  }

  if (key === '[' || key === ']') {
    return reset({
      type: 'move-cursor',
      motion: { type: 'block', direction: key === ']' ? 1 : -1, count },
    });
  }

  if (key === 'g') return withState({ ...emptyParserState(), pendingG: true });
  if (key === 'G') {
    return reset({
      type: 'move-cursor',
      motion: rawCount ? { type: 'index', index: Math.max(0, Number(rawCount) - 1) } : { type: 'last' },
    });
  }

  const operator = operatorKeyMap[key];
  if (operator) {
    if (mode === 'visual') {
      return reset({ type: 'operate', operator, target: { type: 'selection' } });
    }
    return withState({
      ...emptyParserState(),
      pendingOperator: {
        operator,
        operatorCount: count,
        motionCount: '',
        objectPrefix: null,
        awaitingG: false,
      },
    });
  }

  if (key === 'x') {
    return reset({ type: 'operate', operator: 'delete', target: mode === 'visual' ? { type: 'selection' } : { type: 'current', count } });
  }
  if (key === 'D') return reset({ type: 'operate', operator: 'delete', target: { type: 'block-tail' } });
  if (key === 'p' || key === 'P') return reset({ type: 'paste', side: key === 'P' ? 'before' : 'after', count });
  if (key === '>' || key === '<') return reset({ type: 'move-rows', direction: key === '>' ? 1 : -1, count });
  if (key === 'u') return reset({ type: 'undo', count });
  if (key === 'U') return reset({ type: 'redo', count });
  if (key === '.') return reset({ type: 'repeat' });
  if (key === '/') return reset({ type: 'open-search' });
  if (key === '?') return reset({ type: 'open-help' });
  if (key === 'n' || key === 'N') return reset({ type: 'next-search', direction: key === 'n' ? 1 : -1 });
  if (key === 'r') return reset({ type: 'open-replace' });
  if (key === 'e') return reset({ type: 'open-quantity-editor' });
  if (key === 't') return reset({ type: 'open-time-editor' });

  if (key === 'o' || key === 'O' || key === 'a' || key === 'A') {
    if ((key === 'a' || key === 'A') && rawCount) {
      return reset({ type: 'open-add', side: 'explicit', timeLiteral: rawCount });
    }
    if (key === 'A') return reset({ type: 'open-add', side: 'now' });
    return reset({ type: 'open-add', side: key === 'O' ? 'before' : 'after' });
  }

  return { state: emptyParserState(), command: null, consumed: false };
}
