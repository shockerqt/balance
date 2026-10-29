import { AppState, AppStateStatus } from 'react-native';
import { WS_SYNC_URL, WS_AUTH_MODE } from '@/services/config';
import { accessTokenChanged } from '@/services/auth/session-state';
import { storage } from '@/services/storage';
import type { SyncStatusSnapshot } from './sync-status';
import {
  SYNC_COLLECTIONS,
  SyncCheckpoint,
  SyncCollection,
  SyncDocument,
  SyncPushRejection,
  parsePushRejections,
  isSyncDocument,
} from './types';

const REQUEST_TIMEOUT_MS = 12_000;
const OUTBOX_KEY_PREFIX = '@balance_sync_outbox_v2:';
const COLLECTION_KEY_PREFIX = '@balance_sync_collection_v2:';
const CHECKPOINT_KEY_PREFIX = '@balance_sync_checkpoint_v2:';

export interface PullResult {
  documents: SyncDocument[];
  checkpoint: SyncCheckpoint | null;
  hasMoreDocuments: boolean;
}

export interface CollectionHandlers {
  onDocuments: (documents: SyncDocument[], result: PullResult) => void;
  onPushConflicts?: (documents: SyncDocument[]) => void;
  onPushRejected?: (rejections: RejectedDocument[]) => void;
}

export interface RejectedDocument {
  document: SyncDocument;
  previousDocument?: SyncDocument | null;
  code: string;
  message: string;
}

interface PushResult {
  conflicts: SyncDocument[];
  invalidConflict: boolean;
  rejections: SyncPushRejection[];
}

interface PendingRequest<T> {
  collection: SyncCollection;
  namespace: string;
  generation: number;
  connectionEpoch: number;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface OutboxEntry {
  collection: SyncCollection;
  document: SyncDocument;
  previousDocument?: SyncDocument | null;
  queuedAt: number;
}

type ServerMessage = Record<string, unknown> & { event?: string; requestId?: string; collection?: string };

const namespaceKey = (namespace: string) => namespace || 'guest';

export function collectionStorageKey(namespace: string, collection: SyncCollection): string {
  return `${COLLECTION_KEY_PREFIX}${namespaceKey(namespace)}:${collection}`;
}

function checkpointStorageKey(namespace: string, collection: SyncCollection): string {
  return `${CHECKPOINT_KEY_PREFIX}${namespaceKey(namespace)}:${collection}`;
}

function outboxStorageKey(namespace: string): string {
  return `${OUTBOX_KEY_PREFIX}${namespaceKey(namespace)}`;
}

function nextRequestId(): string {
  const random = Math.random().toString(36).slice(2);
  return `sync-${Date.now().toString(36)}-${random}`;
}

function isCollection(value: unknown): value is SyncCollection {
  return typeof value === 'string' && (SYNC_COLLECTIONS as readonly string[]).includes(value);
}

export class SyncClient {
  private ws: WebSocket | null = null;
  private ready = false;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private expiredToken: string | null = null;
  private accessToken: string | null = null;
  private namespace = 'guest';
  private namespaceGeneration = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectWithoutDelay = false;
  private closedByUser = false;
  private pending = new Map<string, PendingRequest<unknown>>();
  private collectionFallbackRequests = new Map<SyncCollection, string[]>();
  private handlers = new Map<SyncCollection, CollectionHandlers>();
  private outbox = new Map<string, OutboxEntry>();
  private outboxLoadedFor = '';
  private flushPromise: Promise<void> | null = null;
  private flushAfterCurrent = false;
  private resyncs = new Map<SyncCollection, Promise<void>>();
  private enqueueChains = new Map<string, Promise<void>>();
  private disabledCollections = new Set<SyncCollection>();
  private collectionReadiness = new Map<SyncCollection, Promise<void>>();
  private resyncAgain = new Set<SyncCollection>();
  private completedCollections = new Set<SyncCollection>();
  private connectionEpoch = 0;
  private receivedDocuments = 0;
  private lastSyncedAt: number | null = null;
  private activeEnqueues = new Map<string, Map<string, number>>();
  private outboxLoad: { namespace: string; generation: number; promise: Promise<void> } | null = null;
  private statusErrors = new Map<string, NonNullable<SyncStatusSnapshot['error']>>();
  // Failure metadata only: the original editor/store retains ownership of the
  // rejected document. Retry must never invent a replacement upload queue.
  private failedEnqueueRevisions = new Map<string, number>();
  private statusListeners = new Set<() => void>();
  private statusSnapshot: SyncStatusSnapshot = Object.freeze({
    phase: 'inactive', receivedDocuments: 0, pendingChanges: 0, lastSyncedAt: null, error: null,
  });

  getStatusSnapshot = (): SyncStatusSnapshot => this.statusSnapshot;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  };

  retrySync = async (): Promise<void> => {
    if (this.namespace === 'guest' || !this.accessToken) return;
    for (const key of this.statusErrors.keys()) {
      if (!key.startsWith('enqueue:')) this.statusErrors.delete(key);
    }
    this.completedCollections.clear();
    this.publishStatus();
    if (!this.isReady()) {
      this.connect();
      this.publishStatus();
      return;
    }
    await Promise.all([this.resync(), this.flushOutbox()]);
  };

  private operationIsCurrent(namespace: string, generation: number, epoch: number): boolean {
    return this.isCurrent(namespace, generation) && this.connectionEpoch === epoch;
  }

  private invalidateConnectionStatus(): void {
    this.connectionEpoch += 1;
    this.resyncs.clear();
    this.resyncAgain.clear();
    this.completedCollections.clear();
    this.receivedDocuments = 0;
    if (this.flushPromise) this.flushAfterCurrent = true;
  }

  private publishStatus(): void {
    const active = this.namespace !== 'guest' && !!this.accessToken;
    const namespaceEnqueues = this.activeEnqueues.get(this.namespace);
    const pendingKeys = new Set([...this.outbox.keys(), ...(namespaceEnqueues?.keys() ?? [])]);
    const error = active ? this.statusErrors.values().next().value ?? null : null;
    let phase: SyncStatusSnapshot['phase'];
    if (!active) phase = 'inactive';
    else if (!this.isReady()) phase = this.ws ? 'connecting' : 'offline';
    else if (error) phase = 'error';
    else if (this.resyncs.size || this.flushPromise || namespaceEnqueues?.size || this.outboxLoad) phase = 'syncing';
    else if (pendingKeys.size || this.outboxLoadedFor !== this.namespace || this.resyncAgain.size ||
      SYNC_COLLECTIONS.some(collection => !this.disabledCollections.has(collection) && !this.completedCollections.has(collection))) phase = 'pending';
    else phase = 'synced';
    if (active && phase === 'synced' && this.statusSnapshot.phase !== 'synced') this.lastSyncedAt = Date.now();
    const next: SyncStatusSnapshot = Object.freeze({
      phase,
      receivedDocuments: active ? this.receivedDocuments : 0,
      pendingChanges: active ? pendingKeys.size : 0,
      lastSyncedAt: active ? this.lastSyncedAt : null,
      error,
    });
    if (Object.keys(next).every(key => next[key as keyof SyncStatusSnapshot] === this.statusSnapshot[key as keyof SyncStatusSnapshot])) return;
    this.statusSnapshot = next;
    for (const listener of this.statusListeners) {
      try { listener(); } catch { /* An observer cannot interrupt the sync owner. */ }
    }
  }

  constructor() {
    AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void this.resync();
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.scheduleReconnect(0);
      }
    });
  }

  setNamespace(namespace: string | null): void {
    const next = namespaceKey(namespace ?? 'guest');
    if (next === this.namespace) return;
    this.clearAuthTimer();
    this.ready = false;
    const previousSocket = this.ws;
    this.ws = null;
    previousSocket?.close();
    this.namespace = next;
    this.namespaceGeneration += 1;
    this.invalidateConnectionStatus();
    this.outboxLoad = null;
    this.statusErrors.clear();
    this.failedEnqueueRevisions.clear();
    this.lastSyncedAt = null;
    this.cancelPending(new Error('SYNC_NAMESPACE_CHANGED'));
    this.resyncs.clear();
    if (this.flushPromise) this.flushAfterCurrent = true;
    this.outbox = new Map();
    this.outboxLoadedFor = '';
    void this.loadOutbox().catch(() => undefined);
    this.publishStatus();
  }

  registerCollection(collection: SyncCollection, nextHandlers: CollectionHandlers, ready?: Promise<void>): () => void {
    this.handlers.set(collection, nextHandlers);
    this.collectionReadiness.set(collection, ready ?? Promise.resolve());
    this.completedCollections.delete(collection);
    if (!this.disabledCollections.has(collection)) void this.resyncCollection(collection);
    this.publishStatus();
    return () => {
      if (this.handlers.get(collection) === nextHandlers) {
        this.handlers.delete(collection);
        this.collectionReadiness.delete(collection);
        this.completedCollections.delete(collection);
        this.publishStatus();
      }
    };
  }

  setCollectionEnabled(collection: SyncCollection, enabled: boolean): void {
    if (collection === 'userPreferences') return;
    if (!enabled) {
      this.disabledCollections.add(collection);
      this.completedCollections.delete(collection);
      this.resyncAgain.delete(collection);
      this.publishStatus();
      return;
    }
    if (!this.disabledCollections.delete(collection)) return;
    this.completedCollections.delete(collection);
    this.publishStatus();
    void this.resyncCollection(collection);
    void this.flushOutbox();
  }

  connect(accessToken?: string, namespace?: string): void {
    const reconnectForToken = accessTokenChanged(this.accessToken, accessToken);
    if (accessToken) this.accessToken = accessToken;
    if (reconnectForToken) this.expiredToken = null;
    if (namespace) this.setNamespace(namespace);
    this.closedByUser = false;
    if (!this.accessToken || this.expiredToken === this.accessToken) { this.publishStatus(); return; }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (reconnectForToken) {
        this.invalidateConnectionStatus();
        this.clearAuthTimer();
        this.ready = false;
        this.clearReconnectTimer();
        this.cancelPending(new Error('SYNC_ACCESS_TOKEN_CHANGED'));
        // A routine token rotation is not a failure: reconnect at once instead
        // of inheriting the backoff and leaving sync offline for up to 30 s.
        this.reconnectWithoutDelay = true;
        this.reconnectAttempt = 0;
        this.ws.close();
        this.publishStatus();
      }
      return;
    }

    this.clearReconnectTimer();
    this.invalidateConnectionStatus();
    try {
      const token = this.accessToken;
      const generation = this.namespaceGeneration;
      const socket = new WebSocket(WS_SYNC_URL, WS_AUTH_MODE === 'application' ? ['balance'] : ['balance', `balance.bearer.${token}`]);
      this.ws = socket;
      this.ready = false;
      this.publishStatus();
      const current = () => this.ws === socket && this.namespaceGeneration === generation && this.accessToken === token;
      const ready = () => {
        this.clearAuthTimer();
        this.ready = true;
        this.reconnectAttempt = 0;
        this.statusErrors.delete('connection');
        void this.resync();
        void this.flushOutbox();
        this.publishStatus();
      };
      socket.onopen = () => {
        if (!current()) return;
        if (WS_AUTH_MODE === 'application') {
          this.authTimer = setTimeout(() => {
            if (!current() || this.ready) return;
            this.authTimer = null;
            socket.close();
          }, REQUEST_TIMEOUT_MS);
          try { socket.send(JSON.stringify({ event: 'authenticate', accessToken: token })); }
          catch { socket.close(); }
        } else ready();
      };
      socket.onmessage = (event) => {
        if (!current()) return;
        if (WS_AUTH_MODE === 'application' && !this.ready) {
          try {
            const message = JSON.parse(event.data);
            if (message.event === 'authenticated' && Object.keys(message).length === 1) ready();
          } catch { /* Untrusted non-ACK frames never enable sync. */ }
          return;
        }
        void this.handleMessage(event.data);
      };
      socket.onerror = () => {
        if (!current()) return;
        // onclose schedules reconnect; never log credentials or payloads.
      };
      socket.onclose = (event) => {
        // Token rotation has already replaced the captured token; socket identity
        // still owns cleanup/reconnect, but never a new namespace's callbacks.
        if (this.ws !== socket || this.namespaceGeneration !== generation) return;
        this.clearAuthTimer();
        this.ready = false;
        this.invalidateConnectionStatus();
        this.cancelPending(new Error('SYNC_DISCONNECTED'));
        this.ws = null;
        const immediate = this.reconnectWithoutDelay;
        this.reconnectWithoutDelay = false;
        if (WS_AUTH_MODE === 'application' && event.code === 4001 && this.accessToken === token) this.expiredToken = token;
        if (!this.closedByUser) this.scheduleReconnect(immediate ? 0 : undefined);
        this.statusErrors.set('connection', 'connection');
        this.publishStatus();
      };
    } catch {
      this.ws = null;
      this.ready = false;
      this.clearAuthTimer();
      this.scheduleReconnect();
      this.statusErrors.set('connection', 'connection');
      this.publishStatus();
    }
  }

  disconnect(): void {
    this.clearAuthTimer();
    this.ready = false;
    this.expiredToken = null;
    this.closedByUser = true;
    this.reconnectWithoutDelay = false;
    this.accessToken = null;
    this.clearReconnectTimer();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('SYNC_DISCONNECTED'));
    }
    this.pending.clear();
    this.collectionFallbackRequests.clear();
    this.ws?.close();
    this.ws = null;
    this.setNamespace('guest');
    this.publishStatus();
  }

  async pull(collection: SyncCollection, checkpoint?: SyncCheckpoint, limit = 50, expected?: { namespace: string; generation: number }): Promise<PullResult> {
    if (this.disabledCollections.has(collection)) throw new Error('SYNC_COLLECTION_DISABLED');
    if (!this.isReady()) {
      throw new Error('SYNC_OFFLINE');
    }
    const requestId = nextRequestId();
    const namespace = expected?.namespace ?? this.namespace;
    const generation = expected?.generation ?? this.namespaceGeneration;
    const result = await this.request<PullResult>(
      requestId,
      collection,
      {
        event: 'pull',
        requestId,
        collection,
        checkpoint: checkpoint ?? null,
        limit: Math.max(1, Math.min(limit, 100)),
      },
      (message) => {
        if (!Array.isArray(message.documents) || !message.documents.every(doc => isSyncDocument(collection, doc)))
          throw new Error('SYNC_INVALID_PAGE');
        const documents = message.documents as SyncDocument[];
        const more = message.hasMoreDocuments ?? message.has_more_documents;
        if (typeof more !== 'boolean' ||
          (message.hasMoreDocuments !== undefined && message.has_more_documents !== undefined && message.hasMoreDocuments !== message.has_more_documents))
          throw new Error('SYNC_INVALID_PAGE');
        const rawCheckpoint = message.checkpoint;
        let nextCheckpoint: SyncCheckpoint | null = null;
        if (rawCheckpoint !== null && rawCheckpoint !== undefined) {
          if (typeof rawCheckpoint !== 'object' || Array.isArray(rawCheckpoint)) throw new Error('SYNC_INVALID_CHECKPOINT');
          const value = rawCheckpoint as Record<string, unknown>;
          if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0 ||
            typeof value.id !== 'string' || !value.id) throw new Error('SYNC_INVALID_CHECKPOINT');
          nextCheckpoint = { updatedAt: value.updatedAt, id: value.id };
        }
        const last = documents.at(-1);
        if (last) {
          if (!nextCheckpoint || nextCheckpoint.updatedAt !== last.updatedAt || nextCheckpoint.id !== String(last.id) ||
            (checkpoint && (nextCheckpoint.updatedAt < checkpoint.updatedAt ||
              (nextCheckpoint.updatedAt === checkpoint.updatedAt && nextCheckpoint.id! <= (checkpoint.id ?? '')))))
            throw new Error('SYNC_NONADVANCING_CHECKPOINT');
        } else if (more || nextCheckpoint) throw new Error('SYNC_INVALID_PAGE');
        return { documents, checkpoint: nextCheckpoint, hasMoreDocuments: more };
      },
      namespace,
      generation,
    );
    return result;
  }

  async push(collection: SyncCollection, rows: { newDocumentState: SyncDocument }[]): Promise<PushResult> {
    if (this.disabledCollections.has(collection)) throw new Error('SYNC_COLLECTION_DISABLED');
    if (!rows.length) return { conflicts: [], invalidConflict: false, rejections: [] };
    if (!this.isReady()) throw new Error('SYNC_OFFLINE');
    const requestId = nextRequestId();
    return this.request<PushResult>(
      requestId,
      collection,
      { event: 'push', requestId, collection, rows },
      (message) => {
        if (!Array.isArray(message.conflicts)) {
          return { conflicts: [], invalidConflict: true, rejections: [] };
        }
        const conflicts: SyncDocument[] = [];
        let invalidConflict = false;
        for (const doc of message.conflicts) {
          if (isSyncDocument(collection, doc)) conflicts.push(doc);
          else invalidConflict = true;
        }
        let rejections: SyncPushRejection[] = [];
        if (message.rejections !== undefined) {
          const parsed = parsePushRejections(message.rejections, rows.length);
          if (parsed) rejections = parsed;
          else invalidConflict = true;
        }
        return { conflicts, invalidConflict, rejections };
      },
      this.namespace,
      this.namespaceGeneration,
    );
  }

  async enqueue(
    collection: SyncCollection,
    document: SyncDocument,
    previousDocument?: SyncDocument | null
  ): Promise<void> {
    const namespace = this.namespace;
    const generation = this.namespaceGeneration;
    const key = `${collection}:${document.id}`;
    const namespaceEnqueues = this.activeEnqueues.get(namespace) ?? new Map<string, number>();
    namespaceEnqueues.set(key, (namespaceEnqueues.get(key) ?? 0) + 1);
    this.activeEnqueues.set(namespace, namespaceEnqueues);
    this.publishStatus();
    const previous = this.enqueueChains.get(namespace) ?? Promise.resolve();
    const operation = previous.then(async () => {
      await this.loadOutbox();
      const raw = await storage.getItem(outboxStorageKey(namespace));
      const entries = new Map<string, OutboxEntry>();
      if (raw) {
        try {
          const saved = JSON.parse(raw) as OutboxEntry[];
          if (Array.isArray(saved)) {
            for (const entry of saved) {
              if (
                isCollection(entry.collection) &&
                isSyncDocument(entry.collection, entry.document) &&
                (entry.previousDocument === undefined ||
                  entry.previousDocument === null ||
                  isSyncDocument(entry.collection, entry.previousDocument))
              ) {
                entries.set(`${entry.collection}:${entry.document.id}`, entry);
              }
            }
          }
        } catch {
          // Invalid outbox data is discarded for this namespace only.
        }
      }
      const key = `${collection}:${document.id}`;
      const queued = entries.get(key);
      entries.set(key, {
        collection,
        document,
        previousDocument: queued ? queued.previousDocument : previousDocument,
        queuedAt: Date.now(),
      });
      await storage.setItem(outboxStorageKey(namespace), JSON.stringify(Array.from(entries.values())));
      if (this.isCurrent(namespace, generation)) {
        this.outbox = entries;
        this.outboxLoadedFor = namespace;
        if (this.flushPromise) this.flushAfterCurrent = true;
        void this.flushOutbox();
        this.publishStatus();
      } else if (this.namespace === namespace) {
        // A durable enqueue can outlive logout and return to the same account.
        // Wait out any older hydration, then reload the just-written queue using
        // the current generation's owner before releasing its pending-work gate.
        const currentGeneration = this.namespaceGeneration;
        const loading = this.outboxLoad?.namespace === namespace ? this.outboxLoad.promise : null;
        if (loading) await loading.catch(() => undefined);
        if (this.isCurrent(namespace, currentGeneration)) {
          this.outboxLoadedFor = '';
          await this.loadOutbox();
          if (this.isCurrent(namespace, currentGeneration)) {
            if (this.flushPromise) this.flushAfterCurrent = true;
            void this.flushOutbox();
            this.publishStatus();
          }
        }
      }
    });
    this.enqueueChains.set(namespace, operation.catch(() => undefined));
    try {
      await operation;
      const failedRevision = this.failedEnqueueRevisions.get(key);
      if (this.namespace === namespace && failedRevision !== undefined && document.updatedAt >= failedRevision) {
        this.failedEnqueueRevisions.delete(key);
        this.statusErrors.delete(`enqueue:${key}`);
      }
    } catch (error) {
      if (this.namespace === namespace) {
        this.failedEnqueueRevisions.set(key, Math.max(document.updatedAt, this.failedEnqueueRevisions.get(key) ?? document.updatedAt));
        this.statusErrors.set(`enqueue:${key}`, 'local');
      }
      throw error;
    } finally {
      const pending = this.activeEnqueues.get(namespace);
      const count = pending?.get(key) ?? 1;
      if (count <= 1) pending?.delete(key); else pending?.set(key, count - 1);
      if (pending?.size === 0) this.activeEnqueues.delete(namespace);
      this.publishStatus();
    }
  }

  async resync(): Promise<void> {
    if (!this.isReady()) return;
    await Promise.all(
      Array.from(this.handlers.keys())
        .filter((collection) => !this.disabledCollections.has(collection))
        .map((collection) => this.resyncCollection(collection))
    );
  }

  async resyncCollection(collection: SyncCollection, ready?: Promise<void>): Promise<void> {
    if (this.disabledCollections.has(collection) || !this.isReady()) return;
    if (ready) this.collectionReadiness.set(collection, ready);
    const current = this.resyncs.get(collection);
    if (current) {
      this.resyncAgain.add(collection);
      this.completedCollections.delete(collection);
      this.publishStatus();
      return current;
    }
    const namespace = this.namespace;
    const generation = this.namespaceGeneration;
    const epoch = this.connectionEpoch;
    this.completedCollections.delete(collection);
    const operation = (async () => {
      do {
        this.resyncAgain.delete(collection);
        const completed = await this.performResync(collection, namespace, generation, epoch);
        if (!this.operationIsCurrent(namespace, generation, epoch)) return;
        if (completed && !this.resyncAgain.has(collection)) this.completedCollections.add(collection);
        if (!completed && !this.resyncAgain.has(collection)) return;
      } while (this.operationIsCurrent(namespace, generation, epoch) && this.isReady() &&
        !this.disabledCollections.has(collection) && this.resyncAgain.has(collection));
    })().finally(() => {
      if (this.resyncs.get(collection) === operation) {
        this.resyncs.delete(collection);
        if (this.operationIsCurrent(namespace, generation, epoch) && this.isReady() &&
          !this.disabledCollections.has(collection) && this.resyncAgain.has(collection)) {
          this.completedCollections.delete(collection);
          void this.resyncCollection(collection);
        }
        this.publishStatus();
      }
    });
    this.resyncs.set(collection, operation);
    this.publishStatus();
    return operation;
  }

  async resetCollection(collection: SyncCollection): Promise<void> {
    const namespace = this.namespace;
    const generation = this.namespaceGeneration;
    this.completedCollections.delete(collection);
    this.publishStatus();
    try { await storage.removeItem(checkpointStorageKey(namespace, collection)); }
    catch {
      if (this.isCurrent(namespace, generation)) {
        this.statusErrors.set(`pull:${collection}`, 'local');
        this.publishStatus();
      }
      return;
    }
    if (this.isCurrent(namespace, generation)) await this.resyncCollection(collection);
  }

  private async performResync(collection: SyncCollection, namespace: string, generation: number, epoch: number): Promise<boolean> {
    const handlers = this.handlers.get(collection);
    let localOperation = true;
    try {
      await this.collectionReadiness.get(collection);
      if (!handlers || this.handlers.get(collection) !== handlers || !this.operationIsCurrent(namespace, generation, epoch) ||
        !this.isReady() || this.disabledCollections.has(collection)) return false;
      const rawCheckpoint = await storage.getItem(checkpointStorageKey(namespace, collection));
      if (!this.operationIsCurrent(namespace, generation, epoch)) return false;
      let checkpoint: SyncCheckpoint | undefined;
      if (rawCheckpoint) {
        try {
          const parsed = JSON.parse(rawCheckpoint) as SyncCheckpoint;
          if (typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) checkpoint = parsed;
        } catch { /* A corrupt checkpoint behaves like an initial pull. */ }
      }
      while (this.operationIsCurrent(namespace, generation, epoch) && this.isReady() && !this.disabledCollections.has(collection)) {
        localOperation = false;
        const result = await this.pull(collection, checkpoint, 50, { namespace, generation });
        if (!this.operationIsCurrent(namespace, generation, epoch) || this.handlers.get(collection) !== handlers) return false;
        localOperation = true;
        handlers.onDocuments(result.documents, result);
        this.receivedDocuments += result.documents.length;
        this.publishStatus();
        if (result.checkpoint) {
          checkpoint = result.checkpoint;
          await storage.setItem(checkpointStorageKey(namespace, collection), JSON.stringify(checkpoint));
          if (!this.operationIsCurrent(namespace, generation, epoch)) return false;
        }
        this.publishStatus();
        if (!result.hasMoreDocuments) {
          this.statusErrors.delete(`pull:${collection}`);
          return true;
        }
      }
    } catch {
      if (this.operationIsCurrent(namespace, generation, epoch) && this.isReady()) {
        this.statusErrors.set(`pull:${collection}`, localOperation ? 'local' : 'download');
        this.publishStatus();
      }
    }
    return false;
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return;
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    const collection = isCollection(message.collection) ? message.collection : undefined;
    const event = message.event;
    if (
      event === 'collection_changed' ||
      event === 'collectionChanged' ||
      event === 'sync_required'
    ) {
      if (collection && !this.disabledCollections.has(collection))
        void this.resyncCollection(collection);
      else void this.resync();
      return;
    }
    if (event === 'error' || event === 'sync_error') {
      const nestedError =
        message.error && typeof message.error === 'object'
          ? (message.error as Record<string, unknown>).code
          : undefined;
      this.resolvePending(
        typeof message.requestId === 'string'
          ? message.requestId
          : collection ? this.collectionFallbackRequests.get(collection)?.[0] ?? '' : '',
        message,
        new Error(String(message.code || nestedError || 'SYNC_SERVER_ERROR')),
      );
      return;
    }
    const pendingId =
      typeof message.requestId === 'string'
        ? message.requestId
        : collection
          ? this.collectionFallbackRequests.get(collection)?.[0]
          : undefined;
    if (pendingId) this.resolvePending(pendingId, message);
  }

  private request<T>(
    requestId: string,
    collection: SyncCollection,
    payload: Record<string, unknown>,
    parse: (message: ServerMessage) => T,
    namespace = this.namespace,
    generation = this.namespaceGeneration,
  ): Promise<T> {
    if (!this.isReady() || !this.isCurrent(namespace, generation)) return Promise.reject(new Error('SYNC_OFFLINE'));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.removeFallbackId(collection, requestId);
        reject(new Error('SYNC_TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        collection,
        namespace,
        generation,
        connectionEpoch: this.connectionEpoch,
        timer,
        resolve: (value) => resolve(value as T),
        reject,
      });
      const fallback = this.collectionFallbackRequests.get(collection) ?? [];
      fallback.push(requestId);
      this.collectionFallbackRequests.set(collection, fallback);
      try {
        this.ws!.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        this.removeFallbackId(collection, requestId);
        reject(error);
      }
      // Store parser alongside the resolver without widening public state.
      (this.pending.get(requestId) as PendingRequest<T> & { parse?: (message: ServerMessage) => T }).parse = parse;
    });
  }

  private resolvePending(requestId: string, message: ServerMessage, error?: Error): void {
    const pending = this.pending.get(requestId) as (PendingRequest<unknown> & { parse?: (message: ServerMessage) => unknown }) | undefined;
    if (!pending) return;
    if (!this.operationIsCurrent(pending.namespace, pending.generation, pending.connectionEpoch)) {
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      this.removeFallbackId(pending.collection, requestId);
      pending.reject(new Error('SYNC_NAMESPACE_CHANGED'));
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    this.removeFallbackId(pending.collection, requestId);
    if (error) {
      pending.reject(error);
      return;
    }
    try {
      pending.resolve(pending.parse ? pending.parse(message) : message);
    } catch (parseError) {
      pending.reject(parseError);
    }
  }

  private async loadOutbox(): Promise<void> {
    const namespace = this.namespace;
    const generation = this.namespaceGeneration;
    if (this.outboxLoadedFor === namespace) return;
    if (this.outboxLoad?.namespace === namespace && this.outboxLoad.generation === generation) return this.outboxLoad.promise;
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const raw = await storage.getItem(outboxStorageKey(namespace));
        if (!this.isCurrent(namespace, generation)) return;
        const loaded = new Map<string, OutboxEntry>();
        if (raw) {
          const entries: unknown = JSON.parse(raw);
          if (!Array.isArray(entries)) throw new Error('SYNC_INVALID_OUTBOX');
          for (const entry of entries) {
            if (!entry || !isCollection(entry.collection) || !isSyncDocument(entry.collection, entry.document))
              throw new Error('SYNC_INVALID_OUTBOX');
            loaded.set(`${entry.collection}:${entry.document.id}`, entry);
          }
        }
        this.outbox = loaded;
        this.outboxLoadedFor = namespace;
        this.statusErrors.delete('outbox');
      } catch (error) {
        if (this.isCurrent(namespace, generation)) this.statusErrors.set('outbox', 'local');
        throw error;
      } finally {
        if (this.outboxLoad?.promise === promise) {
          this.outboxLoad = null;
          this.publishStatus();
        }
      }
    })();
    this.outboxLoad = { namespace, generation, promise };
    this.publishStatus();
    return promise;
  }

  private async persistOutbox(): Promise<void> {
    const namespace = this.namespace;
    const generation = this.namespaceGeneration;
    try {
      await storage.setItem(outboxStorageKey(namespace), JSON.stringify(Array.from(this.outbox.values())));
    } catch (error) {
      // An acknowledged entry may still exist on disk. Require a fresh owner
      // hydration before a retry can claim the queue has been drained; resending
      // that same document uses the existing idempotent push/conflict contract.
      if (this.isCurrent(namespace, generation)) this.outboxLoadedFor = '';
      throw error;
    }
  }

  private async flushOutbox(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    const namespace = this.namespace;
    const generation = this.namespaceGeneration;
    const epoch = this.connectionEpoch;
    this.flushPromise = (async () => {
      try { await this.loadOutbox(); } catch { return; }
      if (!this.operationIsCurrent(namespace, generation, epoch) || !this.isReady() || this.outbox.size === 0) return;
      for (const collection of SYNC_COLLECTIONS) {
        if (!this.operationIsCurrent(namespace, generation, epoch)) return;
        if (this.disabledCollections.has(collection)) continue;
        const entries = Array.from(this.outbox.values()).filter((entry) => entry.collection === collection);
        if (!entries.length) continue;
        let localOperation = false;
        try {
          const result = await this.push(collection, entries.map((entry) => ({ newDocumentState: entry.document })));
          if (!this.operationIsCurrent(namespace, generation, epoch)) return;
          localOperation = true;
          this.handlers.get(collection)?.onPushConflicts?.(result.conflicts);
          if (result.invalidConflict) {
            this.statusErrors.set(`push:${collection}`, 'upload');
            return;
          }
          if (result.rejections.length) this.statusErrors.set(`push:${collection}`, 'upload');
          const rejectedDocuments = result.rejections.map((rejection) => ({
            document: entries[rejection.index].document,
            previousDocument: entries[rejection.index].previousDocument,
            code: rejection.code,
            message: rejection.message,
          }));
          if (rejectedDocuments.length)
            this.handlers.get(collection)?.onPushRejected?.(rejectedDocuments);
          for (const entry of entries) {
            const current = this.outbox.get(`${collection}:${entry.document.id}`);
            if (current?.document.updatedAt === entry.document.updatedAt) this.outbox.delete(`${collection}:${entry.document.id}`);
          }
          await this.persistOutbox();
        } catch {
          if (this.operationIsCurrent(namespace, generation, epoch) && this.isReady()) this.statusErrors.set(`push:${collection}`, localOperation ? 'local' : 'upload');
          return;
        }
      }
    })().finally(() => {
      this.flushPromise = null;
      if (this.flushAfterCurrent) {
        this.flushAfterCurrent = false;
        if (this.isReady() && this.outbox.size > 0) void this.flushOutbox();
      }
      this.publishStatus();
    });
    this.publishStatus();
    return this.flushPromise;
  }

  private scheduleReconnect(delay?: number): void {
    if (this.closedByUser || !this.accessToken || this.expiredToken === this.accessToken || this.reconnectTimer) return;
    const wait = delay ?? Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  private isReady(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && (WS_AUTH_MODE !== 'application' || this.ready);
  }

  private clearAuthTimer(): void {
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private removeFallbackId(collection: SyncCollection, requestId: string): void {
    const ids = this.collectionFallbackRequests.get(collection);
    if (!ids) return;
    const next = ids.filter((id) => id !== requestId);
    if (next.length) this.collectionFallbackRequests.set(collection, next);
    else this.collectionFallbackRequests.delete(collection);
  }

  private isCurrent(namespace: string, generation: number): boolean {
    return this.namespace === namespace && this.namespaceGeneration === generation;
  }

  private cancelPending(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestId);
    }
    this.collectionFallbackRequests.clear();
  }
}

export const syncClient = new SyncClient();
