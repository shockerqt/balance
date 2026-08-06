import React, { useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TextInput, TouchableWithoutFeedback } from 'react-native';
import { makeStyles, useTheme } from '@/theme';

interface BatchMoveModalProps {
  visible: boolean;
  selectedCount: number;
  onClose: () => void;
  onConfirmMove: (newTime: string) => void;
}

export const BatchMoveModal: React.FC<BatchMoveModalProps> = ({
  visible,
  selectedCount,
  onClose,
  onConfirmMove,
}) => {
  const theme = useTheme();
  const styles = useStyles();
  const now = new Date();
  const defaultHours = String(now.getHours()).padStart(2, '0');
  const defaultMinutes = String(now.getMinutes()).padStart(2, '0');

  const [timeInput, setTimeInput] = useState(`${defaultHours}:${defaultMinutes}`);

  const quickTimes = ['08:30', '11:00', '13:30', '17:00', '20:30'];

  const handleConfirm = () => {
    if (timeInput.trim()) {
      onConfirmMove(timeInput.trim());
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.modalCard}>
              <Text style={styles.title}>Mover Alimentos en Lote</Text>
              <Text style={styles.subtitle}>
                Selecciona la nueva hora de consumo para los {selectedCount} alimentos seleccionados.
              </Text>

              {/* Time Input Field */}
              <View style={styles.inputBox}>
                <Text style={styles.inputLabel}>Nueva Hora (HH:MM)</Text>
                <TextInput
                  style={styles.textInput}
                  value={timeInput}
                  onChangeText={setTimeInput}
                  placeholder="08:30"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </View>

              {/* Quick Time Selector Chips */}
              <View style={styles.quickChipsRow}>
                {quickTimes.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, timeInput === t && styles.chipActive]}
                    delayPressIn={0}
                    onPress={() => setTimeInput(t)}>
                    <Text style={[styles.chipText, timeInput === t && styles.chipTextActive]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Modal Action Buttons */}
              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.cancelBtn} delayPressIn={0} onPress={onClose}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.confirmBtn} delayPressIn={0} onPress={handleConfirm}>
                  <Text style={styles.confirmBtnText}>Mover {selectedCount} Alimentos</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const useStyles = makeStyles((t) => ({
  backdrop: {
    flex: 1,
    backgroundColor: t.colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: t.colors.surface,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.colors.surfaceRaised,
    padding: 20,
    shadowColor: t.colors.shadow,
  },
  title: {
    color: t.colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: t.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  inputBox: {
    marginBottom: 14,
  },
  inputLabel: {
    color: t.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: t.colors.border,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.colors.primary,
    color: t.colors.text,
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  quickChipsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: t.colors.border,
    borderWidth: 1,
    borderColor: t.colors.surfaceRaised,
  },
  chipActive: {
    borderColor: t.colors.primary,
    backgroundColor: t.colors.border,
  },
  chipText: {
    color: t.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: t.colors.primary,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: t.colors.border,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: t.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: t.colors.primary,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: t.colors.onPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
}));
