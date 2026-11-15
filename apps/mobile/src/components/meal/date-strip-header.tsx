import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, createContext, useContext } from 'react';
import { StyleSheet, View, TouchableOpacity, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { font, useTheme } from '@/theme';
import { useMealDay } from '@/hooks/use-meal-store';
import { Icon, Text } from '@/components/ui';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, type DerivedValue, type SharedValue, type AnimatedStyle } from 'react-native-reanimated';
import { DateSwipe } from './date-swipe';
import { useWeekStripSwipe } from './use-week-strip-swipe';
import { DAY_NAMES, MONTH_NAMES, dateIdToEpochDay, epochDayToDateId, buildWeekGroup, generateWeeksWindow, getMondayDateId, parseDateId, shiftDateId, todayId } from '@/lib/dates';

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
type Presentation = { position: SharedValue<number>; weekOffset: SharedValue<number>; weekPhase: SharedValue<number>; selectedDay: SharedValue<number> };

type CollapsePresentation = {
  week: AnimatedStyle<ViewStyle>;
};
type CollapseState = {
  visible: CollapsePresentation;
  deferred: CollapsePresentation;
};
const CollapseContext = createContext<CollapseState | null>(null);
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
function collapseProgress(collapseScroll: SharedValue<number> | undefined, compactFallback: number) {
  'worklet';
  return Math.min(1, Math.max(0, collapseScroll ? collapseScroll.value / 216 : compactFallback));
}
function useCollapsePresentation(progress: DerivedValue<number>): CollapsePresentation {
  const week = useAnimatedStyle(() => {
    const p = progress.value;
    return { height: 72 - 30 * p, paddingTop: 4 - 2 * p, paddingBottom: 8 - 4 * p };
  });
  return useMemo(() => ({ week }), [week]);
}
export function DateStripHeader(props: DateStripHeaderProps) {
  const { collapseScroll, compact = false } = props;
  // When collapseScroll is provided, keep compactFallback constant (0) so toggling `compact` at 108dp never restarts the pVisible UI mapper.
  const compactFallback = collapseScroll ? 0 : compact ? 1 : 0;
  const pVisible = useDerivedValue(() => collapseProgress(collapseScroll, compactFallback));
  const collapseVisible = useCollapsePresentation(pVisible);
  const staticCollapse = useMemo(() => ({ visible: collapseVisible, deferred: collapseVisible }), [collapseVisible]);
  if (props.pagerPosition) {
    return <ProgressDateStripHeader {...props} pagerPosition={props.pagerPosition} pVisible={pVisible} collapseVisible={collapseVisible} />;
  }
  return <CollapseContext value={staticCollapse}><HeaderContent {...props} pVisible={pVisible} /></CollapseContext>;
}
function ProgressDateStripHeader(props: DateStripHeaderProps & {
  pagerPosition: SharedValue<number>;
  pVisible: DerivedValue<number>;
  collapseVisible: CollapsePresentation;
}) {
  const { pagerPosition, pVisible, collapseVisible, selectedDateId, active = true } = props;
  const width = useSharedValue(1);
  const { gesture, offset, phase, setWidth } = useWeekStripSwipe({ dateId: props.selectedDateId, active: props.active ?? true,
    width, interaction: props.pagerInteraction, onSelectDate: props.onSelectDate });
  const interaction = props.pagerInteraction;
  // A content swipe takes visual precedence if another touch starts the pager.
  const weekPhase = useDerivedValue(() => (interaction?.value ?? 0) === 0 ? phase.value : 0);
  const selectedDayEpoch = dateIdToEpochDay(props.selectedDateId);
  const selectedDay = useSharedValue(selectedDayEpoch);
  selectedDay.value = selectedDayEpoch;
  // The canonical date advances only at accepted idle; chained native swipes
  // can travel much farther. Recenter bounded visual windows with headroom.
  const [window, setWindow] = useState({ dateId: selectedDateId, day: selectedDayEpoch });
  if (window.dateId !== selectedDateId) setWindow({ dateId: selectedDateId, day: selectedDayEpoch });
  const visualDay = window.dateId === selectedDateId ? window.day : selectedDayEpoch;
  const windowDay = useSharedValue(visualDay);
  const live = useRef({ dateId: selectedDateId, active: active, mounted: true });
  useLayoutEffect(() => {
    live.current = { dateId: selectedDateId, active: active, mounted: true };
    windowDay.value = visualDay;
    return () => { live.current.mounted = false; };
  }, [selectedDateId, active, visualDay, windowDay]);
  const moveWindow = useCallback((expectedDate: string) => {
    if (!live.current.mounted || !live.current.active || live.current.dateId !== expectedDate) return;
    // Read the latest position, never a potentially stale queued target.
    const day = Math.floor(pagerPosition.value);
    setWindow(previous => previous.dateId === expectedDate && previous.day === day ? previous : { dateId: expectedDate, day });
  }, [pagerPosition]);
  useAnimatedReaction(() => pagerPosition.value, position => {
    if (!active || weekPhase.value !== 0 || Math.abs(position - windowDay.value) < 4) return;
    windowDay.value = Math.floor(position);
    runOnJS(moveWindow)(selectedDateId);
  });
  const visualDateId = epochDayToDateId(visualDay);
  const lastSyncedP = useSharedValue(props.compact ? 1 : 0);
  // Gate offscreen weeks and occluded faces during pure vertical collapse; sync immediately on horizontal activity or endpoints.
  const pDeferred = useDerivedValue(() => {
    const p = pVisible.value;
    const isHorizontalActive =
      weekPhase.value !== 0 ||
      Math.abs(offset.value) > 1e-4 ||
      Math.abs(pagerPosition.value - selectedDay.value) > 1e-4 ||
      (interaction ? interaction.value !== 0 : false);
    if (isHorizontalActive || p === 0 || p === 1) {
      if (lastSyncedP.value !== p) lastSyncedP.value = p;
      return p;
    }
    return lastSyncedP.value;
  });
  const collapseDeferred = useCollapsePresentation(pDeferred);
  const collapse = useMemo(() => ({ visible: collapseVisible, deferred: collapseDeferred }), [collapseVisible, collapseDeferred]);
  const presentation = useMemo(
    () => ({ position: pagerPosition, weekOffset: offset, weekPhase, selectedDay }),
    [pagerPosition, offset, weekPhase, selectedDay],
  );
  return <CollapseContext value={collapse}>
    <HeaderContent {...props} visualDateId={visualDateId} presentation={presentation} weekGesture={gesture} width={width} onWidth={setWidth} />
  </CollapseContext>;
}
function HeaderContent({ compact = false, pVisible, selectedDateId, onSelectDate, onShiftDate, visualDateId = selectedDateId, presentation, weekGesture, width, onWidth }: DateStripHeaderProps & {
  pVisible: DerivedValue<number>; visualDateId?: string; presentation?: Presentation; weekGesture?: ReturnType<typeof useWeekStripSwipe>['gesture']; width?: SharedValue<number>; onWidth?: (width: number) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const today = todayId();
  const isToday = selectedDateId === today;
  const label = dateLabel(selectedDateId, today);
  const handlePressToday = useCallback(() => {
    if (selectedDateId !== today) onSelectDate(today);
  }, [onSelectDate, selectedDateId, today]);
  const titleHeight = useAnimatedStyle(() => ({ height: 64 - 28 * pVisible.value }));
  const fullTitle = useAnimatedStyle(() => {
    const p = pVisible.value;
    return { opacity: Math.max(0, 1 - p / 0.42), transform: [{ translateY: -28 * p }] };
  });
  const compactTitle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (pVisible.value - 0.58) / 0.42)),
  }));
  const weekHeight = useAnimatedStyle(() => ({ height: 72 - 30 * pVisible.value }));
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
  const monday = getMondayDateId(visualDateId);
  return <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
    <Animated.View style={[{ overflow: 'hidden' }, titleHeight]}>
      <Animated.View pointerEvents={compact ? 'none' : 'box-none'} accessibilityElementsHidden={compact}
        importantForAccessibility={compact ? 'no-hide-descendants' : 'auto'} style={[styles.topHeaderRow, fullTitle]}>
        <TouchableOpacity testID="date-title-expanded" accessible={!compact} {...dateCommands}
          disabled={isToday} activeOpacity={0.7} onPress={handlePressToday} style={styles.dateTitleBox}>
          {presentation ? <TitleLayerList selectedDateId={visualDateId} today={today} compact={false} presentation={presentation} /> : <DateLabel {...label} />}
        </TouchableOpacity>
        {calendar(false)}
      </Animated.View>
      <Animated.View pointerEvents={compact ? 'box-none' : 'none'} accessibilityElementsHidden={!compact}
        importantForAccessibility={compact ? 'auto' : 'no-hide-descendants'} style={[styles.compactHeaderRow, compactTitle]}>
        <TouchableOpacity testID="date-title-compact" accessible={compact} {...dateCommands}
          disabled={isToday} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8 }} onPress={handlePressToday} style={[styles.dateTitleBox, { height: 20 }]}>
          {presentation ? <TitleLayerList selectedDateId={visualDateId} today={today} compact presentation={presentation} /> : <CompactDateLabel title={label.title} dateId={selectedDateId} />}
        </TouchableOpacity>
        {calendar(true)}
      </Animated.View>
    </Animated.View>
    <WeekStripSection
      monday={monday}
      selectedDateId={selectedDateId}
      today={today}
      weekHeight={weekHeight}
      presentation={presentation}
      weekGesture={weekGesture}
      width={width}
      onWidth={onWidth}
      onSelectDate={onSelectDate}
    />
  </View>;
}

const TitleLayerList = React.memo(function TitleLayerList({
  selectedDateId,
  today,
  compact,
  presentation,
}: {
  selectedDateId: string;
  today: string;
  compact: boolean;
  presentation: Presentation;
}) {
  const labels = useMemo(() => Array.from({ length: 15 }, (_, i) => {
    const dateId = shiftDateId(selectedDateId, i - 7);
    return { dateId, day: dateIdToEpochDay(dateId), ...dateLabel(dateId, today) };
  }), [selectedDateId, today]);
  return <>{labels.map(item => <ProgressDateLabel key={item.dateId} {...item} compact={compact} presentation={presentation} />)}</>;
});

const WeekStripSection = React.memo(function WeekStripSection({
  monday,
  selectedDateId,
  today,
  weekHeight,
  presentation,
  weekGesture,
  width,
  onWidth,
  onSelectDate,
}: {
  monday: string;
  selectedDateId: string;
  today: string;
  weekHeight: AnimatedStyle<ViewStyle>;
  presentation?: Presentation;
  weekGesture?: ReturnType<typeof useWeekStripSwipe>['gesture'];
  width?: SharedValue<number>;
  onWidth?: (width: number) => void;
  onSelectDate: (dateId: string) => void;
}) {
  const collapse = useContext(CollapseContext)!;
  const week = useMemo(() => buildWeekGroup(monday, 0, today), [monday, today]);
  const weeks = useMemo(() => generateWeeksWindow(monday, 1, 1, today), [monday, today]);
  if (presentation && weekGesture && width) {
    return (
      <GestureDetector gesture={weekGesture}>
        <Animated.View testID="week-viewport" collapsable={false} style={[styles.weekViewport, weekHeight]} onLayout={event => onWidth?.(event.nativeEvent.layout.width)}>
          {weeks.map((item, index) => <ProgressWeek key={item.startDateId} week={item} offset={index - 1} today={today}
            monday={dateIdToEpochDay(monday)} width={width} presentation={presentation} selectedDateId={selectedDateId} onSelectDate={onSelectDate} />)}
        </Animated.View>
      </GestureDetector>
    );
  }
  return (
    <DateSwipe days={7}>
      <Animated.View testID="week-viewport" style={[styles.weekViewport, weekHeight]}>
        <Animated.View style={[styles.daysRow, collapse.visible.week]}>
          {week.days.map((item, index) => <DayPill key={item.dateId} item={item} letter={WEEK_LETTERS[index]} today={today}
            selected={item.dateId === selectedDateId} onSelectDate={onSelectDate} />)}
        </Animated.View>
      </Animated.View>
    </DateSwipe>
  );
});

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
    const distance = distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay.value);
    return { opacity: Math.max(0, 1 - Math.abs(distance)), transform: [{ translateX: Math.max(-1, Math.min(1, distance)) * -16 }] };
  });
  return <Animated.View testID={`date-label-${compact ? 'compact' : 'expanded'}-${dateId}`} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.titleLayer, animated]}>{compact ? <CompactDateLabel title={title} dateId={dateId} /> : <DateLabel title={title} subtitle={subtitle} />}</Animated.View>;
}
function ProgressWeek({ week, offset, monday, width, presentation, selectedDateId, today, onSelectDate }: {
  week: ReturnType<typeof buildWeekGroup>; offset: number; monday: number; width: SharedValue<number>; presentation: Presentation;
  selectedDateId: string; today: string; onSelectDate: (date: string) => void;
}) {
  const { visible, deferred } = useContext(CollapseContext)!;
  const weekCollapse = offset === 0 ? visible : deferred;
  const { position, weekOffset, weekPhase } = presentation;
  const animated = useAnimatedStyle(() => {
    const relativeDay = position.value - monday;
    const wholeWeeks = Math.floor(relativeDay / 7);
    // Only the boundary interval reveals the adjacent week, reversibly.
    const progress = weekPhase.value ? weekOffset.value : wholeWeeks + Math.max(0, relativeDay - wholeWeeks * 7 - 6);
    return { transform: [{ translateX: (offset - progress) * width.value }] };
  });
  return <Animated.View testID={`week-layer-${offset}`} accessibilityElementsHidden={offset !== 0} importantForAccessibility={offset === 0 ? 'auto' : 'no-hide-descendants'}
    style={[styles.daysRow, styles.weekLayer, weekCollapse.week, animated]}>
    {week.days.map((item, index) => <DayPill key={item.dateId} item={item} letter={WEEK_LETTERS[index]} today={today} selected={item.dateId === selectedDateId}
      presentation={presentation} onSelectDate={onSelectDate} />)}
  </Animated.View>;
}
/** One face of a day cell: the resting look or the selected (ink) look. */
function DayFace({ item, letter: letterName, logged, future, inverted }: {
  item: Day; letter: string; logged: boolean; future: boolean; inverted: boolean;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const ink = inverted ? c.onPrimary : future ? c.textSecondary : c.text;
  return <>
    <Text style={[theme.type.label, styles.dayLetterText, { color: ink }]}>{letterName}</Text>
    <Text style={[styles.dayNumberText, { color: ink }]}>{item.dayNumber}</Text>
    <View style={[styles.mark, { backgroundColor: inverted ? c.onPrimary : logged ? c.text : c.barEmpty, opacity: inverted && !logged ? 0.35 : 1 }]} />
  </>;
}
function DayPill({ item, letter, today, selected, presentation, onSelectDate }: {
  item: Day; letter: string; today: string; selected: boolean; presentation?: Presentation; onSelectDate: (date: string) => void;
}) {
  const theme = useTheme();
  const logged = useMealDay(item.dateId).foods.length > 0;
  const future = item.dateId > today;
  const date = parseDateId(item.dateId);
  return <TouchableOpacity accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }}
    accessibilityLabel={`${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} de ${MONTH_NAMES[date.getUTCMonth()].toLocaleLowerCase('es')}${logged ? ', con registros' : ''}`}
    accessibilityState={{ selected }} testID={`day-${item.dateId}`} onPress={() => onSelectDate(item.dateId)} style={styles.dayTouch}>
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
  const weight = useDerivedValue(() => Math.max(0, 1 - Math.abs(distanceFromDay(day, position.value, weekOffset.value, weekPhase.value, selectedDay.value))));
  const fill = useAnimatedStyle(() => ({ opacity: weight.value }));
  return <View style={[styles.dayPill, { borderColor: theme.colors.border }]}>
    {rest}
    <Animated.View testID={`day-active-${day}`} style={[styles.dayActive, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }, fill]}>{active}</Animated.View>
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
  dayTouch: { flex: 1 },
  dayPill: { flex: 1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 5, gap: 3, overflow: 'hidden' },
  dayActive: { position: 'absolute', top: -1, bottom: -1, left: -1, right: -1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 5, gap: 3, overflow: 'hidden' },
  dayLetterText: { height: 16, lineHeight: 16, textAlign: 'center' },
  dayNumberText: { fontFamily: font.displaySmall, fontSize: 17, lineHeight: 20, fontVariant: ['tabular-nums'], textAlign: 'center' },
  mark: { width: 18, height: 4, borderRadius: 2 },
});
