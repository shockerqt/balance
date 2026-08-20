import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { MealLogDoc, MealTemplateDoc } from '../../../types/meal-log';
import {
  documentsForSelectedDay,
  ensureCursor,
  selectedRowIds,
  type FoodLogState,
} from '../domain/food-log-state';
import { parseCompactTime, parseTimeExpression, todayId } from '../domain/time';
import {
  emptyParserState,
  pendingKeys,
  type FoodLogCommand,
  type ParserState,
  type Target,
} from '../commands/command';
import { executeFoodLogCommand } from '../commands/execute-command';
import { feedKey } from '../commands/parser';
import { sampleMealLogs, sampleTemplates } from '../data/sample-data';
import { browserFoodLogStorage } from '../services/food-log-storage';

export type FoodLogOverlay =
  | {
      type: 'picker';
      intent: 'add' | 'replace';
      side: 'before' | 'after' | 'now' | 'explicit';
      time?: string;
    }
  | { type: 'quantity' }
  | { type: 'time' }
  | { type: 'search' }
  | { type: 'help' }
  | null;

export interface FoodLogController {
  state: FoodLogState;
  rows: MealLogDoc[];
  selectedIds: Set<string>;
  templates: MealTemplateDoc[];
  overlay: FoodLogOverlay;
  pending: string;
  message: string;
  lastSearch: string;
  terminalRef: RefObject<HTMLElement | null>;
  persistenceLabel: string;
  dispatch: (command: FoodLogCommand) => void;
  closeOverlay: () => void;
  chooseTemplate: (template: MealTemplateDoc) => void;
  commitQuantity: (value: string, unit: import('../../../types/meal-log.ts').MealUnit) => boolean;
  commitTime: (value: string) => boolean;
  commitSearch: (query: string) => void;
  selectRow: (id: string) => void;
  openQuantityFor: (id: string) => void;
  openTimeFor: (id: string) => void;
  selectHourById: (id: string) => void;
}

function createInitialState(): FoodLogState {
  const documents = browserFoodLogStorage.load() ?? sampleMealLogs();
  return ensureCursor({
    documents,
    selectedDateId: todayId(),
    cursorId: null,
    selectionAnchorId: null,
    mode: 'normal',
    register: null,
    history: [],
    future: [],
    lastChange: null,
  });
}

export function useFoodLogController(): FoodLogController {
  const [state, setState] = useState<FoodLogState>(createInitialState);
  const [parserState, setParserState] = useState<ParserState>(emptyParserState);
  const [overlay, setOverlay] = useState<FoodLogOverlay>(null);
  const [message, setMessage] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const terminalRef = useRef<HTMLElement>(null);
  const parserRef = useRef(parserState);
  const messageTimerRef = useRef<number | null>(null);

  const templates = useMemo(() => sampleTemplates(), []);
  const rows = useMemo(() => documentsForSelectedDay(state), [state]);
  const selectedIds = useMemo(() => new Set(selectedRowIds(state)), [state]);

  const restoreFocus = useCallback(() => {
    window.requestAnimationFrame(() => terminalRef.current?.focus({ preventScroll: true }));
  }, []);

  const flash = useCallback((next: string) => {
    setMessage(next);
    if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage(''), 1600);
  }, []);

  const resetParser = useCallback(() => {
    const empty = emptyParserState();
    parserRef.current = empty;
    setParserState(empty);
  }, []);

  const execute = useCallback((command: FoodLogCommand) => {
    setState((current) => {
      const result = executeFoodLogCommand(current, command);
      if (result.changedDocuments) browserFoodLogStorage.save(result.state.documents);
      if (result.message) flash(result.message);
      return result.state;
    });
  }, [flash]);

  const targetForEditor = useCallback((current: FoodLogState): Target => {
    return current.mode === 'visual' ? { type: 'selection' } : { type: 'current', count: 1 };
  }, []);

  const dispatch = useCallback((command: FoodLogCommand) => {
    if (command.type === 'open-add') {
      if (command.side === 'explicit') {
        const time = parseCompactTime(command.timeLiteral ?? '');
        if (!time) {
          flash(`${command.timeLiteral ?? ''} · invalid time`);
          return;
        }
        setOverlay({ type: 'picker', intent: 'add', side: 'explicit', time });
      } else {
        setOverlay({ type: 'picker', intent: 'add', side: command.side });
      }
      return;
    }
    if (command.type === 'open-replace') {
      setOverlay({ type: 'picker', intent: 'replace', side: 'after' });
      return;
    }
    if (command.type === 'open-quantity-editor') {
      if (!state.cursorId) return;
      setOverlay({ type: 'quantity' });
      return;
    }
    if (command.type === 'open-time-editor') {
      if (!state.cursorId) return;
      setOverlay({ type: 'time' });
      return;
    }
    if (command.type === 'open-search') {
      setOverlay({ type: 'search' });
      return;
    }
    if (command.type === 'open-help') {
      setOverlay({ type: 'help' });
      return;
    }
    if (command.type === 'next-search') {
      if (!lastSearch) {
        flash('no search');
        return;
      }
      execute({ type: 'search', query: lastSearch, direction: command.direction });
      return;
    }
    execute(command);
  }, [execute, flash, lastSearch, state.cursorId]);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    resetParser();
    restoreFocus();
  }, [resetParser, restoreFocus]);

  const chooseTemplate = useCallback((template: MealTemplateDoc) => {
    if (!overlay || overlay.type !== 'picker') return;
    if (overlay.intent === 'replace') execute({ type: 'replace-food', template });
    else execute({ type: 'add-food', template, side: overlay.side, ...(overlay.time ? { time: overlay.time } : {}) });
    setOverlay(null);
    restoreFocus();
  }, [execute, overlay, restoreFocus]);

  const commitQuantity = useCallback((value: string, unit: import('../../../types/meal-log.ts').MealUnit): boolean => {
    const quantity = Number(value);
    const current = rows.find((row) => row.id === state.cursorId);
    if (!current || !Number.isFinite(quantity) || quantity <= 0) {
      flash('invalid quantity');
      return false;
    }
    execute({ type: 'set-quantity', quantity, unit });
    setOverlay(null);
    restoreFocus();
    return true;
  }, [execute, flash, restoreFocus, rows, state.cursorId]);

  const commitTime = useCallback((value: string): boolean => {
    const expression = parseTimeExpression(value);
    if (!expression) {
      flash(`${value || 'empty'} · invalid time`);
      return false;
    }
    const target = targetForEditor(state);
    if (expression.kind === 'absolute') execute({ type: 'set-time', target, time: expression.time });
    else execute({ type: 'shift-time', target, minutes: expression.minutes });
    setOverlay(null);
    restoreFocus();
    return true;
  }, [execute, flash, restoreFocus, state, targetForEditor]);

  const commitSearch = useCallback((query: string) => {
    const normalized = query.trim();
    if (!normalized) {
      closeOverlay();
      return;
    }
    setLastSearch(normalized);
    execute({ type: 'search', query: normalized, direction: 1, includeCurrent: true });
    setOverlay(null);
    restoreFocus();
  }, [closeOverlay, execute, restoreFocus]);

  const selectRow = useCallback((id: string) => {
    setState((current) => ({ ...current, cursorId: id, mode: 'normal', selectionAnchorId: null }));
    resetParser();
    restoreFocus();
  }, [resetParser, restoreFocus]);

  const openQuantityFor = useCallback((id: string) => {
    setState((current) => ({ ...current, cursorId: id }));
    setOverlay({ type: 'quantity' });
  }, []);

  const openTimeFor = useCallback((id: string) => {
    setState((current) => ({ ...current, cursorId: id }));
    setOverlay({ type: 'time' });
  }, []);

  const selectHourById = useCallback((id: string) => {
    setState((current) => {
      const withCursor = { ...current, cursorId: id };
      return executeFoodLogCommand(withCursor, { type: 'select-hour-block' }).state;
    });
    resetParser();
    restoreFocus();
  }, [resetParser, restoreFocus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'r'
      ) {
        event.preventDefault();
        if (overlay) flash('redo unavailable while editing');
        else dispatch({ type: 'redo', count: 1 });
        return;
      }

      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (overlay || typing || event.metaKey || event.ctrlKey || event.altKey) return;

      const output = feedKey(parserRef.current ?? emptyParserState(), event.key, state.mode);
      if (output.consumed) event.preventDefault();
      parserRef.current = output.state;
      setParserState(output.state);
      if (output.command) dispatch(output.command);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, flash, overlay, state.mode]);

  useEffect(() => () => {
    if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current);
  }, []);

  return {
    state,
    rows,
    selectedIds,
    templates,
    overlay,
    pending: pendingKeys(parserState),
    message,
    lastSearch,
    terminalRef,
    persistenceLabel: 'local',
    dispatch,
    closeOverlay,
    chooseTemplate,
    commitQuantity,
    commitTime,
    commitSearch,
    selectRow,
    openQuantityFor,
    openTimeFor,
    selectHourById,
  };
}
