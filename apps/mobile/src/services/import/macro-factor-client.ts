import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { MacroFactorDocumentPlan, MacroFactorRow } from './macro-factor';

type AuthorizedFetch = (path: string, init?: RequestInit) => Promise<Response>;

interface ApiEnvelope<T> {
  data?: T | null;
  error?: { message?: string } | null;
}

export interface ImportSummary {
  templates: {
    created: number;
    updated: number;
    deleted: number;
    unchanged: number;
  };
  logs: {
    created: number;
    updated: number;
    deleted: number;
    unchanged: number;
  };
}

interface SessionStatus {
  sessionId: string;
  receivedRows: number;
}

async function jsonRequest<T>(authorizedFetch: AuthorizedFetch, path: string, init: RequestInit): Promise<T> {
  const response = await authorizedFetch(path, init);
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? `El servidor rechazó la importación (${response.status})`);
  }
  return payload.data;
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function macroFactorFingerprint(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes).buffer;
  return toHex(await digest(CryptoDigestAlgorithm.SHA256, input));
}

export async function uploadMacroFactorImport(
  authorizedFetch: AuthorizedFetch,
  fingerprint: string,
  rows: MacroFactorRow[],
  plan: MacroFactorDocumentPlan,
  onProgress: (completed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ImportSummary> {
  const logs = plan.logs.filter((document) => !document._deleted).slice(0, rows.length);
  if (logs.length !== rows.length) throw new Error('El plan de importación no coincide con las filas válidas');
  const templates = plan.templates.filter((document) => !document._deleted);
  const operationId = randomUUID();
  const session = await jsonRequest<SessionStatus>(authorizedFetch, '/imports/macrofactor', {
    method: 'POST',
    body: JSON.stringify({
      operationId,
      fileFingerprint: fingerprint,
      expectedRows: logs.length,
      templates,
    }),
    signal,
  });

  try {
    for (let offset = session.receivedRows; offset < logs.length; offset += 250) {
      const end = Math.min(offset + 250, logs.length);
      const stagedRows = logs.slice(offset, end).map((document, index) => ({
        rowIndex: rows[offset + index].rowIndex,
        document,
      }));
      await jsonRequest<SessionStatus>(authorizedFetch, `/imports/macrofactor/${session.sessionId}/chunks`, {
        method: 'PUT',
        body: JSON.stringify({ rows: stagedRows }),
        signal,
      });
      onProgress(end, logs.length);
    }
    return await jsonRequest<ImportSummary>(authorizedFetch, `/imports/macrofactor/${session.sessionId}/commit`, {
      method: 'POST',
      signal,
    });
  } catch (error) {
    await authorizedFetch(`/imports/macrofactor/${session.sessionId}`, {
      method: 'DELETE',
    }).catch(() => undefined);
    throw error;
  }
}
