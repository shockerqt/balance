import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { MealLogDoc } from '@/services/sync/types';
import { useMealActions } from './use-meal-store';

/** UI receipt only: the existing meal store/outbox owns the actual write. */
export function useMealReceipt(onComplete: () => void) {
  const { registerMealLogs } = useMealActions();
  const navigation = useNavigation();
  const [state, setState] = useState({ saving: false, saved: false, error: '' });
  const [focused, setFocused] = useState(false);
  const live = useRef({ mounted: true, focused: false, saving: false, saved: false });
  const complete = useRef(onComplete);
  useLayoutEffect(() => { complete.current = onComplete; });
  const intention = useRef<{ key: string; documents: MealLogDoc[] } | null>(null);
  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; };
  }, []);
  useFocusEffect(useCallback(() => {
    live.current.focused = true; setFocused(true);
    return () => { live.current.focused = false; setFocused(false); };
  }, []));
  usePreventRemove(state.saving, ({ data }) => {
    if (live.current.saved) navigation.dispatch(data.action);
  });
  useEffect(() => {
    if (focused && state.saved && !state.saving) complete.current();
  }, [focused, state.saved, state.saving]);

  const submit = useCallback(async (key: string, prepare: () => MealLogDoc[], validateRetry?: () => void) => {
    if (!live.current.mounted || !live.current.focused || live.current.saving || live.current.saved) return;
    live.current.saving = true;
    setState({ saving: true, saved: false, error: '' });
    try {
      validateRetry?.();
      if (intention.current?.key !== key) intention.current = { key, documents: prepare() };
    } catch (error) {
      live.current.saving = false;
      setState({ saving: false, saved: false, error: error instanceof Error ? error.message : 'Revisa los datos.' });
      return;
    }
    try {
      // Preserve the exact IDs, snapshots and revisions on a failed receipt.
      await registerMealLogs(intention.current.documents);
      live.current.saved = true;
      if (live.current.mounted) setState({ saving: false, saved: true, error: '' });
    } catch {
      if (live.current.mounted) setState({ saving: false, saved: false,
        error: 'No se pudo guardar en el teléfono. Conservamos los datos para que puedas reintentar.' });
    } finally { live.current.saving = false; }
  }, [registerMealLogs]);
  return { ...state, submit };
}
