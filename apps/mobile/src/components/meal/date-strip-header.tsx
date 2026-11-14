import React, { useEffect, useMemo, useState, createContext, useContext } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { font, useTheme } from '@/theme';
import { useMealDay } from '@/hooks/use-meal-store';
import { Icon, Text } from '@/components/ui';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue, type AnimatedStyle } from 'react-native-reanimated';
import { DateSwipe } from './date-swipe';
import { useWeekStripSwipe } from './use-week-strip-swipe';
import { DAY_NAMES, MONTH_NAMES, dateIdToEpochDay, buildWeekGroup, generateWeeksWindow, getMondayDateId, parseDateId, shiftDateId, todayId } from '@/lib/dates';

interface DateStripHeaderProps {
  compact?: boolean;
  collapseScroll?: SharedValue<number>;
  pagerPosition?: SharedValue<number>;
  pagerInteraction?: SharedValue<number>;
  active?: boolean;
  pageLocal?: boolean;
  collapseDistance?: number;
  onMeasure?: (expanded: number, compact: number) => void;
  onHeaderTouch?: (down: boolean) => void;
  selectedDateId: string;
  onSelectDate: (dateId: string) => void;
  onShiftDate: (days: number) => void;
}
type Day = ReturnType<typeof buildWeekGroup>['days'][number];
type Presentation = { position: SharedValue<number>; weekOffset: SharedValue<number>; weekPhase: SharedValue<number>; selectedDay: number };

const CompactContext = createContext(false);
type CollapsePresentation = {
  letter: AnimatedStyle<{ height: number; opacity: number }>;
  number: AnimatedStyle<{ fontSize: number }>;
  mark: AnimatedStyle<{ height: number }>;
  touch: AnimatedStyle<{ height: number }>;
  week: AnimatedStyle<{ height: number; paddingTop: number; paddingBottom: number }>;
};
const CollapseContext = createContext<CollapsePresentation | null>(null);
type HeaderMetrics = { fullTitle: number; compactTitle: number; fullWeek: number; compactWeek: number; letter: number };
const HeaderMetricsContext = createContext<HeaderMetrics>({ fullTitle: 64, compactTitle: 36, fullWeek: 72, compactWeek: 42, letter: 16 });
const DayTouch = Animated.createAnimatedComponent(TouchableOpacity);
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
  const { collapseScroll, compact = false, collapseDistance = 216, onMeasure } = props;
  const [measurements, setMeasurements] = useState<Partial<HeaderMetrics>>({});
  const metrics = { fullTitle: 64, compactTitle: 36, fullWeek: 72, compactWeek: 42, letter: 16, ...measurements };
  useEffect(() => {
    if (Object.keys(measurements).length === 5) onMeasure?.(metrics.fullTitle + metrics.fullWeek, metrics.compactTitle + metrics.compactWeek);
  }, [measurements, onMeasure, metrics.fullTitle, metrics.fullWeek, metrics.compactTitle, metrics.compactWeek]);
  // All day faces share these five UI styles, avoiding duplicate worklet registration per face.
  const letter = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { height: metrics.letter * (1 - p), opacity: 1 - p };
  });
  const number = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { fontSize: 17 - 2 * p };
  });
  const mark = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { height: 4 - p };
  });
  const touch = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { height: metrics.fullWeek - 12 - (metrics.fullWeek - 12 - metrics.compactWeek + 6) * p };
  });
  const week = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { height: metrics.fullWeek - (metrics.fullWeek - metrics.compactWeek) * p, paddingTop: 4 - 2 * p, paddingBottom: 8 - 4 * p };
  });
  const collapse = useMemo(() => ({ letter, number, mark, touch, week }), [letter, number, mark, touch, week]);
  return <HeaderMetricsContext value={metrics}><CompactContext value={compact}><CollapseContext value={collapse}>
    {props.pagerPosition ? <ProgressDateStripHeader {...props} pagerPosition={props.pagerPosition} /> : <HeaderContent {...props} />}
    {onMeasure ? <HeaderMeasurement dateId={props.selectedDateId} onMeasure={(key, height) => {
      setMeasurements(previous => previous[key] === height ? previous : { ...previous, [key]: height });
    }} /> : null}
  </CollapseContext></CompactContext></HeaderMetricsContext>;
}
function ProgressDateStripHeader(props: DateStripHeaderProps & { pagerPosition: SharedValue<number> }) {
  const width = useSharedValue(1);
  const { gesture, offset, phase, setWidth } = useWeekStripSwipe({ dateId: props.selectedDateId, active: props.active ?? true,
    width, interaction: props.pagerInteraction, onSelectDate: props.onSelectDate, onHeaderTouch: props.onHeaderTouch });
  const interaction = props.pagerInteraction;
  // A content swipe takes visual precedence if another touch starts the pager.
  const weekPhase = useDerivedValue(() => (interaction?.value ?? 0) === 0 ? phase.value : 0);
  const presentation = { position: props.pagerPosition, weekOffset: offset, weekPhase, selectedDay: dateIdToEpochDay(props.selectedDateId) };
  return <HeaderContent {...props} presentation={presentation} weekGesture={gesture} width={width} onWidth={setWidth} />;
}
function HeaderContent({ compact = false, collapseScroll, collapseDistance = 216, pageLocal = false, selectedDateId, onSelectDate, onShiftDate, presentation, weekGesture, width, onWidth }: DateStripHeaderProps & {
  presentation?: Presentation; weekGesture?: ReturnType<typeof useWeekStripSwipe>['gesture']; width?: SharedValue<number>; onWidth?: (width: number) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const metrics = useContext(HeaderMetricsContext);
  const today = todayId();
  const monday = getMondayDateId(selectedDateId);
  const week = useMemo(() => buildWeekGroup(monday, 0, today), [monday, today]);
  const weeks = useMemo(() => generateWeeksWindow(selectedDateId, 1, 1, today), [selectedDateId, today]);
  const labels = useMemo(() => Array.from({ length: pageLocal ? 3 : 15 }, (_, i) => {
    const dateId = shiftDateId(selectedDateId, pageLocal ? (i - 1) * 7 : i - 7);
    return { dateId, day: dateIdToEpochDay(dateId), ...dateLabel(dateId, today) };
  }), [pageLocal, selectedDateId, today]);
  const label = dateLabel(selectedDateId, today);
  const row = <View style={styles.daysRow}>{week.days.map((item, index) => <DayPill key={item.dateId} item={item} letter={WEEK_LETTERS[index]} today={today}
    selected={item.dateId === selectedDateId} onSelectDate={onSelectDate} />)}</View>;
  const titleHeight = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { height: metrics.fullTitle - (metrics.fullTitle - metrics.compactTitle) * p };
  });
  const fullTitle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { opacity: 1 - p, transform: [{ translateY: -(metrics.fullTitle - metrics.compactTitle) * p }] };
  });
  const compactTitle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { opacity: p };
  });
  const weekHeight = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / collapseDistance : compact ? 1 : 0));
    return { height: metrics.fullWeek - (metrics.fullWeek - metrics.compactWeek) * p };
  });
  const dateCommands = {
    accessibilityRole: 'adjustable' as const,
    accessibilityLabel: `${label.title}, ${label.subtitle}`,
    accessibilityHint: 'Desliza hacia arriba o abajo para cambiar de día',
    accessibilityActions: [{ name: 'increment', label: 'Día siguiente' }, { name: 'decrement', label: 'Día anterior' },
      ...(selectedDateId !== today ? [{ name: 'activate', label: 'Volver a hoy' }] : [])],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      const action = event.nativeEvent.actionName;
      if (action === 'increment') onShiftDate(1);
      else if (action === 'decrement') onShiftDate(-1);
      else if (action === 'activate' && selectedDateId !== today) onSelectDate(today);
    },
  };
  const calendar = (small: boolean) => <TouchableOpacity accessible={small === compact} accessibilityRole="button" accessibilityLabel="Elegir fecha"
    accessibilityElementsHidden={small !== compact} importantForAccessibility={small === compact ? 'auto' : 'no-hide-descendants'}
    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    style={[styles.calendarBtn, small ? styles.calendarCompact : { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
    onPress={() => router.push('/date-picker')}><Icon name="calendar" size={small ? 18 : 20} tone="primary" /></TouchableOpacity>;
  return <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
    <Animated.View style={[{ overflow: 'hidden' }, titleHeight]}>
      <Animated.View pointerEvents={compact ? 'none' : 'box-none'} accessibilityElementsHidden={compact}
        importantForAccessibility={compact ? 'no-hide-descendants' : 'auto'} style={[styles.topHeaderRow, { height: metrics.fullTitle }, fullTitle]}>
        <View accessible={!compact} {...dateCommands} style={[styles.dateTitleBox, { height: metrics.fullTitle - 12 }]}>
          {presentation ? labels.map(item => <ProgressDateLabel key={item.dateId} {...item} presentation={presentation} />) : <DateLabel {...label} />}
        </View>
        {calendar(false)}
      </Animated.View>
      <Animated.View pointerEvents={compact ? 'box-none' : 'none'} accessibilityElementsHidden={!compact}
        importantForAccessibility={compact ? 'auto' : 'no-hide-descendants'} style={[styles.compactHeaderRow, { height: metrics.compactTitle }, compactTitle]}>
        <View accessible={compact} {...dateCommands} style={[styles.dateTitleBox, { height: metrics.compactTitle - 16 }]}>
          {presentation ? labels.map(item => <ProgressDateLabel key={item.dateId} {...item} compact presentation={presentation} />) : <CompactDateLabel title={label.title} dateId={selectedDateId} />}
        </View>
        {calendar(true)}
      </Animated.View>
    </Animated.View>
    {presentation && weekGesture && width ? <GestureDetector gesture={weekGesture}>
      <Animated.View testID="week-viewport" collapsable={false} style={[styles.weekViewport, weekHeight]} onLayout={event => onWidth?.(event.nativeEvent.layout.width)}>
        {weeks.map((item, index) => <ProgressWeek key={item.startDateId} week={item} offset={index - 1} today={today}
          monday={dateIdToEpochDay(monday)} width={width} presentation={presentation} selectedDateId={selectedDateId} onSelectDate={onSelectDate} />)}
      </Animated.View>
    </GestureDetector> : <DateSwipe days={7}><View style={{ paddingTop: compact ? 2 : 4, paddingBottom: compact ? 4 : 8 }}>{row}</View></DateSwipe>}
  </View>;
}
function CompactDateLabel({ title, dateId }: { title: string; dateId: string }) {
  const date = parseDateId(dateId);
  return <Text numberOfLines={1} style={styles.compactDate}>{title} · {date.getUTCDate()} {MONTH_NAMES[date.getUTCMonth()].slice(0, 3).toLocaleLowerCase('es')}</Text>;
}

function DateLabel({ title, subtitle }: { title: string; subtitle: string }) {
  return <>
    <Text variant="display" numberOfLines={1}>{title}</Text>
    <Text tone="secondary" numberOfLines={1} style={styles.subtitleContext}>{subtitle}</Text>
  </>;
}
function ProgressDateLabel({ day, title, subtitle, dateId, compact = false, presentation }: { day: number; title: string; subtitle: string; dateId: string; compact?: boolean; presentation: Presentation }) {
  const { position, weekOffset, weekPhase, selectedDay } = presentation;
  const animated = useAnimatedStyle(() => {
    const distance = distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay);
    return { opacity: Math.max(0, 1 - Math.abs(distance)), transform: [{ translateX: Math.max(-1, Math.min(1, distance)) * -16 }] };
  });
  return <Animated.View testID={`date-label-${compact ? 'compact' : 'expanded'}-${dateId}`} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.titleLayer, animated]}>{compact ? <CompactDateLabel title={title} dateId={dateId} /> : <DateLabel title={title} subtitle={subtitle} />}</Animated.View>;
}
function ProgressWeek({ week, offset, monday, width, presentation, selectedDateId, today, onSelectDate }: {
  week: ReturnType<typeof buildWeekGroup>; offset: number; monday: number; width: SharedValue<number>; presentation: Presentation;
  selectedDateId: string; today: string; onSelectDate: (date: string) => void;
}) {
  const collapse = useContext(CollapseContext)!;
  const { position, weekOffset, weekPhase } = presentation;
  const animated = useAnimatedStyle(() => {
    const relativeDay = position.value - monday;
    const wholeWeeks = Math.floor(relativeDay / 7);
    // Only the boundary interval reveals the adjacent week, reversibly.
    const progress = weekPhase.value ? weekOffset.value : wholeWeeks + Math.max(0, relativeDay - wholeWeeks * 7 - 6);
    return { transform: [{ translateX: (offset - progress) * width.value }] };
  });
  return <Animated.View testID={`week-layer-${offset}`} accessibilityElementsHidden={offset !== 0} importantForAccessibility={offset === 0 ? 'auto' : 'no-hide-descendants'}
    style={[styles.daysRow, styles.weekLayer, collapse.week, animated]}>
    {week.days.map((item, index) => <DayPill key={item.dateId} item={item} letter={WEEK_LETTERS[index]} today={today} selected={item.dateId === selectedDateId}
      presentation={presentation} onSelectDate={onSelectDate} />)}
  </Animated.View>;
}
/** One face of a day cell: the resting look or the selected (ink) look. */
function DayFace({ item, letter: letterName, logged, future, inverted }: { item: Day; letter: string; logged: boolean; future: boolean; inverted: boolean }) {
  const theme = useTheme();
  const c = theme.colors;
  const ink = inverted ? c.onPrimary : future ? c.textSecondary : c.text;
  const collapse = useContext(CollapseContext)!;
  return <>
    <Animated.Text style={[theme.type.label, { color: ink, overflow: 'hidden' }, collapse.letter]}>{letterName}</Animated.Text>
    <Animated.Text style={[styles.dayNumberText, { color: ink }, collapse.number]}>{item.dayNumber}</Animated.Text>
    <Animated.View style={[styles.mark, { backgroundColor: inverted ? c.onPrimary : logged ? c.text : c.barEmpty, opacity: inverted && !logged ? 0.35 : 1 }, collapse.mark]} />
  </>;
}
function DayPill({ item, letter, today, selected, presentation, onSelectDate }: { item: Day; letter: string; today: string; selected: boolean; presentation?: Presentation; onSelectDate: (date: string) => void }) {
  const theme = useTheme();
  const collapse = useContext(CollapseContext)!;
  const logged = useMealDay(item.dateId).foods.length > 0;
  const future = item.dateId > today;
  const date = parseDateId(item.dateId);
  return <DayTouch accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }}
    accessibilityLabel={`${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} de ${MONTH_NAMES[date.getUTCMonth()].toLocaleLowerCase('es')}${logged ? ', con registros' : ''}`}
    accessibilityState={{ selected }} testID={`day-${item.dateId}`} onPress={() => onSelectDate(item.dateId)} style={[styles.dayTouch, collapse.touch]}>
    {presentation ? <ProgressDayPill day={dateIdToEpochDay(item.dateId)} presentation={presentation}
      rest={<DayFace item={item} letter={letter} logged={logged} future={future} inverted={false} />}
      active={<DayFace item={item} letter={letter} logged={logged} future={future} inverted />} />
      : <View style={[styles.dayPill, { backgroundColor: selected ? theme.colors.primary : 'transparent', borderColor: selected ? theme.colors.primary : theme.colors.border }]}>
        <DayFace item={item} letter={letter} logged={logged} future={future} inverted={selected} />
      </View>}
  </DayTouch>;
}
function ProgressDayPill({ day, presentation, rest, active }: { day: number; presentation: Presentation; rest: React.ReactNode; active: React.ReactNode }) {
  const theme = useTheme();
  const { position, weekOffset, weekPhase, selectedDay } = presentation;
  const weight = useDerivedValue(() => Math.max(0, 1 - Math.abs(distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay))));
  const fill = useAnimatedStyle(() => ({ opacity: weight.value }));
  return <View style={[styles.dayPill, { borderColor: theme.colors.border }]}>
    {rest}
    <Animated.View testID={`day-active-${day}`} style={[styles.dayActive, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }, fill]}>{active}</Animated.View>
  </View>;
}

/** Natural text/control measurements are outside the animated clipping boxes. */
function HeaderMeasurement({ dateId, onMeasure }: { dateId: string; onMeasure: (key: keyof HeaderMetrics, height: number) => void }) {
  const label = dateLabel(dateId, todayId());
  const measure = (key: keyof HeaderMetrics) => (event: { nativeEvent: { layout: { height: number } } }) => onMeasure(key, event.nativeEvent.layout.height);
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', left: 20, right: 76, top: 0, opacity: 0 }}>
    <View style={{ minHeight: 64, paddingTop: 12 }} onLayout={measure('fullTitle')}><DateLabel {...label} /></View>
    <View style={{ minHeight: 36, paddingVertical: 8 }} onLayout={measure('compactTitle')}><CompactDateLabel title={label.title} dateId={dateId} /></View>
    <View style={{ paddingTop: 4, paddingBottom: 8 }} onLayout={measure('fullWeek')}>
      <View style={{ minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <Text variant="label" onLayout={measure('letter')}>L</Text>
        <Text style={styles.dayNumberText}>28</Text><View style={{ height: 4 }} />
      </View>
    </View>
    <View style={{ paddingTop: 2, paddingBottom: 4 }} onLayout={measure('compactWeek')}>
      <View style={{ minHeight: 36, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <View style={{ height: 0 }} /><Text style={[styles.dayNumberText, { fontSize: 15 }]}>28</Text><View style={{ height: 3 }} />
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: {},
  weekViewport: { height: 72, overflow: 'hidden' },
  weekLayer: { position: 'absolute', top: 0, left: 0, right: 0, height: 72, paddingTop: 4, paddingBottom: 8 },
  titleLayer: { position: 'absolute', left: 0, right: 0, top: 0 },
  topHeaderRow: { position: 'absolute', top: 0, left: 0, right: 0, height: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingHorizontal: 20 },
  compactHeaderRow: { position: 'absolute', top: 0, left: 0, right: 0, height: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, paddingHorizontal: 20 },
  compactDate: { fontFamily: font.displaySmall, fontSize: 17, lineHeight: 20, letterSpacing: -0.17 },
  calendarCompact: { width: 44, height: 28, borderWidth: 0, backgroundColor: 'transparent' },
  dateTitleBox: { flex: 1, height: 52, overflow: 'hidden', justifyContent: 'flex-start' },
  subtitleContext: { fontSize: 14, lineHeight: 18, marginTop: 2 },
  calendarBtn: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  daysRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 6 },
  dayTouch: { flex: 1, height: 60 },
  dayPill: { flex: 1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2, overflow: 'hidden' },
  dayActive: { position: 'absolute', top: -1, bottom: -1, left: -1, right: -1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  dayNumberText: { fontFamily: font.displaySmall, fontSize: 17, lineHeight: 20, fontVariant: ['tabular-nums'] },
  mark: { width: 18, height: 4, borderRadius: 2 },
});
