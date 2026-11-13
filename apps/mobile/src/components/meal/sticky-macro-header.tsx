import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { ProgressBar, Text } from '@/components/ui';
import { useTheme } from '@/theme';
import { formatCalories, formatMacroGrams, sumNutrition } from '@/lib/nutrition';

interface StickyMacroHeaderProps {
  compact?: boolean;
  foods: LoggedFoodItem[];
  targetCalories?: number;
  targetProtein?: number;
  targetCarbs?: number;
  targetFat?: number;
  targetFiber?: number;
  /** Abre el detalle nutricional del dia. */
  onPress?: () => void;
}

/* Resumen del dia: calorias contra la meta, lo que queda y un medidor
   por macro. Tocarlo abre el detalle (fibra y micronutrientes). */
export const StickyMacroHeader: React.FC<StickyMacroHeaderProps> = React.memo(({
  foods,
  compact = false,
  targetCalories = 2200,
  targetProtein = 150,
  targetCarbs = 220,
  targetFat = 65,
  onPress,
}) => {
  const theme = useTheme();
  const c = theme.colors;
  const totals = sumNutrition(foods);
  const left = targetCalories - totals.calories;
  const over = left < 0;
  const percent = targetCalories > 0 ? Math.round((totals.calories / targetCalories) * 100) : 0;
  const macros = [
    { name: 'Proteína', value: totals.protein, target: targetProtein, color: c.macroProtein },
    { name: 'Carbohidratos', value: totals.carbs, target: targetCarbs, color: c.macroCarbs },
    { name: 'Grasa', value: totals.fat, target: targetFat, color: c.macroFat },
  ];

  if (compact) return <TouchableOpacity accessibilityRole="button" onPress={onPress} hitSlop={{ top: 7, bottom: 7 }}
    accessibilityLabel={`${formatCalories(totals.calories)} de ${formatCalories(targetCalories)} kilocalorías. Abre el detalle nutricional`}
    style={{ paddingHorizontal: 20, height: 30, flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: c.background }}>
    <Text variant="caption">{formatCalories(totals.calories)} / {formatCalories(targetCalories)} kcal</Text>
    <View style={{ flex: 1 }}><ProgressBar value={targetCalories > 0 ? totals.calories / targetCalories : 0} height={3} color={c.primary} /></View>
  </TouchableOpacity>;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Resumen del día: ${formatCalories(totals.calories)} de ${formatCalories(targetCalories)} kilocalorías, ${formatCalories(Math.abs(left))} ${over ? 'sobre la meta' : 'restantes'}. ${macros.map(m => `${m.name} ${formatMacroGrams(m.value)} de ${formatMacroGrams(m.target)} gramos`).join(', ')}`}
      accessibilityHint="Abre el detalle nutricional"
      activeOpacity={0.8}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.kcalRow}>
        <View>
          <Text variant="numberLarge" style={over ? { color: c.danger } : null}>{formatCalories(totals.calories)}</Text>
          <Text variant="caption" tone="secondary" style={styles.goal}>de {formatCalories(targetCalories)} kcal</Text>
        </View>
        <View style={styles.right}>
          <Text variant="number" style={styles.left}>{formatCalories(Math.abs(left))}</Text>
          <Text variant="caption" tone={over ? 'danger' : 'secondary'}>{over ? 'sobre la meta' : 'te quedan'}</Text>
        </View>
      </View>
      <View accessibilityLabel={`${percent} por ciento de la meta de calorías`}>
        <ProgressBar value={targetCalories > 0 ? totals.calories / targetCalories : 0} height={10} over={over} color={c.primary} />
      </View>
      <View style={styles.macros}>
        {macros.map(m => (
          <View key={m.name} style={styles.macro}>
            <Text variant="label" tone="secondary" numberOfLines={1}>{m.name}</Text>
            <Text variant="number" numberOfLines={1}>
              {formatMacroGrams(m.value)} <Text variant="caption" tone="secondary">/ {formatMacroGrams(m.target)} g</Text>
            </Text>
            <ProgressBar value={m.target > 0 ? m.value / m.target : 0} height={6} color={m.color} />
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, padding: 14, gap: 12, borderRadius: 20, borderWidth: 1 },
  kcalRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  goal: { marginTop: 4 },
  right: { alignItems: 'flex-end' },
  left: { fontSize: 17, lineHeight: 22 },
  macros: { flexDirection: 'row', gap: 14 },
  macro: { flex: 1, minWidth: 0, gap: 6 },
});
