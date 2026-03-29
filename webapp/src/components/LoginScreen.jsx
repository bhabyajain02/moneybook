import { useState, useEffect, useRef } from 'react'
import { login, checkPhone } from '../api.js'

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

export default function LoginScreen({ onLogin }) {
  const [phone, setPhone]         = useState('')
  const [storeName, setStoreName] = useState('')
  const [loading, setLoading]     = useState(false)
  const [checking, setChecking]   = useState(false)
  const [error, setError]         = useState('')
  const [existingStore, setExistingStore] = useState(null)  // null | { name, onboarding_state }
  const [isNewUser, setIsNewUser] = useState(false)
  const [lang, setLang]           = useState(
    () => localStorage.getItem(LS_LANG) || 'hinglish'
  )
  const checkTimeoutRef = useRef(null)

  function selectLang(key) {
    setLang(key)
    localStorage.setItem(LS_LANG, key)
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

    // Debounce the check
    if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current)
    checkTimeoutRef.current = setTimeout(async () => {
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

    return () => {
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current)
    }
  }, [phone])

  async function handleSubmit(e) {
    e.preventDefault()
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('10 digit ka mobile number daalen')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await login(digits, storeName)
      onLogin(digits, data, lang)
    } catch (err) {
      setError(err.message || 'Kuch gadbad ho gayi, dobara try karein')
    } finally {
      setLoading(false)
    }
  }

  const digits = phone.replace(/\D/g, '')

  return (
    <div className="login-screen">
      <div className="login-logo">📒</div>
      <h1 className="login-title">MoneyBook</h1>
      <p className="login-subtitle">
        Aapka digital khata — WhatsApp ki tarah simple
      </p>

      <form className="login-input-group" onSubmit={handleSubmit}>
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

        {/* Returning user: welcome back */}
        {digits.length === 10 && !checking && existingStore && (
          <p className="login-welcome-back">
            👋 Welcome back, <strong>{existingStore.name}</strong>!
          </p>
        )}

        {/* New user: store name input */}
        {digits.length === 10 && !checking && isNewUser && (
          <div className="store-name-wrapper">
            <input
              className="store-name-input"
              type="text"
              placeholder="Aapke store ka naam (e.g. Sharma General Store)"
              value={storeName}
              onChange={e => setStoreName(e.target.value)}
              maxLength={60}
            />
          </div>
        )}

        {/* Language selector */}
        <div className="lang-section">
          <p className="lang-label">Bhasha / Language</p>
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
          disabled={digits.length !== 10 || loading || checking}
        >
          {loading ? 'Connecting...' : checking ? 'Checking...' : 'Start ▶'}
        </button>
      </form>

      <p className="login-note">Koi password nahi — sirf number daalen aur shuru karein</p>
    </div>
  )
}
