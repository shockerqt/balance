import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { makeStyles } from '@/theme';
import { Text } from '@/components/ui';

/* Seccion plegable de la busqueda. Las dos secciones repetian
   cabecera y contenedor con las mismas reglas. */

export const CollapsibleSection: React.FC<{
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, count, expanded, onToggle, children }) => {
  const styles = useStyles();

  return (
    <View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.header}
        delayPressIn={0}
        onPress={onToggle}>
        <Text variant="label" tone="secondary">
          {expanded ? '▼' : '▶'}  {title} ({count})
        </Text>
      </TouchableOpacity>

      {expanded ? <View>{children}</View> : null}
    </View>
  );
};

const useStyles = makeStyles((t) => ({
  header: {
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.md,
    backgroundColor: t.colors.surface,
    borderTopWidth: t.border.hairline,
    borderBottomWidth: t.border.hairline,
    borderColor: t.colors.border,
  },
}));
