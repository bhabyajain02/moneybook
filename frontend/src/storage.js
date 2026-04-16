/**
 * Cross-platform storage abstraction.
 * Uses @capacitor/preferences on native, localStorage on web.
 */
import { Capacitor } from '@capacitor/core'

let Preferences = null

// Lazy-load Preferences plugin only on native
async function getPrefs() {
  if (!Preferences && Capacitor.isNativePlatform()) {
    const mod = await import('@capacitor/preferences')
    Preferences = mod.Preferences
  }
  return Preferences
}

export async function getItem(key) {
  const prefs = await getPrefs()
  if (prefs) {
    const { value } = await prefs.get({ key })
    return value
  }
  return localStorage.getItem(key)
}

export async function setItem(key, value) {
  const prefs = await getPrefs()
  if (prefs) {
    await prefs.set({ key, value: value ?? '' })
  } else {
    localStorage.setItem(key, value)
  }
}

export async function removeItem(key) {
  const prefs = await getPrefs()
  if (prefs) {
    await prefs.remove({ key })
  } else {
    localStorage.removeItem(key)
  }
}

/**
 * Synchronous getters for initial state (localStorage only — works on web, empty on native).
 * On native, the App component will re-hydrate from async storage on mount.
 */
export function getItemSync(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
