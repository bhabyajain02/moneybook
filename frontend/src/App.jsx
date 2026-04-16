import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import LoginScreen from './components/LoginScreen.jsx'
import ChatWindow from './components/ChatWindow.jsx'
import AnalyticsPage from './components/AnalyticsPage.jsx'
import DuesPage from './components/DuesPage.jsx'
import ProfilePage from './components/ProfilePage.jsx'
import OperatorDashboard from './components/OperatorDashboard.jsx'
import { updateProfile } from './api.js'
import { getItem, setItem, removeItem, getItemSync } from './storage.js'

const LS_KEY  = 'moneybook_phone'
const LS_NAME = 'moneybook_store_name'
const LS_LANG = 'moneybook_lang'

export default function App() {
  const [isAdmin] = useState(() => window.location.hash === '#admin')
  const [phone, setPhone]         = useState(() => getItemSync(LS_KEY) || null)
  const [storeName, setStoreName] = useState(() => getItemSync(LS_NAME) || '')
  const [language, setLanguage]   = useState(() => getItemSync(LS_LANG) || 'hinglish')
  const [activePage, setActivePage] = useState('chat')
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setRefreshKey(k => k + 1)

  // On native, hydrate from async Capacitor Preferences
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      Promise.all([getItem(LS_KEY), getItem(LS_NAME), getItem(LS_LANG)]).then(([p, n, l]) => {
        if (p) setPhone(p)
        if (n) setStoreName(n)
        if (l) setLanguage(l)
      })
    }
  }, [])

  // Back button handler for Android
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app').then(({ App: CapApp }) => {
        CapApp.addListener('backButton', () => {
          if (activePage !== 'chat') setActivePage('chat')
          else CapApp.exitApp()
        })
      })
    }
  }, [activePage])

  // StatusBar color on native
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        StatusBar.setBackgroundColor({ color: '#075E54' }).catch(() => {})
        StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
      }).catch(() => {})
    }
  }, [])

  function handleLogin(digits, storeData, lang) {
    const normalized = `web:+91${digits}`
    setItem(LS_KEY, normalized)
    setItem(LS_NAME, storeData.name || '')
    if (lang) {
      setItem(LS_LANG, lang)
      setLanguage(lang)
      updateProfile(normalized, { language: lang }).catch(() => {})
    }
    setPhone(normalized)
    setStoreName(storeData.name || '')
  }

  function handleLogout() {
    removeItem(LS_KEY)
    removeItem(LS_NAME)
    setPhone(null)
    setStoreName('')
    setActivePage('chat')
  }

  function handleStoreNameChange(name) {
    setItem(LS_NAME, name)
    setStoreName(name)
  }

  function handleLanguageChange(key) {
    setItem(LS_LANG, key)
    setLanguage(key)
    if (phone) updateProfile(phone, { language: key }).catch(() => {})
  }

  if (isAdmin) {
    return <OperatorDashboard />
  }

  if (!phone) {
    return (
      <div className="app">
        <div className="phone-frame">
          <LoginScreen onLogin={handleLogin} initialLanguage={language} />
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="phone-frame">
        <div className="app-content">
          {/* Keep all pages mounted — CSS hides inactive ones so state is preserved */}
          <div style={{ display: activePage === 'chat' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
            <ChatWindow
              phone={phone}
              storeName={storeName}
              language={language}
              onLogout={handleLogout}
              onLanguageChange={handleLanguageChange}
              onDataChange={bumpRefresh}
            />
          </div>
          <div style={{ display: activePage === 'analytics' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
            <AnalyticsPage phone={phone} storeName={storeName} language={language} refreshKey={refreshKey} />
          </div>
          <div style={{ display: activePage === 'dues' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
            <DuesPage phone={phone} storeName={storeName} language={language} refreshKey={refreshKey} />
          </div>
          <div style={{ display: activePage === 'profile' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
            <ProfilePage
              phone={phone}
              storeName={storeName}
              language={language}
              onLanguageChange={handleLanguageChange}
              onStoreNameChange={handleStoreNameChange}
              onLogout={handleLogout}
            />
          </div>
        </div>

        {/* Bottom Navigation */}
        <nav className="bottom-nav">
          <button
            className={`nav-tab ${activePage === 'chat' ? 'active' : ''}`}
            onClick={() => setActivePage('chat')}
          >
            <span className="nav-icon">💬</span>
            <span className="nav-label">Chat</span>
          </button>
          <button
            className={`nav-tab ${activePage === 'analytics' ? 'active' : ''}`}
            onClick={() => setActivePage('analytics')}
          >
            <span className="nav-icon">📊</span>
            <span className="nav-label">Analytics</span>
          </button>
          <button
            className={`nav-tab ${activePage === 'dues' ? 'active' : ''}`}
            onClick={() => setActivePage('dues')}
          >
            <span className="nav-icon">👥</span>
            <span className="nav-label">Dues &amp; Staff</span>
          </button>
          <button
            className={`nav-tab ${activePage === 'profile' ? 'active' : ''}`}
            onClick={() => setActivePage('profile')}
          >
            <span className="nav-icon">👤</span>
            <span className="nav-label">Profile</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
