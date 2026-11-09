import React from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Sheet } from '@/components/ui';
import { CalendarMonth } from '@/components/meal/calendar-month';
import { useLogsSelectedDate } from '@/hooks/use-logs-date';

export default function DatePickerScreen() {
  const router = useRouter();
  const [date, setDate] = useLogsSelectedDate();
  return <Sheet title="Seleccionar fecha">
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20 }}>
      <CalendarMonth value={date} onChange={value => { setDate(value); router.back(); }} />
    </ScrollView>
  </Sheet>;
}
