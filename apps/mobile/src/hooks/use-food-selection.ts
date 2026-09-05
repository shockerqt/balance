import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LoggedFoodItem } from '@/hooks/use-meal-store';

/* ============================================================
   Seleccion multiple de alimentos.

   Eran seis handlers y dos estados sueltos dentro de la pantalla de
   registros, mezclados con el ruteo y los modales. Aqui quedan como
   una sola pieza con su propia invariante: al vaciarse la seleccion,
   el modo se apaga.
   ============================================================ */

export interface FoodSelection {
  isSelectionMode: boolean;
  selectedIds: ReadonlySet<string>;
  selectedCount: number;
  /** Mantener pulsado un alimento entra en modo seleccion. */
  startFromFood: (food: LoggedFoodItem) => void;
  /** Mantener pulsado un grupo horario selecciona todo el grupo. */
  startFromGroup: (foodIds: string[]) => void;
  toggleFood: (foodId: string) => void;
  /** Si el grupo esta entero seleccionado lo deselecciona; si no, lo agrega. */
  toggleGroup: (foodIds: string[]) => void;
  clear: () => void;
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set();
type SelectionState = { scope: string; ids: ReadonlySet<string> };

export function useFoodSelection(scope = 'default'): FoodSelection {
  const committedScope = useRef(scope);
  useLayoutEffect(() => { committedScope.current = scope; }, [scope]);
  const [state, setState] = useState<SelectionState>({ scope, ids: EMPTY_SELECTION });
  const selectedIds = state.scope === scope ? state.ids : EMPTY_SELECTION;

  // Clear a previous day's nonempty selection before native input can act on it.
  // Ordinary date navigation with no selection causes no additional state update.
  useLayoutEffect(() => {
    if (state.scope !== scope && state.ids.size) setState({ scope, ids: EMPTY_SELECTION });
  }, [scope, state]);

  const clear = useCallback(() => {
    if (committedScope.current !== scope) return;
    setState((previous) => previous.ids.size ? { scope, ids: EMPTY_SELECTION } : previous);
  }, [scope]);

  const startFromGroup = useCallback((ids: string[]) => {
    if (committedScope.current !== scope) return;
    setState((previous) => previous.scope === scope && previous.ids.size
      ? previous : { scope, ids: new Set(ids) });
  }, [scope]);
  const startFromFood = useCallback((food: LoggedFoodItem) => startFromGroup([food.id]), [startFromGroup]);

  const toggleGroup = useCallback((ids: string[]) => {
    if (committedScope.current !== scope) return;
    setState((previous) => {
      const next = new Set(previous.scope === scope ? previous.ids : EMPTY_SELECTION);
      const allSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => allSelected ? next.delete(id) : next.add(id));
      return { scope, ids: next.size ? next : EMPTY_SELECTION };
    });
  }, [scope]);
  const toggleFood = useCallback((id: string) => toggleGroup([id]), [toggleGroup]);

  return useMemo(() => ({
    isSelectionMode: selectedIds.size > 0,
    selectedIds, selectedCount: selectedIds.size,
    startFromFood, startFromGroup, toggleFood, toggleGroup, clear,
  }), [selectedIds, startFromFood, startFromGroup, toggleFood, toggleGroup, clear]);
}
