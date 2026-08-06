import { TextStyle } from 'react-native';

/* ============================================================
   Contrato del tema.

   Una paleta es cualquier objeto que cumpla `Palette`. Los
   componentes leen de aqui y nunca declaran un color, un tamaño de
   fuente ni un espaciado literal: por eso un restyle se hace
   editando este archivo y `palettes.ts`, no las pantallas.
   ============================================================ */

/** Colores. Cada paleta debe llenar todas las ranuras. */
export interface PaletteColors {
  /** Fondo de la pantalla */
  background: string;
  /** Superficie elevada: tarjetas, cabeceras */
  surface: string;
  /** Superficie por encima de `surface`: cajas dentro de tarjetas */
  surfaceRaised: string;
  /** Borde de superficies y pistas de barras de progreso */
  border: string;

  /** Color de accion y de marca */
  primary: string;
  /** Estado presionado de `primary` */
  primaryPressed: string;
  /** Texto sobre `primary` */
  onPrimary: string;

  /** Texto de primer nivel */
  text: string;
  /** Texto de apoyo */
  textSecondary: string;
  /** Texto terciario: etiquetas, unidades */
  textMuted: string;

  /** Velo tras modales y hojas */
  scrim: string;
  /** Color de sombra proyectada */
  shadow: string;

  /** Estados. Van siempre acompañados de texto o icono, nunca color solo. */
  danger: string;
  success: string;

  /**
   * Un color por macro. Antes estaban repartidos entre tokens y
   * literales sueltos, lo que hacia imposible cambiarlos de una vez.
   */
  macroProtein: string;
  macroCarbs: string;
  macroFat: string;
  macroFiber: string;
}

/** Variantes tipograficas. Reemplazan a los fontSize/fontWeight sueltos. */
export type TypeVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'number'
  | 'numberLarge';

export const type: Record<TypeVariant, TextStyle> = {
  display: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 13, fontWeight: '400' },
  bodyStrong: { fontSize: 13, fontWeight: '600' },
  /** Etiquetas en caja alta: el renglon de cabecera del libro. */
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  caption: { fontSize: 11, fontWeight: '500' },
  /** Toda cifra va tabular: en un libro las columnas deben alinearse. */
  number: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  numberLarge: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
};

/** Escala de espaciado. Multiplos de 4. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Radios de esquina. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/**
 * Grosor de reglas. En el lenguaje del libro contable el peso del
 * filete codifica la jerarquia: la regla gruesa abre el panel, la
 * media separa secciones y el pelo separa asientos.
 */
export const border = {
  hairline: 1,
  rule: 2,
  ruleHeavy: 3,
} as const;

export type Space = keyof typeof space;
export type Radius = keyof typeof radius;

/** El tema completo que reciben los componentes. */
export interface Theme {
  key: string;
  name: string;
  /** `dark` alimenta la StatusBar y los temas de expo-router */
  scheme: 'light' | 'dark';
  colors: PaletteColors;
  type: typeof type;
  space: typeof space;
  radius: typeof radius;
  border: typeof border;
}
