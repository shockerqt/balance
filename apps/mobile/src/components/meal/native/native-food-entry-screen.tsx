import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { randomUUID } from 'expo-crypto';
import { BalanceFoodEntryView } from '../../../../modules/balance-daily-log/src/BalanceFoodEntryView';
import { Screen } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useMealStore } from '@/hooks/use-meal-store';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { useTheme } from '@/theme';
import { chileDateParts, todayId } from '@/lib/dates';
import { isDateId } from '@/services/sync/types';
import { logsDateStore } from '@/hooks/use-logs-date';
import { acceptFoodEntryEvent, createFoodEntry, nutrientFields } from './food-entry-contract';
import { interfaceColors } from './interface-contract';

export default function NativeFoodEntryScreen() {
  const { user, isGuest } = useAuth();
  return <FoodEntrySession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}
function FoodEntrySession() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ dateId?: string; time?: string }>();
  const meals = useMealStore();
  const library = useFoodLibraryStore();
  const theme = useTheme();
  const [session, setSession] = useState(randomUUID);
  const [documentId] = useState(randomUUID);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState({ saving: false, error: '' });
  const [completedDate, setCompletedDate] = useState<string | null>(null);
  const live = useRef({ active: false, sequence: 0, saving: false, saved: false, session, mounted: true });
  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; };
  }, []);
  useFocusEffect(useCallback(() => {
    live.current.session = randomUUID(); live.current.sequence = 0; setSession(live.current.session);
    live.current.active = true; setActive(true);
    return () => { live.current.active = false; setActive(false); };
  }, []));
  useEffect(() => {
    if (completedDate && !status.saving && active) {
      logsDateStore.set(completedDate);
      router.back();
    }
  }, [completedDate, status.saving, active, router]);
  // Persisting the canonical outbox is short but asynchronous. Keep the screen
  // mounted until its acknowledgement rather than allowing a second draft.
  usePreventRemove(status.saving, ({ data }) => {
    if (live.current.saved) navigation.dispatch(data.action);
  });
  const [initial] = useState(() => {
    const now = chileDateParts(Date.now());
    return {
      date: typeof params.dateId === 'string' && isDateId(params.dateId) && params.dateId >= '1970-01-01' ? params.dateId : todayId(),
      time: typeof params.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.time) ? params.time : `${String(now.hour).padStart(2,'0')}:${String(now.minute).padStart(2,'0')}`,
    };
  });
  const data = useMemo(() => JSON.stringify({ session, draftId: documentId, ...initial, colors: interfaceColors,
    templates: library.templateDocuments.filter(t => !t._deleted), ready: library.isLibraryReady, nutrientFields,
  }), [session, documentId, initial, theme.colors, library.templateDocuments, library.isLibraryReady]);
  return <Screen edges={['top', 'bottom']}><BalanceFoodEntryView style={{ flex: 1 }} data={data} active={active} status={JSON.stringify({ ...status, receipt: `${session}:${live.current.sequence}` })}
    onAction={async ({ nativeEvent: event }) => {
      if (!live.current.active || live.current.saving || live.current.saved || !acceptFoodEntryEvent(event, live.current.session, live.current.sequence)) return;
      live.current.sequence = event.sequence;
      if (event.action === 'cancel') { router.back(); return; }
      live.current.saving = true;
      setStatus({ saving: true, error: '' });
      let input: unknown;
      let doc;
      try {
        input = JSON.parse(event.input);
        doc = createFoodEntry(input, library.templateDocuments, documentId);
      } catch (error) {
        live.current.saving = false;
        setStatus({ saving: false, error: error instanceof SyntaxError ? 'Revisa los datos del registro.' : error instanceof Error ? error.message : 'Revisa los datos del registro.' });
        return;
      }
      try {
        await meals.registerMealLog(doc);
        live.current.saved = true;
        if (!live.current.mounted) return;
        setCompletedDate((input as { date: string }).date);
        // Let the removal guard observe saving=false before navigating.
        setStatus({ saving: false, error: '' });
      } catch (error) {
        if (live.current.mounted) setStatus({ saving: false, error: 'No se pudo guardar en el teléfono. Conservamos el formulario para que puedas reintentar.' });
      } finally { live.current.saving = false; }
    }} /></Screen>;
}
