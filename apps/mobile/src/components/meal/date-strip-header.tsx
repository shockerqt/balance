import React, { useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Icon } from '@/components/ui';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { DateSwipe } from './date-swipe';
import { useWeekStripSwipe } from './use-week-strip-swipe';
import { DAY_NAMES, MONTH_NAMES, dateIdToEpochDay, buildWeekGroup, generateWeeksWindow, getMondayDateId, parseDateId, shiftDateId, todayId } from '@/lib/dates';

interface DateStripHeaderProps {
  pagerPosition?: SharedValue<number>;
  pagerInteraction?: SharedValue<number>;
  active?: boolean;
  selectedDateId: string;
  onSelectDate: (dateId: string) => void;
  onShiftDate: (days: number) => void;
}
type Day = ReturnType<typeof buildWeekGroup>['days'][number];
type Presentation = { position: SharedValue<number>; weekOffset: SharedValue<number>; weekPhase: SharedValue<number>; selectedDay: number };

function dateLabel(dateId: string, today: string) {
  const date = parseDateId(dateId);
  return { title: dateId === today ? 'Hoy' : `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()}`,
    subtitle: `${date.getUTCDate()} de ${MONTH_NAMES[date.getUTCMonth()]} · ${date.getUTCFullYear()}` };
}
/** The title, outline and underline share a weight without rendering React. */
function distanceFromDay(day: number, position: number, weekOffset: number, weekPhase: number, selectedDay: number) {
  'worklet';
  if (!weekPhase) return day - position;
  const delta = day - selectedDay;
  return delta % 7 === 0 ? delta / 7 - weekOffset : 2;
}
export function DateStripHeader(props: DateStripHeaderProps) {
  return props.pagerPosition ? <ProgressDateStripHeader {...props} pagerPosition={props.pagerPosition} /> : <HeaderContent {...props} />;
}
function ProgressDateStripHeader(props: DateStripHeaderProps & { pagerPosition: SharedValue<number> }) {
  const width = useSharedValue(1);
  const { gesture, offset, phase, setWidth } = useWeekStripSwipe({ dateId: props.selectedDateId, active: props.active ?? true,
    width, interaction: props.pagerInteraction, onSelectDate: props.onSelectDate });
  const interaction = props.pagerInteraction;
  // A content swipe takes visual precedence if another touch starts the pager.
  const weekPhase = useDerivedValue(() => (interaction?.value ?? 0) === 0 ? phase.value : 0);
  const presentation = { position: props.pagerPosition, weekOffset: offset, weekPhase, selectedDay: dateIdToEpochDay(props.selectedDateId) };
  return <HeaderContent {...props} presentation={presentation} weekGesture={gesture} width={width} onWidth={setWidth} />;
}
function HeaderContent({ selectedDateId, onSelectDate, onShiftDate, presentation, weekGesture, width, onWidth }: DateStripHeaderProps & {
  presentation?: Presentation; weekGesture?: ReturnType<typeof useWeekStripSwipe>['gesture']; width?: SharedValue<number>; onWidth?: (width: number) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const today = todayId();
  const monday = getMondayDateId(selectedDateId);
  const week = useMemo(() => buildWeekGroup(monday, 0, today), [monday, today]);
  const weeks = useMemo(() => generateWeeksWindow(selectedDateId, 1, 1, today), [selectedDateId, today]);
  const labels = useMemo(() => Array.from({ length: 15 }, (_, i) => {
    const dateId = shiftDateId(selectedDateId, i - 7);
    return { dateId, day: dateIdToEpochDay(dateId), ...dateLabel(dateId, today) };
  }), [selectedDateId, today]);
  const label = dateLabel(selectedDateId, today);
  const row = <View style={styles.daysRow}>{week.days.map(item => <DayPill key={item.dateId} item={item}
    selected={item.dateId === selectedDateId} onSelectDate={onSelectDate} />)}</View>;
  return <View style={[styles.container, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.border }]}>
    <View style={styles.topHeaderRow}>
      <View style={styles.fixedDateNavBox}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ir al día anterior"
          style={[styles.navArrowBtn, { backgroundColor: theme.colors.surface }]} onPress={() => onShiftDate(-1)}>
          <Icon name="chevron-left" size={20} tone="accent" />
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Elegir fecha: ${label.title}, ${label.subtitle}`}
          style={styles.dateTitleBox} onPress={() => router.push('/date-picker')}>
          {presentation ? labels.map(item => <ProgressDateLabel key={item.dateId} {...item} presentation={presentation} />) : <DateLabel {...label} />}
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ir al día siguiente"
          style={[styles.navArrowBtn, { backgroundColor: theme.colors.surface }]} onPress={() => onShiftDate(1)}>
          <Icon name="chevron-right" size={20} tone="accent" />
        </TouchableOpacity>
      </View>
      {selectedDateId !== today && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Volver a hoy"
        style={[styles.todayPillBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]} onPress={() => onSelectDate(today)}>
        <Text style={[styles.todayPillText, { color: theme.colors.primary }]}>Hoy</Text>
      </TouchableOpacity>}
    </View>
    {presentation && weekGesture && width ? <GestureDetector gesture={weekGesture}>
      <View collapsable={false} style={styles.weekViewport} onLayout={event => onWidth?.(event.nativeEvent.layout.width)}>
        {weeks.map((item, index) => <ProgressWeek key={item.startDateId} week={item} offset={index - 1}
          monday={dateIdToEpochDay(monday)} width={width} presentation={presentation} selectedDateId={selectedDateId} onSelectDate={onSelectDate} />)}
      </View>
    </GestureDetector> : <DateSwipe days={7}>{row}</DateSwipe>}
  </View>;
}
function DateLabel({ title, subtitle }: { title: string; subtitle: string }) {
  const theme = useTheme();
  return <>
    <Text numberOfLines={1} style={[styles.headlineTitle, { color: theme.colors.text }]}>{title}</Text>
    <Text numberOfLines={1} style={[styles.subtitleContext, { color: theme.colors.textSecondary }]}>{subtitle}</Text>
  </>;
}
function ProgressDateLabel({ day, title, subtitle, presentation }: { day: number; title: string; subtitle: string; presentation: Presentation }) {
  const { position, weekOffset, weekPhase, selectedDay } = presentation;
  const animated = useAnimatedStyle(() => {
    const distance = distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay);
    return { opacity: Math.max(0, 1 - Math.abs(distance)), transform: [{ translateX: Math.max(-1, Math.min(1, distance)) * 24 }] };
  });
  return <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.titleLayer, animated]}><DateLabel title={title} subtitle={subtitle} /></Animated.View>;
}
function ProgressWeek({ week, offset, monday, width, presentation, selectedDateId, onSelectDate }: {
  week: ReturnType<typeof buildWeekGroup>; offset: number; monday: number; width: SharedValue<number>; presentation: Presentation;
  selectedDateId: string; onSelectDate: (date: string) => void;
}) {
  const { position, weekOffset, weekPhase } = presentation;
  const animated = useAnimatedStyle(() => {
    const relativeDay = position.value - monday;
    const wholeWeeks = Math.floor(relativeDay / 7);
    // Only the boundary interval reveals the adjacent week, reversibly.
    const progress = weekPhase.value ? weekOffset.value : wholeWeeks + Math.max(0, relativeDay - wholeWeeks * 7 - 6);
    return { transform: [{ translateX: (offset - progress) * width.value }] };
  });
  return <Animated.View accessibilityElementsHidden={offset !== 0} importantForAccessibility={offset === 0 ? 'auto' : 'no-hide-descendants'}
    style={[styles.daysRow, styles.weekLayer, animated]}>
    {week.days.map(item => <DayPill key={item.dateId} item={item} selected={item.dateId === selectedDateId}
      presentation={presentation} onSelectDate={onSelectDate} />)}
  </Animated.View>;
}
function DayPill({ item, selected, presentation, onSelectDate }: { item: Day; selected: boolean; presentation?: Presentation; onSelectDate: (date: string) => void }) {
  const theme = useTheme();
  const content = <>
    <Text style={[styles.dayNameText, { color: selected && !presentation ? theme.colors.onPrimary : theme.colors.textMuted }]}>{item.dayName}</Text>
    <Text style={[styles.dayNumberText, { color: selected && !presentation ? theme.colors.onPrimary : theme.colors.text }]}>{item.dayNumber}</Text>
  </>;
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${DAY_NAMES[parseDateId(item.dateId).getUTCDay()]} ${item.dateId}`}
    accessibilityState={{ selected }} onPress={() => onSelectDate(item.dateId)} style={{ flex: 1, height: 54 }}>
    {presentation ? <ProgressDayPill day={dateIdToEpochDay(item.dateId)} isToday={item.isToday} presentation={presentation}>{content}</ProgressDayPill>
      : <View style={[styles.dayPill, { backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
        borderColor: selected || item.isToday ? theme.colors.primary : theme.colors.border }]}>{content}</View>}
  </TouchableOpacity>;
}
function ProgressDayPill({ day, isToday, presentation, children }: { day: number; isToday: boolean; presentation: Presentation; children: React.ReactNode }) {
  const theme = useTheme();
  const primary = theme.colors.primary, border = theme.colors.border;
  const { position, weekOffset, weekPhase, selectedDay } = presentation;
  const weight = useDerivedValue(() => Math.max(0, 1 - Math.abs(distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay))));
  const outline = useAnimatedStyle(() => ({ borderColor: interpolateColor(isToday ? 1 : weight.value, [0, 1], [border, primary]) }));
  const marker = useAnimatedStyle(() => ({ opacity: weight.value }));
  return <Animated.View style={[styles.dayPill, { backgroundColor: theme.colors.surface }, outline]}>
    <Animated.View style={[styles.marker, { backgroundColor: primary }, marker]} />{children}
  </Animated.View>;
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  weekViewport: { height: 54, overflow: 'hidden' },
  weekLayer: { position: 'absolute', top: 0, left: 0, right: 0, height: 54 },
  titleLayer: { position: 'absolute', left: 8, right: 8, alignItems: 'center' },
  marker: { position: 'absolute', bottom: 2, height: 3, width: 24, borderRadius: 2 },
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
    overflow: 'hidden',
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
