/* Renders a single chat bubble — user (right, green) or bot (left, white).
   Handles WhatsApp-style *bold* and _italic_ formatting inline.
   Supports three metadata states:
     pending_transactions   → shows ConfirmCard (editable, not yet saved)
     confirmed_transactions → shows SavedCard (saved entries with delete)
     dismissed / overwritten → returns null (removed from view) */

import { useState } from 'react'
import ConfirmCard from './ConfirmCard.jsx'
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

// ── SavedCard: shown after ConfirmCard is confirmed ─────────────
const TYPE_COLORS_SC = {
  sale:'#25D366', receipt:'#25D366', udhaar_given:'#E53935',
  udhaar_received:'#25D366', expense:'#FF7043', bank_deposit:'#9C27B0',
  opening_balance:'#607D8B', closing_balance:'#607D8B',
  cash_in_hand:'#607D8B', upi_in_hand:'#2196F3',
}
const TYPE_LABELS_SC = {
  sale:'💰 Sale', receipt:'📨 Receipt', udhaar_given:'📤 Udhaar Diya',
  udhaar_received:'📥 Udhaar Mila', expense:'💸 Expense',
  bank_deposit:'🏦 Bank', opening_balance:'🔓 Opening', closing_balance:'🔒 Closing',
  cash_in_hand:'💵 Cash', upi_in_hand:'📱 UPI',
}

function SavedCard({ transactions: initialTxns, phone, createdAt }) {
  const [txns, setTxns] = useState(initialTxns || [])

  async function handleDelete(txnId, idx) {
    if (!txnId) return
    if (!window.confirm('Delete this entry?')) return
    try {
      await deleteTransaction(phone, txnId)
      setTxns(prev => prev.filter((_, i) => i !== idx))
    } catch (e) {
      alert('Delete failed: ' + e.message)
    }
  }

  if (txns.length === 0) {
    return <div className="saved-card saved-card-empty">🗑️ All entries deleted</div>
  }

  const totalIn  = txns.filter(t => ['sale','receipt','udhaar_received'].includes(t.type))
                       .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
  const totalOut = txns.filter(t => ['expense','udhaar_given','bank_deposit'].includes(t.type))
                       .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)

  return (
    <div className="saved-card">
      <div className="saved-card-header">
        ✅ {txns.length} entr{txns.length === 1 ? 'y' : 'ies'} saved
        {(totalIn > 0 || totalOut > 0) && (
          <span className="saved-card-totals">
            {totalIn  > 0 && <span style={{color:'#25D366'}}>  +₹{totalIn.toLocaleString('en-IN')}</span>}
            {totalOut > 0 && <span style={{color:'#E53935'}}>  −₹{totalOut.toLocaleString('en-IN')}</span>}
          </span>
        )}
      </div>
      {txns.map((t, i) => {
        const color = TYPE_COLORS_SC[t.type] || '#666'
        const label = TYPE_LABELS_SC[t.type] || t.type
        return (
          <div key={i} className="saved-entry-row">
            <span className="saved-entry-type" style={{color, background: color+'18'}}>
              {label}
            </span>
            <span className="saved-entry-body">
              <span className="saved-entry-desc">{t.description || '—'}</span>
              {t.person_name && <span className="saved-entry-person"> · 👤{t.person_name}</span>}
              {t.date && <span className="saved-entry-date"> · {t.date}</span>}
            </span>
            <span className="saved-entry-amount">₹{parseFloat(t.amount).toLocaleString('en-IN')}</span>
            <button
              className="saved-entry-delete"
              onClick={() => handleDelete(t.id, i)}
              title="Delete this entry"
            >🗑️</button>
          </div>
        )
      })}
    </div>
  )
}

// ── Main MessageBubble ──────────────────────────────────────────
export default function MessageBubble({ msg, phone, onConfirm, onCancel, onPendingEdit }) {
  const { direction, body, media_url, created_at, metadata } = msg
  const isUser = direction === 'user'

  // Dismissed or overwritten → invisible (clean up chat)
  if (!isUser && (metadata?.dismissed || metadata?.overwritten)) return null

  const pendingTxns   = !isUser && metadata?.pending_transactions
  const confirmedTxns = !isUser && metadata?.confirmed_transactions
  const showConfirmCard = pendingTxns?.length > 0 && onConfirm
  const showSavedCard   = confirmedTxns?.length > 0

  const count   = pendingTxns?.length || 0
  const txnDate = pendingTxns?.[0]?.date

  return (
    <div className={`msg-row ${direction}`}>
      <div className="bubble">
        {/* Image attachment */}
        {media_url && (
          <img src={media_url} alt="attachment" className="bubble-image"
               onClick={() => window.open(media_url, '_blank')} />
        )}

        {/* Plain text — hidden when ConfirmCard or SavedCard is shown */}
        {body && !showConfirmCard && !showSavedCard && (
          <p className="bubble-text">{formatText(body)}</p>
        )}

        {/* Compact header above ConfirmCard */}
        {showConfirmCard && (
          <p className="confirm-header-text">
            📋 <b>{count} entries found</b>{txnDate ? ` · ${txnDate}` : ''}
            <br/><span style={{fontSize:11,color:'#888'}}>Review and edit below, then save</span>
          </p>
        )}

        {/* Confirm card (pending, not yet saved) */}
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
