import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanonicalUnit, MealLogDoc } from '../../../../types/meal-log.ts';
import {
  displayRow,
  hourKey,
  nutritionForDocument,
  type DisplayFoodRow,
} from '../../domain/food-log-state.ts';
import {
  dateDeltaFromToday,
  labelForDate,
  relationForDate,
  timeInChile,
} from '../../domain/time.ts';
import { useFoodLogController, type FoodLogController } from '../../hooks/use-food-log-controller.ts';
import { CommandPanel } from '../command-panel/command-panel.tsx';
import { MiniCalendar } from '../mini-calendar/mini-calendar.tsx';
import styles from './food-log.module.css';

interface GroupedRows {
  hour: string;
  rows: DisplayFoodRow[];
}

interface Totals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

function sumDocuments(documents: MealLogDoc[]): Totals {
  return documents.reduce<Totals>((total, document) => {
    const nutrition = nutritionForDocument(document);
    return {
      calories: total.calories + nutrition.calories,
      protein: total.protein + nutrition.protein,
      carbs: total.carbs + nutrition.carbs,
      fat: total.fat + nutrition.fat,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function groupRows(documents: MealLogDoc[]): GroupedRows[] {
  const groups = new Map<string, DisplayFoodRow[]>();
  for (const document of documents) {
    const key = hourKey(document);
    const group = groups.get(key) ?? [];
    group.push(displayRow(document));
    groups.set(key, group);
  }
  return Array.from(groups, ([hour, rows]) => ({ hour, rows }));
}

export function FoodLog() {
  const controller = useFoodLogController();
  const groups = useMemo(() => groupRows(controller.rows), [controller.rows]);
  const totals = useMemo(() => sumDocuments(controller.rows), [controller.rows]);
  const delta = dateDeltaFromToday(controller.state.selectedDateId);
  const deltaLabel = delta === 0 ? 'TODAY' : `Δ ${delta > 0 ? '+' : ''}${delta}d`;
  const status = controller.message || controller.pending || (controller.state.mode === 'visual'
    ? `${controller.selectedIds.size} selected · d/y · p replace · = normalize · t time`
    : controller.state.register
      ? `${controller.state.register.items.length} in register · p/P paste · ${controller.state.register.source}`
      : 'j/k items · [/] blocks · h/l day · gt today · Space visual · ? help');

  return (
    <div className={styles.page}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.orbOne} />
        <span className={styles.orbTwo} />
        <span className={styles.orbThree} />
      </div>

      <section
        ref={controller.terminalRef}
        tabIndex={-1}
        className={styles.terminal}
        aria-label="Balance terminal food log"
      >
        <header className={styles.topBar}>
          <div className={styles.headerCopy}>
            <div className={styles.path}>
              <span>balance://</span>
              <strong>{controller.state.selectedDateId}</strong>
            </div>
            <div className={styles.dateMeta}>
              <span>{labelForDate(controller.state.selectedDateId)}</span>
              <span className={styles.delta}>{deltaLabel}</span>
              <span className={styles.headerHint}>h/l day · H/L week · gt today · [/] blocks</span>
            </div>
          </div>
          <MiniCalendar dateId={controller.state.selectedDateId} />
        </header>

        <section className={styles.daySummary}>
          <div className={styles.dayCopy}>
            <strong>{labelForDate(controller.state.selectedDateId)}</strong>
            <span>{relationForDate(controller.state.selectedDateId)}</span>
          </div>
          <Metric label="KCAL" value={totals.calories} accent />
          <Metric label="P" value={totals.protein} />
          <Metric label="C" value={totals.carbs} />
          <Metric label="F" value={totals.fat} />
        </section>

        <div className={styles.columns} aria-hidden="true">
          <span />
          <span>time</span>
          <span className={styles.left}>food</span>
          <span>qty</span>
          <span className={styles.kcalColumn}>kcal</span>
          <span>P</span>
          <span>C</span>
          <span>F</span>
        </div>

        <main className={styles.buffer}>
          {groups.map((group) => {
            const groupDocuments = group.rows.map((row) => row.document);
            const subtotal = sumDocuments(groupDocuments);
            const first = group.rows[0]?.document;
            return (
              <section key={group.hour} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupHeader}
                  onClick={() => first && controller.selectHourById(first.id)}
                  title="Select hour block"
                >
                  <span className={styles.groupInfo}>
                    <strong>{group.hour}</strong>
                    <small>{group.rows.length} item{group.rows.length === 1 ? '' : 's'}</small>
                  </span>
                  <span className={styles.groupKcal}>Σ {Math.round(subtotal.calories)} kcal</span>
                  <span>{Math.round(subtotal.protein)}P</span>
                  <span>{Math.round(subtotal.carbs)}C</span>
                  <span>{Math.round(subtotal.fat)}F</span>
                </button>

                {group.rows.map((row) => (
                  <FoodRow
                    key={row.document.id}
                    row={row}
                    controller={controller}
                    selected={controller.state.mode === 'visual' && controller.selectedIds.has(row.document.id)}
                    cursor={controller.state.cursorId === row.document.id}
                  />
                ))}
              </section>
            );
          })}
          {!groups.length && <div className={styles.empty}>-- empty buffer --</div>}
        </main>

        <CommandPanel controller={controller} />

        <footer className={styles.statusBar}>
          <div className={styles.statusLeft}>
            <span className={controller.state.mode === 'visual' ? styles.modeVisual : styles.modeNormal}>
              {controller.state.mode.toUpperCase()}
            </span>
            <span className={styles.pending}>{controller.pending || '·'}</span>
            <span className={styles.statusText}>{status}</span>
          </div>
          <div className={styles.statusRight}>
            <span className={styles.persistence}>{controller.persistenceLabel}</span>
            <span>{deltaLabel.toLowerCase()}</span>
          </div>
        </footer>
      </section>
    </div>
  );
}

interface FoodRowProps {
  row: DisplayFoodRow;
  controller: FoodLogController;
  selected: boolean;
  cursor: boolean;
}

function FoodRow({ row, controller, selected, cursor }: FoodRowProps) {
  const editingQuantity = cursor && controller.overlay?.type === 'quantity';
  const editingTime = cursor && controller.overlay?.type === 'time';
  const nutrition = row.nutrition;
  return (
    <div
      className={`${styles.foodRow}${selected ? ` ${styles.selectedRow}` : ''}`}
      onClick={() => controller.selectRow(row.document.id)}
    >
      <span className={styles.pointer}>{cursor ? '>' : ''}</span>
      <span className={styles.timeCell} onClick={(event) => { event.stopPropagation(); controller.openTimeFor(row.document.id); }}>
        {editingTime ? <InlineTimeEditor controller={controller} document={row.document} /> : row.time}
      </span>
      <span className={styles.foodName}>{row.document.nameSnapshot}</span>
      <span className={styles.quantityCell} onClick={(event) => { event.stopPropagation(); controller.openQuantityFor(row.document.id); }}>
        {editingQuantity ? <InlineQuantityEditor controller={controller} document={row.document} /> : row.quantityLabel}
      </span>
      <span className={`${styles.number} ${styles.kcalColumn}`}>{Math.round(nutrition.calories)}</span>
      <span className={styles.number}>{Math.round(nutrition.protein)}</span>
      <span className={styles.number}>{Math.round(nutrition.carbs)}</span>
      <span className={styles.number}>{Math.round(nutrition.fat)}</span>
    </div>
  );
}

interface InlineTimeEditorProps {
  controller: FoodLogController;
  document: MealLogDoc;
}

function InlineTimeEditor({ controller, document }: InlineTimeEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <input
      ref={inputRef}
      className={styles.inlineInput}
      value={value}
      placeholder={timeInChile(document.consumedAt)}
      onChange={(event) => setValue(event.target.value.replace(/[^0-9+\-hH]/g, '').slice(0, 8))}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); controller.closeOverlay(); }
        else if (event.key === 'Enter') { event.preventDefault(); controller.commitTime(value); }
      }}
      aria-label="Edit time"
    />
  );
}

interface InlineQuantityEditorProps {
  controller: FoodLogController;
  document: MealLogDoc;
}

function InlineQuantityEditor({ controller, document }: InlineQuantityEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(String(document.entry.enteredQuantity));
  const canonicalUnit: CanonicalUnit = document.nutritionSnapshot.canonicalUnit;
  const unitLabel = document.entry.portionSnapshot?.name ?? canonicalUnit;
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <span className={styles.inlineQuantity}>
      <input
        ref={inputRef}
        className={styles.inlineInput}
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/[^0-9.]/g, ''))}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); controller.closeOverlay(); }
          else if (event.key === 'Enter') { event.preventDefault(); controller.commitQuantity(value, canonicalUnit); }
        }}
        aria-label="Edit quantity"
      />
      <b>{unitLabel}</b>
    </span>
  );
}

interface MetricProps {
  label: string;
  value: number;
  accent?: boolean;
}

function Metric({ label, value, accent = false }: MetricProps) {
  return (
    <div className={accent ? styles.metricAccent : styles.metric}>
      <strong>{Math.round(value)}</strong>
      <span>{label}</span>
    </div>
  );
}
