import { useEffect, useMemo, useRef, useState } from 'react';
import type { MealTemplateDoc } from '../../../../types/meal-log.ts';
import type { FoodLogController } from '../../hooks/use-food-log-controller.ts';
import styles from './command-panel.module.css';

interface CommandPanelProps {
  controller: FoodLogController;
}

export function CommandPanel({ controller }: CommandPanelProps) {
  const { overlay } = controller;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [resultIndex, setResultIndex] = useState(0);

  useEffect(() => {
    if (!overlay) return;
    setQuery(overlay.type === 'search' ? controller.lastSearch : '');
    setResultIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [controller.lastSearch, overlay]);

  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return controller.templates
      .filter((template) => !template._deleted && template.name.toLowerCase().includes(needle))
      .slice(0, 7);
  }, [controller.templates, query]);

  if (!overlay) return null;

  const cancel = () => controller.closeOverlay();
  const cycleResult = (delta: number) => {
    if (!filteredTemplates.length) return;
    setResultIndex((currentIndex) => (currentIndex + delta + filteredTemplates.length) % filteredTemplates.length);
  };

  if (overlay.type === 'help') {
    return (
      <section className={styles.panel} aria-label="Keyboard shortcut reference">
        <div className={styles.helpHeader}>
          <span>balance://keys</span>
          <button type="button" onClick={cancel}>esc</button>
        </div>
        <div className={styles.helpGrid}>
          <HelpGroup title="navigate" lines={['j/k  item', '[/]  hour block', 'h/l  day', 'H/L  week', 'gg/G  first/last', 'gt  today']} />
          <HelpGroup title="select" lines={['Space/v  visual', 'V  hour block', 'viw/vib  block object', 'Esc  normal']} />
          <HelpGroup title="edit" lines={['x/dd/D  delete', 'd{motion}  delete range', 'yy/y{motion}  yank', 'p/P  paste', 'u/U/Ctrl+r  history', '.  repeat']} />
          <HelpGroup title="food" lines={['a/o/O/A  add', '13a/1330a  add time', 'r  replace', 'e  quantity', 't  timestamp', '/ n N  search']} />
        </div>
      </section>
    );
  }

  if (overlay.type === 'picker') {
    return (
      <section className={styles.panel} aria-label={overlay.intent === 'replace' ? 'Replace food' : 'Add food'}>
        <div className={styles.commandLine}>
          <span>{overlay.intent === 'replace' ? 'replace>' : `add${overlay.time ? ` @ ${overlay.time}` : ''}>`}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setResultIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); cancel(); }
              else if (event.key === 'Tab') { event.preventDefault(); cycleResult(event.shiftKey ? -1 : 1); }
              else if (event.altKey && event.code === 'KeyJ') { event.preventDefault(); cycleResult(1); }
              else if (event.altKey && event.code === 'KeyK') { event.preventDefault(); cycleResult(-1); }
              else if (event.key === 'ArrowDown') { event.preventDefault(); cycleResult(1); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); cycleResult(-1); }
              else if (event.key === 'Enter' && filteredTemplates[resultIndex]) {
                event.preventDefault();
                controller.chooseTemplate(filteredTemplates[resultIndex]);
              }
            }}
            placeholder="search food library…"
            aria-label="Search food library"
          />
        </div>
        <div className={styles.hint}>tab/⇧tab · alt+j/k · enter · esc</div>
        <div className={styles.results}>
          {filteredTemplates.map((template, index) => (
            <TemplateResult
              key={template.id}
              template={template}
              active={index === resultIndex}
              onHover={() => setResultIndex(index)}
              onSelect={() => controller.chooseTemplate(template)}
            />
          ))}
        </div>
      </section>
    );
  }

  if (overlay.type === 'quantity' || overlay.type === 'time') return null;

  return (
    <section className={styles.panel} aria-label="Search current day">
      <div className={styles.commandLine}>
        <span>/</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); cancel(); }
            else if (event.key === 'Enter') { event.preventDefault(); controller.commitSearch(query); }
          }}
          placeholder="search current day…"
          aria-label="Search current day"
        />
      </div>
      <div className={styles.hint}>enter search · n/N next/previous · esc</div>
    </section>
  );
}

interface HelpGroupProps {
  title: string;
  lines: string[];
}

function HelpGroup({ title, lines }: HelpGroupProps) {
  return (
    <div className={styles.helpGroup}>
      <strong>{title}</strong>
      {lines.map((line) => <span key={line}>{line}</span>)}
    </div>
  );
}

interface TemplateResultProps {
  template: MealTemplateDoc;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}

function TemplateResult({ template, active, onHover, onSelect }: TemplateResultProps) {
  const nutrition = template.details.nutrition;
  return (
    <button
      type="button"
      className={active ? styles.resultActive : styles.result}
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      <span>{active ? '>' : ' '}</span>
      <span>{template.name}</span>
      <span>{template.details.baseAmount} {template.details.unit}</span>
      <span>{Math.round(nutrition.calories)} kcal · {Math.round(nutrition.protein)}P {Math.round(nutrition.carbs)}C {Math.round(nutrition.fat)}F</span>
    </button>
  );
}
