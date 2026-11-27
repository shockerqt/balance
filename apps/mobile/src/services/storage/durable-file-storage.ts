import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

let directoryReady: Promise<void> | undefined;

function ensureDirectory(directory: string): Promise<void> {
  if (!directoryReady) {
    // Android's legacy mkdir can race when separate keys first create one dir.
    const creating = FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    directoryReady = creating;
    void creating.catch(() => { if (directoryReady === creating) directoryReady = undefined; });
  }
  return directoryReady;
}

// The storage adapter remains the sole owner. Hashes keep paths bounded and
// avoid exposing namespaces; values/tombstones share one durable file format.
async function itemPath(key: string): Promise<string> {
  if (!FileSystem.documentDirectory) throw new Error('SYNC_STORAGE_UNAVAILABLE');
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
  return `${FileSystem.documentDirectory}balance-sync-v1/${hash}.json`;
}

export async function readDurableItem(key: string): Promise<{ exists: boolean; value: string | null }> {
  const path = await itemPath(key);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return { exists: false, value: null };
  const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(path));
  if (!parsed || typeof parsed !== 'object') throw new Error('SYNC_STORAGE_INVALID');
  const envelope = parsed as { version?: unknown; value?: unknown };
  if (envelope.version !== 1 || (envelope.value !== null && typeof envelope.value !== 'string')) {
    throw new Error('SYNC_STORAGE_INVALID');
  }
  return { exists: true, value: envelope.value };
}

async function writeEncodedFile(key: string, encoded: string): Promise<void> {
  const path = await itemPath(key);
  const directory = path.slice(0, path.lastIndexOf('/') + 1);
  await ensureDirectory(directory);
  if (Platform.OS === 'ios') {
    // SDK57's installed iOS legacy writer uses Data.write(options: .atomic).
    // Its moveAsync deletes the destination first, so do not use that route.
    await FileSystem.writeAsStringAsync(path, encoded, { encoding: FileSystem.EncodingType.UTF8, append: false });
    return;
  }
  const temporary = `${path}.${Crypto.randomUUID()}.tmp`;
  try {
    await FileSystem.writeAsStringAsync(temporary, encoded, { encoding: FileSystem.EncodingType.UTF8, append: false });
    // Android's installed file:// move uses renameTo, on this same filesystem.
    await FileSystem.moveAsync({ from: temporary, to: path });
  } finally {
    await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
  }
}

export async function writeDurableItem(key: string, value: string | null): Promise<void> {
  await writeEncodedFile(key, JSON.stringify({ version: 1, value }));
}

export async function readDurableJson<T>(key: string): Promise<{ exists: boolean; value: T | null }> {
  const path = await itemPath(key);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return { exists: false, value: null };
  const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(path));
  return { exists: true, value: (parsed ?? null) as T | null };
}

export async function writeDurableJson<T>(key: string, value: T | null): Promise<void> {
  await writeEncodedFile(key, JSON.stringify(value));
}

export async function deleteDurableItem(key: string): Promise<void> {
  const path = await itemPath(key);
  await FileSystem.deleteAsync(path, { idempotent: true });
}
