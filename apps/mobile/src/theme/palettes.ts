import { organicPalettes, paletteNames } from './organic-palettes';
import type { ColorSource, OrganicPalette } from './organic-palettes';
import { border, radius, space, type } from './tokens';
import type { Theme } from './tokens';
export type PaletteKey = OrganicPalette;
export const DEFAULT_PALETTE: PaletteKey = 'forest';
export const LIGHT_PALETTE: PaletteKey = 'forest';
export function makeOrganicTheme(source: ColorSource, scheme: 'light' | 'dark', system?: Record<string, string> | null): Theme {
  const own = organicPalettes[source === 'system' ? 'forest' : source][scheme];
  const roles = { ...own.roles, ...(source === 'system' ? system : null) };
  const dynamic = source === 'system' && !!system;
  const header = dynamic ? [roles.surface, roles.surfaceRaised, roles.surface] : [...own.header];
  const component = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const lightInk = [0, 1, 2].reduce((n, i) => n + component(roles.onPrimary, i), 0) > 384;
  const end = '#' + [0, 1, 2].map(i => Math.round(component(roles.primary, i) * .92 + (lightInk ? 0 : 255) * .08).toString(16).padStart(2, '0')).join('');
  const action = dynamic ? [roles.primary, end, roles.primary] : [...own.action];
  return { key: `${source}-${scheme}`, name: paletteNames[source], scheme,
    colors: { ...roles, primaryPressed: roles.primary, textMuted: roles.textSecondary,
      border: '#' + [0, 1, 2].map(i => Math.round(component(roles.surface, i) * .9 + component(roles.text, i) * .1).toString(16).padStart(2, '0')).join(''), scrim: '#00000088', shadow: '#000000',
      danger: scheme === 'dark' ? '#ffb4ab' : '#ba1a1a', success: roles.primary,
      macroProtein: roles.text, macroCarbs: roles.textSecondary, macroFat: roles.textSecondary, macroFiber: roles.textSecondary },
    gradients: { header, action }, type, space, radius, border };
}
export const palettes = Object.fromEntries((Object.keys(organicPalettes) as PaletteKey[]).map(key => [key, makeOrganicTheme(key, 'dark')])) as Record<PaletteKey, Theme>;
export const paletteList = Object.values(palettes);
