import { Platform } from 'react-native';

export interface ThemePalette {
  name: string;
  background: string;
  surface: string;
  surfaceBorder: string;
  cardBackground: string;
  primary: string;
  primaryHover: string;
  primaryText: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  kcalCoral: string;
  accentMuted: string;
  // Aliases for standard Expo components
  text: string;
  backgroundElement: string;
  backgroundSelected: string;
}

export const Palettes: Record<string, ThemePalette> = {
  // Paleta 1: Obsidian Deep & Cobalt Blue
  obsidianCobalt: {
    name: 'Obsidian & Cobalt',
    background: '#080B11',
    surface: '#0F172A',
    surfaceBorder: '#1E293B',
    cardBackground: '#131C2E',
    primary: '#3B82F6',
    primaryHover: '#2563EB',
    primaryText: '#FFFFFF',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    kcalCoral: '#F87171',
    accentMuted: '#1E293B',
    text: '#F8FAFC',
    backgroundElement: '#0F172A',
    backgroundSelected: '#131C2E',
  },

  // Paleta 2: Midnight Cyber & Emerald Mint (Paleta Menta Eléctrica para Probar)
  midnightEmerald: {
    name: 'Midnight & Emerald Mint',
    background: '#0B0E14',
    surface: '#161B22',
    surfaceBorder: '#21262D',
    cardBackground: '#1C2128',
    primary: '#10B981', // Menta Esmeralda Eléctrico
    primaryHover: '#059669',
    primaryText: '#042F2E',
    textPrimary: '#F0F6FC',
    textSecondary: '#8B949E',
    textMuted: '#484F58',
    kcalCoral: '#F59E0B', // Ámbar Energía
    accentMuted: '#21262D',
    text: '#F0F6FC',
    backgroundElement: '#161B22',
    backgroundSelected: '#1C2128',
  },
};

// Paleta activa global (Cambiar esta clave altera el tema de toda la app al instante)
export const ACTIVE_PALETTE_KEY: keyof typeof Palettes = 'midnightEmerald';

export const ActiveTheme = Palettes[ACTIVE_PALETTE_KEY];

// Backward-compatible exports for Expo components
export const Colors = {
  light: Palettes.obsidianCobalt,
  dark: Palettes.midnightEmerald,
};

export type ThemeColor = keyof ThemePalette;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    mono: 'monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
