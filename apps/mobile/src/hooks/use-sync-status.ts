import { useSyncExternalStore } from 'react';
import { syncClient } from '@/services/sync/sync-client';
import type { SyncStatusSnapshot } from '@/services/sync/sync-status';

// Server rendering never exposes activity from a shared process or account.
const serverSnapshot: SyncStatusSnapshot = Object.freeze({
  phase: 'inactive',
  receivedDocuments: 0,
  pendingChanges: 0,
  lastSyncedAt: null,
  error: null,
});
const getServerSnapshot = () => serverSnapshot;

export function useSyncStatus(): SyncStatusSnapshot {
  return useSyncExternalStore(
    syncClient.subscribeStatus,
    syncClient.getStatusSnapshot,
    getServerSnapshot,
  );
}
