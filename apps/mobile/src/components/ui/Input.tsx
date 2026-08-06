import React from 'react';
import { TextInput as RNTextInput, TextInputProps } from 'react-native';
import { makeStyles, useTheme } from '@/theme';

/* La caja de texto del sistema. Cada pantalla tenia la suya: cuatro
   combinaciones distintas de fondo, borde y radio para el mismo
   control. */

export interface InputProps extends TextInputProps {
  /** `number` alinea a la derecha y usa cifras tabulares. */
  variant?: 'text' | 'number';
  /** Realza el campo cuando es el dato principal de la hoja. */
  emphasis?: boolean;
}

export const Input: React.FC<InputProps> = ({
  variant = 'text',
  emphasis = false,
  style,
  ...rest
}) => {
  const styles = useStyles();
  const theme = useTheme();

  return (
    <RNTextInput
      placeholderTextColor={theme.colors.textMuted}
      style={[
        styles.base,
        variant === 'number' && styles.number,
        emphasis && styles.emphasis,
        style,
      ]}
      {...rest}
    />
  );
};

const useStyles = makeStyles((t) => ({
  base: {
    color: t.colors.text,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.md,
    fontSize: 15,
    fontWeight: '500',
  },
  number: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  emphasis: { fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
}));
