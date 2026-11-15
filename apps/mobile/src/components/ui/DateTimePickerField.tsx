import React, { useState } from 'react';
import { Platform, StyleProp, TouchableOpacity, View, ViewStyle } from 'react-native';
import { dateIdToLocalDate, localDateToDateId, localDateToTimeString, timeStringToLocalDate } from '@/lib/dates';
import { font, makeStyles, useTheme } from '@/theme';
import { Icon } from './Icon';
import { Input } from './Input';
import { Text } from './Text';

// Safe require for RNDateTimePicker to prevent module evaluation failure on un-updated Dev Clients
let RNDateTimePicker: React.ComponentType<any> | null = null;
try {
  RNDateTimePicker = require('@react-native-community/datetimepicker').default ?? null;
} catch {
  RNDateTimePicker = null;
}

export interface DateTimePickerFieldProps {
  mode: 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  accessibilityLabel?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  style?: StyleProp<ViewStyle>;
  /** Optional override for testing native picker vs fallback rendering. */
  pickerComponent?: React.ComponentType<any> | null;
}

export const DateTimePickerField: React.FC<DateTimePickerFieldProps> = ({
  mode,
  value,
  onChange,
  placeholder,
  disabled = false,
  clearable = false,
  accessibilityLabel,
  minimumDate,
  maximumDate,
  style,
  pickerComponent,
}) => {
  const styles = useStyles();
  const theme = useTheme();
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);

  const Picker = pickerComponent === undefined ? RNDateTimePicker : pickerComponent;
  const resolvedPlaceholder = placeholder ?? (mode === 'date' ? 'AAAA-MM-DD' : 'HH:mm');
  const trimmedValue = value.trim();
  const hasValue = trimmedValue.length > 0;
  const pickerDate =
    mode === 'date'
      ? dateIdToLocalDate(trimmedValue)
      : timeStringToLocalDate(trimmedValue, '12:00');

  const handlePickerChange = (event: { type?: string } | undefined, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowAndroidPicker(false);
    }
    if (event?.type === 'dismissed' || !selectedDate) {
      return;
    }
    onChange(mode === 'date' ? localDateToDateId(selectedDate) : localDateToTimeString(selectedDate));
  };

  if (!Picker) {
    return (
      <View style={[styles.fallbackRow, style]}>
        <Input
          accessibilityLabel={accessibilityLabel}
          value={value}
          onChangeText={onChange}
          placeholder={resolvedPlaceholder}
          maxLength={mode === 'date' ? 10 : 5}
          editable={!disabled}
          keyboardType="numbers-and-punctuation"
          style={styles.fallbackInput}
        />
        {clearable && hasValue && !disabled ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Limpiar"
            onPress={() => onChange('')}
            style={styles.clearButton}
          >
            <Icon name="x" size={16} tone="muted" />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (Platform.OS === 'ios') {
    const showPlaceholderButton = clearable && !hasValue;
    return (
      <View style={[styles.iosRow, disabled && styles.disabled, style]}>
        {showPlaceholderButton ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() =>
              onChange(mode === 'date' ? localDateToDateId(pickerDate) : localDateToTimeString(pickerDate))
            }
            style={styles.trigger}
          >
            <Icon name={mode === 'date' ? 'calendar' : 'clock'} size={16} tone="secondary" />
            <Text style={styles.placeholderText}>{resolvedPlaceholder}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.iosPickerWrap} pointerEvents={disabled ? 'none' : 'auto'}>
            <Picker
              accessibilityLabel={accessibilityLabel}
              value={pickerDate}
              mode={mode}
              display="compact"
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              onChange={handlePickerChange}
              themeVariant={theme.scheme === 'dark' ? 'dark' : 'light'}
            />
          </View>
        )}
        {clearable && hasValue && !disabled ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Limpiar"
            onPress={() => onChange('')}
            style={styles.clearButton}
          >
            <Icon name="x" size={16} tone="muted" />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={style}>
      <View style={[styles.triggerRow, disabled && styles.disabled]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled }}
          disabled={disabled}
          activeOpacity={0.7}
          onPress={() => setShowAndroidPicker(true)}
          style={styles.trigger}
        >
          <Icon name={mode === 'date' ? 'calendar' : 'clock'} size={16} tone="secondary" />
          <Text style={hasValue ? styles.valueText : styles.placeholderText}>
            {hasValue ? trimmedValue : resolvedPlaceholder}
          </Text>
        </TouchableOpacity>
        {clearable && hasValue && !disabled ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Limpiar"
            onPress={() => onChange('')}
            style={styles.clearButton}
          >
            <Icon name="x" size={16} tone="muted" />
          </TouchableOpacity>
        ) : null}
      </View>

      {showAndroidPicker && !disabled ? (
        <Picker
          value={pickerDate}
          mode={mode}
          display="default"
          is24Hour={mode === 'time'}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handlePickerChange}
        />
      ) : null}
    </View>
  );
};

const useStyles = makeStyles((t) => ({
  fallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
  },
  fallbackInput: {
    flex: 1,
  },
  iosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.colors.surface,
    borderWidth: t.border.hairline,
    borderColor: t.colors.lineStrong,
    borderRadius: t.radius.lg,
    minHeight: 50,
    paddingHorizontal: 10,
  },
  iosPickerWrap: {
    flex: 1,
    alignItems: 'flex-start',
  },
  triggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderWidth: t.border.hairline,
    borderColor: t.colors.lineStrong,
    borderRadius: t.radius.lg,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  trigger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    paddingVertical: t.space.md,
  },
  valueText: {
    color: t.colors.text,
    fontSize: 15,
    fontFamily: font.regular,
    fontVariant: ['tabular-nums'],
  },
  placeholderText: {
    color: t.colors.textMuted,
    fontSize: 15,
    fontFamily: font.regular,
  },
  clearButton: {
    padding: t.space.xs,
  },
  disabled: {
    opacity: 0.55,
  },
}));
