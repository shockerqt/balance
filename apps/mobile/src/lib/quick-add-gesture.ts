// BAL-066: pure gesture contract adapted from the approved sandbox v1.5.0.
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const HOURS = Array.from({ length: 19 }, (_, i) => i + 5);
export const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const HOLD_MS = 350;
const TAP_DISTANCE = 10;
const AXIS_DISTANCE = 18;
const AXIS_DOMINANCE = 1.3;
const AXIS_RESET = 12;
const ARM_DISTANCE = 44;
const DISARM_DISTANCE = 28;
const RADIAL_DISTANCE = 32;
const DOWN_CANCEL = 40;

/* Geometría del dial radial de herradura (288° con boca inferior de 72° mirando al +). */
const RADIAL_SIZE = 288;
const RADIAL_CX = RADIAL_SIZE / 2;
const RADIAL_START_DEG = 126;
const RADIAL_STEP_DEG = 16;
const RADIAL_INNER_CANCEL = 70;
const RADIAL_OUTER_CANCEL = 144;


type SwipeAction = 'weight' | 'hour' | 'food';
type Axis = 'left' | 'right' | 'up' | 'down';
export type PlusGestureState = {
  id: number | string;
  x: number;
  y: number;
  startedAt: number;
  maxDistance: number;
  dx: number;
  dy: number;
  phase: 'pending' | 'dragging' | 'radial' | 'cancelled' | 'finished';
  axis: Axis | null;
  armed: 'weight' | 'food' | null;
  target: SwipeAction | null;
  progress: number;
  puck: { x: number; y: number };
  hour: number | null;
  outcome: 'tap' | 'weight' | 'food' | 'cancel' | number | null;
};
export type PlusGestureEvent =
  | { type: 'start'; id: number | string; x: number; y: number; time: number }
  | { type: 'move' | 'release'; x: number; y: number; time: number; hour?: number | null }
  | { type: 'hold'; time: number }
  | { type: 'cancel' };

/** Resistencia vectorial: el botón exterior nunca se mueve. */
export function puckOffset(dx: number, dy: number) {
  const distance = Math.hypot(dx, dy);
  const amount = 24 * (1 - Math.exp(-distance / 48));
  return distance === 0 ? { x: 0, y: 0 } : { x: dx / distance * amount, y: dy / distance * amount };
}

/** Transiciones sin DOM, reloj global ni efectos; ambos docks comparten este contrato. */
export function transitionPlusGesture(state: PlusGestureState | null, event: PlusGestureEvent): PlusGestureState {
  if (event.type === 'start') {
    return { id: event.id, x: event.x, y: event.y, startedAt: event.time, maxDistance: 0,
      dx: 0, dy: 0, phase: 'pending', axis: null, armed: null, target: null, progress: 0,
      puck: { x: 0, y: 0 }, hour: null, outcome: null };
  }
  if (!state) throw new Error('El gesto necesita un inicio');
  if (state.phase === 'finished') return state;
  const cancel = (): PlusGestureState => ({ ...state, phase: 'cancelled', axis: null, armed: null,
    target: null, progress: 0, puck: { x: 0, y: 0 }, hour: null, outcome: 'cancel' });
  if (event.type === 'cancel') return cancel();
  if (state.phase === 'cancelled') return state;
  if (event.type === 'hold') {
    return state.phase === 'pending' && state.maxDistance <= TAP_DISTANCE && event.time - state.startedAt >= HOLD_MS
      ? { ...state, phase: 'radial', hour: null, armed: null, target: 'hour', progress: 1 }
      : state;
  }
  const dx = event.x - state.x;
  const dy = event.y - state.y;
  const distance = Math.hypot(dx, dy);
  const maxDistance = Math.max(state.maxDistance, distance);
  if (dy > DOWN_CANCEL) return cancel();
  let next: PlusGestureState = { ...state, dx, dy, maxDistance, puck: puckOffset(dx, dy) };
  if (state.phase === 'radial') {
    next.hour = event.hour === undefined ? state.hour : event.hour;
  } else {
    next.phase = maxDistance <= TAP_DISTANCE ? 'pending' : 'dragging';
    if (distance <= AXIS_RESET) {
      next.axis = null;
      next.armed = null;
    } else if (next.axis === null && distance >= AXIS_DISTANCE) {
      if (Math.abs(dx) >= AXIS_DOMINANCE * Math.abs(dy)) next.axis = dx < 0 ? 'left' : 'right';
      else if (Math.abs(dy) >= AXIS_DOMINANCE * Math.abs(dx)) next.axis = dy < 0 ? 'up' : 'down';
    }
    const lateral = next.axis === 'left' ? -dx : next.axis === 'right' ? dx : 0;
    if (lateral < DISARM_DISTANCE) next.armed = null;
    if (lateral >= ARM_DISTANCE) next.armed = next.axis === 'left' ? 'weight' : 'food';
    next.target = lateral > 0 ? (next.axis === 'left' ? 'weight' : 'food') : next.axis === 'up' && dy < 0 ? 'hour' : null;
    next.progress = next.target === null ? 0 : clamp((next.target === 'hour' ? -dy : lateral) / (next.target === 'hour' ? RADIAL_DISTANCE : ARM_DISTANCE));
    if (next.axis === 'up' && dy <= -RADIAL_DISTANCE) {
      next = { ...next, phase: 'radial', hour: null, armed: null, target: 'hour', progress: 1 };
    }
  }
  if (event.type === 'release') {
    const outcome = next.phase === 'radial' ? next.hour ?? 'cancel'
      : maxDistance <= TAP_DISTANCE && event.time - state.startedAt < HOLD_MS ? 'tap'
      : next.armed ?? 'cancel';
    return { ...next, phase: 'finished', outcome, puck: { x: 0, y: 0 }, progress: 0 };
  }
  return next;
}

/** Coordenadas cliente con cursor 24px sobre el dedo, normalizadas al dial renderizado. */
export function radialSelection(x: number, y: number,
  box: { left: number; top: number; width: number; height: number }, previous: number | null = null): number | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const dx = (x - box.left) * RADIAL_SIZE / box.width - RADIAL_CX;
  const dy = (y - 24 - box.top) * RADIAL_SIZE / box.height - RADIAL_CX;
  const radius = Math.hypot(dx, dy);
  if (radius <= RADIAL_INNER_CANCEL || radius > RADIAL_OUTER_CANCEL) return null;
  const alpha = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  if (alpha > 62 && alpha < 118) return null;
  let delta = (alpha - RADIAL_START_DEG + 360) % 360;
  if (delta > 288) delta = alpha >= 90 ? 0 : 288;
  const previousIndex = previous === null ? -1 : HOURS.indexOf(previous);
  if (previousIndex >= 0 && Math.abs(delta - previousIndex * RADIAL_STEP_DEG) <= RADIAL_STEP_DEG / 2 + 3) return previous;
  return HOURS[clamp(Math.round(delta / RADIAL_STEP_DEG), 0, HOURS.length - 1)];
}

