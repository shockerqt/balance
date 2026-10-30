import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { BalanceDailyLogView } from '../../../../modules/balance-daily-log';
import { Screen } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { logsDateStore, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { useTheme } from '@/theme';
import { currentTimeString, todayId } from '@/lib/dates';
import { acceptDailyEvent } from './daily-log-contract';
import { acceptInterfaceEvent, createInterfaceDaysProjector, interfaceColors, projectInterfaceDays, weightGrams } from './interface-contract';
import { prepareSelectionCopy, selectionCopyPlanIsCurrent, type SelectionCopyPlan } from './copy-selection-contract';

// Remains disabled in released routes until the compatible API/native delivery
// gates are satisfied. Tests can exercise the actual host with this explicit prop.
export default function NativeDailyLogScreen({ copyEnabled = false }: { copyEnabled?: boolean } = {}) {
  const { user, isGuest } = useAuth();
  // Account changes replace the native tree and invalidate all queued events.
  return <DailyLogSession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} copyEnabled={copyEnabled} />;
}
let sessionCounter = 0;
const freshSession = () => `daily-${Date.now()}-${++sessionCounter}`;
function DailyLogSession({ copyEnabled }: { copyEnabled: boolean }) {
  const { user, isGuest } = useAuth();
  const router = useRouter();
  const meals = useMealStore();
  const latestMeals = useRef(meals);
  latestMeals.current = meals;
  const weight = useWeightStore();
  const preferences = usePreferencesStore();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [selected] = useLogsSelectedDate();
  const [session, setSession] = useState(freshSession);
  const [mounted, setMounted] = useState(false);
  const [today, setToday] = useState(todayId);
  const [copyStatus, setCopyStatus] = useState<Record<string, unknown>>({});
  const copyOperation = useRef<{ plan: SelectionCopyPlan; session: string; revision: number; saving: boolean; saved: boolean } | null>(null);
  const live = useRef({ alive: true, focused: false, sequence: 0, nativeDate: '', session, applyingNative: false, commandRevision: logsDateStore.getRevision() });
  useFocusEffect(useCallback(() => {
    live.current.focused = true;
    live.current.session = freshSession();
    live.current.sequence = 0;
    live.current.nativeDate = '';
    copyOperation.current = null;
    setCopyStatus({});
    setSession(live.current.session);
    setFocused(true);
    return () => { live.current.focused = false; copyOperation.current = null; setFocused(false); };
  }, []));
  useEffect(() => {
    live.current.alive = true;
    setMounted(true);
    const unsubscribe = logsDateStore.subscribe(() => {
      if (!live.current.applyingNative) {
        live.current.commandRevision = logsDateStore.getRevision();
        live.current.nativeDate = '';
      }
    });
    const updateToday = () => setToday(todayId());
    const subscription = AppState.addEventListener('change', updateToday);
    const timer = setInterval(updateToday, 60_000);
    return () => { live.current.alive = false; unsubscribe(); subscription.remove(); clearInterval(timer); };
  }, []);
  const projectLiveDays = useMemo(createInterfaceDaysProjector, []);
  const retainedData = useRef('');
  const data = useMemo(() => {
    // A retained, blurred host must not rebuild/parse the full native payload
    // behind the editor. Focus refreshes once from the latest complete stores.
    if (!focused && retainedData.current) return retainedData.current;
    const serialized = JSON.stringify({
    session, today, colors: interfaceColors,
    profile: { name: user?.name ?? (isGuest ? 'Invitado' : 'Cuenta'), guest: isGuest },
    preferencesError: preferences.syncError,
    showWeight: preferences.preferencesReady && preferences.weightTrackingEnabled,
    weightError: weight.syncError,
    preferencesReady: preferences.preferencesReady,
    days: mounted && focused ? projectLiveDays(meals.dayLogs, weight.weightsByDate, meals.mealDocuments) : {},
    empty: projectInterfaceDays({ [today]: emptyDayLog(today) }, {}, [])[today],
    });
    retainedData.current = serialized;
    return serialized;
  }, [session, today, user?.name, isGuest, preferences.syncError, preferences.preferencesReady, preferences.weightTrackingEnabled, weight.syncError, weight.weightsByDate, meals.dayLogs, meals.mealDocuments, mounted, focused, projectLiveDays]);
  const dateCommand = JSON.stringify({ date: selected, fromNative: live.current.nativeDate === selected, revision: live.current.commandRevision, session });
  return <Screen edges={['top', 'bottom']} style={{ backgroundColor: interfaceColors.background }}><BalanceDailyLogView style={{ flex: 1 }} data={data} dateCommand={dateCommand} active={focused && mounted} copyEnabled={copyEnabled} copyStatus={JSON.stringify(copyStatus)}
    onAction={async ({ nativeEvent: e }) => {
      if (!live.current.alive || !live.current.focused || !mounted) return;
      if (e.action === 'copy' && !copyEnabled) return;
      const common = [live.current.session, live.current.sequence] as const;
      const legacy = acceptDailyEvent(e, ...common, logsDateStore.get(), meals.dayLogs, live.current.commandRevision);
      if (!legacy && !acceptInterfaceEvent(e, ...common, live.current.commandRevision, todayId(), meals.mealDocuments)) return;
      live.current.sequence = e.sequence;
      if (e.action === 'copy') {
        const operationId = e.input!.operationId!;
        const input = { operationId, sourceDate: e.date, ids: e.ids!, revisions: e.input!.revisions!,
          destinationDate: e.input!.destinationDate!, time: e.time! };
        let operation = copyOperation.current;
        const result = (state: string, error = '') => setCopyStatus({ operationId, session: e.session, state, error });
        try {
          if (operation?.plan.input.operationId === operationId) {
            if (operation.session !== e.session || operation.revision !== e.commandRevision ||
                operation.plan.input.sourceDate !== input.sourceDate || operation.plan.input.destinationDate !== input.destinationDate ||
                operation.plan.input.time !== input.time || operation.plan.input.ids.length !== input.ids.length ||
                operation.plan.input.ids.some((id, i) => id !== input.ids[i] || operation!.plan.input.revisions[id] !== input.revisions[id]))
              throw new Error('Vuelve a abrir Copiar para elegir otro destino.');
            if (operation.saving) return;
            if (operation.saved) { result('success'); return; }
            if (!selectionCopyPlanIsCurrent(operation.plan, latestMeals.current.mealDocuments))
              throw new Error('Los registros cambiaron. Vuelve a seleccionarlos antes de copiar.');
          } else {
            if (operation?.saving) return;
            operation = { plan: prepareSelectionCopy(input, latestMeals.current.mealDocuments, randomUUID),
              session: e.session, revision: e.commandRevision, saving: false, saved: false };
            copyOperation.current = operation;
          }
        } catch (error) {
          result('error', error instanceof Error ? error.message : 'Vuelve a seleccionar los registros que quieres copiar.');
          return;
        }
        const activeOperation = operation;
        const stillCurrent = () => copyOperation.current === activeOperation && live.current.alive && live.current.focused &&
          live.current.session === e.session && live.current.commandRevision === e.commandRevision && logsDateStore.get() === e.date;
        activeOperation.saving = true;
        result('saving');
        try {
          await latestMeals.current.registerMealLogs(activeOperation.plan.documents);
          activeOperation.saved = true;
          if (stillCurrent()) result('success');
        } catch {
          if (stillCurrent()) result('error', 'No se pudo guardar en el teléfono. Conservamos el destino para que puedas reintentar.');
        } finally { activeOperation.saving = false; }
      }
      else if (e.action === 'date') {
        live.current.nativeDate = e.date;
        live.current.applyingNative = true;
        try { logsDateStore.set(e.date); } finally { live.current.applyingNative = false; }
      } else if (e.action === 'add' || e.action === 'register') {
        // A calendar selection may be ahead of the hidden pager. Commit that
        // explicit navigation before blur, including when the draft is cancelled.
        if (e.action === 'register') logsDateStore.set(e.date);
        router.push({ pathname: '/food-search', params: { dateId: e.date, time: e.time ?? currentTimeString() } });
      }
      else if (e.action === 'edit') router.push({ pathname: '/food-edit', params: { dateId: e.date, foodId: e.ids![0] } });
      else if (e.action === 'weight' && preferences.weightTrackingEnabled && e.date <= todayId()) router.push({ pathname: '/weight-entry', params: { dateId: e.date } });
      else if (e.action === 'delete') meals.deleteMultipleFoods(e.date, e.ids!);
      else if (e.action === 'move') meals.moveMultipleFoodsTime(e.date, e.ids!, e.time!);
      else if (e.action === 'weight-save' && preferences.preferencesReady && preferences.weightTrackingEnabled) weight.saveWeight(e.date, weightGrams(e.input?.quantity)!);
      else if (e.action === 'weight-delete' && preferences.preferencesReady && preferences.weightTrackingEnabled) weight.deleteWeight(e.date);
      else if (e.action === 'preference' && preferences.preferencesReady) preferences.setWeightTrackingEnabled(e.input!.enabled!);
      else if (e.action === 'edit-save') {
        const doc = meals.mealDocuments.find(d => d.id === e.ids![0] && !d._deleted)!;
        const unit = e.input!.mode === 'portion' ? ` ${doc.entry.portionSnapshot!.name}` : doc.nutritionSnapshot.canonicalUnit;
        meals.updateFood(e.date, doc.id, { portion: `${e.input!.quantity!.replace(',', '.')}${unit}`, time: e.time });
      }
      else if (e.action === 'library') router.push('/(tabs)/library');
      else if (e.action === 'settings') router.push('/settings');
      else if (e.action === 'import') router.push('/macro-factor-import');
    }} /></Screen>;
}
