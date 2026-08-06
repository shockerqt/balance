import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { useMealStore } from '@/hooks/use-meal-store';
import { makeStyles, useTheme } from '@/theme';

export default function FoodPortionScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ foodId?: string; dateId?: string; time?: string; mode?: string }>();

  const { libraryFoods, incrementFoodFrequency } = useFoodLibraryStore();
  const { addFood, selectedDateId } = useMealStore();

  const targetFoodId = params.foodId || '';
  const targetDateId = params.dateId || selectedDateId;
  const targetTime = params.time || '08:30';

  const foodItem = libraryFoods.find((f) => f.id === targetFoodId) || libraryFoods[0];

  const [portionInput, setPortionInput] = useState('100');
  const [unitLabel, setUnitLabel] = useState('g');
  const [timeInput, setTimeInput] = useState(targetTime);

  useEffect(() => {
    if (foodItem) {
      setTimeInput(targetTime);
      const match = foodItem.portion.match(/^(\d+)\s*(.*)$/);
      if (match) {
        setPortionInput(match[1]);
        setUnitLabel(match[2] || 'g');
      } else {
        setPortionInput('100');
        setUnitLabel('g');
      }
    }
  }, [foodItem, targetTime]);

  if (!foodItem) return null;

  const match = foodItem.portion.match(/^(\d+)\s*(.*)$/);
  const baseQty = match ? parseFloat(match[1]) || 100 : 100;
  const currentQty = parseFloat(portionInput) || baseQty;
  const scale = currentQty / baseQty;

  const calculatedCalories = Math.round(foodItem.calories * scale);
  const calculatedProtein = Math.round(foodItem.protein * scale);
  const calculatedCarbs = Math.round(foodItem.carbs * scale);
  const calculatedFat = Math.round(foodItem.fat * scale);
  const calculatedFiber = Math.round((foodItem.fiber || 0) * scale);

  const handleConfirmAdd = () => {
    incrementFoodFrequency(foodItem.id);
    addFood(targetDateId, {
      name: foodItem.name,
      portion: `${currentQty}${unitLabel}`,
      calories: calculatedCalories,
      protein: calculatedProtein,
      carbs: calculatedCarbs,
      fat: calculatedFat,
      fiber: calculatedFiber,
      time: timeInput.trim() || targetTime,
    });
    router.dismissAll();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Bar */}
        <View style={styles.headerBar}>
          <TouchableOpacity style={styles.cancelBtn} delayPressIn={0} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>✕ Cancelar</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ajustar Porción</Text>
        </View>

        {/* Food Title & Chilean Health Seals */}
        <View style={styles.headerBox}>
          <Text style={styles.foodNameTitle}>{foodItem.name}</Text>
          {foodItem.chileanSeals && foodItem.chileanSeals.length > 0 && (
            <View style={styles.sealsRow}>
              {foodItem.chileanSeals.map((seal, idx) => (
                <View key={idx} style={styles.sealBadge}>
                  <Text style={styles.sealBadgeText}>{seal}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Quantity & Portion Input with AutoFocus */}
        <View style={styles.quantitySection}>
          <Text style={styles.sectionLabel}>Cantidad y Porción</Text>
          <View style={styles.quantityInputRow}>
            <TextInput
              style={styles.qtyInput}
              value={portionInput}
              onChangeText={setPortionInput}
              keyboardType="numeric"
              autoFocus={true}
              selectTextOnFocus={true}
              placeholder="100"
              placeholderTextColor={theme.colors.textMuted}
            />
            <Text style={styles.unitText}>{unitLabel}</Text>
          </View>
        </View>

        {/* Real-time Recalculated Macros Display */}
        <View style={styles.macrosSummaryBox}>
          <Text style={styles.macrosBoxLabel}>Métricas Totales Recalculadas</Text>
          <View style={styles.macrosGrid}>
            <View style={styles.macroStatCell}>
              <Text style={styles.kcalStatValue}>{calculatedCalories}</Text>
              <Text style={styles.statLabel}>kcal</Text>
            </View>

            <View style={styles.macroStatCell}>
              <Text style={styles.macroStatValue}>{calculatedProtein}g</Text>
              <Text style={styles.statLabel}>Proteína</Text>
            </View>

            <View style={styles.macroStatCell}>
              <Text style={styles.macroStatValue}>{calculatedCarbs}g</Text>
              <Text style={styles.statLabel}>Carbos</Text>
            </View>

            <View style={styles.macroStatCell}>
              <Text style={styles.macroStatValue}>{calculatedFat}g</Text>
              <Text style={styles.statLabel}>Grasas</Text>
            </View>
          </View>
        </View>

        {/* Time Input Selector */}
        <View style={styles.timeSection}>
          <Text style={styles.sectionLabel}>Hora de Consumo</Text>
          <TextInput
            style={styles.timeInput}
            value={timeInput}
            onChangeText={setTimeInput}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>

        {/* Confirm Action Button */}
        <TouchableOpacity style={styles.confirmBtn} delayPressIn={0} onPress={handleConfirmAdd}>
          <Text style={styles.confirmBtnText}>Agregar a las {timeInput}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.surface,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cancelBtn: {
    paddingRight: 12,
  },
  cancelBtnText: {
    color: t.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitle: {
    color: t.colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 'auto',
    marginRight: 'auto',
    paddingRight: 60,
  },
  headerBox: {
    marginBottom: 16,
  },
  foodNameTitle: {
    color: t.colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  sealsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sealBadge: {
    backgroundColor: t.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: t.colors.danger,
  },
  sealBadgeText: {
    color: t.colors.danger,
    fontSize: 10,
    fontWeight: '700',
  },
  quantitySection: {
    marginBottom: 16,
  },
  sectionLabel: {
    color: t.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  quantityInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.border,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.primary,
    paddingHorizontal: 14,
  },
  qtyInput: {
    flex: 1,
    color: t.colors.text,
    fontSize: 20,
    fontWeight: '700',
    paddingVertical: 10,
    fontVariant: ['tabular-nums'],
  },
  unitText: {
    color: t.colors.primary,
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  macrosSummaryBox: {
    backgroundColor: t.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.colors.surfaceRaised,
    padding: 14,
    marginBottom: 16,
  },
  macrosBoxLabel: {
    color: t.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  macrosGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  macroStatCell: {
    alignItems: 'center',
  },
  kcalStatValue: {
    color: t.colors.danger,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  macroStatValue: {
    color: t.colors.text,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: t.colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  timeSection: {
    marginBottom: 24,
  },
  timeInput: {
    backgroundColor: t.colors.border,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.surfaceRaised,
    color: t.colors.text,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  confirmBtn: {
    backgroundColor: t.colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    color: t.colors.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
}));
