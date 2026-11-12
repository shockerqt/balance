import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { Edge, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { SyncStatusBanner } from '@/components/sync/sync-status-banner';

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
  const insets = useSafeAreaInsets();
  const base = [styles.fill, { backgroundColor: theme.colors.background }, style];

  if (!safeArea) {
    return (
      <View style={base} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <SafeAreaView style={base} edges={edges} {...rest}>
        {children}
      </SafeAreaView>
      {edges.includes('top') && <SyncStatusBanner offset={insets.top} />}
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
