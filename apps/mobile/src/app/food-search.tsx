import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFoodLibraryStore, LibraryFoodItem } from '@/hooks/use-food-library-store';
import { useMealStore, LoggedFoodItem } from '@/hooks/use-meal-store';

interface StagedDraftItem {
  id: string; // unique draft id
  originalFoodId: string;
  name: string;
  quantityStr: string;
  unit: string;
  baseQty: number;
  baseCalories: number;
  baseProtein: number;
  baseCarbs: number;
  baseFat: number;
  baseFiber: number;
  chileanSeals?: string[];
  autoFocus?: boolean;
}

const AVAILABLE_UNITS = ['g', 'un', 'cc', 'porción', 'taza'];

export default function FoodSearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dateId?: string; time?: string }>();

  const targetDateId = params.dateId || '2026-08-02';
  const initialTime = params.time || '08:30';

  const { getSmartRecommendations, libraryFoods, incrementFoodFrequency } = useFoodLibraryStore();
  const { addMultipleFoods } = useMealStore();

  const [selectedTime, setSelectedTime] = useState(initialTime);
  const [searchQuery, setSearchQuery] = useState('');
  const [stagedItems, setStagedItems] = useState<StagedDraftItem[]>([]);

  // Section Collapsible States
  const [isSuggestedExpanded, setIsSuggestedExpanded] = useState(true);
  const [isAllFoodsExpanded, setIsAllFoodsExpanded] = useState(false);

  // Retrieve smart time-delta ranked recommendations (top 15)
  const allRecommended = getSmartRecommendations(selectedTime, searchQuery);
  const suggestedTop15 = searchQuery ? allRecommended : allRecommended.slice(0, 15);

  const handleStageFood = (food: LibraryFoodItem) => {
    const match = food.portion.match(/^(\d+)\s*(.*)$/);
    const parsedBaseQty = match ? parseFloat(match[1]) || 100 : 100;
    const defaultUnit = match && match[2] ? match[2].trim() : 'g';

    const newItem: StagedDraftItem = {
      id: 'draft_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      originalFoodId: food.id,
      name: food.name,
      quantityStr: String(parsedBaseQty),
      unit: defaultUnit,
      baseQty: parsedBaseQty,
      baseCalories: food.calories,
      baseProtein: food.protein,
      baseCarbs: food.carbs,
      baseFat: food.fat,
      baseFiber: food.fiber || 0,
      chileanSeals: food.chileanSeals,
      autoFocus: true,
    };

    incrementFoodFrequency(food.id);
    setStagedItems((prev) => [...prev, newItem]);
  };

  const handleUpdateStagedQuantity = (draftId: string, text: string) => {
    setStagedItems((prev) =>
      prev.map((item) => (item.id === draftId ? { ...item, quantityStr: text, autoFocus: false } : item))
    );
  };

  const handleToggleStagedUnit = (draftId: string) => {
    setStagedItems((prev) =>
      prev.map((item) => {
        if (item.id === draftId) {
          const currentIdx = AVAILABLE_UNITS.indexOf(item.unit);
          const nextIdx = (currentIdx + 1) % AVAILABLE_UNITS.length;
          return { ...item, unit: AVAILABLE_UNITS[nextIdx], autoFocus: false };
        }
        return item;
      })
    );
  };

  const handleRemoveStagedItem = (draftId: string) => {
    setStagedItems((prev) => prev.filter((item) => item.id !== draftId));
  };

  const handleCreateCustomFood = () => {
    router.push({
      pathname: '/create-food',
      params: { dateId: targetDateId, time: selectedTime },
    });
  };

  const handleCommitAll = () => {
    if (stagedItems.length === 0) return;

    const foodsToCommit: Omit<LoggedFoodItem, 'id'>[] = stagedItems.map((item) => {
      const q = parseFloat(item.quantityStr) || item.baseQty;
      const scale = q / item.baseQty;

      return {
        name: item.name,
        portion: `${q}${item.unit}`,
        calories: Math.round(item.baseCalories * scale),
        protein: Math.round(item.baseProtein * scale),
        carbs: Math.round(item.baseCarbs * scale),
        fat: Math.round(item.baseFat * scale),
        fiber: Math.round(item.baseFiber * scale),
        time: selectedTime.trim() || initialTime,
        chileanSeals: item.chileanSeals,
      };
    });

    addMultipleFoods(targetDateId, foodsToCommit);
    router.back();
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (text.trim().length > 0) {
      setIsAllFoodsExpanded(true);
    }
  };

  const stagedCount = stagedItems.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 1. Clean Top Header Bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.cancelBtn} delayPressIn={0} onPress={() => router.back()}>
          <Text style={styles.cancelBtnText}>Cancelar</Text>
        </TouchableOpacity>

        {/* Editable Center Time Badge */}
        <View style={styles.centerTimeBox}>
          <TextInput
            style={styles.timeInput}
            value={selectedTime}
            onChangeText={setSelectedTime}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>

        {/* Top Right Batch Commit Button */}
        <TouchableOpacity
          style={[styles.commitBtn, stagedCount === 0 && styles.commitBtnDisabled]}
          delayPressIn={0}
          disabled={stagedCount === 0}
          onPress={handleCommitAll}>
          <Text style={[styles.commitBtnText, stagedCount === 0 && styles.commitBtnTextDisabled]}>
            Agregar ({stagedCount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* 2. Live Search Bar & Create Custom Button */}
      <View style={styles.searchSection}>
        <View style={styles.searchBarBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholder="Buscar por nombre..."
            placeholderTextColor="#64748B"
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity delayPressIn={0} onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearchIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.createCustomBtn}
          delayPressIn={0}
          activeOpacity={0.7}
          onPress={handleCreateCustomFood}>
          <Text style={styles.createCustomBtnText}>+ Crear Alimento Personalizado</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollList} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 3. Section 1: ALIMENTOS PARA REGISTRAR (Top Active Staging Group) */}
        {stagedCount > 0 && (
          <View style={styles.stagedSectionContainer}>
            <Text style={styles.stagedSectionHeader}>
              🛒 ALIMENTOS PARA REGISTRAR ({stagedCount})
            </Text>

            {stagedItems.map((item, idx) => {
              const q = parseFloat(item.quantityStr) || item.baseQty;
              const scale = q / item.baseQty;
              const calcKcal = Math.round(item.baseCalories * scale);
              const calcP = Math.round(item.baseProtein * scale);
              const calcC = Math.round(item.baseCarbs * scale);
              const calcF = Math.round(item.baseFat * scale);
              const isLastAdded = idx === stagedItems.length - 1;

              return (
                <View key={item.id} style={styles.stagedRowCard}>
                  <View style={styles.stagedCardMain}>
                    <Text style={styles.stagedFoodName} numberOfLines={1}>
                      {item.name}
                    </Text>

                    <View style={styles.stagedControlsRow}>
                      {/* Inline Quantity Input with AutoFocus for last added */}
                      <TextInput
                        style={styles.inlineQtyInput}
                        value={item.quantityStr}
                        onChangeText={(txt) => handleUpdateStagedQuantity(item.id, txt)}
                        keyboardType="numeric"
                        autoFocus={isLastAdded && item.autoFocus}
                        selectTextOnFocus={true}
                      />

                      {/* Inline Unit Toggle Chip */}
                      <TouchableOpacity
                        style={styles.inlineUnitPill}
                        delayPressIn={0}
                        onPress={() => handleToggleStagedUnit(item.id)}>
                        <Text style={styles.inlineUnitText}>{item.unit} ▾</Text>
                      </TouchableOpacity>

                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.stagedKcalText}>{calcKcal} kcal</Text>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.stagedMacroText}>
                        P {calcP}g C {calcC}g G {calcF}g
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.removeStagedBtn}
                    delayPressIn={0}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => handleRemoveStagedItem(item.id)}>
                    <Text style={styles.removeStagedIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* 4. Section 2: ⚡ SUGERIDOS PARA LAS HORA (Top 15 Collapsible) */}
        <TouchableOpacity
          style={styles.accordionHeader}
          delayPressIn={0}
          onPress={() => setIsSuggestedExpanded(!isSuggestedExpanded)}>
          <Text style={styles.accordionHeaderTitle}>
            {isSuggestedExpanded ? '▼' : '▶'} ⚡ SUGERIDOS PARA LAS {selectedTime} ({suggestedTop15.length})
          </Text>
        </TouchableOpacity>

        {isSuggestedExpanded && (
          <View style={styles.accordionContent}>
            {suggestedTop15.map((food) => (
              <TouchableOpacity
                key={food.id}
                style={styles.foodLibraryCard}
                delayPressIn={0}
                activeOpacity={0.7}
                onPress={() => handleStageFood(food)}>
                <View style={styles.foodCardLeft}>
                  <Text style={styles.foodName}>{food.name}</Text>
                  <View style={styles.foodMetaRow}>
                    <Text style={styles.foodKcal}>{food.calories} kcal</Text>
                    <Text style={styles.dot}>·</Text>
                    <Text style={styles.foodMacros}>
                      P {food.protein}g C {food.carbs}g G {food.fat}g
                    </Text>
                    <Text style={styles.dot}>·</Text>
                    <Text style={styles.basePortionText}>{food.portion}</Text>
                  </View>
                </View>

                <View style={styles.addCircleBtn}>
                  <Text style={styles.addCircleText}>+</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 5. Section 3: 📚 TODOS LOS ALIMENTOS (Collapsible) */}
        <TouchableOpacity
          style={styles.accordionHeader}
          delayPressIn={0}
          onPress={() => setIsAllFoodsExpanded(!isAllFoodsExpanded)}>
          <Text style={styles.accordionHeaderTitle}>
            {isAllFoodsExpanded ? '▼' : '▶'} 📚 TODOS LOS ALIMENTOS ({libraryFoods.length})
          </Text>
        </TouchableOpacity>

        {isAllFoodsExpanded && (
          <View style={styles.accordionContent}>
            {libraryFoods.map((food) => (
              <TouchableOpacity
                key={food.id}
                style={styles.foodLibraryCard}
                delayPressIn={0}
                activeOpacity={0.7}
                onPress={() => handleStageFood(food)}>
                <View style={styles.foodCardLeft}>
                  <Text style={styles.foodName}>{food.name}</Text>
                  <View style={styles.foodMetaRow}>
                    <Text style={styles.foodKcal}>{food.calories} kcal</Text>
                    <Text style={styles.dot}>·</Text>
                    <Text style={styles.foodMacros}>
                      P {food.protein}g C {food.carbs}g G {food.fat}g
                    </Text>
                    <Text style={styles.dot}>·</Text>
                    <Text style={styles.basePortionText}>{food.portion}</Text>
                  </View>
                </View>

                <View style={styles.addCircleBtn}>
                  <Text style={styles.addCircleText}>+</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080B11',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2638',
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingRight: 10,
  },
  cancelBtnText: {
    color: '#8E9BAE',
    fontSize: 14,
    fontWeight: '600',
  },
  centerTimeBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeInput: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 4,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  commitBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  commitBtnDisabled: {
    backgroundColor: '#1E293B',
  },
  commitBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  commitBtnTextDisabled: {
    color: '#64748B',
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  searchBarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1420',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1C2638',
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 8,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '500',
  },
  clearSearchIcon: {
    color: '#64748B',
    fontSize: 14,
    padding: 4,
  },
  createCustomBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCustomBtnText: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '600',
  },
  scrollList: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingBottom: 40,
  },
  stagedSectionContainer: {
    backgroundColor: '#0E1420',
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#3B82F6',
    padding: 12,
    marginBottom: 16,
  },
  stagedSectionHeader: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  stagedRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161F2E',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1C2638',
  },
  stagedCardMain: {
    flex: 1,
    paddingRight: 8,
  },
  stagedFoodName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  stagedControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  inlineQtyInput: {
    backgroundColor: '#1E293B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3B82F6',
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 44,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  inlineUnitPill: {
    backgroundColor: '#1E293B',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#1C2638',
  },
  inlineUnitText: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '600',
  },
  dot: {
    color: '#475569',
    fontSize: 11,
  },
  stagedKcalText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  stagedMacroText: {
    color: '#8E9BAE',
    fontSize: 11,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  removeStagedBtn: {
    padding: 4,
  },
  removeStagedIcon: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },
  accordionHeader: {
    paddingVertical: 10,
    marginBottom: 6,
  },
  accordionHeaderTitle: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  accordionContent: {
    marginBottom: 12,
  },
  foodLibraryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0E1420',
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#1C2638',
    padding: 12,
    marginBottom: 8,
  },
  foodCardLeft: {
    flex: 1,
    paddingRight: 10,
  },
  foodName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
  },
  foodMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  foodKcal: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  foodMacros: {
    color: '#8E9BAE',
    fontSize: 11,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  basePortionText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '400',
  },
  addCircleBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCircleText: {
    color: '#3B82F6',
    fontSize: 18,
    fontWeight: '500',
    marginTop: -1,
  },
});
