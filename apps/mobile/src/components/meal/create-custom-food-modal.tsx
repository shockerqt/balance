import React, { useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TextInput, ScrollView, TouchableWithoutFeedback } from 'react-native';
import { LibraryFoodItem, useFoodLibraryStore } from '@/hooks/use-food-library-store';

interface CreateCustomFoodModalProps {
  visible: boolean;
  onClose: () => void;
  onFoodCreated: (newFood: LibraryFoodItem) => void;
}

const CHILEAN_SEALS_OPTIONS = [
  'ALTO EN CALORÍAS',
  'ALTO EN SODIO',
  'ALTO EN AZÚCARES',
  'ALTO EN GRASAS SATURADAS',
];

export const CreateCustomFoodModal: React.FC<CreateCustomFoodModalProps> = ({
  visible,
  onClose,
  onFoodCreated,
}) => {
  const { addCustomFood } = useFoodLibraryStore();

  const [name, setName] = useState('');
  const [portion, setPortion] = useState('100g');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [selectedSeals, setSelectedSeals] = useState<Set<string>>(new Set());

  const toggleSeal = (seal: string) => {
    const next = new Set(selectedSeals);
    if (next.has(seal)) {
      next.delete(seal);
    } else {
      next.add(seal);
    }
    setSelectedSeals(next);
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const created = addCustomFood({
      name: name.trim(),
      portion: portion.trim() || '100g',
      calories: parseFloat(calories) || 0,
      protein: parseFloat(protein) || 0,
      carbs: parseFloat(carbs) || 0,
      fat: parseFloat(fat) || 0,
      fiber: parseFloat(fiber) || 0,
      typicalTime: '12:00',
      chileanSeals: Array.from(selectedSeals),
      category: 'Personalizados',
    });

    onFoodCreated(created);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.modalCard}>
              <Text style={styles.title}>Crear Alimento Personalizado</Text>
              <Text style={styles.subtitle}>
                Define las métricas por porción base para guardarlo en tu biblioteca personal.
              </Text>

              <ScrollView style={styles.formScroll} showsVerticalScrollIndicator={false}>
                {/* Name & Portion */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Nombre del Alimento</Text>
                  <TextInput
                    style={styles.textInput}
                    value={name}
                    onChangeText={setName}
                    placeholder="Ej. Pan de Masa Madre"
                    placeholderTextColor="#64748B"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Porción Base (ej. 100g o 1 unidad)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={portion}
                    onChangeText={setPortion}
                    placeholder="100g"
                    placeholderTextColor="#64748B"
                  />
                </View>

                {/* Macro Inputs Grid */}
                <View style={styles.macrosRow}>
                  <View style={[styles.inputGroup, styles.flexCell]}>
                    <Text style={styles.label}>Kcal</Text>
                    <TextInput
                      style={styles.textInputNumber}
                      value={calories}
                      onChangeText={setCalories}
                      keyboardType="numeric"
                      placeholder="250"
                      placeholderTextColor="#64748B"
                    />
                  </View>

                  <View style={[styles.inputGroup, styles.flexCell]}>
                    <Text style={styles.label}>Proteínas (g)</Text>
                    <TextInput
                      style={styles.textInputNumber}
                      value={protein}
                      onChangeText={setProtein}
                      keyboardType="numeric"
                      placeholder="12"
                      placeholderTextColor="#64748B"
                    />
                  </View>
                </View>

                <View style={styles.macrosRow}>
                  <View style={[styles.inputGroup, styles.flexCell]}>
                    <Text style={styles.label}>Carbos (g)</Text>
                    <TextInput
                      style={styles.textInputNumber}
                      value={carbs}
                      onChangeText={setCarbs}
                      keyboardType="numeric"
                      placeholder="30"
                      placeholderTextColor="#64748B"
                    />
                  </View>

                  <View style={[styles.inputGroup, styles.flexCell]}>
                    <Text style={styles.label}>Grasas (g)</Text>
                    <TextInput
                      style={styles.textInputNumber}
                      value={fat}
                      onChangeText={setFat}
                      keyboardType="numeric"
                      placeholder="5"
                      placeholderTextColor="#64748B"
                    />
                  </View>
                </View>

                {/* Chilean Seals Selection */}
                <View style={styles.sealsSection}>
                  <Text style={styles.label}>Sellos Minsal Chile (Opcional)</Text>
                  <View style={styles.sealsGrid}>
                    {CHILEAN_SEALS_OPTIONS.map((seal) => {
                      const isSelected = selectedSeals.has(seal);
                      return (
                        <TouchableOpacity
                          key={seal}
                          style={[styles.sealChip, isSelected && styles.sealChipSelected]}
                          delayPressIn={0}
                          onPress={() => toggleSeal(seal)}>
                          <Text style={[styles.sealChipText, isSelected && styles.sealChipTextSelected]}>
                            {seal}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>

              {/* Action Buttons */}
              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.cancelBtn} delayPressIn={0} onPress={onClose}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.confirmBtn, !name.trim() && styles.confirmBtnDisabled]}
                  delayPressIn={0}
                  disabled={!name.trim()}
                  onPress={handleSave}>
                  <Text style={styles.confirmBtnText}>Guardar Alimento</Text>
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
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '85%',
    backgroundColor: '#0E1420',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#1C2638',
    padding: 20,
    boxShadow: '0 -8px 32px rgba(0, 0, 0, 0.6)',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#8E9BAE',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  formScroll: {
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  flexCell: {
    flex: 1,
  },
  macrosRow: {
    flexDirection: 'row',
    gap: 12,
  },
  label: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1C2638',
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  textInputNumber: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1C2638',
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontVariant: ['tabular-nums'],
  },
  sealsSection: {
    marginTop: 6,
    marginBottom: 10,
  },
  sealsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sealChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#1C2638',
  },
  sealChipSelected: {
    borderColor: '#EF4444',
    backgroundColor: '#2A1A20',
  },
  sealChipText: {
    color: '#8E9BAE',
    fontSize: 11,
    fontWeight: '600',
  },
  sealChipTextSelected: {
    color: '#EF4444',
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
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.5,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
