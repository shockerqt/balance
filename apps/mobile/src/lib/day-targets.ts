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
