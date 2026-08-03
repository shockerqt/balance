import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFoodLibraryStore, LibraryFoodItem } from '@/hooks/use-food-library-store';
import { useMealStore } from '@/hooks/use-meal-store';
import { FoodPortionModal } from '@/components/meal/food-portion-modal';
import { CreateCustomFoodModal } from '@/components/meal/create-custom-food-modal';

export default function FoodSearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dateId?: string; time?: string }>();

  const targetDateId = params.dateId || '2026-08-02';
  const targetTime = params.time || '08:30';

  const { getSmartRecommendations, incrementFoodFrequency } = useFoodLibraryStore();
  const { addFood } = useMealStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFoodItem, setSelectedFoodItem] = useState<LibraryFoodItem | null>(null);
  const [portionModalVisible, setPortionModalVisible] = useState(false);
  const [createCustomModalVisible, setCreateCustomModalVisible] = useState(false);

  // Retrieve smart time-delta ranked food recommendations
  const recommendedFoods = getSmartRecommendations(targetTime, searchQuery);

  const handleSelectFoodItem = (food: LibraryFoodItem) => {
    setSelectedFoodItem(food);
    setPortionModalVisible(true);
  };

  const handleConfirmAddFood = (calculatedFood: {
    name: string;
    portion: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    time: string;
  }) => {
    if (selectedFoodItem) {
      incrementFoodFrequency(selectedFoodItem.id);
    }
    addFood(targetDateId, calculatedFood);
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handleFoodCreated = (newFood: LibraryFoodItem) => {
    setSelectedFoodItem(newFood);
    setPortionModalVisible(true);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 1. Header Navigation Bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} delayPressIn={0} onPress={() => router.canGoBack() && router.back()}>
          <Text style={styles.backBtnText}>‹ Volver</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Biblioteca de Alimentos</Text>
          <Text style={styles.headerSubtitle}>
            Registrando a las <Text style={styles.timeHighlight}>{targetTime}</Text>
          </Text>
        </View>
      </View>

      {/* 2. Live Search Bar & Create Custom Food Button */}
      <View style={styles.searchSection}>
        <View style={styles.searchBarBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Buscar por nombre o categoría..."
            placeholderTextColor="#64748B"
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity delayPressIn={0} onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearchIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Button to Create Custom Food */}
        <TouchableOpacity
          style={styles.createCustomBtn}
          delayPressIn={0}
          activeOpacity={0.7}
          onPress={() => setCreateCustomModalVisible(true)}>
          <Text style={styles.createCustomBtnText}>+ Crear Alimento Personalizado</Text>
        </TouchableOpacity>
      </View>

      {/* 3. Smart Recommendations List */}
      <ScrollView
        style={styles.scrollList}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeadline}>
          {searchQuery
            ? `Resultados para "${searchQuery}" (${recommendedFoods.length})`
            : `⚡ Sugeridos para las ${targetTime}`}
        </Text>

        {recommendedFoods.map((food) => (
          <TouchableOpacity
            key={food.id}
            style={styles.foodLibraryCard}
            delayPressIn={0}
            activeOpacity={0.7}
            onPress={() => handleSelectFoodItem(food)}>
            <View style={styles.foodCardLeft}>
              <Text style={styles.foodName}>{food.name}</Text>

              <View style={styles.foodMetaRow}>
                <Text style={styles.foodKcal}>{food.calories} kcal</Text>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.foodMacros}>
                  P {food.protein}g  C {food.carbs}g  G {food.fat}g
                </Text>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.basePortionText}>{food.portion}</Text>
              </View>

              {food.chileanSeals && food.chileanSeals.length > 0 && (
                <View style={styles.sealsRow}>
                  {food.chileanSeals.map((seal, idx) => (
                    <Text key={idx} style={styles.sealTag}>
                      {seal}
                    </Text>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.addArrowCircle}>
              <Text style={styles.addArrowText}>+</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Step 2: Portion & Quantity Modal */}
      <FoodPortionModal
        visible={portionModalVisible}
        foodItem={selectedFoodItem}
        targetTime={targetTime}
        onClose={() => setPortionModalVisible(false)}
        onConfirmAdd={handleConfirmAddFood}
      />

      {/* Create Custom Food Modal */}
      <CreateCustomFoodModal
        visible={createCustomModalVisible}
        onClose={() => setCreateCustomModalVisible(false)}
        onFoodCreated={handleFoodCreated}
      />
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2638',
  },
  backBtn: {
    paddingRight: 12,
    paddingVertical: 4,
  },
  backBtnText: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingRight: 40,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#8E9BAE',
    fontSize: 12,
    marginTop: 1,
  },
  timeHighlight: {
    color: '#3B82F6',
    fontWeight: '700',
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1420',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1C2638',
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 10,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '500',
  },
  clearSearchIcon: {
    color: '#64748B',
    fontSize: 14,
    padding: 4,
  },
  createCustomBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3B82F6',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCustomBtnText: {
    color: '#3B82F6',
    fontSize: 13,
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
  sectionHeadline: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
    padding: 14,
    marginBottom: 10,
  },
  foodCardLeft: {
    flex: 1,
    paddingRight: 10,
  },
  foodName: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  foodMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  foodKcal: {
    color: '#F87171',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dot: {
    color: '#475569',
    fontSize: 12,
  },
  foodMacros: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  basePortionText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '400',
  },
  sealsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  sealTag: {
    color: '#EF4444',
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: '#2A1A20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  addArrowCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addArrowText: {
    color: '#3B82F6',
    fontSize: 20,
    fontWeight: '500',
    marginTop: -1,
  },
});
