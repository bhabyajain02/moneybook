/* Renders a single chat bubble — user (right, green) or bot (left, white).
   Handles WhatsApp-style *bold* and _italic_ formatting inline.
   Supports three metadata states:
     pending_transactions   → shows ConfirmCard (editable, not yet saved)
     confirmed_transactions → shows SavedCard (saved entries with delete)
     dismissed / overwritten → returns null (removed from view) */

import { useState } from 'react'
import ConfirmCard from './ConfirmCard.jsx'
import PhotoReviewCard from './PhotoReviewCard.jsx'
import { deleteTransaction } from '../api.js'

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
  const d = new Date(iso)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

// ── SavedCard: 2-column JAMA/NAAM format after confirmation ─────
const SC_COLORS = {
  sale:'#25D366', receipt:'#25D366', dues_given:'#E53935', udhaar_given:'#E53935',
  dues_received:'#25D366', udhaar_received:'#25D366', expense:'#FF7043', bank_deposit:'#9C27B0',
  opening_balance:'#607D8B', closing_balance:'#607D8B',
  cash_in_hand:'#607D8B', upi_in_hand:'#2196F3', other:'#78909C',
}
const SC_LABELS = {
  sale:'💰 Sale', receipt:'📨 Receipt', dues_given:'📤 Dues Given', udhaar_given:'📤 Dues Given',
  dues_received:'📥 Dues Received', udhaar_received:'📥 Dues Received', expense:'💸 Expense',
  bank_deposit:'🏦 Bank', opening_balance:'🔓 Opening', closing_balance:'🔒 Closing',
  cash_in_hand:'💵 Cash', upi_in_hand:'📱 UPI', other:'📋 Other',
}
const SC_IN  = new Set(['sale','receipt','dues_received','udhaar_received','cash_in_hand','upi_in_hand','opening_balance'])
const SC_OUT = new Set(['expense','dues_given','udhaar_given','bank_deposit','closing_balance'])

function SavedCell({ txn, onDelete }) {
  if (!txn) return <div className="sc-cell-empty" />
  const color = SC_COLORS[txn.type] || '#94a3b8'
  const label = SC_LABELS[txn.type] || txn.type
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

function SavedCard({ transactions: initialTxns, phone }) {
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
        <div className="sc-col-label sc-jama-label">जमा IN</div>
        <div className="sc-vdivider" />
        <div className="sc-col-label sc-naam-label">नाम OUT</div>
      </div>

      <div className="sc-grid-rows">
        {Array.from({ length: maxRows }).map((_, i) => (
          <div key={i} className="sc-grid-row">
            <div className="sc-col">
              <SavedCell txn={inEntries[i] ?? null} onDelete={handleDelete} />
            </div>
            <div className="sc-vdivider" />
            <div className="sc-col">
              <SavedCell txn={outEntries[i] ?? null} onDelete={handleDelete} />
            </div>
          </div>
        ))}
      </div>

      {/* Other entries (spanning full width) */}
      {otherEntries.map((t, i) => (
        <div key={`other-${i}`} className="sc-other-row">
          <SavedCell txn={t} onDelete={handleDelete} />
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
export default function MessageBubble({ msg, phone, onConfirm, onCancel, onPendingEdit, onOpenLedger }) {
  const { direction, body, media_url, created_at, metadata } = msg
  const isUser = direction === 'user'

  // Dismissed or overwritten → invisible (clean up chat)
  if (!isUser && (metadata?.dismissed || metadata?.overwritten)) return null

  const pendingTxns    = !isUser && metadata?.pending_transactions
  const confirmedTxns  = !isUser && metadata?.confirmed_transactions
  // Photo-sourced messages have metadata.display — use the richer PhotoReviewCard
  const isPhotoSource  = !isUser && !!metadata?.display

  // Low-confidence detection: avg confidence < 55 across all entries → image unclear
  const isLowConfImage = isPhotoSource && (() => {
    const txns = pendingTxns || []
    if (!txns.length) return true  // no entries parsed = completely unreadable
    const avg = txns.reduce((s, t) => s + (t.confidence ?? 100), 0) / txns.length
    return avg < 55
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
          <img src={media_url} alt="attachment" className="bubble-image"
               onClick={() => window.open(media_url, '_blank')} />
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
              <b>Image not clear</b><br/>
              <span>Could not read entries reliably. Please add details manually.</span>
            </div>
            <button className="low-conf-btn" onClick={() => { onCancel?.(); onOpenLedger?.() }}>
              📋 Enter Manually
            </button>
          </div>
        )}

        {/* Photo Review Card — full-width, notebook-format (image-sourced) */}
        {showPhotoReview && (
          <PhotoReviewCard metadata={metadata} onConfirm={onConfirm} onCancel={onCancel} onPendingEdit={onPendingEdit} />
        )}

        {/* Confirm card — text-sourced transactions */}
        {showConfirmCard && (
          <ConfirmCard metadata={metadata} onConfirm={onConfirm} onCancel={onCancel} onPendingEdit={onPendingEdit} />
        )}

        {/* Saved card (confirmed entries with delete buttons) */}
        {showSavedCard && (
          <SavedCard transactions={confirmedTxns} phone={phone} createdAt={created_at} />
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
