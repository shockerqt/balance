import { useMemo } from 'react';
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { Theme } from './tokens';
import { useTheme } from './ThemeProvider';

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Hojas de estilo que dependen del tema.
 *
 * `StyleSheet.create` es estatico, asi que los colores quedaban
 * escritos como literales. Con esto la hoja se reconstruye cuando
 * cambia el tema y ningun componente vuelve a fijar un color.
 *
 *   const useStyles = makeStyles((t) => ({
 *     card: { backgroundColor: t.colors.surface, padding: t.space.lg },
 *   }));
 *
 *   const styles = useStyles();
 */
export function makeStyles<T extends NamedStyles>(build: (theme: Theme) => T) {
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => StyleSheet.create(build(theme)), [theme]);
  };
}
