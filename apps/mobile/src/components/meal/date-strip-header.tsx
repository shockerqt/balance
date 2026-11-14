import React, { useMemo, createContext, useContext } from 'react';
import { StyleSheet, View, TouchableOpacity, type TextStyle, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { font, useTheme } from '@/theme';
import { useMealDay } from '@/hooks/use-meal-store';
import { Icon, Text } from '@/components/ui';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue, type AnimatedStyle } from 'react-native-reanimated';
import { DateSwipe } from './date-swipe';
import { useWeekStripSwipe } from './use-week-strip-swipe';
import { DAY_NAMES, MONTH_NAMES, dateIdToEpochDay, buildWeekGroup, generateWeeksWindow, getMondayDateId, parseDateId, shiftDateId, todayId } from '@/lib/dates';

interface DateStripHeaderProps {
  compact?: boolean;
  collapseScroll?: SharedValue<number>;
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
type CollapsePresentation = {
  letter: AnimatedStyle<TextStyle>;
  number: AnimatedStyle<TextStyle>;
  mark: AnimatedStyle<ViewStyle>;
  pillMiddle: AnimatedStyle<ViewStyle>;
  pillBottom: AnimatedStyle<ViewStyle>;
  touch: AnimatedStyle<ViewStyle>;
  weekRow: AnimatedStyle<ViewStyle>;
};
const CollapseContext = createContext<CollapsePresentation | null>(null);
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
function collapseProgress(collapseScroll: SharedValue<number> | undefined, compact: boolean) {
  'worklet';
  return Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / 216 : compact ? 1 : 0));
}
function collapseMetrics(p: number) {
  'worklet';
  const H = 60 - 24 * p;
  const L = 16 * (1 - p);
  const M = 4 - p;
  const stackTop = (H - (L + 20 + M + 4)) / 2;
  return { H, L, M, stackTop };
}
export function DateStripHeader(props: DateStripHeaderProps) {
  const { collapseScroll, compact = false } = props;
  // All day faces, pill surfaces and touch overlays share these UI-thread styles so collapse animates via transform/opacity without repeated face layout.
  const letter = useAnimatedStyle(() => {
    const p = collapseProgress(collapseScroll, compact);
    const { L, stackTop } = collapseMetrics(p);
    return { opacity: Math.max(0, 1 - p / 0.45), transform: [{ translateY: stackTop + L / 2 - 16 }] };
  });
  const number = useAnimatedStyle(() => {
    const p = collapseProgress(collapseScroll, compact);
    const { L, stackTop } = collapseMetrics(p);
    return { transform: [{ translateY: stackTop + L + 12 - 36 }, { scale: (17 - 2 * p) / 17 }] };
  });
  const mark = useAnimatedStyle(() => {
    const p = collapseProgress(collapseScroll, compact);
    const { L, M, stackTop } = collapseMetrics(p);
    return { transform: [{ translateY: stackTop + L + 24 + M / 2 - 50 }, { scaleY: M / 4 }] };
  });
  const pillMiddle = useAnimatedStyle(() => {
    const p = collapseProgress(collapseScroll, compact);
    const H = 60 - 24 * p;
    // Compensate centered scaleY origin (y=30) so the middle segment stays anchored at y=14..H-14.
    return { transform: [{ translateY: (H - 60) / 2 }, { scaleY: (H - 28) / 32 }] };
  });
  const pillBottom = useAnimatedStyle(() => {
    const H = 60 - 24 * collapseProgress(collapseScroll, compact);
    return { transform: [{ translateY: H - 60 }] };
  });
  const touch = useAnimatedStyle(() => {
    const H = 60 - 24 * collapseProgress(collapseScroll, compact);
    // Compensate centered scaleY origin (y=30) so the touch overlay tracks y=0..H without squashing sibling visuals.
    return { transform: [{ translateY: (H - 60) / 2 }, { scaleY: H / 60 }] };
  });
  const weekRow = useAnimatedStyle(() => ({
    transform: [{ translateY: -2 * collapseProgress(collapseScroll, compact) }],
  }));
  const collapse = useMemo(
    () => ({ letter, number, mark, pillMiddle, pillBottom, touch, weekRow }),
    [letter, number, mark, pillMiddle, pillBottom, touch, weekRow],
  );
  return <CompactContext value={compact}><CollapseContext value={collapse}>{props.pagerPosition ? <ProgressDateStripHeader {...props} pagerPosition={props.pagerPosition} /> : <HeaderContent {...props} />}</CollapseContext></CompactContext>;
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
function HeaderContent({ compact = false, collapseScroll, selectedDateId, onSelectDate, onShiftDate, presentation, weekGesture, width, onWidth }: DateStripHeaderProps & {
  presentation?: Presentation; weekGesture?: ReturnType<typeof useWeekStripSwipe>['gesture']; width?: SharedValue<number>; onWidth?: (width: number) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const collapse = useContext(CollapseContext)!;
  const today = todayId();
  const monday = getMondayDateId(selectedDateId);
  const week = useMemo(() => buildWeekGroup(monday, 0, today), [monday, today]);
  const weeks = useMemo(() => generateWeeksWindow(selectedDateId, 1, 1, today), [selectedDateId, today]);
  const labels = useMemo(() => Array.from({ length: 15 }, (_, i) => {
    const dateId = shiftDateId(selectedDateId, i - 7);
    return { dateId, day: dateIdToEpochDay(dateId), ...dateLabel(dateId, today) };
  }), [selectedDateId, today]);
  const label = dateLabel(selectedDateId, today);
  const row = <View style={styles.weekLayer}><Animated.View style={[styles.daysRow, collapse.weekRow]}>{week.days.map((item, index) => <DayPill key={item.dateId} item={item} letter={WEEK_LETTERS[index]} today={today}
    selected={item.dateId === selectedDateId} onSelectDate={onSelectDate} />)}</Animated.View></View>;
  const titleHeight = useAnimatedStyle(() => ({ height: 64 - 28 * collapseProgress(collapseScroll, compact) }));
  const fullTitle = useAnimatedStyle(() => {
    const p = collapseProgress(collapseScroll, compact);
    return { opacity: Math.max(0, 1 - p / 0.42), transform: [{ translateY: -28 * p }] };
  });
  const compactTitle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (collapseProgress(collapseScroll, compact) - 0.58) / 0.42)),
  }));
  const weekHeight = useAnimatedStyle(() => ({ height: 72 - 30 * collapseProgress(collapseScroll, compact) }));
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
        importantForAccessibility={compact ? 'no-hide-descendants' : 'auto'} style={[styles.topHeaderRow, fullTitle]}>
        <View accessible={!compact} {...dateCommands} style={styles.dateTitleBox}>
          {presentation ? labels.map(item => <ProgressDateLabel key={item.dateId} {...item} presentation={presentation} />) : <DateLabel {...label} />}
        </View>
        {calendar(false)}
      </Animated.View>
      <Animated.View pointerEvents={compact ? 'box-none' : 'none'} accessibilityElementsHidden={!compact}
        importantForAccessibility={compact ? 'auto' : 'no-hide-descendants'} style={[styles.compactHeaderRow, compactTitle]}>
        <View accessible={compact} {...dateCommands} style={[styles.dateTitleBox, { height: 20 }]}>
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
    </GestureDetector> : <DateSwipe days={7}><Animated.View testID="week-viewport" style={[styles.weekViewport, weekHeight]}>{row}</Animated.View></DateSwipe>}
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
    style={[styles.weekLayer, animated]}>
    <Animated.View testID={`week-row-${offset}`} style={[styles.daysRow, collapse.weekRow]}>
      {week.days.map((item, index) => <DayPill key={item.dateId} item={item} letter={WEEK_LETTERS[index]} today={today} selected={item.dateId === selectedDateId}
        presentation={presentation} onSelectDate={onSelectDate} />)}
    </Animated.View>
  </Animated.View>;
}
/** Fixed-radius top/bottom caps + scaled straight middle keep 14dp corners circular and 1dp borders unscaled. */
function PillSurface({ backgroundColor, borderColor, collapse }: { backgroundColor: string; borderColor: string; collapse: CollapsePresentation }) {
  return <>
    <View testID="pill-cap-top" style={[styles.pillCapTop, { backgroundColor, borderColor }]} />
    <Animated.View testID="pill-middle" style={[styles.pillMiddle, { backgroundColor, borderColor }, collapse.pillMiddle]} />
    <Animated.View testID="pill-cap-bottom" style={[styles.pillCapBottom, { backgroundColor, borderColor }, collapse.pillBottom]} />
  </>;
}
/** One face of a day cell: the resting look or the selected (ink) look. */
function DayFace({ item, letter: letterName, logged, future, inverted }: { item: Day; letter: string; logged: boolean; future: boolean; inverted: boolean }) {
  const theme = useTheme();
  const c = theme.colors;
  const ink = inverted ? c.onPrimary : future ? c.textSecondary : c.text;
  const collapse = useContext(CollapseContext)!;
  return <View style={styles.dayFace}>
    <Animated.Text style={[theme.type.label, styles.dayLetterSlot, { color: ink }, collapse.letter]}>{letterName}</Animated.Text>
    <Animated.Text style={[styles.dayNumberText, styles.dayNumberSlot, { color: ink }, collapse.number]}>{item.dayNumber}</Animated.Text>
    <Animated.View style={[styles.mark, styles.dayMarkSlot, { backgroundColor: inverted ? c.onPrimary : logged ? c.text : c.barEmpty, opacity: inverted && !logged ? 0.35 : 1 }, collapse.mark]} />
  </View>;
}
function DayPill({ item, letter, today, selected, presentation, onSelectDate }: { item: Day; letter: string; today: string; selected: boolean; presentation?: Presentation; onSelectDate: (date: string) => void }) {
  const theme = useTheme();
  const collapse = useContext(CollapseContext)!;
  const logged = useMealDay(item.dateId).foods.length > 0;
  const future = item.dateId > today;
  const date = parseDateId(item.dateId);
  // The touch target is separate from the paint, so mirror its pressed feedback
  // on the visual sibling without re-rendering or scaling its contents.
  const pressedOpacity = useSharedValue(1);
  const pressed = useAnimatedStyle(() => ({ opacity: pressedOpacity.value }));
  return <View testID={`day-cell-${item.dateId}`} style={styles.dayCell}>
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.dayLayer, pressed]}>
      {presentation ? <ProgressDayPill day={dateIdToEpochDay(item.dateId)} presentation={presentation}
        rest={<DayFace item={item} letter={letter} logged={logged} future={future} inverted={false} />}
        active={<DayFace item={item} letter={letter} logged={logged} future={future} inverted />} />
        : <>
          <PillSurface backgroundColor={selected ? theme.colors.primary : 'transparent'} borderColor={selected ? theme.colors.primary : theme.colors.border} collapse={collapse} />
          <DayFace item={item} letter={letter} logged={logged} future={future} inverted={selected} />
        </>}
    </Animated.View>
    <DayTouch accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }}
      accessibilityLabel={`${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} de ${MONTH_NAMES[date.getUTCMonth()].toLocaleLowerCase('es')}${logged ? ', con registros' : ''}`}
      accessibilityState={{ selected }} testID={`day-${item.dateId}`} onPress={() => onSelectDate(item.dateId)}
      onPressIn={() => { pressedOpacity.value = withTiming(0.2, { duration: 150 }); }}
      onPressOut={() => { pressedOpacity.value = withTiming(1, { duration: 250 }); }} style={[styles.dayLayer, collapse.touch]} />
  </View>;
}
function ProgressDayPill({ day, presentation, rest, active }: { day: number; presentation: Presentation; rest: React.ReactNode; active: React.ReactNode }) {
  const theme = useTheme();
  const collapse = useContext(CollapseContext)!;
  const { position, weekOffset, weekPhase, selectedDay } = presentation;
  const weight = useDerivedValue(() => Math.max(0, 1 - Math.abs(distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay))));
  const fill = useAnimatedStyle(() => ({ opacity: weight.value }));
  return <>
    <PillSurface backgroundColor="transparent" borderColor={theme.colors.border} collapse={collapse} />
    {rest}
    <Animated.View testID={`day-active-${day}`} style={[styles.dayLayer, fill]}>
      <PillSurface backgroundColor={theme.colors.primary} borderColor={theme.colors.primary} collapse={collapse} />
      {active}
    </Animated.View>
  </>;
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
  dayCell: { flex: 1, height: 60 },
  dayLayer: { position: 'absolute', top: 0, left: 0, right: 0, height: 60 },
  dayFace: { position: 'absolute', top: 0, left: 0, right: 0, height: 60, alignItems: 'center' },
  dayLetterSlot: { position: 'absolute', top: 8, left: 0, right: 0, height: 16, textAlign: 'center' },
  dayNumberText: { fontFamily: font.displaySmall, fontSize: 17, lineHeight: 20, fontVariant: ['tabular-nums'] },
  dayNumberSlot: { position: 'absolute', top: 26, left: 0, right: 0, height: 20, textAlign: 'center' },
  dayMarkSlot: { position: 'absolute', top: 48 },
  mark: { width: 18, height: 4, borderRadius: 2 },
  pillCapTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 14, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 0 },
  pillMiddle: { position: 'absolute', top: 14, left: 0, right: 0, height: 32, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 0, borderBottomWidth: 0 },
  pillCapBottom: { position: 'absolute', top: 46, left: 0, right: 0, height: 14, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 0 },
});
