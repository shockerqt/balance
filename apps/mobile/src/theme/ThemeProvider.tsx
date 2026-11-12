import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { useFonts } from 'expo-font';
import { storage } from '@/services/storage';
import { defaultPreferences, makeBalanceTheme, parseThemePreferences } from './palettes';
import type { ThemePreferences } from './palettes';
import { font } from './tokens';
import type { Theme } from './tokens';
export type ThemePreference = ThemePreferences;
export const THEME_STORAGE_KEY = '@balance_theme_v2';
type Controls = { preference: ThemePreferences; setPreference: (next: ThemePreferences) => void; ready: boolean };
const ThemeContext = createContext<(Controls & { theme: Theme }) | undefined>(undefined);
const fonts = {
  [font.regular]: require('../../assets/fonts/Inter.ttf'),
  [font.medium]: require('../../assets/fonts/Inter-Medium.ttf'),
  [font.semibold]: require('../../assets/fonts/Inter-SemiBold.ttf'),
  [font.displaySmall]: require('../../assets/fonts/BricolageGrotesque-SemiBold16.ttf'),
  [font.titleSheet]: require('../../assets/fonts/BricolageGrotesque-Bold22.ttf'),
  [font.title]: require('../../assets/fonts/BricolageGrotesque-Bold30.ttf'),
  [font.hero]: require('../../assets/fonts/BricolageGrotesque-Bold40.ttf'),
};
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [preference, setState] = useState<ThemePreferences>(defaultPreferences);
  const [ready, setReady] = useState(false);
  const changed = useRef(false);
  const writes = useRef(Promise.resolve());
  const [fontsReady, fontError] = useFonts(fonts);
  useEffect(() => {
    let cancelled = false;
    Promise.all([storage.getItem(THEME_STORAGE_KEY), storage.getItem('@balance_theme_v1')]).then(([saved, legacy]) => {
      if (!cancelled) { if (!changed.current) setState(parseThemePreferences(saved, legacy)); setReady(true); }
    }).catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);
  const setPreference = useCallback((next: ThemePreferences) => {
    changed.current = true; setState(next);
    writes.current = writes.current.catch(() => {}).then(() => storage.setItem(THEME_STORAGE_KEY, JSON.stringify(next)));
  }, []);
  const theme = useMemo(() => {
    const scheme = preference.appearance === 'system' ? systemScheme === 'dark' ? 'dark' : 'light' : preference.appearance;
    return makeBalanceTheme(scheme);
  }, [preference, systemScheme]);
  const value = useMemo(() => ({ theme, preference, setPreference, ready }), [theme, preference, setPreference, ready]);
  if (!fontsReady && !fontError) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
export function useTheme(): Theme { const value = useContext(ThemeContext); if (!value) throw new Error('useTheme debe usarse dentro de un ThemeProvider'); return value.theme; }
export function useThemeControls(): Controls { const value = useContext(ThemeContext); if (!value) throw new Error('useThemeControls debe usarse dentro de un ThemeProvider'); return { preference: value.preference, setPreference: value.setPreference, ready: value.ready }; }
