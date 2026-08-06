import { PaletteColors, Theme, border, radius, space, type } from './tokens';

/* ============================================================
   Paletas.

   Cada una llena el mismo contrato, asi que agregar una es
   escribir un bloque de colores: ni las pantallas ni las
   primitivas cambian.
   ============================================================ */

const build = (
  key: string,
  name: string,
  scheme: 'light' | 'dark',
  colors: PaletteColors
): Theme => ({ key, name, scheme, colors, type, space, radius, border });

const midnightEmerald = build('midnightEmerald', 'Midnight & Emerald', 'dark', {
  background: '#0B0E14',
  surface: '#161B22',
  surfaceRaised: '#1C2128',
  border: '#21262D',

  primary: '#10B981',
  primaryPressed: '#059669',
  onPrimary: '#042F2E',

  text: '#F0F6FC',
  textSecondary: '#8B949E',
  textMuted: '#6E7681',

  scrim: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',

  danger: '#F87171',
  success: '#34D399',

  macroProtein: '#10B981',
  macroCarbs: '#38BDF8',
  macroFat: '#F59E0B',
  macroFiber: '#A78BFA',
});

const obsidianCobalt = build('obsidianCobalt', 'Obsidian & Cobalt', 'dark', {
  background: '#080B11',
  surface: '#0F172A',
  surfaceRaised: '#131C2E',
  border: '#1E293B',

  primary: '#3B82F6',
  primaryPressed: '#2563EB',
  onPrimary: '#FFFFFF',

  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',

  scrim: 'rgba(0, 0, 0, 0.65)',
  shadow: '#000000',

  danger: '#F87171',
  success: '#4ADE80',

  macroProtein: '#3B82F6',
  macroCarbs: '#22D3EE',
  macroFat: '#F87171',
  macroFiber: '#C084FC',
});

/**
 * Paleta clara real. Antes `Colors.light` apuntaba a una paleta
 * oscura, asi que el modo claro del sistema entregaba un tema oscuro.
 */
const daylight = build('daylight', 'Daylight', 'light', {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceRaised: '#F1F3F6',
  border: '#E2E5EA',

  primary: '#047857',
  primaryPressed: '#065F46',
  onPrimary: '#FFFFFF',

  text: '#111827',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',

  scrim: 'rgba(17, 24, 39, 0.45)',
  shadow: '#111827',

  danger: '#B91C1C',
  success: '#047857',

  macroProtein: '#047857',
  macroCarbs: '#0369A1',
  macroFat: '#B45309',
  macroFiber: '#6D28D9',
});

export const palettes = {
  midnightEmerald,
  obsidianCobalt,
  daylight,
} as const;

export type PaletteKey = keyof typeof palettes;

export const DEFAULT_PALETTE: PaletteKey = 'midnightEmerald';

/** La paleta que se usa cuando el sistema esta en modo claro y el usuario no eligio. */
export const LIGHT_PALETTE: PaletteKey = 'daylight';

export const paletteList = Object.values(palettes);
