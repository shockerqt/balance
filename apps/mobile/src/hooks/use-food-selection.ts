import { useCallback, useMemo, useState } from 'react';
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

export function useFoodSelection(): FoodSelection {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const clear = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const startFromFood = useCallback((food: LoggedFoodItem) => {
    setIsSelectionMode((mode) => {
      if (!mode) setSelectedIds(new Set([food.id]));
      return true;
    });
  }, []);

  const startFromGroup = useCallback((foodIds: string[]) => {
    setIsSelectionMode((mode) => {
      if (!mode) setSelectedIds(new Set(foodIds));
      return true;
    });
  }, []);

  const toggleFood = useCallback((foodId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(foodId)) next.delete(foodId);
      else next.add(foodId);
      if (next.size === 0) setIsSelectionMode(false);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((foodIds: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = foodIds.every((id) => next.has(id));
      foodIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      if (next.size === 0) setIsSelectionMode(false);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      isSelectionMode,
      selectedIds,
      selectedCount: selectedIds.size,
      startFromFood,
      startFromGroup,
      toggleFood,
      toggleGroup,
      clear,
    }),
    [isSelectionMode, selectedIds, startFromFood, startFromGroup, toggleFood, toggleGroup, clear]
  );
}
