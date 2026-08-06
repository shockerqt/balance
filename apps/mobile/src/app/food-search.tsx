import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFoodLibraryStore, LibraryFoodItem } from '@/hooks/use-food-library-store';
import { useMealStore, LoggedFoodItem } from '@/hooks/use-meal-store';
import { makeStyles, useTheme } from '@/theme';
import { LibraryFoodRow } from '@/components/food-search/library-food-row';
import { CollapsibleSection } from '@/components/food-search/collapsible-section';
import { StagedFoodRow } from '@/components/food-search/staged-food-row';

// Safe require for RNDateTimePicker to prevent module evaluation failure on un-updated Dev Clients
let RNDateTimePicker: any = null;
try {
  RNDateTimePicker = require('@react-native-community/datetimepicker').default;
} catch (e) {
  RNDateTimePicker = null;
}

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

// Helper to convert "HH:MM" string to a Date object
const timeStrToDate = (timeStr: string): Date => {
  const d = new Date();
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    d.setHours(parseInt(parts[0], 10) || 8, parseInt(parts[1], 10) || 30, 0, 0);
  }
  return d;
};

export function FoodSearchScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ dateId?: string; time?: string }>();

  const targetDateId = params.dateId || '2026-08-02';
  const initialTime = params.time || '08:30';

  const { getSmartRecommendations, libraryFoods, incrementFoodFrequency } = useFoodLibraryStore();
  const { addMultipleFoods } = useMealStore();

  const [selectedTime, setSelectedTime] = useState(initialTime);
  const [showAndroidTimePicker, setShowAndroidTimePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stagedItems, setStagedItems] = useState<StagedDraftItem[]>([]);

  // Section Collapsible States
  const [isSuggestedExpanded, setIsSuggestedExpanded] = useState(true);
  const [isAllFoodsExpanded, setIsAllFoodsExpanded] = useState(false);

  // Retrieve smart time-delta ranked recommendations (top 15)
  const allRecommended = getSmartRecommendations(selectedTime, searchQuery);
  const suggestedTop15 = searchQuery ? allRecommended : allRecommended.slice(0, 15);

  const handleNativeTimeChange = (_event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowAndroidTimePicker(false);
    }
    if (date) {
      const h = String(date.getHours()).padStart(2, '0');
      const m = String(date.getMinutes()).padStart(2, '0');
      setSelectedTime(`${h}:${m}`);
    }
  };

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
  const currentDateObj = timeStrToDate(selectedTime);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 1. Clean Compact Top Header Bar with Native OS Time Picker */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.cancelBtn} delayPressIn={0} onPress={() => router.back()}>
          <Text style={styles.cancelBtnText}>Cancelar</Text>
        </TouchableOpacity>

        {/* Center Native OS Time Picker */}
        <View style={styles.centerTimeBox}>
          {RNDateTimePicker && Platform.OS === 'ios' ? (
            <RNDateTimePicker
              value={currentDateObj}
              mode="time"
              display="compact"
              onChange={handleNativeTimeChange}
              themeVariant="dark"
            />
          ) : (
            <TouchableOpacity
              style={styles.timePickerBtn}
              delayPressIn={0}
              onPress={() => setShowAndroidTimePicker(true)}>
              <Text style={styles.timePickerBtnText}>{selectedTime} 🕒</Text>
            </TouchableOpacity>
          )}

          {RNDateTimePicker && Platform.OS === 'android' && showAndroidTimePicker && (
            <RNDateTimePicker
              value={currentDateObj}
              mode="time"
              display="default"
              onChange={handleNativeTimeChange}
            />
          )}
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

      {/* 2. Compact Search & Custom Food Section */}
      <View style={styles.searchSection}>
        <View style={styles.searchBarBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholder="Buscar por nombre..."
            placeholderTextColor={theme.colors.textMuted}
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

      {/* 3. Ultra-dense Native ScrollView */}
      <ScrollView
        style={styles.scrollList}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        {/* Section 1: ALIMENTOS PARA REGISTRAR (Top Active Staging Group) */}
        {stagedCount > 0 && (
          <View style={styles.stagedSectionContainer}>
            <Text style={styles.stagedSectionHeader}>
              🛒 ALIMENTOS PARA REGISTRAR ({stagedCount})
            </Text>

            {stagedItems.map((item, idx) => (
              <StagedFoodRow
                key={item.id}
                item={item}
                autoFocus={idx === stagedItems.length - 1 && !!item.autoFocus}
                onChangeQuantity={handleUpdateStagedQuantity}
                onToggleUnit={handleToggleStagedUnit}
                onRemove={handleRemoveStagedItem}
              />
            ))}
          </View>
        )}

        <CollapsibleSection
          title="⚡ SUGERIDOS PARA LA HORA"
          count={suggestedTop15.length}
          expanded={isSuggestedExpanded}
          onToggle={() => setIsSuggestedExpanded(!isSuggestedExpanded)}>
          {suggestedTop15.map((food) => (
            <LibraryFoodRow key={food.id} food={food} onPick={handleStageFood} />
          ))}
        </CollapsibleSection>

        <CollapsibleSection
          title="📚 TODOS LOS ALIMENTOS"
          count={libraryFoods.length}
          expanded={isAllFoodsExpanded}
          onToggle={() => setIsAllFoodsExpanded(!isAllFoodsExpanded)}>
          {libraryFoods.map((food) => (
            <LibraryFoodRow key={food.id} food={food} onPick={handleStageFood} />
          ))}
        </CollapsibleSection>

      </ScrollView>
    </SafeAreaView>
  );
}

export default FoodSearchScreen;

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.surfaceRaised,
  },
  cancelBtn: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  cancelBtnText: {
    color: t.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  centerTimeBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePickerBtn: {
    backgroundColor: t.colors.border,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  timePickerBtnText: {
    color: t.colors.primary,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  commitBtn: {
    backgroundColor: t.colors.primary,
    borderRadius: 6,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  commitBtnDisabled: {
    backgroundColor: t.colors.border,
  },
  commitBtnText: {
    color: t.colors.onPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  commitBtnTextDisabled: {
    color: t.colors.textMuted,
  },
  searchSection: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  searchBarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.colors.surfaceRaised,
    paddingHorizontal: 10,
    height: 36,
    marginBottom: 6,
  },
  searchIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: t.colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  clearSearchIcon: {
    color: t.colors.textMuted,
    fontSize: 13,
    padding: 2,
  },
  createCustomBtn: {
    backgroundColor: t.colors.border,
    borderRadius: 6,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.colors.primary,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCustomBtnText: {
    color: t.colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  scrollList: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    paddingBottom: 30,
  },
  stagedSectionContainer: {
    backgroundColor: t.colors.surface,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.colors.primary,
    padding: 10,
    marginBottom: 12,
  },
  stagedSectionHeader: {
    color: t.colors.primary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.4,
  },
}));
