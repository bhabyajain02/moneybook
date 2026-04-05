// ── AsyncStorage wrapper replacing localStorage ────────────────────────────
// Provides a synchronous-feeling API for React Native.
// All values are stored as strings (same as localStorage).

import AsyncStorage from '@react-native-async-storage/async-storage'

export const storage = {
  getItem: async (key) => {
    try { return await AsyncStorage.getItem(key) }
    catch { return null }
  },
  setItem: async (key, value) => {
    try { await AsyncStorage.setItem(key, value) }
    catch {}
  },
  removeItem: async (key) => {
    try { await AsyncStorage.removeItem(key) }
    catch {}
  },
}

// Key constants (same as web app)
export const LS_KEY  = 'moneybook_phone'
export const LS_NAME = 'moneybook_store_name'
export const LS_LANG = 'moneybook_lang'
