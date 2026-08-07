import { WS_SYNC_URL } from '@/services/config';
// Cliente de sincronizacion por WebSocket contra el backend de Balance.
// (No usa RxDB pese al nombre que tenia la carpeta: es un protocolo propio.)


export interface SyncCheckpoint {
  updatedAt: number;
  id?: string;
}

export interface SyncDocument {
  id: string;
  updatedAt: number;
  _deleted?: boolean;
  [key: string]: any;
}

export class RxDBSyncClient {
  private ws: WebSocket | null = null;
  private accessToken: string | null = null;
  private isConnected = false;
  private pendingPulls: Map<string, (data: any) => void> = new Map();
  private pendingPushes: Map<string, (conflicts: any[]) => void> = new Map();

  connect(accessToken?: string) {
    if (accessToken) this.accessToken = accessToken;
    if (!this.accessToken) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_SYNC_URL, ['balance', `balance.bearer.${this.accessToken}`]);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('[RxDB Sync] Connected to WebSocket server');
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'pull_response') {
            const cb = this.pendingPulls.get(data.collection);
            if (cb) cb(data);
          } else if (data.event === 'push_response') {
            const cb = this.pendingPushes.get(data.collection);
            if (cb) cb(data.conflicts || []);
          }
        } catch (e) {
          console.error('[RxDB Sync] Failed to parse message', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('[RxDB Sync] WebSocket disconnected, reconnecting in 5s...');
        setTimeout(() => this.connect(), 5000);
      };

      this.ws.onerror = (e) => {
        console.warn('[RxDB Sync] WebSocket error', e);
      };
    } catch (e) {
      console.warn('[RxDB Sync] Connection failed', e);
    }
  }

  disconnect() {
    this.accessToken = null;
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
  }

  async pull(collection: string, checkpoint?: SyncCheckpoint, limit: number = 50): Promise<{
    documents: SyncDocument[];
    checkpoint: SyncCheckpoint | null;
    hasMoreDocuments: boolean;
  }> {
    if (!this.isConnected || !this.ws) {
      return { documents: [], checkpoint: null, hasMoreDocuments: false };
    }

    return new Promise((resolve) => {
      this.pendingPulls.set(collection, (res) => {
        resolve({
          documents: res.documents || [],
          checkpoint: res.checkpoint || null,
          hasMoreDocuments: res.hasMoreDocuments || false,
        });
      });

      this.ws?.send(
        JSON.stringify({
          event: 'pull',
          collection,
          checkpoint,
          limit,
        })
      );
    });
  }

  async push(collection: string, rows: { newDocumentState: SyncDocument }[]): Promise<SyncDocument[]> {
    if (!this.isConnected || !this.ws || rows.length === 0) {
      return [];
    }

    return new Promise((resolve) => {
      this.pendingPushes.set(collection, (conflicts) => {
        resolve(conflicts || []);
      });

      this.ws?.send(
        JSON.stringify({
          event: 'push',
          collection,
          rows,
        })
      );
    });
  }
}

export const syncClient = new RxDBSyncClient();
