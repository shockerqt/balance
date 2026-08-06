import React from 'react';
import { TextInput, TouchableOpacity, View } from 'react-native';
import { makeStyles } from '@/theme';
import { Icon, Text } from '@/components/ui';

/* Fila de la lista de preparacion. El calculo de macros escalados
   estaba inline dentro del map de la pantalla. */

export interface StagedItem {
  id: string;
  name: string;
  quantityStr: string;
  unit: string;
  baseQty: number;
  baseCalories: number;
  baseProtein: number;
  baseCarbs: number;
  baseFat: number;
  autoFocus?: boolean;
}

export const StagedFoodRow: React.FC<{
  item: StagedItem;
  autoFocus: boolean;
  onChangeQuantity: (id: string, value: string) => void;
  onToggleUnit: (id: string) => void;
  onRemove: (id: string) => void;
}> = ({ item, autoFocus, onChangeQuantity, onToggleUnit, onRemove }) => {
  const styles = useStyles();

  const quantity = parseFloat(item.quantityStr) || item.baseQty;
  const factor = item.baseQty > 0 ? quantity / item.baseQty : 1;
  const kcal = Math.round(item.baseCalories * factor);
  const protein = Math.round(item.baseProtein * factor);
  const carbs = Math.round(item.baseCarbs * factor);
  const fat = Math.round(item.baseFat * factor);

  return (
    <View style={styles.row}>
      <View style={styles.main}>
        <Text variant="bodyStrong" numberOfLines={1} selectable>
          {item.name}
        </Text>

        <View style={styles.controls}>
          <TextInput
            style={styles.qtyInput}
            value={item.quantityStr}
            onChangeText={(text) => onChangeQuantity(item.id, text)}
            keyboardType="numeric"
            autoFocus={autoFocus}
            selectTextOnFocus
            accessibilityLabel={`Cantidad de ${item.name}`}
          />

          <TouchableOpacity
            accessibilityRole="button"
            style={styles.unitPill}
            delayPressIn={0}
            onPress={() => onToggleUnit(item.id)}>
            <Text variant="caption" tone="secondary">
              {item.unit} ▾
            </Text>
          </TouchableOpacity>

          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Text variant="caption" tone="accent">
            {kcal} kcal
          </Text>
          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Text variant="caption" tone="secondary">
            P {protein}g C {carbs}g G {fat}g
          </Text>
        </View>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Quitar ${item.name}`}
        style={styles.remove}
        delayPressIn={0}
        hitSlop={8}
        onPress={() => onRemove(item.id)}>
        <Icon name="x" size={15} tone="muted" />
      </TouchableOpacity>
    </View>
  );
};

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    paddingVertical: t.space.md,
    paddingHorizontal: t.space.lg,
    borderBottomWidth: t.border.hairline,
    borderBottomColor: t.colors.border,
  },
  main: { flex: 1, gap: t.space.sm },
  controls: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' },
  qtyInput: {
    minWidth: 54,
    color: t.colors.text,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: t.space.xs,
    paddingHorizontal: t.space.sm,
    borderRadius: t.radius.sm,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  unitPill: {
    paddingVertical: t.space.xs,
    paddingHorizontal: t.space.sm,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.surfaceRaised,
  },
  remove: { padding: t.space.xs },
}));
