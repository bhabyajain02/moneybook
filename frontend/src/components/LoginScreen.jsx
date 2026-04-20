import { useState, useEffect, useRef } from 'react'
import { login, checkPhone, sendOtp, verifyOtp } from '../api.js'
import { t } from '../translations.js'

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

const LS_LANG = 'moneybook_lang'
const RESEND_COOLDOWN_SEC = 30

// Map backend error codes → i18n key
function errKeyFor(code) {
  switch (code) {
    case 'invalid':           return 'otp_invalid'
    case 'expired':           return 'otp_expired'
    case 'too_many_attempts': return 'otp_too_many'
    case 'no_otp':            return 'otp_no_otp'
    default:                  return 'server_error'
  }
}

export default function LoginScreen({ onLogin, initialLanguage }) {
  const [phone, setPhone]         = useState('')
  const [storeName, setStoreName] = useState('')
  const [otp, setOtp]             = useState('')
  const [phase, setPhase]         = useState('phone')   // 'phone' | 'otp'
  const [loading, setLoading]     = useState(false)
  const [checking, setChecking]   = useState(false)
  const [error, setError]         = useState('')
  const [info, setInfo]           = useState('')
  const [resendIn, setResendIn]   = useState(0)
  const [devMode, setDevMode]     = useState(false)
  const [existingStore, setExistingStore] = useState(null)
  const [isNewUser, setIsNewUser] = useState(false)
  const [lang, setLang]           = useState(
    () => initialLanguage || localStorage.getItem(LS_LANG) || 'hinglish'
  )
  const checkTimeoutRef = useRef(null)
  const otpInputRef     = useRef(null)

  function selectLang(key) {
    setLang(key)
    localStorage.setItem(LS_LANG, key)
  }

  // When phone reaches 10 digits, check if store exists (for store-name UI)
  useEffect(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setExistingStore(null)
      setIsNewUser(false)
      setStoreName('')
      return
    }
    if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current)
    checkTimeoutRef.current = setTimeout(async () => {
      setChecking(true)
      try {
        const data = await checkPhone(digits)
        if (data?.exists) {
          setExistingStore(data); setIsNewUser(false)
        } else {
          setExistingStore(null); setIsNewUser(true)
        }
      } catch {
        setExistingStore(null); setIsNewUser(true)
      } finally {
        setChecking(false)
      }
    }, 300)
    return () => {
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current)
    }
  }, [phone])

  // Resend cooldown ticker
  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn(v => v - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  // Auto-focus OTP input when entering OTP phase
  useEffect(() => {
    if (phase === 'otp' && otpInputRef.current) {
      otpInputRef.current.focus()
    }
  }, [phase])

  async function handleSendOtp(e) {
    if (e) e.preventDefault()
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError(t('phone_error', lang)); return
    }
    setLoading(true); setError(''); setInfo('')
    try {
      const res = await sendOtp(digits)
      setDevMode(Boolean(res?.dev_mode))
      setPhase('otp')
      setResendIn(RESEND_COOLDOWN_SEC)
      setInfo(t('otp_sent', lang))
      setOtp('')
    } catch (err) {
      const msg = err.message || ''
      if (msg.includes('Too many')) setError(t('otp_rate_limit', lang))
      else setError(msg || t('server_error', lang))
    } finally {
      setLoading(false)
    }
  }

  async function handleResendOtp() {
    if (resendIn > 0) return
    await handleSendOtp()
  }

  async function handleVerifyAndLogin(e) {
    if (e) e.preventDefault()
    const digits = phone.replace(/\D/g, '')
    const code   = otp.replace(/\D/g, '')
    if (code.length !== 6) {
      setError(t('otp_invalid', lang)); return
    }
    setLoading(true); setError(''); setInfo('')
    try {
      // Step 1 — verify OTP
      await verifyOtp(digits, code)
      // Step 2 — complete login (name for new users)
      const data = await login(digits, storeName)
      onLogin(digits, data, lang)
    } catch (err) {
      setError(t(errKeyFor(err.code), lang))
    } finally {
      setLoading(false)
    }
  }

  function handleChangeNumber() {
    setPhase('phone')
    setOtp('')
    setError('')
    setInfo('')
    setResendIn(0)
  }

  const digits     = phone.replace(/\D/g, '')
  const canSendOtp = digits.length === 10 && !loading && !checking
  const canVerify  = otp.length === 6 && !loading

  return (
    <div className="login-screen">
      <div className="login-logo">📒</div>
      <h1 className="login-title">MoneyBook</h1>
      <p className="login-subtitle">{t('subtitle', lang)}</p>

      {/* ── Phase 1: Phone entry ─────────────────────────────────── */}
      {phase === 'phone' && (
        <form className="login-input-group" onSubmit={handleSendOtp}>
          <div className="phone-input-wrapper">
            <span className="phone-prefix">🇮🇳 +91</span>
            <input
              className="phone-input"
              type="tel"
              inputMode="numeric"
              pattern="[0-9]{10}"
              maxLength={10}
              placeholder="Mobile number"
              value={phone}
              onChange={e => {
                setError('')
                setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
              }}
              autoFocus
            />
          </div>

          {digits.length === 10 && !checking && existingStore && (
            <p className="login-welcome-back">
              👋 {t('welcome_back', lang)}, <strong>{existingStore.name}</strong>!
            </p>
          )}

          {digits.length === 10 && !checking && isNewUser && (
            <div className="store-name-wrapper">
              <input
                className="store-name-input"
                type="text"
                placeholder={t('store_placeholder', lang)}
                value={storeName}
                onChange={e => setStoreName(e.target.value)}
                maxLength={60}
              />
            </div>
          )}

          {/* Language selector */}
          <div className="lang-section">
            <p className="lang-label">{t('lang_label', lang)}</p>
            <div className="lang-grid">
              {LANGUAGES.map(l => (
                <button
                  key={l.key}
                  type="button"
                  className={`lang-pill ${lang === l.key ? 'selected' : ''}`}
                  onClick={() => selectLang(l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="login-error">{error}</p>}

          <button
            className={`login-btn ${loading ? 'loading' : ''}`}
            type="submit"
            disabled={!canSendOtp}
          >
            {loading
              ? t('otp_sending', lang)
              : checking
                ? t('checking', lang)
                : t('send_otp', lang)}
          </button>
        </form>
      )}

      {/* ── Phase 2: OTP entry ───────────────────────────────────── */}
      {phase === 'otp' && (
        <form className="login-input-group" onSubmit={handleVerifyAndLogin}>
          <p className="login-welcome-back" style={{ marginBottom: 4 }}>
            {t('otp_title', lang)}
          </p>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 14, textAlign: 'center' }}>
            {t('otp_sent', lang)} <strong>+91 {digits}</strong>
          </p>

          <div className="phone-input-wrapper">
            <input
              ref={otpInputRef}
              className="phone-input"
              type="tel"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder={t('otp_placeholder', lang)}
              value={otp}
              style={{ letterSpacing: '0.4em', textAlign: 'center', fontSize: 22, fontWeight: 600 }}
              onChange={e => {
                setError('')
                setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
              }}
            />
          </div>

          {devMode && (
            <p style={{ fontSize: 11, color: '#9C27B0', textAlign: 'center', marginTop: 6 }}>
              💡 {t('otp_dev_hint', lang)}
            </p>
          )}

          {info && !error && <p className="login-note" style={{ color: '#2e7d32' }}>{info}</p>}
          {error && <p className="login-error">{error}</p>}

          <button
            className={`login-btn ${loading ? 'loading' : ''}`}
            type="submit"
            disabled={!canVerify}
          >
            {loading ? t('otp_verifying', lang) : t('otp_verify', lang)}
          </button>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 10,
            padding: '0 4px',
          }}>
            <button
              type="button"
              onClick={handleChangeNumber}
              style={{
                background: 'none',
                border: 'none',
                color: '#1976D2',
                fontSize: 13,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {t('otp_change_number', lang)}
            </button>
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={resendIn > 0 || loading}
              style={{
                background: 'none',
                border: 'none',
                color: resendIn > 0 ? '#999' : '#1976D2',
                fontSize: 13,
                cursor: resendIn > 0 ? 'default' : 'pointer',
                padding: 0,
              }}
            >
              {resendIn > 0
                ? t('otp_resend_in', lang).replace('{sec}', String(resendIn))
                : t('otp_resend', lang)}
            </button>
          </div>
        </form>
      )}

      <p className="login-note">{t('note', lang)}</p>
    </div>
  )
}
