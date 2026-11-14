import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, AppState, Dimensions, Keyboard, PanResponder, Platform, Pressable, ScrollView, TouchableOpacity, View } from 'react-native';
import type { KeyboardEvent, KeyboardMetrics } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Input, Text } from '@/components/ui';
import { displayDateFor, todayId } from '@/hooks/use-meal-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { MONTH_NAMES, parseDateId, shiftDateId } from '@/lib/dates';
import { font, makeStyles } from '@/theme';
import { formatWeight, parseWeightInput, previousWeight } from '@/services/weight/weight';
import { isDateId } from '@/services/sync/types';
import { weightSheetBodyCap, weightSheetOverlap } from '@/lib/weight-sheet-layout';
import type { WeightSheetBounds } from '@/lib/weight-sheet-layout';

/** Route-local signals. Async adapters never retain a calculated padding. */
function useWeightSheetViewport(focused: boolean, dateId: string, top: number, bottom: number) {
  const root = useRef<View>(null);
  const signals = useRef({
    active: false, foreground: true, session: 0, ticket: 0, episode: 0,
    originReady: false, bounds: null as WeightSheetBounds | null, keyboard: null as KeyboardMetrics | null,
    preference: null as { episode: number; value: boolean } | null,
    pendingPreference: null as { session: number; ticket: number; episode: number } | null,
    intent: null as (() => void) | null, hiding: false,
    usable: null as number | null, footer: null as number | null,
  });
  const [layout, setLayout] = useState({ overlap: 0, ready: false, cap: undefined as number | undefined, usable: undefined as number | undefined });

  const snapshot = (previousOverlap: number) => {
    const s = signals.current;
    const special = Platform.OS === 'ios' && s.keyboard?.screenY === 0;
    const preference = special ? (s.preference?.episode === s.episode ? s.preference.value : null) : false;
    const result = weightSheetOverlap(s.bounds, s.keyboard, preference);
    const cap = weightSheetBodyCap(s.usable, s.footer);
    return {
      overlap: s.keyboard === null ? 0 : result.ready ? result.overlap : Math.min(previousOverlap, s.bounds?.height ?? previousOverlap),
      ready: s.active && s.foreground && s.originReady && result.ready && cap !== undefined && cap > 0,
      cap, usable: s.usable ?? undefined,
    };
  };
  const publish = () => {
    setLayout(previous => {
      const next = snapshot(previous.overlap); // Current signals, even for a queued React update.
      return previous.overlap === next.overlap && previous.ready === next.ready && previous.cap === next.cap && previous.usable === next.usable ? previous : next;
    });
    const s = signals.current;
    if (snapshot(0).ready && s.intent) { const intent = s.intent; s.intent = null; intent(); }
  };
  const ensurePreference = () => {
    const s = signals.current;
    if (!s.active || !s.foreground || !s.originReady || Platform.OS !== 'ios' || s.keyboard?.screenY !== 0
      || s.preference?.episode === s.episode) return;
    const pending = s.pendingPreference;
    if (pending?.session === s.session && pending.ticket === s.ticket && pending.episode === s.episode) return;
    const token = { session: s.session, ticket: s.ticket, episode: s.episode };
    s.pendingPreference = token;
    void AccessibilityInfo.prefersCrossFadeTransitions().then(value => {
      const now = signals.current;
      if (!now.active || !now.foreground || now.pendingPreference !== token || now.session !== token.session
        || now.ticket !== token.ticket || now.episode !== token.episode) return;
      now.preference = { episode: now.episode, value };
      now.pendingPreference = null;
      publish();
    }, () => {
      // Unknown screenY=0 stays unverified; this token prevents a retry loop.
    });
  };
  const measure = () => {
    const s = signals.current;
    if (!s.active || !s.foreground) return;
    const session = s.session, ticket = ++s.ticket;
    s.originReady = false;
    publish();
    root.current?.measureInWindow((_x, y, width, height) => {
      const now = signals.current;
      if (!now.active || !now.foreground || now.session !== session || now.ticket !== ticket
        || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      now.bounds = { y, height };
      now.originReady = true;
      publish(); // Keyboard may have hidden or changed since this request.
      ensurePreference();
    });
  };
  const invalidate = () => {
    const s = signals.current;
    s.active = false; s.session++; s.ticket++;
    s.intent = null; s.pendingPreference = null; s.originReady = false;
  };

  useEffect(() => {
    if (!focused) return;
    const s = signals.current;
    s.active = true; s.foreground = AppState.currentState === 'active'; s.session++;
    s.keyboard = null; s.preference = null; s.hiding = false; s.intent = null;
    const session = s.session;
    const currentSession = () => s.active && s.session === session;
    const frame = (event: KeyboardEvent) => {
      if (!currentSession() || !s.foreground) return;
      s.episode++; s.keyboard = { ...event.endCoordinates }; s.preference = null;
      publish(); measure();
    };
    const hide = () => {
      if (!currentSession()) return;
      s.episode++; s.keyboard = null; s.preference = null; s.pendingPreference = null;
      publish(); measure();
    };
    const subscriptions: { remove(): void }[] = Platform.OS === 'ios' ? [
      Keyboard.addListener('keyboardWillChangeFrame', event => { if (currentSession()) { s.hiding = false; frame(event); } }),
      Keyboard.addListener('keyboardWillHide', () => { if (currentSession()) { s.hiding = true; hide(); } }),
      Keyboard.addListener('keyboardDidShow', event => { if (currentSession() && !s.hiding) frame(event); }),
      Keyboard.addListener('keyboardDidHide', () => { if (currentSession()) { s.hiding = false; hide(); } }),
    ] : [Keyboard.addListener('keyboardDidShow', frame), Keyboard.addListener('keyboardDidHide', hide)];
    const episode = s.episode;
    const metrics = Keyboard.metrics();
    if (s.episode === episode) s.keyboard = metrics ? { ...metrics } : null;
    subscriptions.push(Dimensions.addEventListener('change', () => { if (currentSession()) measure(); }));
    subscriptions.push(AppState.addEventListener('change', state => {
      if (!currentSession()) return;
      s.foreground = state === 'active';
      if (s.foreground) {
        const episode = ++s.episode;
        const metrics = Keyboard.metrics();
        if (s.episode === episode) s.keyboard = metrics ? { ...metrics } : null;
        s.preference = null; measure();
      }
      else { s.ticket++; s.originReady = false; s.intent = null; publish(); }
    }));
    measure();
    return () => { invalidate(); subscriptions.forEach(subscription => subscription.remove()); };
  }, [focused, dateId]);
  useEffect(() => { measure(); }, [top, bottom]);

  return { root, layout, measure, invalidate,
    onUsable: (height: number) => { if (signals.current.active && signals.current.usable !== height) { signals.current.usable = height; publish(); } },
    onFooter: (height: number) => { if (signals.current.active && signals.current.footer !== height) { signals.current.footer = height; publish(); } },
    openEditor: (intent: () => void) => { if (signals.current.active) { signals.current.intent = intent; measure(); } },
  };
}

export default function WeightEntryScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { dateId: dateParam } = useLocalSearchParams<{ dateId?: string }>();
  const dateId = isDateId(dateParam) ? dateParam : todayId();
  const { weightsByDate, saveWeight, deleteWeight } = useWeightStore();
  const { weightTrackingEnabled } = usePreferencesStore();
  const current = weightsByDate[dateId];
  const previous = previousWeight(weightsByDate, dateId);
  const seed = current?.weightGrams ?? previous?.weightGrams ?? 70000;
  const [stored, setStored] = useState({ dateId, value: formatWeight(seed), dirty: false, editing: false, error: null as string | null });
  const entry = stored.dateId === dateId ? stored : { dateId, value: formatWeight(seed), dirty: false, editing: false, error: null };
  const { value, editing, error } = entry;
  const isFuture = dateId > todayId();
  const editable = weightTrackingEnabled && !isFuture;
  const title = current ? 'Editar peso' : 'Registrar peso';
  const subtitle = useMemo(() => displayDateFor(dateId).replace(', ', ' · '), [dateId]);
  const viewport = useWeightSheetViewport(focused, dateId, insets.top, insets.bottom);
  const authority = useRef({ dateId, focused, saveWeight, deleteWeight, generation: 0, active: focused, terminal: false });
  const owner = authority.current;
  if (owner.dateId !== dateId || owner.focused !== focused || owner.saveWeight !== saveWeight || owner.deleteWeight !== deleteWeight) {
    owner.generation++; owner.active = focused; owner.terminal = false;
    owner.dateId = dateId; owner.focused = focused; owner.saveWeight = saveWeight; owner.deleteWeight = deleteWeight;
  }
  const generation = owner.generation;
  const scroll = useRef<ScrollView>(null);
  const editorY = useRef(0);
  const revealEditor = () => {
    if (!focused) return;
    if (error) scroll.current?.scrollToEnd({ animated: false });
    else if (editing) scroll.current?.scrollTo({ y: editorY.current, animated: false });
  };
  useEffect(revealEditor, [focused, editing, error, viewport.layout.cap]);
  const live = useRef({ value, dateId, seed, current, weightTrackingEnabled, saveWeight, deleteWeight, router });
  live.current = { value, dateId, seed, current, weightTrackingEnabled, saveWeight, deleteWeight, router };
  const canUse = (expected: number) => authority.current.active && !authority.current.terminal
    && authority.current.generation === expected && AppState.currentState === 'active';
  const canEdit = (expected: number) => canUse(expected) && live.current.weightTrackingEnabled && live.current.dateId <= todayId();
  const update = (patch: Partial<typeof stored>) => {
    if (canUse(generation)) setStored(previous => ({ ...(previous.dateId === dateId ? previous : entry), ...patch, dateId }));
  };
  useEffect(() => { setStored(previous => previous.dateId !== dateId
    ? { dateId, value: formatWeight(seed), dirty: false, editing: false, error: null }
    : !previous.dirty && previous.value !== formatWeight(seed) ? { ...previous, value: formatWeight(seed) } : previous); }, [dateId, seed]);
  useEffect(() => { authority.current.active = focused; return () => { authority.current.active = false; }; }, []);
  const draft = parseWeightInput(value);
  const draftRef = useRef(draft ?? seed); draftRef.current = draft ?? seed;
  const bounded = useCallback((grams: number) => {
    const now = live.current, token = authority.current.generation;
    if (!canEdit(token)) return;
    const next = Math.max(1000, Math.min(500000, Math.round(grams / 100) * 100));
    setStored(previous => ({ ...(previous.dateId === now.dateId ? previous : { dateId: now.dateId, editing: false }), value: formatWeight(next), dirty: true, error: null, dateId: now.dateId }));
  }, []);
  const drag = useRef<{ x: number; grams: number; generation: number } | null>(null);
  const ruler = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => canEdit(authority.current.generation),
    onMoveShouldSetPanResponder: () => canEdit(authority.current.generation),
    onPanResponderGrant: event => { if (canEdit(authority.current.generation)) drag.current = { x: event.nativeEvent.pageX, grams: draftRef.current, generation: authority.current.generation }; },
    onPanResponderMove: event => {
      if (drag.current && canEdit(drag.current.generation)) bounded(drag.current.grams + Math.round((drag.current.x - event.nativeEvent.pageX) / 10) * 100);
    },
    onPanResponderRelease: () => { drag.current = null; },
    onPanResponderTerminate: () => { drag.current = null; },
  }), [bounded]);
  const delta = draft !== null && previous ? draft - previous.weightGrams : null;
  const priorDate = previous ? parseDateId(previous.id) : null;
  const priorLabel = previous?.id === shiftDateId(todayId(), -1) ? 'ayer' : priorDate
    ? `${priorDate.getUTCDate()} ${MONTH_NAMES[priorDate.getUTCMonth()].slice(0, 3).toLocaleLowerCase('es')}` : '';
  const deltaText = delta === null ? 'Primer registro' : delta === 0
    ? `Igual que ${priorLabel} (${formatWeight(previous!.weightGrams)} kg)`
    : `${delta > 0 ? '+' : '−'}${formatWeight(Math.abs(delta))} kg vs. ${priorLabel} (${formatWeight(previous!.weightGrams)} kg)`;
  const centerKg = Math.round((draft ?? seed) / 1000);
  const trackOffset = (centerKg * 1000 - (draft ?? seed)) / 10;
  const integers = Array.from({ length: 7 }, (_, i) => centerKg - 3 + i).filter(kg => kg >= 1 && kg <= 500);

  const commitInput = () => {
    if (!canEdit(generation)) return;
    const grams = parseWeightInput(live.current.value);
    if (grams === null) { update({ error: 'Ingresa un valor entre 1,0 y 500,0 kg usando un decimal.' }); return; }
    update({ value: formatWeight(grams), editing: false, error: null });
  };
  const leave = () => {
    if (!canUse(generation)) return;
    owner.terminal = true; owner.active = false; owner.generation++;
    viewport.invalidate(); Keyboard.dismiss(); live.current.router.back();
  };
  const save = () => {
    if (!canEdit(generation)) return;
    const now = live.current, grams = parseWeightInput(now.value);
    if (grams === null) { update({ error: 'Ingresa un valor entre 1,0 y 500,0 kg usando un decimal.' }); return; }
    owner.terminal = true;
    if (!now.saveWeight(now.dateId, grams)) {
      owner.terminal = false;
      update({ error: now.weightTrackingEnabled ? 'No se puede registrar peso para esta fecha.' : 'El seguimiento de peso está desactivado en Configuración.' });
      return;
    }
    owner.active = false; owner.generation++; viewport.invalidate(); Keyboard.dismiss(); now.router.back();
  };
  const confirmDelete = () => {
    if (!canEdit(generation) || !live.current.current) return;
    const record = live.current.current;
    Alert.alert('Eliminar peso', `Se quitará el registro de ${subtitle.toLowerCase()}.`, [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Eliminar', style: 'destructive', onPress: () => {
        if (!canEdit(generation) || live.current.current !== record) return;
        owner.terminal = true;
        live.current.deleteWeight(live.current.dateId);
        owner.active = false; owner.generation++; viewport.invalidate(); Keyboard.dismiss(); live.current.router.back();
      } },
    ]);
  };

  return <View ref={viewport.root} collapsable={false} testID="weight-sheet-root" style={styles.root} onLayout={() => viewport.measure()}>
    <Pressable testID="weight-sheet-backdrop" accessible={false} style={styles.backdrop} onPress={leave} />
    <View testID="weight-sheet-avoidance" pointerEvents="box-none" style={[styles.root, { paddingBottom: viewport.layout.overlap }]}>
      <View pointerEvents="box-none" style={[styles.root, { paddingTop: insets.top }]}>
        <View testID="weight-sheet-viewport" pointerEvents="box-none" style={styles.viewport} onLayout={event => viewport.onUsable(event.nativeEvent.layout.height)}>
          <View testID="weight-sheet-surface" accessibilityViewIsModal style={[styles.sheet, { maxHeight: viewport.layout.usable ?? '100%' }]}>
            <ScrollView ref={scroll} testID="weight-sheet-body" onContentSizeChange={revealEditor} style={[styles.scroll, viewport.layout.cap !== undefined && { maxHeight: viewport.layout.cap }]}
              keyboardShouldPersistTaps="handled" nestedScrollEnabled contentInsetAdjustmentBehavior="never" automaticallyAdjustKeyboardInsets={false} contentContainerStyle={styles.body}>
              <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              <View style={styles.header}>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.title}>{title}</Text><Text variant="caption" tone="secondary">{subtitle}</Text></View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancelar" style={styles.close} onPress={leave}><Icon name="x" size={18} tone="primary" /></TouchableOpacity>
              </View>
              <View style={styles.hero} onLayout={event => { editorY.current = event.nativeEvent.layout.y; revealEditor(); }}>
                {editing ? <View style={styles.readout}>
                  <Input accessibilityLabel="Peso en kilogramos" editable={editable && focused} autoFocus keyboardType="decimal-pad" maxLength={5}
                    selectTextOnFocus value={value} variant="number" style={styles.decimal} onBlur={commitInput} onSubmitEditing={commitInput}
                    onChangeText={next => { if (canEdit(generation)) update({ value: next, dirty: true, error: null }); }} />
                  <Text style={styles.unit} tone="secondary">kg</Text>
                </View> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Peso ${value} kg, tocar para escribir`} disabled={!editable || !viewport.layout.ready}
                  style={[styles.readout, !editable && { opacity: 0.7 }]} onPress={() => { if (canEdit(generation)) viewport.openEditor(() => { if (canEdit(generation)) update({ editing: true }); }); }}>
                  <Text style={styles.figure}>{value}</Text><Text style={styles.unit} tone="secondary">kg</Text>
                </TouchableOpacity>}
                <View style={styles.delta}><Text variant="caption" tone="secondary" numberOfLines={1} accessibilityLiveRegion="polite">{deltaText}</Text></View>
              </View>
              <View {...ruler.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Peso, precisión de 0,1 kg"
                accessibilityValue={{ min: 1, max: 500, now: (draft ?? seed) / 1000, text: `${value} kg` }}
                accessibilityActions={[{ name: 'increment', label: 'Subir 0,1 kg' }, { name: 'decrement', label: 'Bajar 0,1 kg' }]}
                onAccessibilityAction={event => { if (canEdit(generation)) bounded(draftRef.current + (event.nativeEvent.actionName === 'increment' ? 100 : event.nativeEvent.actionName === 'decrement' ? -100 : 0)); }}
                style={[styles.ruler, !editable && { opacity: 0.45 }]}>
                <View testID="weight-ruler-track" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.track, { transform: [{ translateX: trackOffset }] }]}>
                  {integers.map(kg => <View key={kg} style={{ position: 'absolute', left: (kg - centerKg) * 100, top: 0, width: 100, height: 72 }}>
                    {Array.from({ length: 10 }, (_, tenth) => tenth + kg * 10 <= 5000 ? <View key={tenth} style={[styles.tick, { left: tenth * 10 }, tenth === 0 ? styles.major : tenth === 5 ? styles.half : null]} /> : null)}
                    <Text variant="label" tone="secondary" style={styles.rulerLabel}>{kg}</Text>
                  </View>)}
                </View>
                <View testID="weight-ruler-needle" pointerEvents="none" style={styles.needle} />
              </View>
              <View style={styles.actions}>{[-1000, -100, 100, 1000].map(step => <Button key={step} title={`${step > 0 ? '+' : '−'}${formatWeight(Math.abs(step))}`}
                variant="secondary" size="md" disabled={!editable} style={styles.step} onPress={() => { if (canEdit(generation)) bounded(draftRef.current + step); }} />)}</View>
              {error ? <Text variant="caption" tone="danger" selectable accessibilityRole="alert">{error}</Text> : null}
              {isFuture ? <Text variant="caption" tone="danger">Las fechas futuras no admiten registros.</Text> : null}
            </ScrollView>
            <View testID="weight-sheet-footer" onLayout={event => viewport.onFooter(event.nativeEvent.layout.height)} style={[styles.footer, { paddingBottom: Math.max(22, insets.bottom) }]}>
              {current ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Eliminar" style={styles.delete} disabled={!editable} onPress={confirmDelete}><Text style={styles.deleteLabel}>Eliminar</Text></TouchableOpacity> : null}
              <Button title="Guardar peso" disabled={!editable} style={styles.grow} onPress={save} />
            </View>
          </View>
        </View>
      </View>
    </View>
  </View>;
}

const useStyles = makeStyles(t => ({
  root: { flex: 1 },
  viewport: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.colors.scrim },
  sheet: { flexShrink: 1, backgroundColor: t.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  scroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 999, backgroundColor: t.colors.lineStrong, marginBottom: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: font.titleSheet, fontSize: 19, lineHeight: 24 },
  close: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' },
  body: { paddingTop: 10, paddingHorizontal: 20, gap: 14, paddingBottom: 4 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 4 },
  readout: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 4, paddingHorizontal: 12, borderBottomWidth: 1.5, borderStyle: 'dashed', borderColor: t.colors.lineStrong },
  figure: { fontFamily: font.semibold, fontSize: 48, lineHeight: 51, letterSpacing: -1.44, fontVariant: ['tabular-nums'] },
  decimal: { width: 152, minHeight: 0, borderWidth: 0, borderRadius: 0, padding: 0, backgroundColor: 'transparent', fontFamily: font.semibold, fontSize: 48, lineHeight: 51, letterSpacing: -1.44 },
  unit: { fontFamily: font.semibold, fontSize: 20, lineHeight: 24 },
  delta: { paddingVertical: 5, paddingHorizontal: 12, maxWidth: '100%', borderRadius: 999, backgroundColor: t.colors.track },
  ruler: { height: 72, borderRadius: 18, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.background, overflow: 'hidden' },
  track: { position: 'absolute', left: '50%', top: 0, bottom: 0 },
  tick: { position: 'absolute', top: 0, width: 1, height: 12, backgroundColor: t.colors.lineStrong },
  half: { width: 1.5, height: 20, backgroundColor: t.colors.bar },
  major: { width: 2, height: 28, backgroundColor: t.colors.primary },
  rulerLabel: { position: 'absolute', left: -40, top: 36, width: 80, textAlign: 'center', fontFamily: font.semibold },
  needle: { position: 'absolute', left: '50%', top: 0, width: 2.5, height: 34, borderRadius: 2, backgroundColor: t.colors.primary, transform: [{ translateX: -1.25 }] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { flex: 1, backgroundColor: t.colors.background },
  footer: { flexShrink: 0, flexDirection: 'row', gap: 10, paddingTop: 12, paddingHorizontal: 20 },
  delete: { minHeight: 52, borderWidth: 1, borderColor: t.colors.lineStrong, borderRadius: 16, paddingHorizontal: 18, justifyContent: 'center' },
  deleteLabel: { fontFamily: font.semibold, fontSize: 15, color: t.colors.macroFat },
  grow: { flex: 1 },
}));
