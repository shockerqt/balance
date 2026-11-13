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

export function isValidDailyCalorieTarget(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 500 && value <= 10000;
}

export function resolveDailyCalorieTarget(value: unknown): number {
  return isValidDailyCalorieTarget(value) ? value : DEFAULT_TARGETS.targetCalories;
}
