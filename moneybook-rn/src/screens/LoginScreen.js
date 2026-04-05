// ── LoginScreen — converted from LoginScreen.jsx ───────────────────────────
// Changes from web: div→View, p/span→Text, button→TouchableOpacity,
// input→TextInput, CSS classes→StyleSheet, localStorage→AsyncStorage (via storage.js)

import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { login, checkPhone } from '../api'
import { t } from '../translations'
import { storage, LS_LANG } from '../storage'

const LANGUAGES = [
  { key: 'english',  label: 'English' },
  { key: 'hindi',    label: 'हिंदी' },
  { key: 'hinglish', label: 'Hinglish' },
  { key: 'gujarati', label: 'ગુજરાતી' },
  { key: 'marathi',  label: 'मराठी' },
  { key: 'bengali',  label: 'বাংলা' },
  { key: 'tamil',    label: 'தமிழ்' },
  { key: 'telugu',   label: 'తెలుగు' },
  { key: 'kannada',  label: 'ಕನ್ನಡ' },
  { key: 'punjabi',  label: 'ਪੰਜਾਬੀ' },
]

export default function LoginScreen({ onLogin, initialLanguage }) {
  const insets = useSafeAreaInsets()
  const [phone,         setPhone]         = useState('')
  const [storeName,     setStoreName]     = useState('')
  const [loading,       setLoading]       = useState(false)
  const [checking,      setChecking]      = useState(false)
  const [error,         setError]         = useState('')
  const [existingStore, setExistingStore] = useState(null)
  const [isNewUser,     setIsNewUser]     = useState(false)
  const [lang,          setLang]          = useState(initialLanguage || 'hinglish')
  const checkTimeout = useRef(null)

  async function selectLang(key) {
    setLang(key)
    await storage.setItem(LS_LANG, key)
  }

  // When phone reaches 10 digits, check if store exists
  useEffect(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setExistingStore(null)
      setIsNewUser(false)
      setStoreName('')
      return
    }
    if (checkTimeout.current) clearTimeout(checkTimeout.current)
    checkTimeout.current = setTimeout(async () => {
      setChecking(true)
      try {
        const data = await checkPhone(digits)
        if (data?.exists) {
          setExistingStore(data)
          setIsNewUser(false)
        } else {
          setExistingStore(null)
          setIsNewUser(true)
        }
      } catch {
        setExistingStore(null)
        setIsNewUser(true)
      } finally {
        setChecking(false)
      }
    }, 300)
    return () => { if (checkTimeout.current) clearTimeout(checkTimeout.current) }
  }, [phone])

  async function handleSubmit() {
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError(t('phone_error', lang))
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await login(digits, storeName)
      onLogin(digits, data, lang)
    } catch (err) {
      setError(err.message || t('server_error', lang))
    } finally {
      setLoading(false)
    }
  }

  const digits = phone.replace(/\D/g, '')
  const canSubmit = digits.length === 10 && !loading && !checking

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#00695C' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <Text style={styles.logo}>📒</Text>
        <Text style={styles.title}>MoneyBook</Text>
        <Text style={styles.subtitle}>{t('subtitle', lang)}</Text>

        {/* Phone input */}
        <View style={styles.card}>
          <View style={styles.phoneRow}>
            <Text style={styles.prefix}>🇮🇳 +91</Text>
            <TextInput
              style={styles.phoneInput}
              placeholder="Mobile number"
              placeholderTextColor="#aaa"
              keyboardType="numeric"
              maxLength={10}
              value={phone}
              onChangeText={v => {
                setError('')
                setPhone(v.replace(/\D/g, '').slice(0, 10))
              }}
              autoFocus
            />
          </View>

          {/* Returning user */}
          {digits.length === 10 && !checking && existingStore && (
            <Text style={styles.welcomeBack}>
              👋 {t('welcome_back', lang)},{' '}
              <Text style={{ fontWeight: '700' }}>{existingStore.name}</Text>!
            </Text>
          )}

          {/* New user: store name */}
          {digits.length === 10 && !checking && isNewUser && (
            <TextInput
              style={styles.storeInput}
              placeholder={t('store_placeholder', lang)}
              placeholderTextColor="#aaa"
              value={storeName}
              onChangeText={setStoreName}
              maxLength={60}
            />
          )}

          {/* Checking indicator */}
          {checking && (
            <View style={styles.checkingRow}>
              <ActivityIndicator size="small" color="#00695C" />
              <Text style={styles.checkingText}>{t('checking', lang)}</Text>
            </View>
          )}
        </View>

        {/* Language selector */}
        <View style={styles.langSection}>
          <Text style={styles.langLabel}>{t('lang_label', lang)}</Text>
          <View style={styles.langGrid}>
            {LANGUAGES.map(l => (
              <TouchableOpacity
                key={l.key}
                style={[styles.langPill, lang === l.key && styles.langPillActive]}
                onPress={() => selectLang(l.key)}
              >
                <Text style={[styles.langPillText, lang === l.key && styles.langPillTextActive]}>
                  {l.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Error */}
        {!!error && <Text style={styles.error}>{error}</Text>}

        {/* Submit button */}
        <TouchableOpacity
          style={[styles.loginBtn, !canSubmit && styles.loginBtnDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginBtnText}>
              {checking ? t('checking', lang) : t('start', lang)}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={styles.note}>{t('note', lang)}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    fontSize: 64,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 32,
    textAlign: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
  },
  prefix: {
    fontSize: 15,
    color: '#333',
    marginRight: 8,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
    fontSize: 18,
    color: '#1a1a1a',
    fontWeight: '600',
    letterSpacing: 1,
  },
  welcomeBack: {
    marginTop: 12,
    fontSize: 14,
    color: '#00695C',
  },
  storeInput: {
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 15,
    color: '#1a1a1a',
  },
  checkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  checkingText: {
    fontSize: 13,
    color: '#888',
    marginLeft: 8,
  },
  langSection: {
    width: '100%',
    marginBottom: 20,
  },
  langLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  langPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginRight: 8,
    marginBottom: 8,
  },
  langPillActive: {
    backgroundColor: '#fff',
  },
  langPillText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
  langPillTextActive: {
    color: '#00695C',
    fontWeight: '700',
  },
  error: {
    color: '#FF5252',
    backgroundColor: 'rgba(255,82,82,0.15)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    fontSize: 13,
    width: '100%',
    textAlign: 'center',
  },
  loginBtn: {
    width: '100%',
    height: 52,
    backgroundColor: '#fff',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  loginBtnDisabled: {
    opacity: 0.5,
  },
  loginBtnText: {
    color: '#00695C',
    fontSize: 16,
    fontWeight: '800',
  },
  note: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
})
