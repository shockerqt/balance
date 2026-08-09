import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@/hooks/use-auth';
import { storage } from '@/services/storage';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { SyncDocument, UserPreferencesDoc, isUserPreferencesDoc } from '@/services/sync/types';

interface PreferencesContextValue {
  preferencesReady: boolean;
  weightTrackingEnabled: boolean;
  syncError: string | null;
  setWeightTrackingEnabled: (enabled: boolean) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

function mergePreference(
  current: UserPreferencesDoc,
  incoming: SyncDocument[]
): UserPreferencesDoc {
  let next = current;
  for (const value of incoming) {
    if (isUserPreferencesDoc(value) && value.updatedAt > next.updatedAt) next = value;
  }
  return next;
}

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const namespace = user ? `user:${user.id}` : 'guest';
  const defaultDoc = useMemo<UserPreferencesDoc>(
    () => ({
      id: user?.id ?? 'guest',
      preferences: { weightTrackingEnabled: true },
      updatedAt: 0,
      _deleted: false,
    }),
    [user?.id]
  );
  const [document, setDocument] = useState(defaultDoc);
  const documentRef = useRef(defaultDoc);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const enabled = document.preferences.weightTrackingEnabled !== false;

  useEffect(() => {
    let cancelled = false;
    documentRef.current = defaultDoc;
    setDocument(defaultDoc);
    setSyncError(null);
    setPreferencesReady(false);
    const ready = (async () => {
      try {
        const raw = await storage.getItem(collectionStorageKey(namespace, 'userPreferences'));
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          const cached = Array.isArray(parsed) ? parsed.find(isUserPreferencesDoc) : parsed;
          if (isUserPreferencesDoc(cached)) {
            const next = mergePreference(defaultDoc, [cached]);
            documentRef.current = next;
            setDocument(next);
          }
        } catch {
          // Invalid local preferences fall back to the enabled default.
        }
      } catch {
        // Storage failures do not make Settings unusable.
      } finally {
        if (!cancelled) setPreferencesReady(true);
      }
    })();
    const receive = (documents: SyncDocument[]) => {
      if (cancelled) return;
      const next = mergePreference(documentRef.current, documents);
      documentRef.current = next;
      setDocument(next);
      void storage.setItem(
        collectionStorageKey(namespace, 'userPreferences'),
        JSON.stringify([next])
      );
    };
    const unregister = syncClient.registerCollection(
      'userPreferences',
      {
        onDocuments: receive,
        onPushConflicts: receive,
        onPushRejected: (rejections) => {
          const rejection = rejections.find((value) => isUserPreferencesDoc(value.document));
          if (!rejection) return;
          const previous = rejection.previousDocument;
          const next = isUserPreferencesDoc(previous) ? previous : defaultDoc;
          documentRef.current = next;
          setDocument(next);
          setSyncError('No se pudo guardar la preferencia. Se restauró el valor anterior.');
          void storage.setItem(
            collectionStorageKey(namespace, 'userPreferences'),
            JSON.stringify([next])
          );
          if (previous === undefined) void syncClient.resetCollection('userPreferences');
        },
      },
      ready
    );
    return () => {
      cancelled = true;
      unregister();
    };
  }, [defaultDoc, namespace]);

  useEffect(() => {
    syncClient.setCollectionEnabled('weightLogs', enabled);
  }, [enabled]);

  const setWeightTrackingEnabled = useCallback(
    (weightTrackingEnabled: boolean) => {
      const next: UserPreferencesDoc = {
        id: user?.id ?? 'guest',
        preferences: { ...documentRef.current.preferences, weightTrackingEnabled },
        updatedAt: Date.now(),
        _deleted: false,
      };
      const previous = documentRef.current;
      documentRef.current = next;
      setDocument(next);
      setSyncError(null);
      void storage.setItem(
        collectionStorageKey(namespace, 'userPreferences'),
        JSON.stringify([next])
      );
      void syncClient.enqueue('userPreferences', next, previous);
    },
    [namespace, user?.id]
  );

  const value = useMemo(
    () => ({
      preferencesReady,
      weightTrackingEnabled: enabled,
      syncError,
      setWeightTrackingEnabled,
    }),
    [enabled, preferencesReady, setWeightTrackingEnabled, syncError]
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

export function usePreferencesStore(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferencesStore debe usarse dentro de PreferencesProvider');
  return context;
}
