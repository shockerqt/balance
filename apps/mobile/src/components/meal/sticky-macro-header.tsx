import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
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
  collapseScroll?: SharedValue<number>;
  collapseDistance?: number;
  onMeasure?: (expanded: number, compact: number) => void;
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
  collapseScroll,
  collapseDistance = 216,
  onMeasure,
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

  const label = `Resumen del día: ${formatCalories(totals.calories)} de ${formatCalories(targetCalories)} kilocalorías, ${formatCalories(Math.abs(left))} ${over ? 'sobre la meta' : 'restantes'}. ${macros.map(m => `${m.name} ${formatMacroGrams(m.value)} de ${formatMacroGrams(m.target)} gramos`).join(', ')}`;
  const compactBody = <View style={{ paddingHorizontal: 20, minHeight: 30, flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: c.background }}>
    <Text variant="caption">{formatCalories(totals.calories)} / {formatCalories(targetCalories)} kcal</Text>
    <View style={{ flex: 1 }}><ProgressBar value={targetCalories > 0 ? totals.calories / targetCalories : 0} height={3} color={c.primary} /></View>
  </View>;
  if (compact && !collapseScroll) return <TouchableOpacity accessibilityRole="button" onPress={onPress} hitSlop={{ top: 7, bottom: 7 }}
    accessibilityLabel={`${formatCalories(totals.calories)} de ${formatCalories(targetCalories)} kilocalorías. Abre el detalle nutricional`}
    disabled={!onPress}>
    {compactBody}
  </TouchableOpacity>;
  const fullBody = <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
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
    </View>;
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Abre el detalle nutricional"
    activeOpacity={0.8} disabled={!onPress} onPress={onPress}>
    {collapseScroll ? <MorphSummary full={fullBody} compact={compactBody} scroll={collapseScroll} distance={collapseDistance} onMeasure={onMeasure} /> : fullBody}
  </TouchableOpacity>;
});

function MorphSummary({ full, compact, scroll, distance, onMeasure }: {
  full: React.ReactNode; compact: React.ReactNode; scroll: SharedValue<number>; distance: number;
  onMeasure?: (expanded: number, compact: number) => void;
}) {
  const [heights, setHeights] = useState({ full: 0, compact: 0 });
  useEffect(() => { if (heights.full && heights.compact) onMeasure?.(heights.full, heights.compact); }, [heights, onMeasure]);
  const expanded = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, scroll.value / distance));
    return { opacity: 1 - p, transform: [{ translateY: -Math.max(0, heights.full - heights.compact) * p }] };
  });
  const collapsed = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, scroll.value / distance)) }));
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={expanded} onLayout={event => {
      const height = event.nativeEvent.layout.height;
      setHeights(previous => previous.full === height ? previous : { ...previous, full: height });
    }}>{full}</Animated.View>
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, collapsed]} onLayout={event => {
      const height = event.nativeEvent.layout.height;
      setHeights(previous => previous.compact === height ? previous : { ...previous, compact: height });
    }}>{compact}</Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, padding: 16, gap: 12, borderRadius: 20, borderWidth: 1 },
  kcalRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  goal: { marginTop: 4 },
  right: { alignItems: 'flex-end' },
  left: { fontSize: 17, lineHeight: 22 },
  macros: { flexDirection: 'row', gap: 14 },
  macro: { flex: 1, minWidth: 0, gap: 6 },
});
