import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

/* Contenedor de pantalla: aporta el fondo del tema y el area segura,
   que antes cada pantalla resolvia por su cuenta. */

export interface ScreenProps extends ViewProps {
  edges?: readonly Edge[];
  /** Para sheets, que no necesitan area segura y van sobre un fondo propio. */
  safeArea?: boolean;
}

export const Screen: React.FC<ScreenProps> = ({
  edges = ['top'],
  safeArea = true,
  style,
  children,
  ...rest
}) => {
  const theme = useTheme();
  const base = [styles.fill, { backgroundColor: theme.colors.background }, style];

  if (!safeArea) {
    return (
      <View style={base} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <SafeAreaView style={base} edges={edges} {...rest}>
      {children}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
