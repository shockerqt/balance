import { isValidDailyCalorieTarget } from '../services/sync/types.ts';
export { isValidDailyCalorieTarget };

export interface DayTargets {
  targetCalories: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat: number;
  targetFiber: number;
}

export const DEFAULT_TARGETS: DayTargets = {
  targetCalories: 2200,
  targetProtein: 150,
  targetCarbs: 220,
  targetFat: 65,
  targetFiber: 30,
};

export function resolveDailyCalorieTarget(value: unknown): number {
  return isValidDailyCalorieTarget(value) ? value : DEFAULT_TARGETS.targetCalories;
}
