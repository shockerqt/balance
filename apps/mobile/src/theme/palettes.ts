import { PaletteColors, Theme, border, radius, space, type } from './tokens';

/* ============================================================
   Paletas.

   El lenguaje es el de un libro contable: se anotan consumos contra
   un presupuesto. De ahi salen el papel, la tinta y el rojo — "estar
   en rojo" es pasarse del objetivo, y es la unica señal de color.

   Cada paleta llena el mismo contrato, asi que agregar una es
   escribir un bloque de colores: ni las pantallas ni las primitivas
   cambian.
   ============================================================ */

const build = (
  key: string,
  name: string,
  scheme: 'light' | 'dark',
  colors: PaletteColors
): Theme => ({ key, name, scheme, colors, type, space, radius, border });

/** Papel de libro contable: el verde palido del formulario continuo. */
const libro = build('libro', 'Libro', 'light', {
  background: '#F2F5EE',
  surface: '#FFFFFF',
  surfaceRaised: '#E9EEE2',
  border: '#CFD8C6',

  primary: '#1A1D19',
  primaryPressed: '#000000',
  onPrimary: '#F2F5EE',

  text: '#1A1D19',
  textSecondary: '#5C6358',
  textMuted: '#8D9487',

  scrim: 'rgba(26, 29, 25, 0.42)',
  shadow: '#1A1D19',

  danger: '#B4232A',
  success: '#3F6B3A',

  macroProtein: '#1A1D19',
  macroCarbs: '#5C6358',
  macroFat: '#8D9487',
  macroFiber: '#B0B7A8',
});

/** El mismo libro de noche: tinta invertida sobre verde muy oscuro. */
const libroNoche = build('libroNoche', 'Libro de noche', 'dark', {
  background: '#12160F',
  surface: '#1A1F16',
  surfaceRaised: '#232A1E',
  border: '#333C2C',

  primary: '#EEF2E6',
  primaryPressed: '#FFFFFF',
  onPrimary: '#12160F',

  text: '#EEF2E6',
  textSecondary: '#9AA392',
  textMuted: '#656E5D',

  scrim: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',

  danger: '#FF6B6B',
  success: '#8FBF7F',

  macroProtein: '#EEF2E6',
  macroCarbs: '#9AA392',
  macroFat: '#656E5D',
  macroFiber: '#4C5545',
});

export const palettes = {
  libro,
  libroNoche,
} as const;

export type PaletteKey = keyof typeof palettes;

/** Cuando el sistema esta en oscuro y el usuario no eligio. */
export const DEFAULT_PALETTE: PaletteKey = 'libroNoche';

/** Cuando el sistema esta en claro y el usuario no eligio. */
export const LIGHT_PALETTE: PaletteKey = 'libro';

export const paletteList = Object.values(palettes);
