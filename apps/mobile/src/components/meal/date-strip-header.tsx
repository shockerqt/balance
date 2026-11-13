import React, { useMemo, createContext, useContext } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { font, useTheme } from '@/theme';
import { useMealDay } from '@/hooks/use-meal-store';
import { Icon, Text } from '@/components/ui';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { DateSwipe } from './date-swipe';
import { useWeekStripSwipe } from './use-week-strip-swipe';
import { DAY_NAMES, MONTH_NAMES, dateIdToEpochDay, buildWeekGroup, generateWeeksWindow, getMondayDateId, parseDateId, shiftDateId, todayId } from '@/lib/dates';

interface DateStripHeaderProps {
  compact?: boolean;
  pagerPosition?: SharedValue<number>;
  pagerInteraction?: SharedValue<number>;
  active?: boolean;
  selectedDateId: string;
  onSelectDate: (dateId: string) => void;
  onShiftDate: (days: number) => void;
}
type Day = ReturnType<typeof buildWeekGroup>['days'][number];
type Presentation = { position: SharedValue<number>; weekOffset: SharedValue<number>; weekPhase: SharedValue<number>; selectedDay: number };

const CompactContext = createContext(false);
const WEEK_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
function dateLabel(dateId: string, today: string) {
  const date = parseDateId(dateId);
  const weekday = DAY_NAMES[date.getUTCDay()];
  const title = dateId === today ? 'Hoy' : dateId === shiftDateId(today, -1) ? 'Ayer' : dateId === shiftDateId(today, 1) ? 'Mañana' : weekday;
  const year = date.getUTCFullYear() !== parseDateId(today).getUTCFullYear() ? ` de ${date.getUTCFullYear()}` : '';
  return { title, subtitle: `${weekday.toLocaleLowerCase('es')} ${date.getUTCDate()} de ${MONTH_NAMES[date.getUTCMonth()].toLocaleLowerCase('es')}${year}` };
}
/** The title, outline and underline share a weight without rendering React. */
function distanceFromDay(day: number, position: number, weekOffset: number, weekPhase: number, selectedDay: number) {
  'worklet';
  if (!weekPhase) return day - position;
  const delta = day - selectedDay;
  return delta % 7 === 0 ? delta / 7 - weekOffset : 2;
}
export function DateStripHeader(props: DateStripHeaderProps) {
  return <CompactContext value={props.compact ?? false}>{props.pagerPosition ? <ProgressDateStripHeader {...props} pagerPosition={props.pagerPosition} /> : <HeaderContent {...props} />}</CompactContext>;
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
function HeaderContent({ compact = false, selectedDateId, onSelectDate, onShiftDate, presentation, weekGesture, width, onWidth }: DateStripHeaderProps & {
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
  const row = <View style={styles.daysRow}>{week.days.map((item, index) => <DayPill key={item.dateId} item={item} letter={WEEK_LETTERS[index]} today={today}
    selected={item.dateId === selectedDateId} onSelectDate={onSelectDate} />)}</View>;
  return <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
    <View style={[styles.topHeaderRow, compact && { height: 36, paddingTop: 0, paddingBottom: 0 }]}>
      {/* Swiping is the visual way to change day; assistive tech gets the same commands as actions. */}
      <View accessible accessibilityRole="adjustable" accessibilityLabel={`${label.title}, ${label.subtitle}`}
        accessibilityHint="Desliza hacia arriba o abajo para cambiar de día"
        accessibilityActions={[{ name: 'increment', label: 'Día siguiente' }, { name: 'decrement', label: 'Día anterior' },
          ...(selectedDateId !== today ? [{ name: 'activate', label: 'Volver a hoy' }] : [])]}
        onAccessibilityAction={event => {
          const action = event.nativeEvent.actionName;
          if (action === 'increment') onShiftDate(1);
          else if (action === 'decrement') onShiftDate(-1);
          else if (action === 'activate' && selectedDateId !== today) onSelectDate(today);
        }} style={[styles.dateTitleBox, compact && { height: 24 }]}>
        {compact ? <Text numberOfLines={1} style={{ fontSize: 17 }}>{label.title} · {parseDateId(selectedDateId).getUTCDate()} {MONTH_NAMES[parseDateId(selectedDateId).getUTCMonth()].slice(0, 3)}</Text> : presentation ? labels.map(item => <ProgressDateLabel key={item.dateId} {...item} presentation={presentation} />) : <DateLabel {...label} />}
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Elegir fecha"
        style={[styles.calendarBtn, compact && { height: 28, width: 36 }, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} onPress={() => router.push('/date-picker')}>
        <Icon name="calendar" size={20} tone="primary" />
      </TouchableOpacity>
    </View>
    {presentation && weekGesture && width ? <GestureDetector gesture={weekGesture}>
      <View collapsable={false} style={[styles.weekViewport, compact && { height: 42 }]} onLayout={event => onWidth?.(event.nativeEvent.layout.width)}>
        {weeks.map((item, index) => <ProgressWeek key={item.startDateId} week={item} offset={index - 1} today={today}
          monday={dateIdToEpochDay(monday)} width={width} presentation={presentation} selectedDateId={selectedDateId} onSelectDate={onSelectDate} />)}
      </View>
    </GestureDetector> : <DateSwipe days={7}>{row}</DateSwipe>}
  </View>;
}
function DateLabel({ title, subtitle }: { title: string; subtitle: string }) {
  return <>
    <Text variant="display" numberOfLines={1}>{title}</Text>
    <Text tone="secondary" numberOfLines={1} style={styles.subtitleContext}>{subtitle}</Text>
  </>;
}
function ProgressDateLabel({ day, title, subtitle, presentation }: { day: number; title: string; subtitle: string; presentation: Presentation }) {
  const { position, weekOffset, weekPhase, selectedDay } = presentation;
  const animated = useAnimatedStyle(() => {
    const distance = distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay);
    return { opacity: Math.max(0, 1 - Math.abs(distance)), transform: [{ translateX: Math.max(-1, Math.min(1, distance)) * -16 }] };
  });
  return <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.titleLayer, animated]}><DateLabel title={title} subtitle={subtitle} /></Animated.View>;
}
function ProgressWeek({ week, offset, monday, width, presentation, selectedDateId, today, onSelectDate }: {
  week: ReturnType<typeof buildWeekGroup>; offset: number; monday: number; width: SharedValue<number>; presentation: Presentation;
  selectedDateId: string; today: string; onSelectDate: (date: string) => void;
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
    {week.days.map((item, index) => <DayPill key={item.dateId} item={item} letter={WEEK_LETTERS[index]} today={today} selected={item.dateId === selectedDateId}
      presentation={presentation} onSelectDate={onSelectDate} />)}
  </Animated.View>;
}
/** One face of a day cell: the resting look or the selected (ink) look. */
function DayFace({ item, letter, logged, future, inverted }: { item: Day; letter: string; logged: boolean; future: boolean; inverted: boolean }) {
  const theme = useTheme();
  const compact = useContext(CompactContext);
  const c = theme.colors;
  const ink = inverted ? c.onPrimary : future ? c.textSecondary : c.text;
  return <>
    {compact ? null : <Text style={[theme.type.label, { color: ink }]}>{letter}</Text>}
    <Text style={[styles.dayNumberText, { color: ink }]}>{item.dayNumber}</Text>
    <View style={[styles.mark, { backgroundColor: inverted ? c.onPrimary : logged ? c.text : c.barEmpty, opacity: inverted && !logged ? 0.35 : 1 }]} />
  </>;
}
function DayPill({ item, letter, today, selected, presentation, onSelectDate }: { item: Day; letter: string; today: string; selected: boolean; presentation?: Presentation; onSelectDate: (date: string) => void }) {
  const compact = useContext(CompactContext);
  const theme = useTheme();
  const logged = useMealDay(item.dateId).foods.length > 0;
  const future = item.dateId > today;
  const date = parseDateId(item.dateId);
  return <TouchableOpacity accessibilityRole="button"
    accessibilityLabel={`${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} de ${MONTH_NAMES[date.getUTCMonth()].toLocaleLowerCase('es')}${logged ? ', con registros' : ''}`}
    accessibilityState={{ selected }} testID={`day-${item.dateId}`} onPress={() => onSelectDate(item.dateId)} style={[styles.dayTouch, compact && { height: 42 }]}>
    {presentation ? <ProgressDayPill day={dateIdToEpochDay(item.dateId)} presentation={presentation}
      rest={<DayFace item={item} letter={letter} logged={logged} future={future} inverted={false} />}
      active={<DayFace item={item} letter={letter} logged={logged} future={future} inverted />} />
      : <View style={[styles.dayPill, { backgroundColor: selected ? theme.colors.primary : 'transparent', borderColor: selected ? theme.colors.primary : theme.colors.border }]}>
        <DayFace item={item} letter={letter} logged={logged} future={future} inverted={selected} />
      </View>}
  </TouchableOpacity>;
}
function ProgressDayPill({ day, presentation, rest, active }: { day: number; presentation: Presentation; rest: React.ReactNode; active: React.ReactNode }) {
  const theme = useTheme();
  const { position, weekOffset, weekPhase, selectedDay } = presentation;
  const weight = useDerivedValue(() => Math.max(0, 1 - Math.abs(distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay))));
  const fill = useAnimatedStyle(() => ({ opacity: weight.value }));
  return <View style={[styles.dayPill, { borderColor: theme.colors.border }]}>
    {rest}
    <Animated.View style={[styles.dayActive, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }, fill]}>{active}</Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  container: { paddingBottom: 12 },
  weekViewport: { height: 60, overflow: 'hidden' },
  weekLayer: { position: 'absolute', top: 0, left: 0, right: 0, height: 60 },
  titleLayer: { position: 'absolute', left: 0, right: 0, top: 0 },
  topHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4, paddingHorizontal: 20, paddingBottom: 6 },
  dateTitleBox: { flex: 1, height: 54, overflow: 'hidden', justifyContent: 'flex-start' },
  subtitleContext: { fontSize: 14, marginTop: 2 },
  calendarBtn: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  daysRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 6 },
  dayTouch: { flex: 1, height: 60 },
  dayPill: { flex: 1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2, overflow: 'hidden' },
  dayActive: { position: 'absolute', top: -1, bottom: -1, left: -1, right: -1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  dayNumberText: { fontFamily: font.displaySmall, fontSize: 17, lineHeight: 20, fontVariant: ['tabular-nums'] },
  mark: { width: 18, height: 4, borderRadius: 2 },
});
