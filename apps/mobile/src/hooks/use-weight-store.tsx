import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { todayId } from '@/hooks/use-meal-store';
import { storage } from '@/services/storage';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { SyncDocument, WeightLogDoc, isDateId, isWeightLogDoc } from '@/services/sync/types';
import { mergeWeightLogs } from '@/services/weight/weight';

interface WeightContextValue {
  weightsByDate: Record<string, WeightLogDoc>;
  saveWeight: (dateId: string, weightGrams: number) => boolean;
  deleteWeight: (dateId: string) => void;
}

const WeightContext = createContext<WeightContextValue | undefined>(undefined);

export const WeightProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { preferencesReady, weightTrackingEnabled } = usePreferencesStore();
  const namespace = user ? `user:${user.id}` : 'guest';
  const [logs, setLogs] = useState<WeightLogDoc[]>([]);

  const persist = useCallback(
    (next: WeightLogDoc[]) => {
      void storage.setItem(collectionStorageKey(namespace, 'weightLogs'), JSON.stringify(next));
    },
    [namespace]
  );

  useEffect(() => {
    if (!preferencesReady || !weightTrackingEnabled) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    setLogs([]);
    const ready = (async () => {
      const raw = await storage.getItem(collectionStorageKey(namespace, 'weightLogs'));
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setLogs(parsed.filter(isWeightLogDoc));
      } catch {
        // PostgreSQL restores the authoritative cache after reconnect.
      }
    })();
    const receive = (documents: SyncDocument[]) => {
      if (cancelled) return;
      setLogs((current) => {
        const next = mergeWeightLogs(current, documents);
        persist(next);
        return next;
      });
    };
    const unregister = syncClient.registerCollection(
      'weightLogs',
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
      setLogs((current) => {
        const next = mergeWeightLogs(current, [document]);
        persist(next);
        return next;
      });
      void syncClient.enqueue('weightLogs', document);
      return true;
    },
    [persist, weightTrackingEnabled]
  );

  const deleteWeight = useCallback(
    (dateId: string) => {
      if (!weightTrackingEnabled) return;
      setLogs((current) => {
        const existing = current.find((doc) => doc.id === dateId && !doc._deleted);
        if (!existing) return current;
        const deleted: WeightLogDoc = { ...existing, updatedAt: Date.now(), _deleted: true };
        const next = mergeWeightLogs(current, [deleted]);
        persist(next);
        void syncClient.enqueue('weightLogs', deleted);
        return next;
      });
    },
    [persist, weightTrackingEnabled]
  );

  const weightsByDate = useMemo(
    () => Object.fromEntries(logs.filter((doc) => !doc._deleted).map((doc) => [doc.id, doc])),
    [logs]
  );
  const value = useMemo(
    () => ({ weightsByDate, saveWeight, deleteWeight }),
    [weightsByDate, saveWeight, deleteWeight]
  );
  return <WeightContext.Provider value={value}>{children}</WeightContext.Provider>;
};

export function useWeightStore(): WeightContextValue {
  const context = useContext(WeightContext);
  if (!context) throw new Error('useWeightStore debe usarse dentro de WeightProvider');
  return context;
}
