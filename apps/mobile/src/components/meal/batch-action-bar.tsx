import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { makeStyles } from '@/theme';
import { Text } from '@/components/ui';

/* Barra flotante del modo seleccion. Estaba embebida en la pantalla
   de registros con ocho reglas de estilo propias. */

export const BatchActionBar: React.FC<{
  count: number;
  onCancel: () => void;
  onMove: () => void;
  onDelete: () => void;
}> = ({ count, onCancel, onMove, onDelete }) => {
  const styles = useStyles();

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.cancel}
        delayPressIn={0}
        onPress={onCancel}>
        <Text variant="bodyStrong" tone="secondary">
          Cancelar
        </Text>
      </TouchableOpacity>

      <Text variant="bodyStrong">
        {count} {count === 1 ? 'seleccionado' : 'seleccionados'}
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.move}
          delayPressIn={0}
          onPress={onMove}>
          <Text variant="bodyStrong" tone="accent">
            Mover
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.delete}
          delayPressIn={0}
          onPress={onDelete}>
          <Text variant="bodyStrong" tone="onPrimary">
            Eliminar
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const useStyles = makeStyles((t) => ({
  bar: {
    position: 'absolute',
    left: t.space.lg,
    right: t.space.lg,
    bottom: t.space.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.space.md,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.md,
    borderRadius: t.radius.lg,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    shadowColor: t.colors.shadow,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  cancel: {
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.border,
  },
  actions: { flexDirection: 'row', gap: t.space.sm },
  move: {
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    borderRadius: t.radius.sm,
    borderWidth: t.border.hairline,
    borderColor: t.colors.primary,
    backgroundColor: t.colors.border,
  },
  delete: {
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.danger,
  },
}));
