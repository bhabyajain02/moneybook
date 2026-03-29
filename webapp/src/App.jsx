import { useState } from 'react'
import LoginScreen from './components/LoginScreen.jsx'
import ChatWindow from './components/ChatWindow.jsx'
import AnalyticsPage from './components/AnalyticsPage.jsx'
import DuesPage from './components/DuesPage.jsx'

const LS_KEY  = 'moneybook_phone'
const LS_NAME = 'moneybook_store_name'
const LS_LANG = 'moneybook_lang'

export default function App() {
  const [phone, setPhone]         = useState(() => localStorage.getItem(LS_KEY) || null)
  const [storeName, setStoreName] = useState(() => localStorage.getItem(LS_NAME) || '')
  const [language, setLanguage]   = useState(() => localStorage.getItem(LS_LANG) || 'hinglish')
  const [activePage, setActivePage] = useState('chat')

  function handleLogin(digits, storeData, lang) {
    const normalized = `web:+91${digits}`
    localStorage.setItem(LS_KEY, normalized)
    localStorage.setItem(LS_NAME, storeData.name || '')
    if (lang) {
      localStorage.setItem(LS_LANG, lang)
      setLanguage(lang)
    }
    setPhone(normalized)
    setStoreName(storeData.name || '')
  }

  function handleLogout() {
    localStorage.removeItem(LS_KEY)
    localStorage.removeItem(LS_NAME)
    setPhone(null)
    setStoreName('')
    setActivePage('chat')
  }

  function handleLanguageChange(key) {
    localStorage.setItem(LS_LANG, key)
    setLanguage(key)
  }

  if (!phone) {
    return (
      <div className="app">
        <div className="phone-frame">
          <LoginScreen onLogin={handleLogin} />
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
            />
          </div>
          <div style={{ display: activePage === 'analytics' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
            <AnalyticsPage phone={phone} storeName={storeName} />
          </div>
          <div style={{ display: activePage === 'dues' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
            <DuesPage phone={phone} storeName={storeName} />
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
        </nav>
      </div>
    </div>
  )
}
