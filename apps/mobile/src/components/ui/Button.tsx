import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, TouchableOpacityProps } from 'react-native';
import { font, useTheme } from '@/theme';
import { Text } from './Text';

/* Botones del sistema.
   primary: tinta con texto invertido. secondary: superficie con borde
   de control. ghost: enlace. danger: rojo de estado. */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

export interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'lg',
  loading = false,
  icon,
  style,
  disabled,
  ...rest
}) => {
  const theme = useTheme();
  const c = theme.colors;

  const surface = { primary: c.primary, secondary: c.surface, ghost: 'transparent', danger: c.danger }[variant];
  const ink = { primary: c.onPrimary, secondary: c.text, ghost: c.link, danger: c.onPrimary }[variant];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      activeOpacity={0.8}
      delayPressIn={0}
      disabled={isDisabled}
      style={[
        styles.base,
        {
          backgroundColor: surface,
          borderRadius: size === 'lg' ? theme.radius.lg : theme.radius.md,
          minHeight: size === 'lg' ? 52 : 44,
          paddingHorizontal: variant === 'ghost' ? 0 : size === 'lg' ? 28 : theme.space.lg,
          gap: theme.space.sm,
          borderWidth: variant === 'secondary' ? theme.border.hairline : 0,
          borderColor: c.lineStrong,
          opacity: isDisabled ? 0.45 : 1,
          alignSelf: variant === 'ghost' ? 'flex-start' : undefined,
        },
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {icon}
          <Text
            variant="heading"
            tone="inherit"
            style={{
              color: ink,
              flexShrink: 1,
              fontFamily: variant === 'ghost' ? font.medium : font.semibold,
              fontSize: size === 'lg' && variant !== 'ghost' ? 16 : variant === 'ghost' ? 15 : 14,
            }}>
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
