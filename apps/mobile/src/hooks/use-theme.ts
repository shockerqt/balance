import { ActiveTheme, Palettes, ThemePalette, ACTIVE_PALETTE_KEY } from '@/constants/theme';

export function useTheme(): ThemePalette {
  return ActiveTheme;
}

export { Palettes, ACTIVE_PALETTE_KEY };
