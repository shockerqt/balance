/** UI-thread release policy; a viewport can settle at most one prepared day. */
export function dayPagerOffset(translationX: number, velocityX: number, width: number, success = true): number {
  'worklet';
  if (!success || width <= 0) return 0;
  const projected = -translationX / width - velocityX / width * 0.18;
  return projected > 0.35 ? 1 : projected < -0.35 ? -1 : 0;
}

export function acceptDaySettle(expectedRevision: number, currentRevision: number, active: boolean): boolean {
  return active && expectedRevision === currentRevision;
}
