import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { readDurableItem, writeDurableItem } from './storage/durable-file-storage';

/* ============================================================
   Almacenamiento local con degradacion.

   Estaba definido dentro de use-meal-store y hacia `require()` en
   cada llamada. Ahora se importa una vez y lo comparten el store, el
   tema y la sesion.

   Orden: AsyncStorage (nativo) -> localStorage (web) -> memoria.
   ============================================================ */

const memory = new Map<string, string>();
const durableKeys = new Set<string>();
const operations = new Map<string, Promise<void>>();
const isSyncKey = (key: string) => key.startsWith('@balance_sync_collection_v2:') ||
  key.startsWith('@balance_sync_checkpoint_v2:') || key.startsWith('@balance_sync_outbox_v2:');
const isCollectionKey = (key: string) => key.startsWith('@balance_sync_collection_v2:');

function ordered<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (operations.get(key) ?? Promise.resolve()).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  operations.set(key, tail);
  void tail.then(() => { if (operations.get(key) === tail) operations.delete(key); });
  return result;
}

const webStorage = (): Storage | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Acceso denegado (modo privado en algunos navegadores)
  }
  return null;
};

export const storage = {
  /** Native legacy fallback never proves cache/cursor consistency after upgrade. */
  isDurableItem(key: string): boolean {
    return durableKeys.has(key);
  },

  async getItem(key: string): Promise<string | null> {
    if (isSyncKey(key)) return ordered(key, async () => {
      durableKeys.delete(key);
      try {
        if (Platform.OS === 'web') {
          const web = webStorage();
          if (!web) throw new Error('SYNC_STORAGE_UNAVAILABLE');
          const value = web.getItem(key);
          if (value !== null) durableKeys.add(key);
          return value;
        }
        const saved = await readDurableItem(key);
        if (saved.exists) {
          durableKeys.add(key);
          return saved.value;
        }
        // Do not migrate or certify a potentially partial legacy cache here.
        return await AsyncStorage.getItem(key);
      } catch {
        // A recoverable collection can replay from its server through the owner.
        // Queue/checkpoint failures instead fail closed; never erase pending work.
        if (isCollectionKey(key)) return null;
        throw new Error('SYNC_STORAGE_READ_FAILED');
      }
    });
    try {
      const value = await AsyncStorage.getItem(key);
      if (value !== null) return value;
    } catch {
      // Sin AsyncStorage: seguimos con los respaldos
    }

    const web = webStorage();
    if (web) {
      const value = web.getItem(key);
      if (value !== null) return value;
    }

    return memory.get(key) ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    if (isSyncKey(key)) return ordered(key, async () => {
      try {
        if (Platform.OS === 'web') {
          const web = webStorage();
          if (!web) throw new Error('SYNC_STORAGE_UNAVAILABLE');
          web.setItem(key, value);
        } else {
          await writeDurableItem(key, value);
        }
        durableKeys.add(key);
      } catch {
        durableKeys.delete(key);
        throw new Error('SYNC_STORAGE_WRITE_FAILED');
      }
    });
    memory.set(key, value);
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // Sin AsyncStorage: quedan memoria y web
    }
    webStorage()?.setItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (isSyncKey(key)) return ordered(key, async () => {
      try {
        if (Platform.OS === 'web') {
          const web = webStorage();
          if (!web) throw new Error('SYNC_STORAGE_UNAVAILABLE');
          web.removeItem(key);
        } else {
          // Persist null instead of deleting the file: an older AsyncStorage
          // value must never resurrect on the next read or process restart.
          await writeDurableItem(key, null);
        }
        durableKeys.add(key);
      } catch {
        durableKeys.delete(key);
        throw new Error('SYNC_STORAGE_WRITE_FAILED');
      }
    });
    memory.delete(key);
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // idem
    }
    webStorage()?.removeItem(key);
  },

  async multiSet(entries: ReadonlyArray<readonly [string, string]>): Promise<void> {
    if (entries.some(([key]) => isSyncKey(key))) {
      for (const [key, value] of entries) await storage.setItem(key, value);
      return;
    }
    for (const [key, value] of entries) memory.set(key, value);
    try {
      await AsyncStorage.multiSet(entries.map(([key, value]) => [key, value]));
    } catch {
      // Sin AsyncStorage: quedan memoria y web.
    }
    const web = webStorage();
    if (web) for (const [key, value] of entries) web.setItem(key, value);
  },
};
