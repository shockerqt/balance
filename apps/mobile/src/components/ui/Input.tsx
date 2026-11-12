import React, { useState } from 'react';
import { TextInput as RNTextInput, TextInputProps } from 'react-native';
import { font, makeStyles, useTheme } from '@/theme';

/* La caja de texto del sistema: superficie, borde de control, radio
   16. El foco pasa el borde a tinta, como el buscador del diseño. */

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
  onFocus,
  onBlur,
  ...rest
}) => {
  const styles = useStyles();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <RNTextInput
      placeholderTextColor={theme.colors.textMuted}
      selectionColor={theme.colors.focus}
      onFocus={event => { setFocused(true); onFocus?.(event); }}
      onBlur={event => { setFocused(false); onBlur?.(event); }}
      style={[
        styles.base,
        focused && styles.focused,
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
    backgroundColor: t.colors.surface,
    borderWidth: t.border.hairline,
    borderColor: t.colors.lineStrong,
    borderRadius: t.radius.lg,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: t.space.md,
    fontSize: 15,
    fontFamily: font.regular,
  },
  focused: { borderColor: t.colors.text },
  number: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  emphasis: { fontSize: 24, fontFamily: font.semibold, fontVariant: ['tabular-nums'] },
}));
