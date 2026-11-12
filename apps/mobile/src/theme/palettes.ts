import { border, radius, space, type } from './tokens';
import type { PaletteColors, Theme } from './tokens';

/* Tokens del rediseño 2026-11-12. Son los mismos valores del sandbox
   (/m/balance-clean-redesign) y de docs/design/balance-redesign.md. */
export const tokens = {
  light: {
    ground: '#F7F7F5', surface: '#FFFFFF', ink: '#16181D', ink2: '#5A606B', onInk: '#FFFFFF',
    line: '#E4E5E1', lineStrong: '#D5D7D2', track: '#ECEDE9',
    protein: '#2F5BEA', carbs: '#B97A00', fat: '#C2336B',
    bar: '#8A8F99', barEmpty: '#D5D7D2', goal: '#9CA1AA', link: '#2F5BEA', focus: '#2F5BEA', danger: '#B42318',
  },
  dark: {
    ground: '#101113', surface: '#1A1C20', ink: '#ECEDEA', ink2: '#A3A8B1', onInk: '#101113',
    line: '#2A2D33', lineStrong: '#5A606B', track: '#2A2D33',
    protein: '#7DA0FF', carbs: '#E3AC3A', fat: '#F27AA6',
    bar: '#6E747F', barEmpty: '#3A3E46', goal: '#8A8F99', link: '#8FB0FF', focus: '#8FB0FF', danger: '#FF8A80',
  },
} as const;

export type Scheme = keyof typeof tokens;
export type Appearance = 'system' | Scheme;
export type ThemePreferences = { appearance: Appearance };
export const defaultPreferences: ThemePreferences = { appearance: 'system' };

export function makeBalanceTheme(scheme: Scheme): Theme {
  const t = tokens[scheme];
  const colors: PaletteColors = {
    background: t.ground, surface: t.surface, surfaceRaised: t.track, border: t.line, outline: t.lineStrong,
    secondary: t.track, onSecondary: t.ink, amber: t.carbs,
    primary: t.ink, primaryPressed: t.ink, onPrimary: t.onInk,
    text: t.ink, textSecondary: t.ink2, textMuted: t.ink2,
    scrim: scheme === 'dark' ? '#000000B3' : '#16181D66', shadow: '#000000',
    danger: t.danger, success: t.ink,
    macroProtein: t.protein, macroCarbs: t.carbs, macroFat: t.fat, macroFiber: t.ink2,
    lineStrong: t.lineStrong, track: t.track, link: t.link, focus: t.focus, bar: t.bar, barEmpty: t.barEmpty, goal: t.goal,
  };
  return { key: `balance-${scheme}`, name: scheme === 'dark' ? 'Oscuro' : 'Claro', scheme, colors, type, space, radius, border };
}

/**
 * Preferencia guardada en el dispositivo. Acepta el formato anterior
 * ({ appearance, colorSource }) y los valores heredados "libro" /
 * "libroNoche"; el color ya no es elegible y se descarta.
 */
export function parseThemePreferences(saved: string | null, legacy: string | null = null): ThemePreferences {
  try {
    const value = saved ? JSON.parse(saved) : null;
    if (value && ['system', 'light', 'dark'].includes(value.appearance)) return { appearance: value.appearance };
  } catch { /* Invalid device preferences use the declared defaults. */ }
  if (legacy === 'libro' || legacy === 'libroNoche') return { appearance: legacy === 'libro' ? 'light' : 'dark' };
  return { ...defaultPreferences };
}
