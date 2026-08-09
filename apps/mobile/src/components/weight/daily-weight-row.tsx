import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui';
import { makeStyles } from '@/theme';
import { WeightLogDoc } from '@/services/sync/types';
import { formatWeight } from '@/services/weight/weight';

interface DailyWeightRowProps {
  measurement?: WeightLogDoc;
  disabled?: boolean;
  onPress: () => void;
}

export const DailyWeightRow: React.FC<DailyWeightRowProps> = ({
  measurement,
  disabled,
  onPress,
}) => {
  const styles = useStyles();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      activeOpacity={0.72}
      disabled={disabled}
      style={styles.row}
      onPress={onPress}
    >
      <View style={styles.labelBlock}>
        <Text variant="label" tone="muted">
          PESO DEL DÍA
        </Text>
        <Text variant="caption" tone="secondary">
          {disabled
            ? 'No se registra en fechas futuras'
            : measurement
              ? 'Toca para corregir'
              : 'Sin registro'}
        </Text>
      </View>
      <Text
        variant={measurement ? 'number' : 'bodyStrong'}
        tone={measurement ? 'primary' : 'accent'}
        selectable
      >
        {measurement ? `${formatWeight(measurement.weightGrams)} kg` : disabled ? '—' : 'Registrar'}
      </Text>
    </TouchableOpacity>
  );
};

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.space.lg,
    paddingHorizontal: t.space.xl,
    paddingVertical: t.space.md,
    backgroundColor: t.colors.surface,
    borderBottomWidth: t.border.hairline,
    borderBottomColor: t.colors.border,
  },
  labelBlock: { gap: t.space.xs },
}));
