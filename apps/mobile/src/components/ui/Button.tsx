import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, TouchableOpacityProps } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './Text';

/* Botones del sistema. Los tres estilos que las pantallas venian
   redibujando a mano. */

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

  const surface = {
    primary: theme.colors.primary,
    secondary: theme.colors.surfaceRaised,
    ghost: 'transparent',
    danger: theme.colors.danger,
  }[variant];

  const label = {
    primary: 'onPrimary',
    secondary: 'primary',
    ghost: 'accent',
    danger: 'onPrimary',
  }[variant] as 'onPrimary' | 'primary' | 'accent';

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
          borderRadius: theme.radius.lg,
          paddingVertical: size === 'lg' ? theme.space.lg : theme.space.md,
          paddingHorizontal: theme.space.xl,
          gap: theme.space.sm,
          borderWidth: variant === 'ghost' ? theme.border.hairline : 0,
          borderColor: theme.colors.border,
          opacity: isDisabled ? 0.5 : 1,
        },
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? theme.colors.onPrimary : theme.colors.primary} />
      ) : (
        <>
          {icon}
          <Text variant="heading" tone={label}>
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
