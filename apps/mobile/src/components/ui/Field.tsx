import React from 'react';
import { View, ViewProps } from 'react-native';
import { makeStyles } from '@/theme';
import { Text } from './Text';

/* Campo de formulario: etiqueta, control y ayuda con una sola forma.
   Antes cada pantalla componia la suya, con etiquetas de 12 o 13 px
   que nunca usaban la variante del tema. */

export interface FieldProps extends ViewProps {
  label: string;
  /** Aclaracion bajo el control: formato esperado, unidad, etc. */
  hint?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, hint, children, style, ...rest }) => {
  const styles = useStyles();

  return (
    <View style={[styles.field, style]} {...rest}>
      <Text variant="label" tone="muted">
        {label.toUpperCase()}
      </Text>
      {children}
      {hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
};

const useStyles = makeStyles((t) => ({
  field: { gap: t.space.sm },
}));
