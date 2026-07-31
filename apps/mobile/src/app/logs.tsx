import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface FoodItem {
  id: string;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  chileanSeals?: string[];
}

interface MealSection {
  title: string;
  icon: string;
  calories: number;
  foods: FoodItem[];
}

interface DayLogData {
  dateId: string;
  displayDate: string;
  isToday?: boolean;
  totalCalories: number;
  targetCalories: number;
  meals: MealSection[];
}

const DAYS_DATA: DayLogData[] = [
  {
    dateId: '2026-07-28',
    displayDate: 'Martes 28 de Julio',
    totalCalories: 2050,
    targetCalories: 2200,
    meals: [
      {
        title: 'Desayuno',
        icon: '🍳',
        calories: 520,
        foods: [
          { id: '1', name: 'Huevos Revueltos (2 un)', portion: '100g', calories: 150, protein: 12, carbs: 1, fat: 10 },
          { id: '2', name: 'Pan Marraqueta Integral', portion: '100g', calories: 270, protein: 9, carbs: 52, fat: 2 },
          { id: '3', name: 'Café Negro sin Azúcar', portion: '200cc', calories: 5, protein: 0, carbs: 1, fat: 0 },
        ],
      },
      {
        title: 'Almuerzo',
        icon: '🍲',
        calories: 810,
        foods: [
          { id: '4', name: 'Carne de Vacuno a la Plancha', portion: '200g', calories: 420, protein: 52, carbs: 0, fat: 22 },
          { id: '5', name: 'Puré de Papas Natural', portion: '200g', calories: 240, protein: 4, carbs: 38, fat: 8 },
        ],
      },
    ],
  },
  {
    dateId: '2026-07-29',
    displayDate: 'Ayer, Miércoles 29 de Julio',
    totalCalories: 1920,
    targetCalories: 2200,
    meals: [
      {
        title: 'Desayuno',
        icon: '🥣',
        calories: 480,
        foods: [
          { id: '6', name: 'Avena Instantánea Quaker', portion: '80g', calories: 300, protein: 11, carbs: 54, fat: 5 },
          { id: '7', name: 'Leche Descremada Soprole', portion: '200cc', calories: 90, protein: 7, carbs: 10, fat: 1 },
        ],
      },
      {
        title: 'Almuerzo',
        icon: '🍲',
        calories: 780,
        foods: [
          { id: '8', name: 'Salmón a la Plancha', portion: '180g', calories: 380, protein: 36, carbs: 0, fat: 24 },
          { id: '9', name: 'Arroz Integral Cocido', portion: '200g', calories: 220, protein: 5, carbs: 46, fat: 2 },
        ],
      },
    ],
  },
  {
    dateId: '2026-07-30',
    displayDate: 'Hoy, Jueves 30 de Julio',
    isToday: true,
    totalCalories: 1840,
    targetCalories: 2200,
    meals: [
      {
        title: 'Almuerzo (13:30)',
        icon: '☀️',
        calories: 740,
        foods: [
          { id: '10', name: 'Pechuga de Pollo Ariztía', portion: '200g (1 porción)', calories: 330, protein: 62, carbs: 0, fat: 7.2 },
          { id: '11', name: 'Arroz Integral Cocido', portion: '250g (1.5 taza)', calories: 275, protein: 6, carbs: 58, fat: 2.5 },
          { id: '12', name: 'Ensalada de Palta y Tomate', portion: '100g (1 taza)', calories: 135, protein: 2, carbs: 6, fat: 14 },
        ],
      },
      {
        title: 'Snack de la Tarde (17:45)',
        icon: '🌆',
        calories: 310,
        foods: [
          {
            id: '13',
            name: 'Yogurt Protein Soprole (Chile)',
            portion: '150g (1 envase)',
            calories: 110,
            protein: 15,
            carbs: 8,
            fat: 1,
            chileanSeals: ['ALTO EN AZÚCARES'],
          },
          { id: '14', name: 'Almendras Mente Naturales', portion: '30g (15 un)', calories: 180, protein: 6, carbs: 6, fat: 15 },
        ],
      },
      {
        title: 'Cena Programada (20:30)',
        icon: '🌙',
        calories: 450,
        foods: [
          { id: '15', name: 'Omelette de Verduras y Queso', portion: '200g', calories: 320, protein: 22, carbs: 4, fat: 24 },
        ],
      },
    ],
  },
  {
    dateId: '2026-07-31',
    displayDate: 'Mañana, Viernes 31 de Julio',
    totalCalories: 0,
    targetCalories: 2200,
    meals: [
      {
        title: 'Planificación de Mañana',
        icon: '📋',
        calories: 0,
        foods: [],
      },
    ],
  },
];

const TODAY_INDEX = 2;

export default function DailyLogsScreen() {
  const [activeIndex, setActiveIndex] = useState(TODAY_INDEX);
  const scrollViewRef = useRef<ScrollView>(null);

  const activeDay = DAYS_DATA[activeIndex];

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / SCREEN_WIDTH);
    if (index !== activeIndex && index >= 0 && index < DAYS_DATA.length) {
      setActiveIndex(index);
    }
  };

  const goToDay = (index: number) => {
    if (index >= 0 && index < DAYS_DATA.length) {
      scrollViewRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
      setActiveIndex(index);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      
      {/* Date Header with Swipe Controls */}
      <View style={styles.dateHeader}>
        <TouchableOpacity
          onPress={() => goToDay(activeIndex - 1)}
          disabled={activeIndex === 0}
          style={styles.navBtn}>
          <Text style={[styles.navBtnText, activeIndex === 0 ? styles.disabledText : null]}>‹</Text>
        </TouchableOpacity>

        <View style={styles.dateCenter}>
          <Text style={styles.dateTitle}>{activeDay.displayDate}</Text>
          <Text style={styles.swipeHint}>‹ Desliza horizontalmente para otros días ›</Text>
        </View>

        <TouchableOpacity
          onPress={() => goToDay(activeIndex + 1)}
          disabled={activeIndex === DAYS_DATA.length - 1}
          style={styles.navBtn}>
          <Text style={[styles.navBtnText, activeIndex === DAYS_DATA.length - 1 ? styles.disabledText : null]}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Horizontal Paged ScrollView for Swipe Gestures */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        contentOffset={{ x: TODAY_INDEX * SCREEN_WIDTH, y: 0 }}
        style={styles.horizontalScrollView}>
        
        {DAYS_DATA.map((dayData) => (
          <ScrollView
            key={dayData.dateId}
            style={{ width: SCREEN_WIDTH }}
            contentContainerStyle={styles.pageContent}
            showsVerticalScrollIndicator={false}>
            
            {/* Day Calorie Header */}
            <View style={styles.daySummaryBox}>
              <View style={styles.daySummaryRow}>
                <Text style={styles.daySummaryLabel}>CONSUMO TOTAL DEL DÍA</Text>
                <Text style={styles.daySummaryCalories}>
                  {dayData.totalCalories} / {dayData.targetCalories} kcal
                </Text>
              </View>
            </View>

            {/* Empty State */}
            {dayData.meals.length === 0 || dayData.totalCalories === 0 ? (
              <View style={styles.emptyStateCard}>
                <Text style={styles.emptyStateTitle}>Sin registros aún</Text>
                <Text style={styles.emptyStateSub}>Toca + para agregar comidas o planificar tu día.</Text>
              </View>
            ) : (
              /* Meal Cards */
              dayData.meals.map((meal, mIdx) => (
                <View key={mIdx} style={styles.mealCard}>
                  <View style={styles.mealHeader}>
                    <Text style={styles.mealTitle}>
                      {meal.icon} {meal.title}
                    </Text>
                    <Text style={styles.mealCalories}>{meal.calories} kcal</Text>
                  </View>

                  <View style={styles.foodList}>
                    {meal.foods.map((food) => (
                      <View key={food.id} style={styles.foodItemRow}>
                        <View style={styles.foodInfo}>
                          <Text style={styles.foodName}>{food.name}</Text>
                          <Text style={styles.foodMeta}>
                            <Text style={styles.portionTag}>{food.portion}</Text> • P: {food.protein}g | C: {food.carbs}g | G: {food.fat}g
                          </Text>
                          
                          {/* Chilean Warning Badges */}
                          {food.chileanSeals && (
                            <View style={styles.sealRow}>
                              {food.chileanSeals.map((seal, sIdx) => (
                                <View key={sIdx} style={styles.chileanSealBadge}>
                                  <Text style={styles.chileanSealText}>🛡️ {seal}</Text>
                                </View>
                              ))}
                            </View>
                          )}
                        </View>
                        <Text style={styles.foodCalVal}>{food.calories} kcal</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}

            {/* Add Meal CTA */}
            <TouchableOpacity style={styles.addMealBtn} activeOpacity={0.8}>
              <Text style={styles.addMealBtnText}>+ Agregar Alimento a este Día</Text>
            </TouchableOpacity>

          </ScrollView>
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090C15',
  },
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justify-content: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#111726',
  },
  dateCenter: {
    alignItems: 'center',
  },
  dateTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  swipeHint: {
    color: '#818CF8',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  navBtn: {
    padding: 8,
  },
  navBtnText: {
    color: '#94A3B8',
    fontSize: 22,
    fontWeight: 'bold',
  },
  disabledText: {
    color: '#334155',
  },
  horizontalScrollView: {
    flex: 1,
  },
  pageContent: {
    padding: 16,
    gap: 14,
  },
  daySummaryBox: {
    backgroundColor: '#111726',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  daySummaryRow: {
    flexDirection: 'row',
    justify-content: 'space-between',
    alignItems: 'center',
  },
  daySummaryLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  daySummaryCalories: {
    color: '#6366F1',
    fontSize: 13,
    fontWeight: 'bold',
  },
  mealCard: {
    backgroundColor: '#111726',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
  },
  mealHeader: {
    flexDirection: 'row',
    justify-content: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  mealTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  mealCalories: {
    color: '#818CF8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  foodList: {
    padding: 12,
    gap: 10,
  },
  foodItemRow: {
    flexDirection: 'row',
    justify-content: 'space-between',
    alignItems: 'flex-start',
  },
  foodInfo: {
    flex: 1,
    marginRight: 8,
  },
  foodName: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  foodMeta: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  portionTag: {
    color: '#E2E8F0',
    fontWeight: '600',
  },
  foodCalVal: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  sealRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
  },
  chileanSealBadge: {
    backgroundColor: '#000000',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  chileanSealText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
  },
  emptyStateCard: {
    backgroundColor: '#111726',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  emptyStateTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyStateSub: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  addMealBtn: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  addMealBtnText: {
    color: '#818CF8',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
