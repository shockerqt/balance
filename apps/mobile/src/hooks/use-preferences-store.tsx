import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { storage } from '@/services/storage';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { SyncDocument, UserPreferencesDoc, isUserPreferencesDoc } from '@/services/sync/types';

interface PreferencesContextValue {
  preferencesReady: boolean;
  weightTrackingEnabled: boolean;
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
  const [preferencesReady, setPreferencesReady] = useState(false);
  const enabled = document.preferences.weightTrackingEnabled !== false;

  useEffect(() => {
    let cancelled = false;
    syncClient.setNamespace(namespace);
    setDocument(defaultDoc);
    setPreferencesReady(false);
    const ready = (async () => {
      try {
        const raw = await storage.getItem(collectionStorageKey(namespace, 'userPreferences'));
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          const cached = Array.isArray(parsed) ? parsed.find(isUserPreferencesDoc) : parsed;
          if (isUserPreferencesDoc(cached)) setDocument(mergePreference(defaultDoc, [cached]));
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
      setDocument((current) => {
        const next = mergePreference(current, documents);
        void storage.setItem(
          collectionStorageKey(namespace, 'userPreferences'),
          JSON.stringify([next])
        );
        return next;
      });
    };
    const unregister = syncClient.registerCollection(
      'userPreferences',
      {
        onDocuments: receive,
        onPushConflicts: receive,
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
      setDocument((current) => {
        const next: UserPreferencesDoc = {
          id: user?.id ?? 'guest',
          preferences: { ...current.preferences, weightTrackingEnabled },
          updatedAt: Date.now(),
          _deleted: false,
        };
        void storage.setItem(
          collectionStorageKey(namespace, 'userPreferences'),
          JSON.stringify([next])
        );
        void syncClient.enqueue('userPreferences', next);
        return next;
      });
    },
    [namespace, user?.id]
  );

  const value = useMemo(
    () => ({
      preferencesReady,
      weightTrackingEnabled: enabled,
      setWeightTrackingEnabled,
    }),
    [enabled, preferencesReady, setWeightTrackingEnabled]
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

export function usePreferencesStore(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferencesStore debe usarse dentro de PreferencesProvider');
  return context;
}
