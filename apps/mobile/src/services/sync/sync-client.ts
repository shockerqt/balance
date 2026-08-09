import { AppState, AppStateStatus } from 'react-native';
import { WS_SYNC_URL } from '@/services/config';
import { accessTokenChanged } from '@/services/auth/session-state';
import { storage } from '@/services/storage';
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
  private accessToken: string | null = null;
  private namespace = 'guest';
  private namespaceGeneration = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
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
    this.namespace = next;
    this.namespaceGeneration += 1;
    this.cancelPending(new Error('SYNC_NAMESPACE_CHANGED'));
    this.resyncs.clear();
    if (this.flushPromise) this.flushAfterCurrent = true;
    this.outbox = new Map();
    this.outboxLoadedFor = '';
    void this.loadOutbox();
  }

  registerCollection(collection: SyncCollection, nextHandlers: CollectionHandlers, ready?: Promise<void>): () => void {
    this.handlers.set(collection, nextHandlers);
    if (!this.disabledCollections.has(collection)) void this.resyncCollection(collection, ready);
    return () => {
      if (this.handlers.get(collection) === nextHandlers) this.handlers.delete(collection);
    };
  }

  setCollectionEnabled(collection: SyncCollection, enabled: boolean): void {
    if (collection === 'userPreferences') return;
    if (!enabled) {
      this.disabledCollections.add(collection);
      return;
    }
    if (!this.disabledCollections.delete(collection)) return;
    void this.resyncCollection(collection);
    void this.flushOutbox();
  }

  connect(accessToken?: string, namespace?: string): void {
    const reconnectForToken = accessTokenChanged(this.accessToken, accessToken);
    if (accessToken) this.accessToken = accessToken;
    if (namespace) this.setNamespace(namespace);
    this.closedByUser = false;
    if (!this.accessToken) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (reconnectForToken) {
        this.clearReconnectTimer();
        this.cancelPending(new Error('SYNC_ACCESS_TOKEN_CHANGED'));
        this.ws.close();
      }
      return;
    }

    this.clearReconnectTimer();
    try {
      const socket = new WebSocket(WS_SYNC_URL, ['balance', `balance.bearer.${this.accessToken}`]);
      this.ws = socket;
      socket.onopen = () => {
        this.reconnectAttempt = 0;
        void this.resync();
        void this.flushOutbox();
      };
      socket.onmessage = (event) => {
        void this.handleMessage(event.data);
      };
      socket.onerror = () => {
        // onclose schedules the reconnect; avoid logging tokens or payloads.
      };
      socket.onclose = () => {
        // A late close from a replaced socket must not erase its successor.
        if (this.ws !== socket) return;
        this.ws = null;
        if (!this.closedByUser) this.scheduleReconnect();
      };
    } catch {
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.closedByUser = true;
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
  }

  async pull(collection: SyncCollection, checkpoint?: SyncCheckpoint, limit = 50, expected?: { namespace: string; generation: number }): Promise<PullResult> {
    if (this.disabledCollections.has(collection)) throw new Error('SYNC_COLLECTION_DISABLED');
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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
        const documents = Array.isArray(message.documents)
          ? message.documents.filter((doc) => isSyncDocument(collection, doc))
          : [];
        const checkpointValue = message.checkpoint;
        const nextCheckpoint = checkpointValue && typeof checkpointValue === 'object'
            ? {
                updatedAt: Number((checkpointValue as Record<string, unknown>).updatedAt),
              id: typeof (checkpointValue as Record<string, unknown>).id === 'string'
                ? (checkpointValue as Record<string, unknown>).id as string
                : undefined,
              }
            : null;
        return {
          documents,
          checkpoint: nextCheckpoint && Number.isFinite(nextCheckpoint.updatedAt) ? nextCheckpoint : null,
          hasMoreDocuments: message.hasMoreDocuments === true || message.has_more_documents === true,
        };
      },
      namespace,
      generation,
    );
    return result;
  }

  async push(collection: SyncCollection, rows: { newDocumentState: SyncDocument }[]): Promise<PushResult> {
    if (this.disabledCollections.has(collection)) throw new Error('SYNC_COLLECTION_DISABLED');
    if (!rows.length) return { conflicts: [], invalidConflict: false, rejections: [] };
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('SYNC_OFFLINE');
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
    const previous = this.enqueueChains.get(namespace) ?? Promise.resolve();
    const operation = previous.then(async () => {
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
        void this.flushOutbox();
      }
    });
    this.enqueueChains.set(namespace, operation.catch(() => undefined));
    await operation;
  }

  async resync(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    await Promise.all(
      Array.from(this.handlers.keys())
        .filter((collection) => !this.disabledCollections.has(collection))
        .map((collection) => this.resyncCollection(collection))
    );
  }

  async resyncCollection(collection: SyncCollection, ready?: Promise<void>): Promise<void> {
    if (this.disabledCollections.has(collection)) return;
    const current = this.resyncs.get(collection);
    if (current) return current;
    const namespace = this.namespace;
    const generation = this.namespaceGeneration;
    const operation = this.performResync(collection, namespace, generation, ready).finally(() => {
      if (this.resyncs.get(collection) === operation) this.resyncs.delete(collection);
    });
    this.resyncs.set(collection, operation);
    return operation;
  }

  async resetCollection(collection: SyncCollection): Promise<void> {
    await storage.removeItem(checkpointStorageKey(this.namespace, collection));
    await this.resyncCollection(collection);
  }

  private async performResync(collection: SyncCollection, namespace: string, generation: number, ready?: Promise<void>): Promise<void> {
    if (ready) await ready;
    if (!this.isCurrent(namespace, generation) || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const rawCheckpoint = await storage.getItem(checkpointStorageKey(namespace, collection));
    let checkpoint: SyncCheckpoint | undefined;
    if (rawCheckpoint) {
      try {
        const parsed = JSON.parse(rawCheckpoint) as SyncCheckpoint;
        if (typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) checkpoint = parsed;
      } catch {
        // A corrupt checkpoint behaves like an initial pull.
      }
    }
    let hasMore = true;
    while (hasMore && this.isCurrent(namespace, generation)) {
      try {
        const result = await this.pull(collection, checkpoint, 50, { namespace, generation });
        if (!this.isCurrent(namespace, generation)) return;
        this.handlers.get(collection)?.onDocuments(result.documents, result);
        if (result.checkpoint) {
          checkpoint = result.checkpoint;
          await storage.setItem(checkpointStorageKey(namespace, collection), JSON.stringify(checkpoint));
        }
        hasMore = result.hasMoreDocuments && result.documents.length > 0;
      } catch {
        return;
      }
    }
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
      const nestedError = message.error && typeof message.error === 'object'
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
    const pendingId = typeof message.requestId === 'string'
        ? message.requestId
      : collection ? this.collectionFallbackRequests.get(collection)?.[0] : undefined;
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
        timer,
        resolve: (value) => resolve(value as T),
        reject,
      });
      const fallback = this.collectionFallbackRequests.get(collection) ?? [];
      fallback.push(requestId);
      this.collectionFallbackRequests.set(collection, fallback);
      try {
        this.ws?.send(JSON.stringify(payload));
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
    if (!this.isCurrent(pending.namespace, pending.generation)) {
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
    const raw = await storage.getItem(outboxStorageKey(namespace));
    if (!this.isCurrent(namespace, generation)) return;
    this.outboxLoadedFor = namespace;
    const loaded = new Map<string, OutboxEntry>();
    if (!raw) return;
    try {
      const entries = JSON.parse(raw) as OutboxEntry[];
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (isCollection(entry.collection) && isSyncDocument(entry.collection, entry.document)) {
            loaded.set(`${entry.collection}:${entry.document.id}`, entry);
          }
        }
      }
      this.outbox = loaded;
    } catch {
      this.outbox.clear();
    }
  }

  private async persistOutbox(): Promise<void> {
    await storage.setItem(outboxStorageKey(this.namespace), JSON.stringify(Array.from(this.outbox.values())));
  }

  private async flushOutbox(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    const namespace = this.namespace;
    const generation = this.namespaceGeneration;
    this.flushPromise = (async () => {
      await this.loadOutbox();
      if (!this.isCurrent(namespace, generation) || !this.ws || this.ws.readyState !== WebSocket.OPEN || this.outbox.size === 0) return;
      for (const collection of SYNC_COLLECTIONS) {
        if (!this.isCurrent(namespace, generation)) return;
        if (this.disabledCollections.has(collection)) continue;
        const entries = Array.from(this.outbox.values()).filter((entry) => entry.collection === collection);
        if (!entries.length) continue;
        try {
          const result = await this.push(collection, entries.map((entry) => ({ newDocumentState: entry.document })));
          if (!this.isCurrent(namespace, generation)) return;
          this.handlers.get(collection)?.onPushConflicts?.(result.conflicts);
          if (result.invalidConflict) return;
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
          return;
        }
      }
    })().finally(() => {
      this.flushPromise = null;
      if (this.flushAfterCurrent) {
        this.flushAfterCurrent = false;
        if (this.ws?.readyState === WebSocket.OPEN && this.outbox.size > 0) void this.flushOutbox();
      }
    });
    return this.flushPromise;
  }

  private scheduleReconnect(delay?: number): void {
    if (this.closedByUser || !this.accessToken || this.reconnectTimer) return;
    const wait = delay ?? Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
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
