import type { TextStyle } from 'react-native';

/* ============================================================
   Contrato del tema.

   Los componentes leen de aqui y nunca declaran un color, un tamaño de
   fuente ni un espaciado literal: un restyle se hace editando este
   archivo y `palettes.ts`, no las pantallas.

   Diseño: rediseño limpio de 2026-11-12 (sandbox
   /m/balance-clean-redesign). Ver docs/design/balance-redesign.md.
   ============================================================ */

/** Colores. Cada esquema debe llenar todas las ranuras. */
export interface PaletteColors {
  /** Fondo de la pantalla (ground) */
  background: string;
  /** Borde de controles (line-strong) */
  outline: string;
  secondary: string;
  onSecondary: string;
  amber: string;
  /** Tarjetas, barras, campos */
  surface: string;
  /** Pista y relleno suave dentro de una superficie (track) */
  surfaceRaised: string;
  /** Borde de tarjetas (line) */
  border: string;

  /** Accion principal: tinta */
  primary: string;
  primaryPressed: string;
  /** Texto e iconos sobre `primary` */
  onPrimary: string;

  text: string;
  textSecondary: string;
  textMuted: string;

  scrim: string;
  shadow: string;

  /** Estados. Van siempre acompañados de texto o icono, nunca color solo. */
  danger: string;
  success: string;

  macroProtein: string;
  macroCarbs: string;
  macroFat: string;
  macroFiber: string;

  /** Borde de controles y botones de contorno */
  lineStrong: string;
  /** Pistas de progreso, divisores de fila, dia con registros */
  track: string;
  /** Enlaces */
  link: string;
  /** Anillo de foco */
  focus: string;
  /** Barras de dias pasados en graficos */
  bar: string;
  /** Dias sin registro en graficos y en la semana */
  barEmpty: string;
  /** Linea punteada de meta */
  goal: string;
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
  | 'numberLarge'
  | 'numberMedium'
  | 'hour';

/**
 * Familias registradas en ThemeProvider. Cada archivo es un solo peso
 * (las de Bricolage ademas fijan el tamaño optico), asi que ningun
 * estilo con estas familias debe declarar `fontWeight`: Android
 * sintetizaria una negrita sobre una fuente que ya lo es.
 */
export const font = {
  regular: 'Inter',
  medium: 'InterMedium',
  semibold: 'InterSemiBold',
  /** Bricolage Grotesque SemiBold, tamaño optico 16 (horas, dias) */
  displaySmall: 'BricolageSemiBold16',
  /** Bricolage Grotesque Bold, tamaño optico 22 (titulo de hoja) */
  titleSheet: 'BricolageBold22',
  /** Bricolage Grotesque Bold, tamaño optico 30 (titulos, cifras 32) */
  title: 'BricolageBold30',
  /** Bricolage Grotesque Bold, tamaño optico 40 (cifra principal) */
  hero: 'BricolageBold40',
} as const;

const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

export const type: Record<TypeVariant, TextStyle> = {
  /** Titulo de pantalla: "Hoy", "Resumen" */
  display: { fontFamily: font.title, fontSize: 30, lineHeight: 32, letterSpacing: -0.6 },
  /** Titulo de hoja: "Agregar" */
  title: { fontFamily: font.titleSheet, fontSize: 22, lineHeight: 24 },
  /** Titulo de tarjeta y etiqueta de boton */
  heading: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 20 },
  bodyStrong: { fontFamily: font.medium, fontSize: 15, lineHeight: 20 },
  /** Lo mas chico que se usa: nombre de macro, letra del dia */
  label: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
  /** Texto de apoyo */
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  number: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, fontVariant: tabular },
  numberLarge: { fontFamily: font.hero, fontSize: 40, lineHeight: 40, letterSpacing: -0.8, fontVariant: tabular },
  numberMedium: { fontFamily: font.title, fontSize: 32, lineHeight: 43, letterSpacing: -0.64, fontVariant: tabular },
  /** Hora de un grupo de comidas y numero del dia */
  hour: { fontFamily: font.displaySmall, fontSize: 16, lineHeight: 20, fontVariant: tabular },
};

/** Escala de espaciado. Multiplos de 2. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Radios: tarjetas 20, listas y campos 16, controles 14, chips 999. */
export const radius = {
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const border = {
  hairline: 1,
  rule: 2,
  ruleHeavy: 3,
} as const;

/** Area tactil minima. */
export const TOUCH = 44;

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
