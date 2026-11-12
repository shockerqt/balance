import React from 'react';
import { View, ViewProps } from 'react-native';
import { useTheme } from '@/theme';
import { Radius, Space } from '@/theme/tokens';

/* Tarjeta: superficie con borde fino y radio 20. `raised` es la caja
   suave (pista) dentro de una tarjeta. */

export interface CardProps extends ViewProps {
  raised?: boolean;
  padding?: Space | 'none';
  radius?: Radius;
  /** El borde es parte del diseño; se puede quitar en cajas internas. */
  bordered?: boolean;
}

export const Card: React.FC<CardProps> = ({
  raised = false,
  padding = 'xl',
  radius = 'xl',
  bordered = !raised,
  style,
  ...rest
}) => {
  const theme = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: raised ? theme.colors.surfaceRaised : theme.colors.surface,
          borderRadius: theme.radius[radius],
          padding: padding === 'none' ? 0 : theme.space[padding],
          borderWidth: bordered ? theme.border.hairline : 0,
          borderColor: theme.colors.border,
        },
        style,
      ]}
      {...rest}
    />
  );
};
