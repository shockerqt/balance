import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFoodLibraryStore, LibraryFoodItem } from '@/hooks/use-food-library-store';
import { useMealStore, LoggedFoodItem, todayId } from '@/hooks/use-meal-store';
import { makeStyles, useTheme } from '@/theme';
import { Button, Icon, Input, Sheet, Text } from '@/components/ui';
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

  const targetDateId = params.dateId || todayId();
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
        templateId: item.originalFoodId,
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
    <Sheet
      title="Registrar"
      subtitle={selectedTime}
      onSubtitlePress={Platform.OS === 'android' ? () => setShowAndroidTimePicker(true) : undefined}
      closeLabel="Cancelar"
      footer={
        <Button
          title={stagedCount ? `Agregar (${stagedCount})` : 'Agregar'}
          disabled={stagedCount === 0}
          onPress={handleCommitAll}
        />
      }>
      {/* El selector nativo: en iOS va inline junto al subtitulo; en
          Android se abre al tocarlo. */}
      {RNDateTimePicker && Platform.OS === 'ios' ? (
        <View style={styles.timeRow}>
          <RNDateTimePicker
            value={currentDateObj}
            mode="time"
            display="compact"
            onChange={handleNativeTimeChange}
            themeVariant={theme.scheme === 'dark' ? 'dark' : 'light'}
          />
        </View>
      ) : null}

      {RNDateTimePicker && Platform.OS === 'android' && showAndroidTimePicker && (
        <RNDateTimePicker
          value={currentDateObj}
          mode="time"
          display="default"
          onChange={handleNativeTimeChange}
        />
      )}

      <View style={styles.searchSection}>
        <Input
          value={searchQuery}
          onChangeText={handleSearchChange}
          placeholder="Buscar alimento"
          autoCapitalize="none"
        />

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.createCustom}
          delayPressIn={0}
          activeOpacity={0.7}
          onPress={handleCreateCustomFood}>
          <Icon name="plus" size={14} tone="accent" />
          <Text variant="bodyStrong" tone="accent">
            Crear alimento propio
          </Text>
        </TouchableOpacity>
      </View>

      {/* 3. Ultra-dense Native ScrollView */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        {/* Section 1: ALIMENTOS PARA REGISTRAR (Top Active Staging Group) */}
        {stagedCount > 0 && (
          <View style={styles.stagedSectionContainer}>
            <Text style={styles.stagedSectionHeader}>
              PARA REGISTRAR ({stagedCount})
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
          title="SUGERIDOS PARA LA HORA"
          count={suggestedTop15.length}
          expanded={isSuggestedExpanded}
          onToggle={() => setIsSuggestedExpanded(!isSuggestedExpanded)}>
          {suggestedTop15.map((food) => (
            <LibraryFoodRow key={food.id} food={food} onPick={handleStageFood} />
          ))}
        </CollapsibleSection>

        <CollapsibleSection
          title="TODOS LOS ALIMENTOS"
          count={libraryFoods.length}
          expanded={isAllFoodsExpanded}
          onToggle={() => setIsAllFoodsExpanded(!isAllFoodsExpanded)}>
          {libraryFoods.map((food) => (
            <LibraryFoodRow key={food.id} food={food} onPick={handleStageFood} />
          ))}
        </CollapsibleSection>

      </ScrollView>
    </Sheet>
  );
}

export default FoodSearchScreen;

const useStyles = makeStyles((t) => ({
  timeRow: {
    alignItems: 'flex-start',
    paddingHorizontal: t.space.xl,
    paddingTop: t.space.md,
  },
  searchSection: {
    padding: t.space.xl,
    paddingTop: t.space.md,
    gap: t.space.md,
  },
  createCustom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    paddingVertical: t.space.sm,
  },

  scrollContent: {
    paddingBottom: t.space.xxl,
  },
  stagedSectionContainer: {
    borderTopWidth: t.border.rule,
    borderBottomWidth: t.border.rule,
    borderColor: t.colors.text,
    marginBottom: t.space.lg,
  },
  stagedSectionHeader: {
    color: t.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: t.space.lg,
    paddingTop: t.space.md,
    paddingBottom: t.space.sm,
  },
}));
