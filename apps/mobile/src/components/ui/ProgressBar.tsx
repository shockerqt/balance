import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';

/* La barra de progreso estaba repetida cinco veces solo en el
   Resumen, cada una con su propio par de reglas de estilo. */

export interface ProgressBarProps {
  /** 0..1. Se recorta a 1 para que la barra no se desborde. */
  value: number;
  color?: string;
  height?: number;
  /** Marca visualmente el exceso; siempre acompañar de texto. */
  over?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  color,
  height = 8,
  over = false,
}) => {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(value, 1)) * 100;

  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        overflow: 'hidden',
        backgroundColor: theme.colors.border,
      }}>
      <View
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: over ? theme.colors.danger : color ?? theme.colors.primary,
        }}
      />
    </View>
  );
};
