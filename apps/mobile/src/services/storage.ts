import AsyncStorage from '@react-native-async-storage/async-storage';

/* ============================================================
   Almacenamiento local con degradacion.

   Estaba definido dentro de use-meal-store y hacia `require()` en
   cada llamada. Ahora se importa una vez y lo comparten el store, el
   tema y la sesion.

   Orden: AsyncStorage (nativo) -> localStorage (web) -> memoria.
   ============================================================ */

const memory = new Map<string, string>();

const webStorage = (): Storage | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Acceso denegado (modo privado en algunos navegadores)
  }
  return null;
};

export const storage = {
  async getItem(key: string): Promise<string | null> {
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
    memory.set(key, value);
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // Sin AsyncStorage: quedan memoria y web
    }
    webStorage()?.setItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    memory.delete(key);
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // idem
    }
    webStorage()?.removeItem(key);
  },

  async multiSet(entries: ReadonlyArray<readonly [string, string]>): Promise<void> {
    for (const [key, value] of entries) memory.set(key, value);
    try {
      await AsyncStorage.setMany(Object.fromEntries(entries));
    } catch {
      // Sin AsyncStorage: quedan memoria y web.
    }
    const web = webStorage();
    if (web) for (const [key, value] of entries) web.setItem(key, value);
  },
};
