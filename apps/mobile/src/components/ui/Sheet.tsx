import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Text } from './Text';

/* Cabecera comun de los cuatro sheets del stack raiz. Cada uno la
   resolvia por su cuenta, con paddings y pesos distintos. */

export interface SheetProps {
  title: string;
  subtitle?: string;
  /** Accion a la derecha del titulo. */
  action?: React.ReactNode;
  /** Por defecto cierra el sheet volviendo atras. */
  onClose?: () => void;
  closeLabel?: string;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({
  title,
  subtitle,
  action,
  onClose,
  closeLabel = 'Cerrar',
  children,
}) => {
  const theme = useTheme();
  const router = useRouter();

  const close = onClose ?? (() => router.back());

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingHorizontal: theme.space.xl,
            paddingTop: theme.space.lg,
            paddingBottom: theme.space.md,
            borderBottomWidth: theme.border.hairline,
            borderBottomColor: theme.colors.border,
            gap: theme.space.md,
          },
        ]}>
        <View style={styles.titleBlock}>
          <Text variant="title">{title}</Text>
          {subtitle ? (
            <Text variant="caption" tone="secondary">
              {subtitle}
            </Text>
          ) : null}
        </View>

        {action ?? (
          <TouchableOpacity onPress={close} accessibilityRole="button" hitSlop={8}>
            <Text variant="bodyStrong" tone="accent">
              {closeLabel}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleBlock: { flexShrink: 1 },
});
