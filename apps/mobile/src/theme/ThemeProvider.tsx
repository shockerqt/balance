import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { storage } from '@/services/storage';
import { DEFAULT_PALETTE, LIGHT_PALETTE, PaletteKey, paletteList, palettes } from './palettes';
import { Theme } from './tokens';

/* ============================================================
   Tema reactivo.

   Antes `useTheme()` devolvia una constante de modulo resuelta al
   importar: cambiar de paleta exigia editar codigo y recargar. Ahora
   vive en contexto, se puede cambiar en runtime y la eleccion se
   recuerda entre sesiones.
   ============================================================ */

const STORAGE_KEY = '@balance_theme_v1';

/** `null` = seguir al sistema. */
export type ThemePreference = PaletteKey | null;

interface ThemeContextValue {
  theme: Theme;
  /** La preferencia guardada, no la resuelta. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  available: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(null);

  useEffect(() => {
    let cancelled = false;
    storage.getItem(STORAGE_KEY).then((saved) => {
      if (cancelled || !saved) return;
      if (saved in palettes) setPreferenceState(saved as PaletteKey);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (next) storage.setItem(STORAGE_KEY, next);
    else storage.removeItem(STORAGE_KEY);
  }, []);

  const theme = useMemo(() => {
    if (preference) return palettes[preference];
    return systemScheme === 'light' ? palettes[LIGHT_PALETTE] : palettes[DEFAULT_PALETTE];
  }, [preference, systemScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, setPreference, available: paletteList }),
    [theme, preference, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/** El tema activo. Reactivo: cambiar la preferencia re-renderiza a los consumidores. */
export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme debe usarse dentro de un ThemeProvider');
  return context.theme;
}

/** Para pantallas de ajustes que ofrecen elegir tema. */
export function useThemeControls(): Omit<ThemeContextValue, 'theme'> {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useThemeControls debe usarse dentro de un ThemeProvider');
  const { theme: _theme, ...controls } = context;
  return controls;
}
