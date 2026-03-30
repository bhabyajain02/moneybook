import { useState } from 'react'
import {
  EditForm, ConfPill, AddEntryForm,
  TYPE_COLORS, TYPE_OPTIONS, fmtRs,
} from './ConfirmCard.jsx'

// Types that belong on the IN (JAMA) side
const IN_TYPES  = new Set(['sale','receipt','udhaar_received','cash_in_hand','upi_in_hand','opening_balance'])
// Types on the OUT (NAAM) side
const OUT_TYPES = new Set(['expense','udhaar_given','bank_deposit','closing_balance'])

// ── Single cell in the review grid ─────────────────────────────
function ReviewCell({ entry, editingIdx, onEdit, onUpdate, onDelete }) {
  if (!entry) return <div className="rlg-cell-empty" />
  const { txn, idx } = entry
  const color     = TYPE_COLORS[txn.type] || '#94a3b8'
  const typeLabel = TYPE_OPTIONS.find(o => o.value === txn.type)?.label || txn.type
  const isLowConf = (txn.confidence ?? 100) < 70

  if (editingIdx === idx) {
    return (
      <div className="rlg-cell rlg-cell-editing">
        <EditForm
          txn={txn}
          onSave={u   => { onUpdate(idx, u); onEdit(null) }}
          onDiscard={() => onEdit(null)}
        />
      </div>
    )
  }

  return (
    <div
      className={`rlg-cell${isLowConf ? ' rlg-lowconf' : ''}`}
      style={{ borderLeftColor: color }}
      onClick={() => onEdit(idx)}
    >
      <div className="rlg-cell-top">
        <span className="rlg-type-pill" style={{ color, background: color + '1a' }}>{typeLabel}</span>
        {isLowConf && <span title="Low confidence — verify" style={{ fontSize: 11 }}>⚠️</span>}
      </div>
      <div className="rlg-desc">{txn.description || '—'}</div>
      <div className="rlg-amount">
        ₹{parseFloat(txn.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
      {txn.person_name && <div className="rlg-person">👤 {txn.person_name}</div>}
      <div className="rlg-actions">
        <button className="rlg-btn" onClick={e => { e.stopPropagation(); onEdit(idx) }} title="Edit">✏️</button>
        <button className="rlg-btn" onClick={e => { e.stopPropagation(); onDelete(idx) }} title="Delete">🗑️</button>
      </div>
    </div>
  )
}

// ── 2-column review grid ────────────────────────────────────────
function ReviewLedgerGrid({ txns, onUpdate, onDelete }) {
  const [editingIdx, setEditingIdx] = useState(null)

  // Split into IN / OUT / uncategorised — carry original index
  const inEntries    = []
  const outEntries   = []
  const otherEntries = []
  txns.forEach((t, i) => {
    if (!t) return
    if (IN_TYPES.has(t.type))   inEntries.push({ txn: t, idx: i })
    else if (OUT_TYPES.has(t.type)) outEntries.push({ txn: t, idx: i })
    else otherEntries.push({ txn: t, idx: i })
  })

  const maxRows = Math.max(inEntries.length, outEntries.length)

  const cellProps = {
    editingIdx,
    onEdit:   setEditingIdx,
    onUpdate,
    onDelete,
  }

  return (
    <div className="review-ledger-grid">

      {/* Column headers */}
      <div className="rlg-col-headers">
        <div className="rlg-col-header rlg-jama-header">
          <span className="rlg-hindi">जमा</span>
          <span className="rlg-en-label">JAMA (IN)</span>
        </div>
        <div className="rlg-vdivider" />
        <div className="rlg-col-header rlg-naam-header">
          <span className="rlg-hindi">नाम</span>
          <span className="rlg-en-label">NAAM (OUT)</span>
        </div>
      </div>

      {/* Entry rows */}
      <div className="rlg-rows">
        {maxRows === 0 ? (
          <div className="rlg-empty-msg">No entries yet — add one below</div>
        ) : (
          Array.from({ length: maxRows }).map((_, i) => (
            <div key={i} className="rlg-row">
              <div className="rlg-col">
                <ReviewCell entry={inEntries[i] ?? null} {...cellProps} />
              </div>
              <div className="rlg-vdivider" />
              <div className="rlg-col">
                <ReviewCell entry={outEntries[i] ?? null} {...cellProps} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Uncategorised entries */}
      {otherEntries.length > 0 && (
        <div className="rlg-other-section">
          <div className="rlg-other-label">Other entries</div>
          <div className="rlg-other-list">
            {otherEntries.map(entry => (
              <ReviewCell key={entry.idx} entry={entry} {...cellProps} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


// ── Main PhotoReviewCard ────────────────────────────────────────
export default function PhotoReviewCard({ metadata, onConfirm, onCancel, onPendingEdit }) {
  const rawTxns  = metadata.pending_transactions || []
  const initDate = metadata.page_date || rawTxns[0]?.date || new Date().toISOString().slice(0, 10)

  const [txns,      setTxns]      = useState(rawTxns)
  const [batchDate, setBatchDate] = useState(initDate)
  const [adding,    setAdding]    = useState(false)

  function syncUp(newTxns) { onPendingEdit?.(newTxns.filter(Boolean)) }

  function handleBatchDate(newDate) {
    if (!newDate) return
    setBatchDate(newDate)
    setTxns(prev => {
      const next = prev.map(t => t ? { ...t, date: newDate } : t)
      syncUp(next)
      return next
    })
  }

  function handleUpdate(idx, updated) {
    setTxns(prev => {
      const next = prev.map((t, i) => i === idx ? updated : t)
      syncUp(next)
      return next
    })
  }

  function handleDelete(idx) {
    setTxns(prev => {
      const next = prev.map((t, i) => i === idx ? null : t)
      syncUp(next)
      return next
    })
  }

  const liveTxns = txns.filter(Boolean)
  const totalIn  = liveTxns.filter(t => IN_TYPES.has(t.type))
                            .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
  const totalOut = liveTxns.filter(t => OUT_TYPES.has(t.type))
                            .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)

  const dateStr = batchDate
    ? new Date(batchDate + 'T00:00:00').toLocaleDateString('en-IN',
        { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Today'

  return (
    <div className="photo-review-card">

      {/* ── Header: count + date ── */}
      <div className="photo-stack-header">
        <div className="photo-split-title">📋 <b>{liveTxns.length} entries found</b></div>
        <div className="photo-split-date">
          <span>📅</span>
          <input type="date" className="confirm-date-inline" value={batchDate}
            onChange={e => handleBatchDate(e.target.value)} />
        </div>
      </div>

      {/* ── IN / OUT summary bar ── */}
      {(totalIn > 0 || totalOut > 0) && (
        <div className="photo-summary-bar">
          <div className="photo-summary-in">
            <span className="photo-summary-label">IN</span>
            <span className="photo-summary-amount">{fmtRs(totalIn)}</span>
          </div>
          <div className="photo-summary-divider" />
          <div className="photo-summary-out">
            <span className="photo-summary-label">OUT</span>
            <span className="photo-summary-amount">{fmtRs(totalOut)}</span>
          </div>
        </div>
      )}

      {/* ── Ledger grid ── */}
      <div className="photo-stack-table">
        <ReviewLedgerGrid
          txns={txns}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      </div>

      {/* ── Actions ── */}
      <div className="photo-stack-actions">
        {adding ? (
          <AddEntryForm
            onAdd={txn => {
              setTxns(prev => { const n = [...prev, txn]; syncUp(n); return n })
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button className="add-entry-btn" onClick={() => setAdding(true)}>
            ➕ Add missed entry
          </button>
        )}
        <div className="confirm-card-actions">
          <button className="confirm-save-btn" onClick={() => onConfirm(liveTxns)}>
            ✅ Save All ({liveTxns.length})
          </button>
          <button className="confirm-cancel-btn" onClick={onCancel}>❌</button>
        </div>
      </div>

    </div>
  )
}
