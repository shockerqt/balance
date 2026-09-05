import React, { useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Icon } from '@/components/ui';
import { DateSwipe } from './date-swipe';
import { DAY_NAMES, MONTH_NAMES, buildWeekGroup, getMondayDateId, parseDateId, todayId } from '@/lib/dates';

interface DateStripHeaderProps {
  selectedDateId: string;
  onSelectDate: (dateId: string) => void;
  onShiftDate: (days: number) => void;
}

export function DateStripHeader({ selectedDateId, onSelectDate, onShiftDate }: DateStripHeaderProps) {
  const theme = useTheme();
  const router = useRouter();
  const today = todayId();
  const monday = getMondayDateId(selectedDateId);
  const week = useMemo(() => buildWeekGroup(monday, 0, today), [monday, today]);
  const date = parseDateId(selectedDateId);
  const isToday = selectedDateId === today;
  const title = isToday ? 'Hoy' : `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()}`;
  const subtitle = `${date.getUTCDate()} de ${MONTH_NAMES[date.getUTCMonth()]} · ${date.getUTCFullYear()}`;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.border }]}>
      <View style={styles.topHeaderRow}>
        <View style={styles.fixedDateNavBox}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ir al día anterior"
            style={[styles.navArrowBtn, { backgroundColor: theme.colors.surface }]}
            onPress={() => onShiftDate(-1)}>
            <Icon name="chevron-left" size={20} tone="accent" />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Elegir fecha"
            style={styles.dateTitleBox} onPress={() => router.push('/date-picker')}>
            <Text numberOfLines={1} style={[styles.headlineTitle, { color: theme.colors.text }]}>{title}</Text>
            <Text numberOfLines={1} style={[styles.subtitleContext, { color: theme.colors.textSecondary }]}>{subtitle}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ir al día siguiente"
            style={[styles.navArrowBtn, { backgroundColor: theme.colors.surface }]}
            onPress={() => onShiftDate(1)}>
            <Icon name="chevron-right" size={20} tone="accent" />
          </TouchableOpacity>
        </View>
        {!isToday && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Volver a hoy"
            style={[styles.todayPillBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}
            onPress={() => onSelectDate(today)}>
            <Text style={[styles.todayPillText, { color: theme.colors.primary }]}>Hoy</Text>
          </TouchableOpacity>
        )}
      </View>
      <DateSwipe days={7}>
        <View style={styles.daysRow}>
          {week.days.map((item) => {
            const selected = item.dateId === selectedDateId;
            return (
              <TouchableOpacity key={item.dateId}
                accessibilityRole="button" accessibilityLabel={`${DAY_NAMES[parseDateId(item.dateId).getUTCDay()]} ${item.dateId}`}
                accessibilityState={{ selected }}
                onPress={() => onSelectDate(item.dateId)}
                style={[styles.dayPill, {
                  backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                  borderColor: selected || item.isToday ? theme.colors.primary : theme.colors.border,
                }]}>
                <Text style={[styles.dayNameText, { color: selected ? theme.colors.onPrimary : theme.colors.textMuted }]}>{item.dayName}</Text>
                <Text style={[styles.dayNumberText, { color: selected ? theme.colors.onPrimary : theme.colors.text }]}>{item.dayNumber}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </DateSwipe>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    position: 'relative',
    height: 48,
  },
  fixedDateNavBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navArrowBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateTitleBox: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headlineTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitleContext: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 1,
  },
  todayPillBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  todayPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 4,
  },
  dayPill: {
    flex: 1,
    height: 54,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  dayNameText: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  dayNumberText: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
