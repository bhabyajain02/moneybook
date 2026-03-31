import { useState, useEffect, useRef, useCallback } from 'react'
import MessageBubble from './MessageBubble.jsx'
import TypingIndicator from './TypingIndicator.jsx'
import QuickReplies from './QuickReplies.jsx'
import InputBar from './InputBar.jsx'
import LedgerEntry from './LedgerEntry.jsx'
import PersonClassifyWidget from './PersonClassifyWidget.jsx'
import { sendMessage, sendImage, pollMessages, confirmTransactions, dismissMessage, dismissBulk, fetchStaff, classifyPersonsBatch, clearChat } from '../api.js'
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

const POLL_INTERVAL = 2500   // ms

// Lightweight tag inference from description when AI didn't assign one
function _inferTag(desc) {
  const d = (desc || '').toLowerCase()
  if (/\b(salary|staff|wages?|labour)\b/.test(d)) return 'staff_expense'
  if (/\b(rent|kiraya)\b/.test(d)) return 'rent'
  if (/\b(electric|bijli|power)\b/.test(d)) return 'electricity'
  if (/\b(petrol|diesel|fuel|gas)\b/.test(d)) return 'petrol'
  if (/\b(food|khana|lunch|dinner|breakfast|refreshment|chai|tea|coffee)\b/.test(d)) return 'refreshment'
  if (/\b(transport|auto|rikshaw|taxi|bus|freight|courier)\b/.test(d)) return 'transport'
  if (/\b(repair|maintenance|service)\b/.test(d)) return 'repair'
  if (/\b(phone|mobile|telephone|recharge)\b/.test(d)) return 'telephone'
  if (/\b(water|pani)\b/.test(d)) return 'water'
  if (/\b(insurance|bima)\b/.test(d)) return 'insurance'
  if (/\b(packaging|packing)\b/.test(d)) return 'packaging'
  if (/\b(cleaning|safai|sweep)\b/.test(d)) return 'cleaning'
  if (/\b(discount|cd\b|cash discount)\b/.test(d)) return 'cash_discount'
  if (/\b(purchase|khareed|buy|bought|saman)\b/.test(d)) return 'purchase'
  if (/\b(office|stationary|supply|supplies)\b/.test(d)) return 'office_supplies'
  return 'store_expense'  // generic fallback
}

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
  const [classifyWidget, setClassifyWidget] = useState(null) // { persons, txns, msgId, date, display }
  const [staffOptions, setStaffOptions]   = useState([])
  const pendingPhotoRef = useRef(null)    // bridge from inside setMessages → outside
  const lastIdRef       = useRef(0)
  const bottomRef       = useRef()
  const pollRef         = useRef()
  const langRef         = useRef()
  // Stores the original AI-parsed pending_transactions keyed by bot message ID.
  // Captured once on first arrival — never overwritten by edits — so we can
  // diff original vs corrected when the user hits Save.
  const originalTxnsRef = useRef({})

  // Fetch staff names for classification widget
  useEffect(() => {
    if (!phone) return
    fetchStaff(phone)
      .then(data => setStaffOptions((data || []).map(s => s.name || s).filter(Boolean)))
      .catch(() => {})
  }, [phone])

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

        // Open photo review modal — or classification widget first if persons need classifying
        if (pendingPhotoRef.current) {
          const pending = pendingPhotoRef.current
          pendingPhotoRef.current = null

          // Extract unique person names that need classification
          const personNames = [...new Set(
            (pending.txns || [])
              .filter(t => t.person_name && t.needs_tracking !== false)
              .map(t => t.person_name)
          )]

          if (personNames.length > 0) {
            // Build person info for the widget
            const persons = personNames.map(name => {
              const txn = pending.txns.find(t => t.person_name === name)
              return { name, description: txn?.description || '', amount: txn?.amount || 0 }
            })
            setClassifyWidget({ persons, txns: pending.txns, msgId: pending.msgId, date: pending.date, display: pending.display })
          } else {
            setPhotoReview(pending)
          }
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
      const resp = await sendImage(phone, file, language)
      setUploadPct(100)

      // Swap temp ID → real DB ID and replace blob URL with server URL
      const realId = resp?.user_message_id
      if (realId) {
        const serverUrl = resp?.media_url || null
        setMessages(prev => prev.map(m =>
          m.id === tempId
            ? { ...m, id: realId, ...(serverUrl ? { media_url: serverUrl } : {}) }
            : m
        ))
        lastIdRef.current = Math.max(lastIdRef.current, realId)
      }
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
      // Collect ack IDs before mutating state, then dismiss in DB (best-effort)
      const ackIds = findAckIds(messages, botMsgId)
      if (ackIds.length > 0) dismissBulk(phone, ackIds).catch(() => {})
      // Remove ack and intermediates, then transform ConfirmCard → SavedCard
      setMessages(prev => {
        const cleaned = removeIntermediates(prev, botMsgId)
        return cleaned.map(m =>
          m.id === botMsgId
            ? { ...m, metadata: { confirmed_transactions: resp.confirmed_transactions } }
            : m
        )
      })
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
      // Skip PAST this message so poll doesn't render it as a ConfirmCard
      lastIdRef.current = Math.max(lastIdRef.current, result.message_id)
    }
    // Auto-confirm manual ledger entries — skip the ConfirmCard in chat
    const txns = result.pending_transactions || []
    if (txns.length > 0 && result.message_id) {
      try {
        await confirmTransactions(phone, txns, result.message_id)
        // Add a success message to chat
        setMessages(prev => [...prev, {
          id: Date.now(), direction: 'bot',
          body: `✅ ${txns.length} entries saved from ledger.`,
          created_at: new Date().toISOString(),
        }])
      } catch (e) {
        setMessages(prev => [...prev, {
          id: Date.now(), direction: 'bot',
          body: `⚠️ Save failed: ${e.message}`,
          created_at: new Date().toISOString(),
        }])
      }
    }
    await poll()
  }

  // ── Photo modal confirm ────────────────────────────────────────
  async function handlePhotoConfirm(editedTxns, msgId) {
    const originals = originalTxnsRef.current[msgId] || null
    try {
      const resp = await confirmTransactions(phone, editedTxns, msgId, originals)
      // Dismiss ack messages in DB before mutating state
      const ackIds = findAckIds(messages, msgId)
      if (ackIds.length > 0) dismissBulk(phone, ackIds).catch(() => {})
      // Remove ack intermediates, transform hidden bot msg → SavedCard
      setMessages(prev => {
        const cleaned = removeIntermediates(prev, msgId)
        return cleaned.map(m =>
          m.id === msgId
            ? { ...m, metadata: { confirmed_transactions: resp.confirmed_transactions } }
            : m
        )
      })
      delete originalTxnsRef.current[msgId]
      setPhotoReview(null)
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
    const msgId = photoReview?.msgId
    if (msgId) {
      const tempId = Date.now()
      const cancelMsg = {
        id: tempId, direction: 'bot',
        body: t('cancel_expense', language),
        created_at: new Date().toISOString()
      }
      // Remove ack + hidden bot msg, show cancel message
      const ackIds = findAckIds(messages, msgId)
      setMessages(prev => {
        const cleaned = removeIntermediates(prev, msgId).filter(m => m.id !== msgId)
        return [...cleaned, cancelMsg]
      })
      delete originalTxnsRef.current[msgId]
      // Persist dismissals + cancel message to DB so they survive reload
      const idsToDissmiss = [...ackIds, msgId]
      dismissBulk(phone, idsToDissmiss, t('cancel_expense', language))
        .then(res => {
          if (res?.cancel_msg_id) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: res.cancel_msg_id } : m))
          }
        })
        .catch(() => {})
    }
    setPhotoReview(null)
  }

  async function handleClassifyComplete(classifications) {
    if (!classifyWidget) return
    const { txns, msgId, date, display } = classifyWidget

    // Save classifications to backend
    const items = Object.entries(classifications).map(([name, c]) => ({
      name: c.staffName || name,
      category: c.category,
    }))
    try {
      await classifyPersonsBatch(phone, items)
    } catch (e) {
      console.error('Classify batch failed:', e)
    }

    // Annotate transactions with their category and remap staff names
    const annotated = txns.map(t => {
      if (!t.person_name) return t
      const c = classifications[t.person_name]
      if (!c) return t
      const updated = {
        ...t,
        person_category: c.category,
        person_name: c.category === 'staff' && c.staffName ? c.staffName : t.person_name,
        needs_tracking: false,
      }
      // Store expense → force type to expense with a tag
      if (c.category === 'store_expense') {
        updated.type = 'expense'
        // Ensure a tag exists — use existing tag or derive from description
        if (!updated.tag) {
          updated.tag = _inferTag(updated.description || t.person_name || '')
        }
      }
      // Staff on OUT side → expense with staff_expense tag
      if (c.category === 'staff' && (t.type === 'expense' || t.type === 'udhaar_given')) {
        updated.type = 'expense'
        updated.tag = 'staff_expense'
      }
      return updated
    })

    // Refresh staff options after classification
    fetchStaff(phone)
      .then(data => setStaffOptions((data || []).map(s => s.name || s).filter(Boolean)))
      .catch(() => {})

    setClassifyWidget(null)
    setPhotoReview({ msgId, txns: annotated, date, display })
  }

  function handleClassifyCancel() {
    const msgId = classifyWidget?.msgId
    if (msgId) {
      const tempId = Date.now()
      const cancelMsg = {
        id: tempId, direction: 'bot',
        body: t('cancel_expense', language),
        created_at: new Date().toISOString()
      }
      const ackIds = findAckIds(messages, msgId)
      setMessages(prev => {
        const cleaned = removeIntermediates(prev, msgId).filter(m => m.id !== msgId)
        return [...cleaned, cancelMsg]
      })
      delete originalTxnsRef.current[msgId]
      // Persist dismissals + cancel message to DB so they survive reload
      const idsToDissmiss = [...ackIds, msgId]
      dismissBulk(phone, idsToDissmiss, t('cancel_expense', language))
        .then(res => {
          if (res?.cancel_msg_id) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: res.cancel_msg_id } : m))
          }
        })
        .catch(() => {})
    }
    setClassifyWidget(null)
  }

  // ── Remove intermediate bot messages between a user image and a bot msg ──
  // Used to clean up the "Photo padh raha hoon..." ack after save/cancel
  function removeIntermediates(prev, msgId) {
    const msgIndex = prev.findIndex(m => m.id === msgId)
    if (msgIndex === -1) return prev
    let imageIndex = -1
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (prev[i].direction === 'user' && prev[i].media_url) {
        imageIndex = i
        break
      }
    }
    if (imageIndex === -1) return prev
    // Remove bot messages between imageIndex and msgIndex (not including msgId)
    return prev.filter((m, i) => !(i > imageIndex && i < msgIndex && m.direction === 'bot'))
  }

  // ── Collect DB IDs of ack bot messages between a user image and msgId ──
  // These are the messages we need to mark as dismissed in the DB so they
  // don't reappear on reload.
  function findAckIds(msgs, msgId) {
    const msgIndex = msgs.findIndex(m => m.id === msgId)
    if (msgIndex === -1) return []
    let imageIndex = -1
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (msgs[i].direction === 'user' && msgs[i].media_url) {
        imageIndex = i
        break
      }
    }
    if (imageIndex === -1) return []
    return msgs
      .slice(imageIndex + 1, msgIndex)
      .filter(m => m.direction === 'bot' && typeof m.id === 'number')
      .map(m => m.id)
  }

  async function handleCancelConfirm(botMsgId) {
    const tempId = Date.now()
    const cancelMsg = {
      id: tempId, direction: 'bot',
      body: t('cancel_expense', language),
      created_at: new Date().toISOString()
    }
    // Remove ConfirmCard + all intermediate bot msgs (ack) between image and card, then add cancel msg
    const ackIds = findAckIds(messages, botMsgId)
    setMessages(prev => {
      const cleaned = removeIntermediates(prev, botMsgId).filter(m => m.id !== botMsgId)
      return [...cleaned, cancelMsg]
    })
    delete originalTxnsRef.current[botMsgId]
    // Persist dismissals + cancel message to DB so they survive reload
    const idsToDissmiss = [...ackIds, botMsgId]
    dismissBulk(phone, idsToDissmiss, t('cancel_expense', language))
      .then(res => {
        if (res?.cancel_msg_id) {
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: res.cancel_msg_id } : m))
        }
      })
      .catch(() => {})
  }

  // ── Clear entire chat ─────────────────────────────────────────────
  async function handleClearChat() {
    if (!window.confirm(t('clear_confirm', language))) return
    try {
      await clearChat(phone)
      setMessages([])
      lastIdRef.current = 0
      setQuickReplies([])
      setProcessing(false)
    } catch (e) {
      console.error('Clear chat failed:', e)
    }
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
            {processing ? t('processing_status', language) : 'Online'}
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
          onClick={handleClearChat}
          title={t('clear_chat', language)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>

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
              <b>{t('empty_title', language)}</b><br/>
              {t('empty_body', language)}
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

      {/* ── Person classification widget (before photo review) ── */}
      {classifyWidget && (
        <PersonClassifyWidget
          persons={classifyWidget.persons}
          staffOptions={staffOptions}
          onComplete={handleClassifyComplete}
          onCancel={handleClassifyCancel}
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
