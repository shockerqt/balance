import React from 'react';
import { TouchableOpacity } from 'react-native';
import { makeStyles } from '@/theme';
import { Text } from '@/components/ui';

/* Boton flotante para registrar. Su resplandor estaba escrito como
   rgba verde fija, atada a una paleta que ya no era la activa. */

export const FloatingAddButton: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const styles = useStyles();

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Registrar comida"
      style={styles.button}
      delayPressIn={0}
      activeOpacity={0.8}
      onPress={onPress}>
      <Text variant="display" tone="onPrimary" style={styles.icon}>
        +
      </Text>
    </TouchableOpacity>
  );
};

const useStyles = makeStyles((t) => ({
  button: {
    position: 'absolute',
    right: t.space.xl,
    bottom: t.space.xxl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.primary,
    shadowColor: t.colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  icon: { lineHeight: 36 },
}));
