/** Ephemeral activity projected by the existing sync owner. No user or payload data. */
export type SyncStatusSnapshot = Readonly<{
  phase: 'inactive' | 'connecting' | 'syncing' | 'pending' | 'synced' | 'offline' | 'error';
  receivedDocuments: number;
  pendingChanges: number;
  lastSyncedAt: number | null;
  error: 'download' | 'upload' | 'local' | 'connection' | null;
}>;
