import React, { useEffect, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Button, Icon, Input, Text } from '@/components/ui';
import { MONTH_NAMES, parseDateId, todayId } from '@/lib/dates';
import { isDateId } from '@/services/sync/types';
import { useTheme } from '@/theme';

/** Calendar arithmetic uses UTC dates; selection always remains a Chilean dateId. */
export function CalendarMonth({ value, onChange, marked = {}, disabled = false }: {
  value: string; onChange: (date: string) => void; marked?: Record<string, unknown>; disabled?: boolean;
}) {
  const theme = useTheme();
  const valid = isDateId(value) ? value : todayId();
  const [month, setMonth] = useState(`${valid.slice(0, 7)}-01`);
  const [jump, setJump] = useState(false);
  const [monthInput, setMonthInput] = useState(valid.slice(0, 7));
  const [error, setError] = useState('');
  useEffect(() => { setMonth(`${valid.slice(0, 7)}-01`); }, [valid]);
  const first = parseDateId(month);
  const year = first.getUTCFullYear(), index = first.getUTCMonth();
  const offset = (first.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, index + 1, 0, 12)).getUTCDate();
  const shift = (delta: number) => {
    const next = new Date(first); next.setUTCMonth(index + delta);
    setMonth(next.toISOString().slice(0, 10));
  };
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Mes anterior" disabled={disabled || year <= 1900} onPress={() => shift(-1)} style={{ padding: 12 }}><Icon name="chevron-left" /></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cambiar mes o año" disabled={disabled} onPress={() => { setMonthInput(month.slice(0, 7)); setJump(!jump); setError(''); }} style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
        <Text variant="heading" style={{ textAlign: 'center' }}>{MONTH_NAMES[index]} {year}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Mes siguiente" disabled={disabled || year >= 9998} onPress={() => shift(1)} style={{ padding: 12 }}><Icon name="chevron-right" /></TouchableOpacity>
    </View>
    {jump ? <View style={{ gap: 8 }}>
      <Input accessibilityLabel="Mes y año del calendario" placeholder="AAAA-MM" value={monthInput} onChangeText={setMonthInput} maxLength={7} editable={!disabled} />
      <Button title="Ir al mes" size="md" variant="secondary" disabled={disabled} onPress={() => {
        if (!/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(monthInput) || Number(monthInput.slice(0, 4)) > 9998) { setError('Usa AAAA-MM, entre 1900 y 9998.'); return; }
        setMonth(`${monthInput}-01`); setJump(false); setError('');
      }} />
      {error ? <Text selectable tone="danger">{error}</Text> : null}
    </View> : null}
    <View style={{ flexDirection: 'row' }}>{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((label, i) => <Text key={i} tone="muted" variant="caption" style={{ width: `${100 / 7}%`, textAlign: 'center' }}>{label}</Text>)}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, i) => {
      const number = i - offset + 1;
      if (number < 1 || number > length) return <View key={i} style={{ width: `${100 / 7}%`, height: 48 }} />;
      const date = `${month.slice(0, 7)}-${String(number).padStart(2, '0')}`;
      const selected = date === value;
      return <TouchableOpacity key={date} accessibilityRole="button" accessibilityLabel={`${date}${marked[date] ? ', con registro' : ', sin registro'}`}
        accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onChange(date)}
        style={{ width: `${100 / 7}%`, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? theme.colors.primary : 'transparent' }}>
        <Text tone={selected ? 'onPrimary' : 'primary'}>{number}</Text><Text variant="caption" tone={selected ? 'onPrimary' : 'accent'}>{marked[date] ? '•' : ' '}</Text>
      </TouchableOpacity>;
    })}</View>
    <Button title="Hoy" variant="ghost" size="md" disabled={disabled} onPress={() => onChange(todayId())} />
  </View>;
}
