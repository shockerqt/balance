import { getDashboardServiceConfig } from '../../../services/config.ts';
import {
  isMealLogDoc,
  isMealTemplateDoc,
  type MealLogDoc,
  type MealTemplateDoc,
} from '../../../types/meal-log.ts';

const REQUEST_TIMEOUT_MS = 12_000;
const PULL_LIMIT = 200;
const PUSH_BATCH_SIZE = 100;

type SyncCollection = 'mealTemplates' | 'mealLogs';

interface SyncCheckpoint {
  updatedAt: number;
  id?: string;
}

interface PullPage<T> {
  documents: T[];
  checkpoint: SyncCheckpoint | null;
  hasMoreDocuments: boolean;
}

interface PushResponse {
  conflicts: MealLogDoc[];
  rejectedIndexes: number[];
}

interface PendingRequest {
  collection: SyncCollection;
  resolve: (message: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: number;
}

export type RemotePersistencePhase = 'connecting' | 'syncing' | 'synced' | 'offline' | 'error';

export interface RemotePersistenceState {
  phase: RemotePersistencePhase;
  ready: boolean;
  pending: number;
  error: string | null;
}

export interface RemoteFoodLogRepositoryHandlers {
  onMealLogs: (documents: MealLogDoc[], mode: 'replace' | 'merge') => void;
  onMealTemplates: (documents: MealTemplateDoc[], mode: 'replace' | 'merge') => void;
  onState: (state: RemotePersistenceState) => void;
}

function requestId(): string {
  return `dashboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parseCheckpoint(value: unknown): SyncCheckpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const checkpoint = value as Record<string, unknown>;
  if (typeof checkpoint.updatedAt !== 'number' || !Number.isFinite(checkpoint.updatedAt)) return null;
  return {
    updatedAt: checkpoint.updatedAt,
    ...(typeof checkpoint.id === 'string' ? { id: checkpoint.id } : {}),
  };
}

function errorMessage(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Remote sync failed';
  const object = value as Record<string, unknown>;
  if (typeof object.message === 'string' && object.message) return object.message;
  const nested = object.error;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'Remote sync failed';
}

export class RemoteFoodLogRepository {
  private readonly handlers: RemoteFoodLogRepositoryHandlers;
  private readonly wsUrl: string;
  private socket: WebSocket | null = null;
  private accessToken: string | null = null;
  private stopped = false;
  private hasInitialSync = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private checkpoints = new Map<SyncCollection, SyncCheckpoint>();
  private resyncs = new Map<SyncCollection, Promise<void>>();
  private outbox = new Map<string, MealLogDoc>();
  private flushPromise: Promise<void> | null = null;
  private state: RemotePersistenceState = {
    phase: 'connecting',
    ready: false,
    pending: 0,
    error: null,
  };

  constructor(handlers: RemoteFoodLogRepositoryHandlers) {
    this.handlers = handlers;
    this.wsUrl = getDashboardServiceConfig().wsSyncUrl;
    this.handlers.onState(this.state);
  }

  getState(): RemotePersistenceState {
    return this.state;
  }

  connect(accessToken: string): void {
    const changedToken = this.accessToken !== accessToken;
    this.accessToken = accessToken;
    this.stopped = false;
    if (!changedToken && this.socket && (
      this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING
    )) return;

    this.clearReconnectTimer();
    if (this.socket) {
      const previous = this.socket;
      this.socket = null;
      previous.close();
    }
    this.rejectPending(new Error('SYNC_RECONNECT'));
    this.setState({ phase: 'connecting', error: null });
    this.openSocket();
  }

  disconnect(): void {
    this.stopped = true;
    this.accessToken = null;
    this.clearReconnectTimer();
    this.rejectPending(new Error('SYNC_DISCONNECTED'));
    if (this.socket) {
      const previous = this.socket;
      this.socket = null;
      previous.close();
    }
  }

  pushMealLogs(documents: MealLogDoc[]): void {
    for (const document of documents) this.outbox.set(document.id, document);
    this.setState({ phase: this.state.ready ? 'syncing' : this.state.phase, error: null });
    void this.flushOutbox();
  }

  private openSocket(): void {
    if (this.stopped || !this.accessToken) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.wsUrl, ['balance', `balance.bearer.${this.accessToken}`]);
    } catch {
      this.setState({ phase: 'offline', error: null });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.setState({ phase: 'syncing', error: null });
      void this.afterOpen();
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.handleMessage(event.data);
    };
    socket.onerror = () => {
      // onclose owns reconnect and status transitions. Never log bearer protocols.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.rejectPending(new Error('SYNC_OFFLINE'));
      if (this.stopped) return;
      this.setState({ phase: 'offline', error: null });
      this.scheduleReconnect();
    };
  }

  private async afterOpen(): Promise<void> {
    try {
      if (!this.hasInitialSync) {
        const [templates, logs] = await Promise.all([
          this.pullAll<MealTemplateDoc>('mealTemplates', true),
          this.pullAll<MealLogDoc>('mealLogs', true),
        ]);
        this.handlers.onMealTemplates(templates, 'replace');
        this.handlers.onMealLogs(logs, 'replace');
        this.hasInitialSync = true;
        this.setState({ ready: true, phase: 'syncing', error: null });
      } else {
        await Promise.all([this.resyncCollection('mealTemplates'), this.resyncCollection('mealLogs')]);
      }
      await this.flushOutbox();
      if (!this.outbox.size) this.setState({ phase: 'synced', ready: true, error: null });
    } catch (syncError) {
      if (this.stopped) return;
      this.setState({
        phase: this.socket?.readyState === WebSocket.OPEN ? 'error' : 'offline',
        error: syncError instanceof Error ? syncError.message : 'Remote sync failed',
      });
    }
  }

  private async pullAll<T extends MealTemplateDoc | MealLogDoc>(
    collection: SyncCollection,
    resetCheckpoint: boolean,
  ): Promise<T[]> {
    if (resetCheckpoint) this.checkpoints.delete(collection);
    let checkpoint = this.checkpoints.get(collection) ?? null;
    const documents: T[] = [];
    let hasMore = true;

    while (hasMore) {
      const page = await this.pullPage<T>(collection, checkpoint);
      documents.push(...page.documents);
      checkpoint = page.checkpoint ?? checkpoint;
      if (page.checkpoint) this.checkpoints.set(collection, page.checkpoint);
      hasMore = page.hasMoreDocuments && page.documents.length > 0;
    }
    return documents;
  }

  private async pullPage<T extends MealTemplateDoc | MealLogDoc>(
    collection: SyncCollection,
    checkpoint: SyncCheckpoint | null,
  ): Promise<PullPage<T>> {
    const message = await this.request(collection, {
      event: 'pull',
      checkpoint,
      limit: PULL_LIMIT,
    });
    const values = Array.isArray(message.documents) ? message.documents : [];
    const documents = values.filter((value): value is T => (
      collection === 'mealLogs' ? isMealLogDoc(value) : isMealTemplateDoc(value)
    ));
    return {
      documents,
      checkpoint: parseCheckpoint(message.checkpoint),
      hasMoreDocuments: message.hasMoreDocuments === true || message.has_more_documents === true,
    };
  }

  private resyncCollection(collection: SyncCollection): Promise<void> {
    const current = this.resyncs.get(collection);
    if (current) return current;
    const operation = (async () => {
      const documents = await this.pullAll<MealLogDoc | MealTemplateDoc>(collection, false);
      if (!documents.length) return;
      if (collection === 'mealLogs') {
        this.handlers.onMealLogs(documents.filter(isMealLogDoc), 'merge');
      } else {
        this.handlers.onMealTemplates(documents.filter(isMealTemplateDoc), 'merge');
      }
    })().finally(() => {
      if (this.resyncs.get(collection) === operation) this.resyncs.delete(collection);
    });
    this.resyncs.set(collection, operation);
    return operation;
  }

  private flushOutbox(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (!this.hasInitialSync || !this.socket || this.socket.readyState !== WebSocket.OPEN || !this.outbox.size) {
      return Promise.resolve();
    }

    const operation = (async () => {
      while (this.socket?.readyState === WebSocket.OPEN && this.outbox.size) {
        const batch = Array.from(this.outbox.values()).slice(0, PUSH_BATCH_SIZE);
        this.setState({ phase: 'syncing', error: null });
        const response = await this.pushBatch(batch);

        const rejected = new Set(response.rejectedIndexes);
        for (const [index, document] of batch.entries()) {
          const queued = this.outbox.get(document.id);
          if (queued?.updatedAt === document.updatedAt) this.outbox.delete(document.id);
          if (rejected.has(index)) continue;
        }
        if (response.conflicts.length) this.handlers.onMealLogs(response.conflicts, 'merge');
        if (rejected.size) {
          await this.resyncCollection('mealLogs');
          throw new Error(`${rejected.size} meal mutation${rejected.size === 1 ? '' : 's'} rejected by server`);
        }
        await this.resyncCollection('mealLogs');
        this.setState({ pending: this.outbox.size });
      }
    })();
    this.flushPromise = operation;
    return operation.finally(() => {
      if (this.flushPromise === operation) this.flushPromise = null;
      if (!this.outbox.size && this.state.ready && this.socket?.readyState === WebSocket.OPEN) {
        this.setState({ phase: 'synced', error: null });
      }
    });
  }

  private async pushBatch(documents: MealLogDoc[]): Promise<PushResponse> {
    const message = await this.request('mealLogs', {
      event: 'push',
      rows: documents.map((document) => ({ newDocumentState: document })),
    });
    if (!Array.isArray(message.conflicts)) throw new Error('Invalid meal sync conflict response');
    const conflicts = message.conflicts.filter(isMealLogDoc);
    if (conflicts.length !== message.conflicts.length) throw new Error('Invalid meal sync conflict document');

    const rejectedIndexes: number[] = [];
    if (message.rejections !== undefined) {
      if (!Array.isArray(message.rejections)) throw new Error('Invalid meal sync rejection response');
      for (const value of message.rejections) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid meal sync rejection');
        const index = (value as Record<string, unknown>).index;
        if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= documents.length) {
          throw new Error('Invalid meal sync rejection index');
        }
        rejectedIndexes.push(Number(index));
      }
    }
    return { conflicts, rejectedIndexes };
  }

  private request(collection: SyncCollection, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('SYNC_OFFLINE'));
    const id = requestId();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`SYNC_TIMEOUT:${collection}`));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(id, { collection, resolve, reject, timer });
      socket.send(JSON.stringify({ ...payload, requestId: id, collection }));
    });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const event = typeof message.event === 'string' ? message.event : '';
    const collection = message.collection === 'mealLogs' || message.collection === 'mealTemplates'
      ? message.collection
      : null;

    if (event === 'collection_changed' || event === 'collectionChanged' || event === 'sync_required') {
      if (this.hasInitialSync && collection) void this.resyncCollection(collection);
      return;
    }

    const id = typeof message.requestId === 'string' ? message.requestId : '';
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    if (collection && collection !== pending.collection) return;

    if (event === 'error' || event === 'sync_error') {
      this.pendingRequests.delete(id);
      window.clearTimeout(pending.timer);
      pending.reject(new Error(errorMessage(message)));
      return;
    }
    if (event !== 'pull_response' && event !== 'pullResponse' && event !== 'push_response' && event !== 'pushResponse') return;
    this.pendingRequests.delete(id);
    window.clearTimeout(pending.timer);
    pending.resolve(message);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null || !this.accessToken) return;
    const delay = Math.min(15_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(patch: Partial<RemotePersistenceState>): void {
    this.state = {
      ...this.state,
      ...patch,
      pending: patch.pending ?? this.outbox.size,
    };
    this.handlers.onState(this.state);
  }
}
