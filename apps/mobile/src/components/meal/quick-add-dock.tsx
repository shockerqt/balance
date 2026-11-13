import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Icon, Text } from '@/components/ui';
import { tickHourChange } from '@/lib/hour-haptics';
import { font, useTheme } from '@/theme';
import { HOURS, hh, radialSelection, transitionPlusGesture, type PlusGestureState } from '@/lib/quick-add-gesture';

/** Clipped fills overlap by1px to avoid rotated antialias seams; only the true perimeter is stroked. */
const Horseshoe = React.memo(function Horseshoe({ size }: { size: number }) {
  const { colors } = useTheme();
  const k = size / 288;
  const circle = (left: number, top: number, diameter: number, stroke: number, color: string, fill = 'transparent') =>
    <View style={{ position: 'absolute', left: left * k, top: top * k, width: diameter * k, height: diameter * k,
      borderRadius: diameter * k / 2, borderWidth: stroke * k, borderColor: color, backgroundColor: fill }} />;
  const half = (angle: number, outline: boolean) => <View key={`arc-${angle}-${outline}`} style={{ position: 'absolute', width: size, height: size, transform: [{ rotate: `${angle}deg` }] }}>
    <View style={{ position: 'absolute', width: size, height: size / 2 + (outline ? 0 : 1), overflow: 'hidden' }}>
      {outline ? <>{circle(1, 1, 286, 1, colors.lineStrong)}{circle(66, 66, 156, 1, colors.lineStrong)}</> : circle(1, 1, 286, 65, colors.surface)}
    </View>
  </View>;
  const cap = (angle: number, reverse: boolean, outline: boolean) => {
    const rad = angle * Math.PI / 180;
    return <View key={`cap-${angle}-${outline}`} style={{ position: 'absolute', left: (144 + 110.5 * Math.cos(rad) - 32.5) * k,
      top: (144 + 110.5 * Math.sin(rad) - 32.5) * k, width: 65 * k, height: 65 * k,
      transform: [{ rotate: `${angle + (reverse ? 180 : 0)}deg` }] }}>
      <View style={{ position: 'relative', width: 65 * k, height: 32.5 * k + (outline ? 0 : 1), overflow: 'hidden' }}>
        {circle(0, 0, 65, outline ? 1 : 0, colors.lineStrong, outline ? 'transparent' : colors.surface)}
      </View>
    </View>;
  };
  return <View testID="hour-horseshoe" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', width: size, height: size }}>
    {half(-54, false)}{half(54, false)}{cap(126, false, false)}{cap(54, true, false)}
    {half(-54, true)}{half(54, true)}{cap(126, false, true)}{cap(54, true, true)}
  </View>;
});

type Props = { children: React.ReactNode; contextKey: string; weightAvailable: boolean; onFood: (time?: string) => void; onWeight: () => void };
type Mode = 'none' | 'menu' | 'hour';
/** A single responder owns the original + from initial contact through release. */
export function QuickAddDock({ children, contextKey, weightAvailable, onFood, onWeight }: Props) {
  const theme = useTheme();
  const size = Math.min(288, useWindowDimensions().width - 16);
  const [mode, setMode] = useState<Mode>('none');
  const [visual, setVisual] = useState<PlusGestureState | null>(null);
  const gesture = useRef<PlusGestureState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dial = useRef<View>(null);
  const bounds = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const generation = useRef(0), focused = useRef(false), modeRef = useRef<Mode>('none');
  const live = useRef({ contextKey, weightAvailable, onFood, onWeight });
  useLayoutEffect(() => { live.current = { contextKey, weightAvailable, onFood, onWeight }; });
  const changeMode = useCallback((next: Mode) => { modeRef.current = next; setMode(next); }, []);
  const clearTimer = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const cancel = useCallback(() => {
    generation.current++; clearTimer(); gesture.current = null; bounds.current = null; setVisual(null); changeMode('none');
  }, [clearTimer, changeMode]);
  useLayoutEffect(() => { cancel(); }, [contextKey, weightAvailable, size, cancel]);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; cancel(); }; }, [cancel]));
  useEffect(() => () => { clearTimer(); generation.current++; }, [clearTimer]);
  const finish = useCallback((outcome: PlusGestureState['outcome'], expected: number) => {
    if (!focused.current || generation.current !== expected) return;
    if (outcome === 'tap') { gesture.current = null; setVisual(null); changeMode(modeRef.current === 'none' ? 'menu' : 'none'); return; }
    cancel();
    if (outcome === 'weight' && live.current.weightAvailable) live.current.onWeight();
    else if (outcome === 'food') live.current.onFood();
    else if (typeof outcome === 'number') live.current.onFood(hh(outcome));
  }, [cancel, changeMode]);
  const renderedGeneration = generation.current;
  const choose = (action: 'weight' | 'food' | number, expected = generation.current) => {
    if (!focused.current || generation.current !== expected) return;
    if (typeof action === 'number') tickHourChange(null, action);
    finish(action, expected);
  };
  const openHours = () => { if (focused.current) { clearTimer(); gesture.current = null; setVisual(null); changeMode('hour'); } };
  const responder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      if (!focused.current || event.nativeEvent.touches.length > 1) return cancel();
      const { identifier, pageX, pageY } = event.nativeEvent;
      gesture.current = transitionPlusGesture(null, { type: 'start', id: identifier, x: pageX, y: pageY, time: Date.now() });
      const expected = generation.current;
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!focused.current || generation.current !== expected || !gesture.current) return;
        const next = transitionPlusGesture(gesture.current, { type: 'hold', time: Math.max(Date.now(), gesture.current.startedAt + 350) });
        gesture.current = next; setVisual(next);
        if (next.phase === 'radial') changeMode('hour');
      }, 350);
    },
    onPanResponderMove: event => {
      const current = gesture.current;
      if (!current) return;
      const touch = event.nativeEvent.touches.find(t => t.identifier === current.id);
      if (!touch || event.nativeEvent.touches.length !== 1) return cancel();
      const hour = current.phase === 'radial' && bounds.current ? radialSelection(touch.pageX, touch.pageY, bounds.current, current.hour) : undefined;
      const next = transitionPlusGesture(current, { type: 'move', x: touch.pageX, y: touch.pageY, time: Date.now(), hour });
      if (next.maxDistance > 10) clearTimer();
      tickHourChange(current.hour, next.hour);
      gesture.current = next; setVisual(next);
      if (next.phase === 'cancelled') return cancel();
      if (next.phase === 'radial') changeMode('hour');
      else if (next.phase === 'dragging') changeMode('menu');
    },
    onPanResponderRelease: event => {
      clearTimer();
      const current = gesture.current;
      if (!current || event.nativeEvent.identifier !== current.id) return cancel();
      const { pageX, pageY } = event.nativeEvent;
      const hour = current.phase === 'radial' ? bounds.current ? radialSelection(pageX, pageY, bounds.current, current.hour) : null : undefined;
      const next = transitionPlusGesture(current, { type: 'release', x: pageX, y: pageY, time: Date.now(), hour });
      tickHourChange(current.hour, next.hour);
      finish(next.outcome, generation.current);
    },
    onPanResponderTerminationRequest: () => true,
    onPanResponderTerminate: cancel,
    onShouldBlockNativeResponder: () => true,
  }), [cancel, changeMode, clearTimer, finish]);
  const nav = React.Children.toArray(children);
  const plus = <View key="plus" {...responder.panHandlers} accessible accessibilityRole="button"
    accessibilityLabel={mode === 'none' ? 'Registrar alimento o peso' : 'Cerrar registro'}
    onAccessibilityTap={() => { if (focused.current) changeMode(modeRef.current === 'none' ? 'menu' : 'none'); }}
    accessibilityActions={[{ name: 'activate', label: 'Abrir menú' }, { name: 'chooseHour', label: 'Elegir hora' }, { name: 'now', label: 'Registrar ahora' }, ...(weightAvailable ? [{ name: 'weight', label: 'Registrar peso' }] : [])]}
    onAccessibilityAction={event => {
      const action = event.nativeEvent.actionName;
      if (action === 'chooseHour') openHours();
      else if (action === 'now') choose('food');
      else if (action === 'weight') choose('weight');
      else if (action === 'activate' && focused.current) changeMode(modeRef.current === 'none' ? 'menu' : 'none');
    }} style={{ width: 60, height: 52, marginHorizontal: 6, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === 'none' ? theme.colors.primary : theme.colors.track }}>
    <View pointerEvents="none" style={{ width: 52, height: 44, borderRadius: 14, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: visual?.puck.x ?? 0 }, { translateY: visual?.puck.y ?? 0 }] }}>
      <Icon name={mode === 'none' ? 'plus' : 'x'} size={24} tone="onPrimary" />
    </View>
  </View>;
  const action = (title: string, onPress: () => void, disabled = false) => <TouchableOpacity key={title} accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
    style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}><Text style={{ fontFamily: font.semibold, fontSize: 14 }}>{title}</Text></TouchableOpacity>;
  return <>
    <View pointerEvents="none" style={{ height: 75 }} />
    <View accessibilityViewIsModal={mode !== 'none'} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 100, ...(mode === 'none' ? { height: 75 } : { top: 0 }) }}>
    {mode !== 'none' ? <TouchableOpacity accessible={false} onPress={cancel} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: `${theme.colors.text}3D` }} /> : null}
    <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 75, backgroundColor: theme.colors.surface, borderTopWidth: theme.border.hairline, borderTopColor: theme.colors.border }} />
    {mode === 'menu' ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Elegir hora" onPress={openHours}
      style={{ position: 'absolute', alignSelf: 'center', bottom: 93, width: 148, height: 48, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.lineStrong, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: font.semibold, fontSize: 14 }}>Elegir hora</Text></TouchableOpacity> : null}
    {mode === 'hour' ? <View ref={dial} onLayout={() => dial.current?.measureInWindow((left, top, width, height) => { bounds.current = { left, top, width, height }; })}
      accessibilityLabel="Elegir hora" style={{ position: 'absolute', bottom: 41 + 152 - size / 2, width: size, height: size, alignSelf: 'center' }}>
      <Horseshoe size={size} />
      {visual?.hour !== null && visual?.hour !== undefined ? (() => {
        const angle = (126 + (visual.hour - 5) * 16) * Math.PI / 180, k = size / 288;
        return <View pointerEvents="none" style={{ position: 'absolute', left: (144 + 87 * Math.cos(angle) - 9) * k, top: (144 + 87 * Math.sin(angle)) * k - 1, width: 18 * k, height: 2, borderRadius: 1, backgroundColor: theme.colors.primary, transform: [{ rotate: `${angle}rad` }] }} />;
      })() : null}
      {HOURS.map((hour, index) => {
        const radians = (126 + index * 16) * Math.PI / 180;
        const x = size / 2 + 112 * size / 288 * Math.cos(radians), y = size / 2 + 112 * size / 288 * Math.sin(radians);
        const selected = visual?.hour === hour;
        return <TouchableOpacity key={hour} accessibilityRole="button" accessibilityLabel={`Registrar a las ${hh(hour)}`} accessibilityState={{ selected }} onPress={() => choose(hour, renderedGeneration)}
          style={{ position: 'absolute', left: x - 18, top: y - 18, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? theme.colors.primary : 'transparent' }}>
            <Text tone={selected ? 'onPrimary' : [6, 12, 18, 23].includes(hour) ? 'primary' : 'secondary'} style={{ fontSize: 12, fontFamily: selected || [6, 12, 18, 23].includes(hour) ? font.semibold : font.medium }}>{String(hour).padStart(2, '0')}</Text>
          </View>
        </TouchableOpacity>;
      })}
      {visual?.phase === 'radial' && bounds.current ? <View pointerEvents="none" accessibilityElementsHidden
        style={{ position: 'absolute', left: (visual.x + visual.dx - bounds.current.left) * size / bounds.current.width - 5,
          top: (visual.y + visual.dy - 24 - bounds.current.top) * size / bounds.current.height - 5,
          width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface }} /> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancelar elección de hora" onPress={cancel}
        style={{ position: 'absolute', left: size / 2 - 66 * size / 288, top: size / 2 - 66 * size / 288, width: 132 * size / 288, height: 132 * size / 288, borderRadius: 66 * size / 288, borderWidth: 1, borderColor: theme.colors.lineStrong, backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center', gap: 3 }}>
        <Text style={{ fontFamily: font.title, fontSize: 30, lineHeight: 32, letterSpacing: -0.6 }}>{visual?.hour === null || visual?.hour === undefined ? '05–23' : hh(visual.hour)}</Text>
        {visual?.hour !== null && visual?.hour !== undefined ? <Text variant="label" tone="secondary">{visual.hour < 12 ? 'Mañana' : visual.hour < 20 ? 'Tarde' : 'Noche'}</Text> : null}
        {visual?.phase !== 'radial' ? <Text variant="label" tone="accent">Cancelar</Text> : null}
      </TouchableOpacity>
    </View> : null}
    <View style={{ position: 'absolute', bottom: 15, left: 10, right: 10, height: 52, flexDirection: 'row', alignItems: 'center' }}>
      {mode === 'none' ? <>{nav.slice(0, 2)}{plus}{nav.slice(2)}</> : <>{action('Peso', () => choose('weight', renderedGeneration), !weightAvailable)}{plus}{action('Ahora', () => choose('food', renderedGeneration))}</>}
    </View>
  </View>
  </>;
}
