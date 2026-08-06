import React from 'react';
import { Text as RNText, TextProps as RNTextProps } from 'react-native';
import { useTheme } from '@/theme';
import { TypeVariant } from '@/theme/tokens';

/* Texto del sistema. Una pantalla no deberia escribir fontSize,
   fontWeight ni un color literal: elige variante y tono. */

type Tone = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'onPrimary' | 'inherit';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  tone?: Tone;
}

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  tone = 'primary',
  style,
  ...rest
}) => {
  const theme = useTheme();

  const color = {
    primary: theme.colors.text,
    secondary: theme.colors.textSecondary,
    muted: theme.colors.textMuted,
    accent: theme.colors.primary,
    danger: theme.colors.danger,
    onPrimary: theme.colors.onPrimary,
    inherit: undefined,
  }[tone];

  return <RNText style={[theme.type[variant], color ? { color } : null, style]} {...rest} />;
};
