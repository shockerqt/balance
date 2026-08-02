import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';

interface TimeFoodModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (foodData: Omit<LoggedFoodItem, 'id'>, foodId?: string) => void;
  onDelete?: (foodId: string) => void;
  initialTime?: string;
  foodToEdit?: LoggedFoodItem | null;
}

export const TimeFoodModal: React.FC<TimeFoodModalProps> = ({
  visible,
  onClose,
  onSave,
  onDelete,
  initialTime = '08:00',
  foodToEdit = null,
}) => {
  const [name, setName] = useState('');
  const [portion, setPortion] = useState('100g');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [time, setTime] = useState(initialTime);

  useEffect(() => {
    if (foodToEdit) {
      setName(foodToEdit.name);
      setPortion(foodToEdit.portion || '');
      setCalories(String(foodToEdit.calories || ''));
      setProtein(String(foodToEdit.protein || ''));
      setCarbs(String(foodToEdit.carbs || ''));
      setFat(String(foodToEdit.fat || ''));
      setFiber(String(foodToEdit.fiber || ''));
      setTime(foodToEdit.time || initialTime);
    } else {
      setName('');
      setPortion('100g');
      setCalories('');
      setProtein('');
      setCarbs('');
      setFat('');
      setFiber('');
      setTime(initialTime);
    }
  }, [foodToEdit, initialTime, visible]);

  const handleSave = () => {
    if (!name.trim()) return;

    onSave(
      {
        name: name.trim(),
        portion: portion.trim(),
        calories: Number(calories) || 0,
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
        fiber: Number(fiber) || 0,
        time: time.trim() || '12:00',
      },
      foodToEdit ? foodToEdit.id : undefined
    );
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

        <View style={styles.sheetContainer}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>
              {foodToEdit ? 'Editar Alimento' : 'Registrar Alimento'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.formContent} showsVerticalScrollIndicator={false}>
            {/* Time input selector */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Hora de Consumo (HH:MM)</Text>
              <TextInput
                style={styles.timeInput}
                value={time}
                onChangeText={setTime}
                placeholder="08:30"
                placeholderTextColor="#64748B"
              />
            </View>

            {/* Food Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Nombre del Alimento</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="ej. Pan Marraqueta, Pechuga de Pollo"
                placeholderTextColor="#64748B"
              />
            </View>

            {/* Portion & Kcal Row */}
            <View style={styles.row}>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.label}>Porción / Cantidad</Text>
                <TextInput
                  style={styles.input}
                  value={portion}
                  onChangeText={setPortion}
                  placeholder="ej. 100g, 2 un"
                  placeholderTextColor="#64748B"
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.label}>Calorías (kcal)</Text>
                <TextInput
                  style={styles.input}
                  value={calories}
                  onChangeText={setCalories}
                  keyboardType="numeric"
                  placeholder="250"
                  placeholderTextColor="#64748B"
                />
              </View>
            </View>

            {/* Macros Row */}
            <Text style={[styles.label, { marginTop: 8 }]}>Macronutrientes (Gramos)</Text>
            <View style={styles.row}>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.subLabel}>Proteína (g)</Text>
                <TextInput
                  style={styles.input}
                  value={protein}
                  onChangeText={setProtein}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#64748B"
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.subLabel}>Carbos (g)</Text>
                <TextInput
                  style={styles.input}
                  value={carbs}
                  onChangeText={setCarbs}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#64748B"
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.subLabel}>Grasas (g)</Text>
                <TextInput
                  style={styles.input}
                  value={fat}
                  onChangeText={setFat}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#64748B"
                />
              </View>
            </View>

            {/* Save & Delete Buttons */}
            <TouchableOpacity style={styles.saveBtn} activeOpacity={0.8} onPress={handleSave}>
              <Text style={styles.saveBtnText}>
                {foodToEdit ? 'Guardar Cambios' : 'Guardar Alimento'}
              </Text>
            </TouchableOpacity>

            {foodToEdit && onDelete ? (
              <TouchableOpacity
                style={styles.deleteBtn}
                activeOpacity={0.8}
                onPress={() => {
                  onDelete(foodToEdit.id);
                  onClose();
                }}>
                <Text style={styles.deleteBtnText}>Eliminar Alimento</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheetContainer: {
    backgroundColor: '#0E1420',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 30,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: '#1C2638',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#334155',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  closeText: {
    color: '#8E9BAE',
    fontSize: 18,
    fontWeight: '600',
  },
  formContent: {
    marginBottom: 10,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  subLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#161E2E',
    borderWidth: 1,
    borderColor: '#1C2638',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
  },
  timeInput: {
    backgroundColor: '#161E2E',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#3B82F6',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    width: 110,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  saveBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  deleteBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  deleteBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
});
