/* Renders a single chat bubble — user (right, green) or bot (left, white).
   Handles WhatsApp-style *bold* and _italic_ formatting inline.
   Supports three metadata states:
     pending_transactions   → shows ConfirmCard (editable, not yet saved)
     confirmed_transactions → shows SavedCard (saved entries with delete)
     dismissed / overwritten → returns null (removed from view) */

import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import ConfirmCard from './ConfirmCard.jsx'
import PhotoReviewCard from './PhotoReviewCard.jsx'
import { deleteTransaction } from '../api.js'
import { t } from '../translations.js'

// Duration to fill from 5% → 90% while reading (ms)
const READING_DURATION_MS = 5 * 60 * 1000   // 5 minutes
const READING_START_PCT   = 5
const READING_CAP_PCT     = 90

/** Parse a server timestamp. The backend uses datetime.utcnow().isoformat()
 *  which emits naive ISO (no "Z"). Default Date.parse would treat that as
 *  LOCAL time — causing a 5.5h offset in IST and breaking elapsed calc.
 *  We append 'Z' when no timezone info is present. */
function parseUtcIso(ts) {
  if (!ts) return 0
  let s = String(ts).replace(' ', 'T')
  if (!/(Z|[+\-]\d\d:?\d\d)$/.test(s)) s += 'Z'
  const p = Date.parse(s)
  return isNaN(p) ? 0 : p
}

/** Smoothly interpolate reading progress over time so the bar feels like
 *  it's actively reading. Server can still override (e.g. operator picks → 95). */
function useSmoothProgress(msg) {
  const meta = msg?.metadata || {}
  const serverPct = typeof meta.progress === 'number' ? meta.progress : null
  const createdAt = msg?.created_at
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // Keep ticking until server signals completion (100%).
    if (serverPct == null || serverPct >= 100) return
    const id = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(id)
  }, [serverPct])

  if (serverPct == null) return null

  const startMs = parseUtcIso(createdAt)

  // Time-based progress: 5 → 90 linearly over READING_DURATION_MS
  let timePct = READING_START_PCT
  if (startMs > 0) {
    const elapsed = Math.max(0, now - startMs)
    const frac = Math.min(1, elapsed / READING_DURATION_MS)
    timePct = READING_START_PCT + frac * (READING_CAP_PCT - READING_START_PCT)
  }

  // Stay at time-based (capped 90%) until server signals completion → 100%.
  let shown
  if (serverPct >= 100) shown = 100
  else                  shown = Math.max(serverPct, Math.min(READING_CAP_PCT, timePct))

  // Single consistent label while in-flight: "Preparing your entries..."
  let labelKey = shown >= 100 ? 'progress_completed' : 'progress_reading'
  // If server provides a specific non-reading label (e.g. rejected), honor it
  if (meta.progress_label && meta.progress_label !== 'reading' && meta.progress_label !== 'photo_received') {
    labelKey = `progress_${meta.progress_label}`
  }

  return { progress: Math.round(shown), labelKey }
}

const BACKEND_URL = 'https://moneybook-1.onrender.com'

// Normalize image URLs so they work on both web and native Android/iOS.
// On web: relative paths like /api/uploads/x.jpg resolve against the current domain — fine.
// On native (Capacitor): the app has no "current domain", so relative paths break.
//   → We must prefix them with the absolute backend URL.
function normalizeImageUrl(url) {
  if (!url) return url
  if (url.startsWith('blob:')) return url
  if (url.startsWith('/uploads/')) url = '/api' + url   // legacy path fix
  if (url.startsWith('/') && Capacitor.isNativePlatform()) {
    return BACKEND_URL + url   // make absolute for Android/iOS
  }
  return url
}

// ── Inline formatting ──────────────────────────────────────────
function formatText(text) {
  if (!text) return null
  const parts = []
  const regex = /(\*[^*]+\*|_[^_]+_|`[^`]+`)/g
  let last = 0, m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('*')) parts.push(<b key={m.index}>{token.slice(1,-1)}</b>)
    else if (token.startsWith('_')) parts.push(<em key={m.index}>{token.slice(1,-1)}</em>)
    else if (token.startsWith('`')) parts.push(<span key={m.index} className="mono">{token.slice(1,-1)}</span>)
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function formatTime(iso) {
  if (!iso) return ''
  // Server timestamps come as "YYYY-MM-DD HH:MM:SS" with no timezone marker (they are UTC).
  // Without a marker, browsers treat the string as *local* time — causing an IST offset error.
  // Normalise: replace the space separator with T and append Z so the browser always reads UTC.
  const normalized = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

// ── SavedCard: 2-column JAMA/NAAM format after confirmation ─────
const SC_COLORS = {
  sale:'#25D366', receipt:'#25D366', dues_given:'#E53935', udhaar_given:'#E53935',
  dues_received:'#25D366', udhaar_received:'#25D366', expense:'#FF7043', bank_deposit:'#9C27B0',
  opening_balance:'#607D8B', closing_balance:'#607D8B',
  cash_in_hand:'#607D8B', upi_in_hand:'#2196F3', other:'#78909C',
}
const SC_LABEL_KEYS = {
  sale:'type_sale', receipt:'type_receipt', dues_given:'type_dues_given', udhaar_given:'type_dues_given',
  dues_received:'type_dues_received', udhaar_received:'type_dues_received', expense:'type_expense',
  bank_deposit:'type_bank_deposit', opening_balance:'type_opening_bal', closing_balance:'type_closing_bal',
  cash_in_hand:'type_cash_in_hand', upi_in_hand:'type_upi_in_hand', other:'type_other',
}
function getSCLabel(type, language) {
  const key = SC_LABEL_KEYS[type]
  return key ? t(key, language) : type
}
const SC_IN  = new Set(['sale','receipt','dues_received','udhaar_received','cash_in_hand','upi_in_hand','opening_balance'])
const SC_OUT = new Set(['expense','dues_given','udhaar_given','bank_deposit','closing_balance'])

function SavedCell({ txn, onDelete, language }) {
  if (!txn) return <div className="sc-cell-empty" />
  const color = SC_COLORS[txn.type] || '#94a3b8'
  const label = getSCLabel(txn.type, language)
  const hideLabel = txn.type === 'other'
  return (
    <div className="sc-cell" style={{ borderLeftColor: color }}>
      {!hideLabel && <span className="sc-type" style={{ color, background: color + '18' }}>{label}</span>}
      <div className="sc-desc">{txn.description || '—'}</div>
      <div className="sc-amount">₹{parseFloat(txn.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
      {txn.person_name && <div className="sc-person">👤 {txn.person_name}</div>}
      {txn.id && (
        <button className="sc-delete" onClick={() => onDelete(txn.id)} title="Delete">🗑️</button>
      )}
    </div>
  )
}

function SavedCard({ transactions: initialTxns, phone, language }) {
  const [txns, setTxns] = useState(initialTxns || [])

  async function handleDelete(txnId) {
    if (!window.confirm('Delete this entry?')) return
    try {
      await deleteTransaction(phone, txnId)
      setTxns(prev => prev.filter(t => t.id !== txnId))
    } catch (e) {
      alert('Delete failed: ' + e.message)
    }
  }

  if (txns.length === 0) {
    return <div className="saved-card saved-card-empty">🗑️ All entries deleted</div>
  }

  const inEntries    = txns.filter(t => SC_IN.has(t.type) || (t.type === 'other' && t.column === 'in'))
  const outEntries   = txns.filter(t => SC_OUT.has(t.type) || (t.type === 'other' && t.column !== 'in'))
  const otherEntries = txns.filter(t => !SC_IN.has(t.type) && !SC_OUT.has(t.type) && t.type !== 'other')
  const maxRows      = Math.max(inEntries.length, outEntries.length)

  const totalIn  = inEntries .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
  const totalOut = outEntries.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)

  const cardDate = txns[0]?.date
  const dateStr = cardDate
    ? new Date(cardDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <div className="saved-card saved-card-2col">
      {/* Header */}
      <div className="sc-header">
        <span>✅ {txns.length} entr{txns.length === 1 ? 'y' : 'ies'} saved</span>
        <span className="sc-header-totals">
          {totalIn  > 0 && <span className="sc-total-in">+₹{totalIn.toLocaleString('en-IN')}</span>}
          {totalOut > 0 && <span className="sc-total-out">−₹{totalOut.toLocaleString('en-IN')}</span>}
        </span>
      </div>
      {dateStr && <div className="sc-date-row">{dateStr}</div>}

      {/* 2-column grid */}
      <div className="sc-col-headers">
        <div className="sc-col-label sc-jama-label">{t('jama_in', language)}</div>
        <div className="sc-vdivider" />
        <div className="sc-col-label sc-naam-label">{t('naam_out', language)}</div>
      </div>

      <div className="sc-grid-rows">
        {Array.from({ length: maxRows }).map((_, i) => (
          <div key={i} className="sc-grid-row">
            <div className="sc-col">
              <SavedCell txn={inEntries[i] ?? null} onDelete={handleDelete} language={language} />
            </div>
            <div className="sc-vdivider" />
            <div className="sc-col">
              <SavedCell txn={outEntries[i] ?? null} onDelete={handleDelete} language={language} />
            </div>
          </div>
        ))}
      </div>

      {/* Other entries (spanning full width) */}
      {otherEntries.map((txn, i) => (
        <div key={`other-${i}`} className="sc-other-row">
          <SavedCell txn={txn} onDelete={handleDelete} language={language} />
        </div>
      ))}

      {/* Totals row */}
      {maxRows > 0 && (
        <div className="sc-totals-row">
          <div className="sc-col sc-total-cell">
            {totalIn > 0 && <span className="sc-total-in">₹{totalIn.toLocaleString('en-IN')}</span>}
          </div>
          <div className="sc-vdivider" />
          <div className="sc-col sc-total-cell">
            {totalOut > 0 && <span className="sc-total-out">₹{totalOut.toLocaleString('en-IN')}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main MessageBubble ──────────────────────────────────────────
export default function MessageBubble({ msg, phone, onConfirm, onCancel, onPendingEdit, onOpenLedger, language }) {
  const { direction, body, media_url, created_at, metadata } = msg
  const isUser = direction === 'user'
  // Progress metadata lives on whichever message has it (currently the bot's
  // "Photo received!" ack). Only animate when still in-flight (< 100%).
  const hasProgress = typeof metadata?.progress === 'number' && metadata.progress < 100
  const smoothProgress = useSmoothProgress(hasProgress ? msg : null)

  // Dismissed or overwritten → invisible (clean up chat)
  if (!isUser && (metadata?.dismissed || metadata?.overwritten)) return null

  const pendingTxns    = !isUser && metadata?.pending_transactions
  const confirmedTxns  = !isUser && metadata?.confirmed_transactions
  // Photo-sourced messages have metadata.display — use the richer PhotoReviewCard
  const isPhotoSource  = !isUser && !!metadata?.display

  // Low-confidence detection: avg confidence < 70 across all entries → image unclear
  const isLowConfImage = isPhotoSource && (() => {
    const txns = pendingTxns || []
    if (!txns.length) return true  // no entries parsed = completely unreadable
    const avg = txns.reduce((s, t) => s + (t.confidence ?? 100), 0) / txns.length
    return avg < 70
  })()

  const showLowConfWarning = isLowConfImage && onConfirm
  const showPhotoReview = isPhotoSource && !isLowConfImage && pendingTxns?.length > 0 && onConfirm
  const showConfirmCard = !isPhotoSource && pendingTxns?.length > 0 && onConfirm
  const showSavedCard   = confirmedTxns?.length > 0

  const count   = pendingTxns?.length || 0
  const txnDate = pendingTxns?.[0]?.date

  // Full-width for photo review OR large saved cards (4+ entries)
  const isWide = showPhotoReview || (showSavedCard && confirmedTxns.length >= 4)

  return (
    <div className={`msg-row ${direction}${isWide ? ' msg-row--photo' : ''}`}>
      <div className="bubble">
        {/* Image attachment — hidden when PhotoReviewCard is shown (it has its own thumbnail) */}
        {media_url && !showPhotoReview && (
          <img src={normalizeImageUrl(media_url)} alt="Uploaded photo" className="bubble-image"
               onClick={() => window.open(normalizeImageUrl(media_url), '_blank')} />
        )}

        {/* "From photo #N" tag on saved-entries cards — lets user match the card to the bar */}
        {!isUser && metadata?.saved_from_photo && metadata.queue_id && (
          <div style={{
            fontSize: 10,
            color: '#888',
            fontWeight: 600,
            letterSpacing: 0.3,
            marginBottom: 6,
          }}>
            📷 Photo #{metadata.queue_id}
          </div>
        )}

        {/* Photo processing progress bar — rendered on the bot's "Photo received!"
            message (or any message carrying progress metadata).
            Smooth time-based interpolation: 5% → 90% over 5 min, then server overrides. */}
        {smoothProgress && smoothProgress.progress < 100 && (
          <div className="photo-progress" style={{ marginTop: 6 }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: '#546E7A',
              marginBottom: 4,
              fontWeight: 500,
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span className="reading-dot" style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#25D366',
                  display: 'inline-block',
                  animation: 'pulse 1.2s ease-in-out infinite',
                }} />
                {metadata?.queue_id && (
                  <span style={{ color: '#1a1a1a', fontWeight: 700 }}>
                    #{metadata.queue_id}
                  </span>
                )}
                <span>{t(smoothProgress.labelKey, language)}</span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{smoothProgress.progress}%</span>
            </div>
            <div style={{
              height: 5,
              borderRadius: 3,
              background: 'rgba(0,0,0,0.08)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${smoothProgress.progress}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #25D366 0%, #128C7E 100%)',
                transition: 'width 1.2s linear',
              }} />
            </div>
          </div>
        )}

        {/* Plain text — hidden when any card is shown */}
        {body && !showPhotoReview && !showConfirmCard && !showSavedCard && (
          <p className="bubble-text">{formatText(body)}</p>
        )}

        {/* Compact header above text-sourced ConfirmCard */}
        {showConfirmCard && (
          <p className="confirm-header-text">
            📋 <b>{count} entries found</b>{txnDate ? ` · ${txnDate}` : ''}
            <br/><span style={{fontSize:11,color:'#888'}}>Review and edit below, then save</span>
          </p>
        )}

        {/* Low-confidence image warning — open empty ledger for manual entry */}
        {showLowConfWarning && (
          <div className="low-conf-warning">
            <div className="low-conf-icon">⚠️</div>
            <div className="low-conf-text">
              <b>{t('low_conf_title', language)}</b><br/>
              <span>{t('low_conf_body', language)}</span>
            </div>
            <button className="low-conf-btn" onClick={() => { onCancel?.(); onOpenLedger?.() }}>
              {t('low_conf_btn', language)}
            </button>
          </div>
        )}

        {/* Photo Review Card — full-width, notebook-format (image-sourced) */}
        {showPhotoReview && (
          <PhotoReviewCard metadata={metadata} onConfirm={onConfirm} onCancel={onCancel} onPendingEdit={onPendingEdit} />
        )}

        {/* Confirm card — text-sourced transactions */}
        {showConfirmCard && (
          <ConfirmCard metadata={metadata} onConfirm={onConfirm} onCancel={onCancel} onPendingEdit={onPendingEdit} language={language} />
        )}

        {/* Saved card (confirmed entries with delete buttons) */}
        {showSavedCard && (
          <SavedCard transactions={confirmedTxns} phone={phone} createdAt={created_at} language={language} />
        )}

        {/* Timestamp + ticks */}
        <div className="bubble-meta">
          <span className="bubble-time">{formatTime(created_at)}</span>
          {isUser && <span className="tick">✓✓</span>}
        </div>
      </div>
    </div>
  )
}
