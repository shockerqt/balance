import { API_BASE_URL } from '@/services/config';
import { authDataNamespace } from '@/services/auth/session-state';
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
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { todayId } from '@/hooks/use-meal-store';
import { storage } from '@/services/storage';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { SyncDocument, WeightLogDoc, isDateId, isWeightLogDoc } from '@/services/sync/types';
import { mergeWeightLogs, rollbackRejectedWeightLogs } from '@/services/weight/weight';

interface WeightContextValue {
  weightsByDate: Record<string, WeightLogDoc>;
  syncError: { dateId: string; message: string } | null;
  saveWeight: (dateId: string, weightGrams: number) => boolean;
  deleteWeight: (dateId: string) => void;
}

const WeightContext = createContext<WeightContextValue | undefined>(undefined);

export const WeightProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { preferencesReady, weightTrackingEnabled } = usePreferencesStore();
  const namespace = user ? authDataNamespace(API_BASE_URL, user.id) : 'guest';
  const [logs, setLogs] = useState<WeightLogDoc[]>([]);
  const logsRef = useRef<WeightLogDoc[]>([]);
  const cacheValid = useRef(false);
  const currentNamespace = useRef(namespace);
  currentNamespace.current = namespace;
  const [syncError, setSyncError] = useState<{ dateId: string; message: string } | null>(null);

  const persist = useCallback(
    (next: WeightLogDoc[]) => {
      const key = collectionStorageKey(namespace, 'weightLogs');
      const trusted = cacheValid.current && storage.isDurableItem(key);
      const persisted = (async () => {
        if (!trusted) await syncClient.invalidateCollectionCheckpoint('weightLogs', namespace);
        await storage.setItem(key, JSON.stringify(next));
      })();
      void persisted.catch(() => {
        if (currentNamespace.current === namespace) syncClient.reportLocalPersistenceError('weightLogs');
      });
      return persisted;
    },
    [namespace]
  );

  useEffect(() => {
    if (!preferencesReady || !weightTrackingEnabled) {
      cacheValid.current = false;
      logsRef.current = [];
      setLogs([]);
      setSyncError(null);
      return;
    }
    let cancelled = false;
    cacheValid.current = false;
    logsRef.current = [];
    setLogs([]);
    const ready = (async () => {
      const raw = await storage.getItem(collectionStorageKey(namespace, 'weightLogs')).catch(() => null);
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cacheValid.current = parsed.every(isWeightLogDoc);
          const next = mergeWeightLogs(parsed.filter(isWeightLogDoc), logsRef.current);
          logsRef.current = next;
          setLogs(next);
        }
      } catch {
        // PostgreSQL restores the authoritative cache after reconnect.
      }
    })();
    const receive = (documents: SyncDocument[]) => {
      if (cancelled) return;
      const next = mergeWeightLogs(logsRef.current, documents);
      logsRef.current = next;
      setLogs(next);
      return persist(next);
    };
    const unregister = syncClient.registerCollection(
      'weightLogs',
      {
        canResume: () => !cancelled && cacheValid.current && storage.isDurableItem(collectionStorageKey(namespace, 'weightLogs')),
        onDocuments: async (documents) => {
          await receive(documents);
          if (!cancelled) cacheValid.current = true;
        },
        onPushConflicts: receive,
        onPushRejected: (rejections) => {
          const rollback = rollbackRejectedWeightLogs(logsRef.current, rejections);
          logsRef.current = rollback.logs;
          setLogs(rollback.logs);
          const persisted = persist(rollback.logs);
          const dateId = rollback.rejectedDateIds.at(-1);
          setSyncError(
            dateId
              ? {
                  dateId,
                  message: `El servidor rechazó el peso de ${dateId}; se restauró el valor anterior.`,
                }
              : null
          );
          if (rollback.resetNeeded) void syncClient.resetCollection('weightLogs');
          return persisted;
        },
      },
      ready
    );
    return () => {
      cancelled = true;
      unregister();
    };
  }, [namespace, persist, preferencesReady, weightTrackingEnabled]);

  const saveWeight = useCallback(
    (dateId: string, weightGrams: number) => {
      if (!weightTrackingEnabled || !isDateId(dateId) || dateId > todayId()) return false;
      if (
        !Number.isInteger(weightGrams) ||
        weightGrams < 1_000 ||
        weightGrams > 500_000 ||
        weightGrams % 100 !== 0
      )
        return false;
      const document: WeightLogDoc = {
        id: dateId,
        weightGrams,
        updatedAt: Date.now(),
        _deleted: false,
      };
      const previous = logsRef.current.find((doc) => doc.id === dateId) ?? null;
      const next = mergeWeightLogs(logsRef.current, [document]);
      logsRef.current = next;
      setLogs(next);
      persist(next);
      setSyncError((current) => (current?.dateId === dateId ? null : current));
      void syncClient.enqueue('weightLogs', document, previous).catch(() => undefined);
      return true;
    },
    [persist, weightTrackingEnabled]
  );

  const deleteWeight = useCallback(
    (dateId: string) => {
      if (!weightTrackingEnabled) return;
      const existing = logsRef.current.find((doc) => doc.id === dateId && !doc._deleted);
      if (!existing) return;
      const deleted: WeightLogDoc = { ...existing, updatedAt: Date.now(), _deleted: true };
      const next = mergeWeightLogs(logsRef.current, [deleted]);
      logsRef.current = next;
      setLogs(next);
      persist(next);
      setSyncError((current) => (current?.dateId === dateId ? null : current));
      void syncClient.enqueue('weightLogs', deleted, existing).catch(() => undefined);
    },
    [persist, weightTrackingEnabled]
  );

  const weightsByDate = useMemo(
    () => Object.fromEntries(logs.filter((doc) => !doc._deleted).map((doc) => [doc.id, doc])),
    [logs]
  );
  const value = useMemo(
    () => ({ weightsByDate, syncError, saveWeight, deleteWeight }),
    [weightsByDate, syncError, saveWeight, deleteWeight]
  );
  return <WeightContext.Provider value={value}>{children}</WeightContext.Provider>;
};

export function useWeightStore(): WeightContextValue {
  const context = useContext(WeightContext);
  if (!context) throw new Error('useWeightStore debe usarse dentro de WeightProvider');
  return context;
}
