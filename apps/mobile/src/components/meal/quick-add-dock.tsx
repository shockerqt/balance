import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Icon, Text } from '@/components/ui';
import { font, useTheme } from '@/theme';
import { HOURS, hh, radialSelection, transitionPlusGesture, type PlusGestureState } from '@/lib/quick-add-gesture';

type Props = { children: React.ReactNode; contextKey: string; weightAvailable: boolean; onFood: (time?: string) => void; onWeight: () => void };
type Mode = 'none' | 'menu' | 'hour';
/** A single responder owns the original + from initial contact through release. */
export function QuickAddDock({ children, contextKey, weightAvailable, onFood, onWeight }: Props) {
  const theme = useTheme();
  const size = Math.min(288, useWindowDimensions().width - 32);
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
  const choose = (action: 'weight' | 'food' | number) => finish(action, generation.current);
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
    }} style={{ width: 60, height: 52, marginHorizontal: 6, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary }}>
    <View pointerEvents="none" style={{ transform: [{ translateX: visual?.puck.x ?? 0 }, { translateY: visual?.puck.y ?? 0 }] }}>
      <Icon name={mode === 'none' ? 'plus' : 'x'} size={24} tone="onPrimary" />
    </View>
  </View>;
  const action = (title: string, onPress: () => void, disabled = false) => <TouchableOpacity key={title} accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
    style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}><Text style={{ fontFamily: font.semibold }}>{title}</Text></TouchableOpacity>;
  return <>
    <View pointerEvents="none" style={{ height: 75 }} />
    <View accessibilityViewIsModal={mode !== 'none'} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 100, ...(mode === 'none' ? { height: 75 } : { top: 0 }) }}>
    {mode !== 'none' ? <TouchableOpacity accessible={false} onPress={cancel} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} /> : null}
    <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 75, backgroundColor: theme.colors.surface, borderTopWidth: theme.border.hairline, borderTopColor: theme.colors.border }} />
    {mode === 'menu' ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Elegir hora" onPress={openHours}
      style={{ position: 'absolute', alignSelf: 'center', bottom: 78, minHeight: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: theme.colors.surfaceRaised, justifyContent: 'center' }}><Text>Elegir hora</Text></TouchableOpacity> : null}
    {mode === 'hour' ? <View ref={dial} onLayout={() => dial.current?.measureInWindow((left, top, width, height) => { bounds.current = { left, top, width, height }; })}
      accessibilityLabel="Elegir hora" style={{ position: 'absolute', bottom: 84, width: size, height: size, alignSelf: 'center', borderRadius: size / 2, backgroundColor: theme.colors.surfaceRaised }}>
      {HOURS.map((hour, index) => {
        const radians = (126 + index * 16) * Math.PI / 180;
        const x = size / 2 + 112 * size / 288 * Math.cos(radians), y = size / 2 + 112 * size / 288 * Math.sin(radians);
        const selected = visual?.hour === hour;
        return <TouchableOpacity key={hour} accessibilityRole="button" accessibilityLabel={`Registrar a las ${hh(hour)}`} accessibilityState={{ selected }} onPress={() => choose(hour)}
          style={{ position: 'absolute', left: x - 18, top: y - 18, width: 36, height: 36, borderRadius: 18, backgroundColor: selected ? theme.colors.primary : theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Text tone={selected ? 'onPrimary' : 'secondary'} style={{ fontSize: 12 }}>{hour}</Text>
        </TouchableOpacity>;
      })}
      {visual?.phase === 'radial' && bounds.current ? <View pointerEvents="none" accessibilityElementsHidden
        style={{ position: 'absolute', left: (visual.x + visual.dx - bounds.current.left) * size / bounds.current.width - 5,
          top: (visual.y + visual.dy - 24 - bounds.current.top) * size / bounds.current.height - 5,
          width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface }} /> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancelar elección de hora" onPress={cancel}
        style={{ position: 'absolute', left: size / 2 - 55, top: size / 2 - 26, width: 110, height: 52, justifyContent: 'center', alignItems: 'center' }}>
        <Text variant="heading">{visual?.hour === null || visual?.hour === undefined ? '05–23' : hh(visual.hour)}</Text>
      </TouchableOpacity>
    </View> : null}
    <View style={{ position: 'absolute', bottom: 14, left: 10, right: 10, height: 52, flexDirection: 'row', alignItems: 'center' }}>
      {mode === 'none' ? <>{nav.slice(0, 2)}{plus}{nav.slice(2)}</> : <>{action('Peso', () => choose('weight'), !weightAvailable)}{plus}{action('Ahora', () => choose('food'))}</>}
    </View>
  </View>
  </>;
}
