import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { makeStyles, useTheme } from '@/theme';

const CHILEAN_SEALS_OPTIONS = [
  'ALTO EN CALORÍAS',
  'ALTO EN SODIO',
  'ALTO EN AZÚCARES',
  'ALTO EN GRASAS SATURADAS',
];

export default function CreateFoodScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const router = useRouter();
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

    router.replace({
      pathname: '/food-portion',
      params: { foodId: created.id },
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Bar */}
        <View style={styles.headerBar}>
          <TouchableOpacity style={styles.cancelBtn} delayPressIn={0} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>✕ Cancelar</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Crear Alimento</Text>
        </View>

        <Text style={styles.subtitle}>
          Define las métricas por porción base para guardarlo en tu biblioteca personal.
        </Text>

        {/* Name & Base Portion */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nombre del Alimento</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="Ej. Pan de Masa Madre"
            placeholderTextColor={theme.colors.textMuted}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Porción Base (ej. 100g o 1 unidad)</Text>
          <TextInput
            style={styles.textInput}
            value={portion}
            onChangeText={setPortion}
            placeholder="100g"
            placeholderTextColor={theme.colors.textMuted}
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
              placeholderTextColor={theme.colors.textMuted}
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
              placeholderTextColor={theme.colors.textMuted}
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
              placeholderTextColor={theme.colors.textMuted}
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
              placeholderTextColor={theme.colors.textMuted}
            />
          </View>
        </View>

        {/* Chilean Health Seals */}
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

        {/* Confirm Save Button */}
        <TouchableOpacity
          style={[styles.confirmBtn, !name.trim() && styles.confirmBtnDisabled]}
          delayPressIn={0}
          disabled={!name.trim()}
          onPress={handleSave}>
          <Text style={styles.confirmBtnText}>Guardar Alimento</Text>
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
    marginBottom: 8,
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
  subtitle: {
    color: t.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
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
    color: t.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: t.colors.border,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.colors.surfaceRaised,
    color: t.colors.text,
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  textInputNumber: {
    backgroundColor: t.colors.border,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.colors.surfaceRaised,
    color: t.colors.text,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontVariant: ['tabular-nums'],
  },
  sealsSection: {
    marginTop: 6,
    marginBottom: 20,
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
    backgroundColor: t.colors.border,
    borderWidth: 1,
    borderColor: t.colors.surfaceRaised,
  },
  sealChipSelected: {
    borderColor: t.colors.danger,
    backgroundColor: t.colors.surfaceRaised,
  },
  sealChipText: {
    color: t.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  sealChipTextSelected: {
    color: t.colors.danger,
  },
  confirmBtn: {
    backgroundColor: t.colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.5,
  },
  confirmBtnText: {
    color: t.colors.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
}));
