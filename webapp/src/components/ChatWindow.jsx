import { useState, useEffect, useRef, useCallback } from 'react'
import MessageBubble from './MessageBubble.jsx'
import TypingIndicator from './TypingIndicator.jsx'
import QuickReplies from './QuickReplies.jsx'
import InputBar from './InputBar.jsx'
import LedgerEntry from './LedgerEntry.jsx'
import { sendMessage, sendImage, pollMessages, confirmTransactions, dismissMessage } from '../api.js'

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

const POLL_INTERVAL = 2500   // ms

/* Derive quick-reply chips from the last bot message body.
   Backend also returns quick_replies[] — we use whichever is latest. */
function deriveChips(quickReplies) {
  if (!quickReplies || quickReplies.length === 0) return []
  return quickReplies.map(qr => {
    // haan / galat / cancel are handled entirely by ConfirmCard — never show as chips
    if (qr === 'haan' || qr === 'cancel' || qr.startsWith('galat')) return null
    // person classification chips: 1 / 2 / 3 / 4
    const num = parseInt(qr, 10)
    const labels = { 1:'👷 Staff', 2:'🛒 Customer', 3:'📦 Supplier', 4:'🏠 Ghar' }
    if (labels[num]) return { label: labels[num], value: qr, type: 'default' }
    return { label: qr, value: qr, type: 'default' }
  }).filter(Boolean)
}

function groupByDate(messages) {
  const groups = []
  let lastDate = null
  messages.forEach(m => {
    const d = new Date(m.created_at).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric'
    })
    if (d !== lastDate) {
      groups.push({ type: 'date', label: d })
      lastDate = d
    }
    groups.push({ type: 'msg', msg: m })
  })
  return groups
}

export default function ChatWindow({ phone, storeName, language = 'hinglish', onLogout, onLanguageChange }) {
  const [messages, setMessages]           = useState([])
  const [processing, setProcessing]       = useState(false)
  const [quickReplies, setQuickReplies]   = useState([])
  const [sending, setSending]             = useState(false)
  const [uploadPct, setUploadPct]         = useState(null)
  const [langOpen, setLangOpen]           = useState(false)
  const [showLedger, setShowLedger]       = useState(false)
  const [photoReview, setPhotoReview]     = useState(null)  // { msgId, txns, date }
  const pendingPhotoRef = useRef(null)    // bridge from inside setMessages → outside
  const lastIdRef       = useRef(0)
  const bottomRef       = useRef()
  const pollRef         = useRef()
  const langRef         = useRef()
  // Stores the original AI-parsed pending_transactions keyed by bot message ID.
  // Captured once on first arrival — never overwritten by edits — so we can
  // diff original vs corrected when the user hits Save.
  const originalTxnsRef = useRef({})

  // Close language dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (langRef.current && !langRef.current.contains(e.target)) {
        setLangOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Scroll to bottom whenever messages change ──────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, processing])

  // ── Polling loop ──────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const data = await pollMessages(phone, lastIdRef.current)
      if (data.messages?.length > 0) {
        setMessages(prev => {
          const existing = new Set(prev.map(m => m.id))
          const fresh = data.messages.filter(m => !existing.has(m.id))
          if (fresh.length === 0) return prev
          lastIdRef.current = Math.max(lastIdRef.current, ...fresh.map(m => m.id))

          const processed = fresh.map(m => {
            if (m.direction === 'bot' && m.metadata?.pending_transactions?.length > 0) {
              // Capture originals for learning — only on first arrival
              if (!originalTxnsRef.current[m.id]) {
                originalTxnsRef.current[m.id] = JSON.parse(
                  JSON.stringify(m.metadata.pending_transactions)
                )
              }
              // Photo-sourced → open modal, hide bot bubble
              if (m.metadata?.display || m.metadata?.source === 'image') {
                pendingPhotoRef.current = {
                  msgId:   m.id,
                  txns:    m.metadata.pending_transactions,
                  date:    m.metadata.page_date,
                  display: m.metadata.display || null,
                }
                return { ...m, metadata: { ...m.metadata, overwritten: true } }
              }
            }
            return m
          })
          return [...prev, ...processed]
        })

        // Open photo review modal outside setMessages
        if (pendingPhotoRef.current) {
          setPhotoReview(pendingPhotoRef.current)
          pendingPhotoRef.current = null
        }

        // Update quick replies from latest bot message
        const latestBot = [...data.messages].reverse().find(m => m.direction === 'bot')
        if (latestBot?.quick_replies) setQuickReplies(latestBot.quick_replies)
      }
      setProcessing(data.processing || false)
    } catch {}
  }, [phone])

  useEffect(() => {
    poll()   // immediate first load
    pollRef.current = setInterval(poll, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [poll])

  // ── Send text ──────────────────────────────────────────────────
  async function handleSend(text) {
    if (sending) return
    setSending(true)
    setQuickReplies([])

    // Optimistic user bubble
    const tempId = Date.now()
    const tempMsg = { id: tempId, direction: 'user', body: text,
                      created_at: new Date().toISOString() }
    setMessages(prev => [...prev, tempMsg])

    try {
      const resp = await sendMessage(phone, text, language)
      // Replace temp bubble with real user message (prevents duplicate on poll)
      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempId)
        const realUser = { id: resp.user_message_id, direction: 'user',
                           body: text, created_at: new Date().toISOString() }
        return [...withoutTemp, realUser]
      })
      // Advance past user message so poll only fetches the bot reply (with full metadata)
      lastIdRef.current = Math.max(lastIdRef.current, resp.user_message_id)
      if (resp.processing) setProcessing(true)
      // Immediately poll to get the bot reply (includes metadata for ConfirmCard)
      await poll()
    } catch (e) {
      setMessages(prev => [...prev, {
        id: tempId + 1, direction: 'bot',
        body: `⚠️ Error: ${e.message}`,
        created_at: new Date().toISOString()
      }])
    } finally {
      setSending(false)
    }
  }

  // ── Send image ─────────────────────────────────────────────────
  async function handleImage(file) {
    if (sending) return
    setSending(true)
    setUploadPct(0)

    // Show image preview bubble immediately
    const previewUrl = URL.createObjectURL(file)
    const tempId = Date.now()
    setMessages(prev => [...prev, {
      id: tempId, direction: 'user',
      media_url: previewUrl, body: null,
      created_at: new Date().toISOString()
    }])

    try {
      setUploadPct(50)
      await sendImage(phone, file, language)
      setUploadPct(100)
      setProcessing(true)
    } catch (e) {
      setMessages(prev => [...prev, {
        id: tempId + 1, direction: 'bot',
        body: `⚠️ Upload failed: ${e.message}`,
        created_at: new Date().toISOString()
      }])
    } finally {
      setSending(false)
      setUploadPct(null)
      URL.revokeObjectURL(previewUrl)
    }
  }

  // ── Confirm edited transactions ────────────────────────────────
  async function handleConfirm(editedTxns, botMsgId) {
    try {
      // Retrieve the original AI-parsed transactions for diff-based learning
      const originals = originalTxnsRef.current[botMsgId] || null
      const resp = await confirmTransactions(phone, editedTxns, botMsgId, originals)
      // Transform the ConfirmCard message in-place to a SavedCard (no new message)
      setMessages(prev => prev.map(m =>
        m.id === botMsgId
          ? { ...m, metadata: { confirmed_transactions: resp.confirmed_transactions } }
          : m
      ))
      // Clean up stored originals for this message
      delete originalTxnsRef.current[botMsgId]
      setQuickReplies([])
    } catch (e) {
      setMessages(prev => [...prev, {
        id: Date.now(), direction: 'bot',
        body: `⚠️ Save failed: ${e.message}`,
        created_at: new Date().toISOString()
      }])
    }
  }

  // Keep ChatWindow's messages in sync with in-progress edits inside ConfirmCard
  // so navigating away and back doesn't lose unsaved edits
  function handlePendingEdit(botMsgId, updatedTxns) {
    setMessages(prev => prev.map(m =>
      m.id === botMsgId
        ? { ...m, metadata: { ...m.metadata, pending_transactions: updatedTxns } }
        : m
    ))
  }

  // ── Ledger classify callback ───────────────────────────────────
  async function handleLedgerClassified(result) {
    if (result.message_id) {
      lastIdRef.current = Math.max(lastIdRef.current, result.message_id - 1)
    }
    await poll()
  }

  // ── Photo modal confirm ────────────────────────────────────────
  async function handlePhotoConfirm(editedTxns, msgId) {
    const originals = originalTxnsRef.current[msgId] || null
    try {
      const resp = await confirmTransactions(phone, editedTxns, msgId, originals)
      // Replace the hidden bot message with a SavedCard
      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? { ...m, metadata: { confirmed_transactions: resp.confirmed_transactions } }
          : m
      ))
      delete originalTxnsRef.current[msgId]
      // Close the modal BEFORE polling so handlePhotoCancel can't fire and
      // call dismissMessage (which would wipe the classifying bot_state).
      setPhotoReview(null)
      // If backend started a classification flow, fetch it immediately
      if (resp.classification_pending) await poll()
    } catch (e) {
      setMessages(prev => [...prev, {
        id: Date.now(), direction: 'bot',
        body: `⚠️ Save failed: ${e.message}`,
        created_at: new Date().toISOString()
      }])
      setPhotoReview(null)
    }
  }

  async function handlePhotoCancel() {
    if (photoReview?.msgId) {
      dismissMessage(phone, photoReview.msgId).catch(() => {})
      delete originalTxnsRef.current[photoReview.msgId]
    }
    setPhotoReview(null)
  }

  async function handleCancelConfirm(botMsgId) {
    // Remove the ConfirmCard message from chat immediately
    setMessages(prev => prev.filter(m => m.id !== botMsgId))
    // Clean up stored originals
    delete originalTxnsRef.current[botMsgId]
    // Tell server to mark dismissed so it doesn't reappear on reload
    dismissMessage(phone, botMsgId).catch(() => {})
  }

  const chips = deriveChips(quickReplies)
  const grouped = groupByDate(messages)

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="chat-header">
        <div className="header-avatar">📒</div>
        <div className="header-info">
          <div className="header-name">{storeName || 'MoneyBook'}</div>
          <div className="header-status">
            <span className="online-dot" />
            {processing ? 'Photo padh raha hoon...' : 'Online'}
          </div>
        </div>
        {/* Language switcher */}
        <div className="lang-switcher" ref={langRef} style={{ marginLeft: 'auto' }}>
          <button
            className="lang-switcher-btn"
            onClick={() => setLangOpen(o => !o)}
            title="Change language"
          >
            🌐 {LANGUAGES.find(l => l.key === language)?.label || 'Lang'}
          </button>
          {langOpen && (
            <div className="lang-dropdown">
              {LANGUAGES.map(l => (
                <button
                  key={l.key}
                  className={`lang-option ${language === l.key ? 'active' : ''}`}
                  onClick={() => {
                    onLanguageChange && onLanguageChange(l.key)
                    setLangOpen(false)
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="icon-btn"
          onClick={onLogout}
          title="Logout"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>

      {/* ── Message list ─────────────────────────────────────── */}
      <div className="chat-body">
        {messages.length === 0 && !processing ? (
          <div className="empty-chat">
            <div className="emoji">📒</div>
            <p>
              <b>MoneyBook mein swagat hai!</b><br/>
              Text mein entry likhein ya notebook ki photo bhejein.
            </p>
          </div>
        ) : (
          grouped.map((item, i) => {
            if (item.type === 'date') {
              return <div key={`d-${i}`} className="date-divider"><span>{item.label}</span></div>
            }
            const msg = item.msg
            // Find last bot message with pending_transactions for confirm card
            const isLastConfirm = msg.direction === 'bot' &&
              msg.metadata?.pending_transactions &&
              !messages.slice(messages.indexOf(msg) + 1).some(
                m => m.direction === 'bot' && m.metadata?.pending_transactions
              )
            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                phone={phone}
                onConfirm={isLastConfirm ? (txns) => handleConfirm(txns, msg.id) : null}
                onCancel={isLastConfirm ? () => handleCancelConfirm(msg.id) : null}
                onPendingEdit={isLastConfirm ? (txns) => handlePendingEdit(msg.id, txns) : null}
                onOpenLedger={() => setShowLedger(true)}
              />
            )
          })
        )}

        {processing && <TypingIndicator />}
        <div ref={bottomRef} className="scroll-anchor" />
      </div>

      {/* ── Quick replies ─────────────────────────────────────── */}
      <QuickReplies chips={chips} onSend={handleSend} />

      {/* ── Input bar ─────────────────────────────────────────── */}
      <InputBar
        onSend={handleSend}
        onImage={handleImage}
        onLedger={() => setShowLedger(true)}
        disabled={sending}
      />

      {/* ── Ledger entry modal (manual) ───────────────────────── */}
      {showLedger && !photoReview && (
        <LedgerEntry
          phone={phone}
          language={language}
          onClose={() => setShowLedger(false)}
          onClassified={handleLedgerClassified}
        />
      )}

      {/* ── Photo review — exact Khata Bahi grid, pre-filled ──── */}
      {photoReview && (
        <LedgerEntry
          phone={phone}
          language={language}
          onClose={handlePhotoCancel}
          onClassified={handleLedgerClassified}
          prefill={{
            txns:    photoReview.txns,
            display: photoReview.display,
            msgId:   photoReview.msgId,
            date:    photoReview.date,
            onSave:  handlePhotoConfirm,
          }}
        />
      )}
    </div>
  )
}
