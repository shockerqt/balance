import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { useFonts } from 'expo-font';
import { storage } from '@/services/storage';
import { makeOrganicTheme } from './palettes';
import { defaultPreferences, parseThemePreferences } from './organic-palettes';
import type { ThemePreferences } from './organic-palettes';
import type { Theme } from './tokens';
export type ThemePreference = ThemePreferences;
export const THEME_STORAGE_KEY = '@balance_theme_v2';
type Controls = { preference: ThemePreferences; setPreference: (next: ThemePreferences) => void; ready: boolean };
const ThemeContext = createContext<(Controls & { theme: Theme }) | undefined>(undefined);
// Same module as the Compose host; absent on older APKs/web -> Bosque fallback.
const nativeTheme = requireOptionalNativeModule<{ getSystemColors?: (dark: boolean) => Record<string, string> | null }>('BalanceDailyLog');
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [preference, setState] = useState<ThemePreferences>(defaultPreferences);
  const [ready, setReady] = useState(false);
  const changed = useRef(false);
  const writes = useRef(Promise.resolve());
  const [revision, setRevision] = useState(0);
  const [fontsReady, fontError] = useFonts({ Inter: require('../../assets/fonts/Inter.ttf'), InterMedium: require('../../assets/fonts/Inter-Medium.ttf'), Outfit: require('../../assets/fonts/Outfit.ttf') });
  useEffect(() => {
    let cancelled = false;
    Promise.all([storage.getItem(THEME_STORAGE_KEY), storage.getItem('@balance_theme_v1')]).then(([saved, legacy]) => {
      if (!cancelled) { if (!changed.current) setState(parseThemePreferences(saved, legacy)); setReady(true); }
    }).catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { const subscription = AppState.addEventListener('change', value => { if (value === 'active') setRevision(n => n + 1); }); return () => subscription.remove(); }, []);
  const setPreference = useCallback((next: ThemePreferences) => {
    changed.current = true; setState(next);
    writes.current = writes.current.catch(() => {}).then(() => storage.setItem(THEME_STORAGE_KEY, JSON.stringify(next)));
  }, []);
  const theme = useMemo(() => {
    const scheme = preference.appearance === 'system' ? systemScheme === 'light' ? 'light' : 'dark' : preference.appearance;
    let dynamic: Record<string, string> | null = null;
    try { if (preference.colorSource === 'system') dynamic = nativeTheme?.getSystemColors?.(scheme === 'dark') ?? null; } catch { /* Older APK: use the complete fallback roles. */ }
    return makeOrganicTheme(preference.colorSource, scheme, dynamic);
  }, [preference, systemScheme, revision]);
  const value = useMemo(() => ({ theme, preference, setPreference, ready }), [theme, preference, setPreference, ready]);
  if (!fontsReady && !fontError) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
export function useTheme(): Theme { const value = useContext(ThemeContext); if (!value) throw new Error('useTheme debe usarse dentro de un ThemeProvider'); return value.theme; }
export function useThemeControls(): Controls { const value = useContext(ThemeContext); if (!value) throw new Error('useThemeControls debe usarse dentro de un ThemeProvider'); return { preference: value.preference, setPreference: value.setPreference, ready: value.ready }; }
