import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TextInput, TouchableWithoutFeedback } from 'react-native';
import { LibraryFoodItem } from '@/hooks/use-food-library-store';

interface FoodPortionModalProps {
  visible: boolean;
  foodItem: LibraryFoodItem | null;
  targetTime: string;
  onClose: () => void;
  onConfirmAdd: (calculatedFood: {
    name: string;
    portion: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    time: string;
  }) => void;
}

export const FoodPortionModal: React.FC<FoodPortionModalProps> = ({
  visible,
  foodItem,
  targetTime,
  onClose,
  onConfirmAdd,
}) => {
  const [portionInput, setPortionInput] = useState('100');
  const [unitLabel, setUnitLabel] = useState('g');
  const [timeInput, setTimeInput] = useState(targetTime);

  useEffect(() => {
    if (foodItem) {
      setTimeInput(targetTime);
      // Parse base portion (e.g., "100g" -> 100 and "g", or "2 un" -> 2 and "un")
      const match = foodItem.portion.match(/^(\d+)\s*(.*)$/);
      if (match) {
        setPortionInput(match[1]);
        setUnitLabel(match[2] || 'g');
      } else {
        setPortionInput('100');
        setUnitLabel('g');
      }
    }
  }, [foodItem, targetTime, visible]);

  if (!foodItem) return null;

  // Base quantity from original portion
  const match = foodItem.portion.match(/^(\d+)\s*(.*)$/);
  const baseQty = match ? parseFloat(match[1]) || 100 : 100;
  const currentQty = parseFloat(portionInput) || baseQty;
  const scale = currentQty / baseQty;

  // Real-time recalculated macros
  const calculatedCalories = Math.round(foodItem.calories * scale);
  const calculatedProtein = Math.round(foodItem.protein * scale);
  const calculatedCarbs = Math.round(foodItem.carbs * scale);
  const calculatedFat = Math.round(foodItem.fat * scale);
  const calculatedFiber = Math.round((foodItem.fiber || 0) * scale);

  const handleAdd = () => {
    onConfirmAdd({
      name: foodItem.name,
      portion: `${currentQty}${unitLabel}`,
      calories: calculatedCalories,
      protein: calculatedProtein,
      carbs: calculatedCarbs,
      fat: calculatedFat,
      fiber: calculatedFiber,
      time: timeInput.trim() || targetTime,
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.modalCard}>
              {/* Header Title & Chilean Seals */}
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

              {/* Quantity & Portion Selector */}
              <View style={styles.quantitySection}>
                <Text style={styles.sectionLabel}>Cantidad y Porción</Text>
                <View style={styles.quantityInputRow}>
                  <TextInput
                    style={styles.qtyInput}
                    value={portionInput}
                    onChangeText={setPortionInput}
                    keyboardType="numeric"
                    placeholder="100"
                    placeholderTextColor="#64748B"
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

              {/* Time Selector */}
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

              {/* Action Buttons */}
              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.cancelBtn} delayPressIn={0} onPress={onClose}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.confirmBtn} delayPressIn={0} onPress={handleAdd}>
                  <Text style={styles.confirmBtnText}>Agregar a las {timeInput}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 6, 10, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#0E1420',
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#1C2638',
    padding: 20,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
  },
  headerBox: {
    marginBottom: 16,
  },
  foodNameTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  sealsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sealBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  sealBadgeText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '700',
  },
  quantitySection: {
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  quantityInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3B82F6',
    paddingHorizontal: 14,
  },
  qtyInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: 8,
    fontVariant: ['tabular-nums'],
  },
  unitText: {
    color: '#3B82F6',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
  macrosSummaryBox: {
    backgroundColor: '#161F2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1C2638',
    padding: 12,
    marginBottom: 16,
  },
  macrosBoxLabel: {
    color: '#8E9BAE',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
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
    color: '#F87171',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  macroStatValue: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  timeSection: {
    marginBottom: 20,
  },
  timeInput: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1C2638',
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1E293B',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#8E9BAE',
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1.6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
