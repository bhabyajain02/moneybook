import { useState } from 'react'
import {
  EditForm, ConfPill, AddEntryForm,
  TYPE_COLORS, TYPE_OPTIONS, fmtRs,
} from './ConfirmCard.jsx'

// ── Notebook-format right panel ───────────────────────────────────
// Renders in the same visual format the notebook was written:
//   two_column → side-by-side grid (left col / right col)
//   table      → multi-column HTML table with real headers
//   list       → single-column stacked cards
function NotebookPanel({ txns, display, onUpdate, onDelete }) {
  const [editingIdx, setEditingIdx] = useState(null)

  const layout     = display?.layout || 'list'
  const displayRows = display?.rows  || []
  const headers    = display?.headers || []

  // Normalize old txn_index (int) and new txn_indices (array) — backward compat
  function getIndices(row) {
    if (Array.isArray(row.txn_indices)) return row.txn_indices
    if (row.txn_index != null) return [row.txn_index]
    return (row.cells || []).map(() => null)
  }

  // Track which txns are covered by display.rows mapping
  const coveredSet = new Set()
  displayRows.forEach(row => {
    getIndices(row).forEach(idx => {
      if (idx != null && idx >= 0 && idx < txns.length && txns[idx]) coveredSet.add(idx)
    })
  })
  const orphans = txns
    .map((t, i) => (t && !coveredSet.has(i)) ? { txn: t, idx: i } : null)
    .filter(Boolean)
  const useFallback = coveredSet.size === 0

  // ── Single transaction card — shown in any layout ──────────────
  function TxnCard({ txnIdx, rawText }) {
    const txn = (txnIdx != null && txns[txnIdx]) ? txns[txnIdx] : null
    if (!txn) {
      // Non-transaction cell (divider/total/header text)
      const t = rawText?.trim()
      return t ? <div className="nb-non-txn-cell">{t}</div> : null
    }

    const isLowConf = (txn.confidence ?? 100) < 70
    const color     = TYPE_COLORS[txn.type] || '#ccc'
    const typeLabel = TYPE_OPTIONS.find(o => o.value === txn.type)?.label || txn.type

    if (editingIdx === txnIdx) {
      return (
        <div className="nb-cell-card nb-cell-editing">
          <EditForm
            txn={txn}
            onSave={u   => { onUpdate(txnIdx, u); setEditingIdx(null) }}
            onDiscard={() => setEditingIdx(null)}
          />
        </div>
      )
    }

    return (
      <div className={`nb-cell-card${isLowConf ? ' nb-row-lowconf' : ''}`}
           style={{ borderLeftColor: color }}>
        <div className="nb-cell-top">
          <span className="nb-type-pill" style={{ background: color + '1a', color }}>{typeLabel}</span>
          {isLowConf && <span className="nb-lowconf-warn" title="Low confidence — verify">⚠️</span>}
        </div>
        <div className="nb-txn-desc">{txn.description || '—'}</div>
        <div className="nb-cell-amount">
          ₹{parseFloat(txn.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </div>
        {txn.tag        && <div className="nb-txn-tag">🏷️ {txn.tag.replace(/_/g, ' ')}</div>}
        {txn.person_name && <div className="nb-txn-person">{txn.person_name}</div>}
        {rawText?.trim() && <div className="nb-raw-cell-text">📝 {rawText.trim()}</div>}
        <div className="nb-cell-actions">
          <button className="nb-btn" onClick={() => setEditingIdx(txnIdx)} title="Edit">✏️</button>
          <button className="nb-btn" onClick={() => onDelete(txnIdx)} title="Delete">🗑️</button>
        </div>
      </div>
    )
  }

  // ── Orphan footer — transactions the display mapping missed ─────
  function OrphanSection() {
    if (useFallback || orphans.length === 0) return null
    return (
      <div className="nb-orphan-section">
        <div className="nb-orphan-divider">Also found on this page</div>
        <div className="nb-list-layout">
          {orphans.map(({ txn, idx }) => <TxnCard key={idx} txnIdx={idx} rawText="" />)}
        </div>
      </div>
    )
  }

  // ── Layout: two_column ─────────────────────────────────────────
  if (layout === 'two_column' && !useFallback) {
    return (
      <div className="nb-two-col-wrap">
        {headers.length > 0 && (
          <div className="nb-two-col-headers">
            {headers.map((h, i) => <div key={i} className="nb-col-header">{h}</div>)}
          </div>
        )}
        {displayRows.map((row, ri) => {
          const cells   = row.cells   || []
          const indices = getIndices(row)
          return (
            <div key={ri} className="nb-two-col-row">
              {cells.map((cellText, ci) => (
                <div key={ci} className="nb-two-col-cell">
                  <TxnCard txnIdx={indices[ci] ?? null} rawText={cellText} />
                </div>
              ))}
            </div>
          )
        })}
        <OrphanSection />
      </div>
    )
  }

  // ── Layout: table ──────────────────────────────────────────────
  if (layout === 'table' && !useFallback) {
    return (
      <div className="notebook-table-wrap">
        <table className="notebook-table">
          {headers.length > 0 && (
            <thead>
              <tr>
                {headers.map((h, i) => <th key={i}>{h}</th>)}
                <th className="nb-actions-col"></th>
              </tr>
            </thead>
          )}
          <tbody>
            {displayRows.map((row, ri) => {
              const cells   = row.cells   || []
              const indices = getIndices(row)
              const allNull = indices.every(i => i == null)
              if (allNull) {
                // Divider row
                return (
                  <tr key={`div-${ri}`} className="nb-row-divider">
                    <td colSpan={Math.max(headers.length, cells.length) + 1}
                        className="nb-divider-cell">
                      {cells.join(' · ')}
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={ri} className="nb-row-data">
                  {cells.map((cellText, ci) => (
                    <td key={ci} className="nb-cell">
                      <TxnCard txnIdx={indices[ci] ?? null} rawText={cellText} />
                    </td>
                  ))}
                  {/* Pad if fewer cells than headers */}
                  {cells.length < headers.length && (
                    Array.from({ length: headers.length - cells.length })
                      .map((_, i) => <td key={`pad-${i}`} className="nb-cell" />)
                  )}
                  <td className="nb-actions-sticky"></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <OrphanSection />
      </div>
    )
  }

  // ── Layout: list (default / fallback) ──────────────────────────
  const listItems = useFallback
    ? txns.map((t, i) => t ? { txnIdx: i, rawText: '' } : null).filter(Boolean)
    : displayRows.map((row, ri) => {
        const cells   = row.cells   || []
        const indices = getIndices(row)
        const txnIdx  = indices.find(i => i != null) ?? null
        return { txnIdx, rawText: cells.join(' · '), ri }
      })

  return (
    <div className="nb-list-layout">
      {headers.length > 0 && (
        <div className="photo-layout-hint">📓 {headers.join(' · ')}</div>
      )}
      {listItems.map((item, i) => (
        <TxnCard key={item.txnIdx ?? `div-${i}`} txnIdx={item.txnIdx} rawText={item.rawText} />
      ))}
      <OrphanSection />
    </div>
  )
}


// ── Main PhotoReviewCard — split panel layout ─────────────────────
export default function PhotoReviewCard({ metadata, onConfirm, onCancel, onPendingEdit }) {
  const rawTxns  = metadata.pending_transactions || []
  const initDate = metadata.page_date || rawTxns[0]?.date || new Date().toISOString().slice(0, 10)
  const display  = metadata.display  || null
  const mediaUrl = metadata.media_url || null

  const [txns,        setTxns]        = useState(rawTxns)
  const [batchDate,   setBatchDate]   = useState(initDate)
  const [editingDate, setEditingDate] = useState(false)
  const [adding,      setAdding]      = useState(false)

  function syncUp(newTxns) { onPendingEdit?.(newTxns.filter(Boolean)) }

  function handleBatchDate(newDate) {
    setBatchDate(newDate)
    setTxns(prev => {
      const next = prev.map(t => t ? { ...t, date: newDate } : t)
      syncUp(next)
      return next
    })
    setEditingDate(false)
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
  const totalIn  = liveTxns.filter(t => ['sale','receipt','udhaar_received'].includes(t.type))
                            .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
  const totalOut = liveTxns.filter(t => ['expense','udhaar_given','bank_deposit'].includes(t.type))
                            .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)

  const dateStr = batchDate
    ? new Date(batchDate + 'T00:00:00').toLocaleDateString('en-IN',
        { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Today'

  return (
    <>
      <div className="photo-review-card">

        {/* ── AI's understanding ── */}
        <div className="photo-stack-entries">

          {/* Header: count + date */}
          <div className="photo-stack-header">
            <div className="photo-split-title">📋 <b>{liveTxns.length} entries found</b></div>
            <div className="photo-split-date">
              {editingDate ? (
                <input type="date" className="confirm-date-input" defaultValue={batchDate} autoFocus
                  onBlur={e  => handleBatchDate(e.target.value)}
                  onChange={e => handleBatchDate(e.target.value)} />
              ) : (
                <>
                  <span>📅 {dateStr}</span>
                  <button className="confirm-date-edit" onClick={() => setEditingDate(true)} title="Edit date">✏️</button>
                </>
              )}
            </div>
          </div>

          {/* In/Out totals */}
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

          {/* Entries */}
          <div className="photo-stack-table">
            <NotebookPanel
              txns={txns}
              display={display}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          </div>

          {/* Actions */}
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
      </div>
    </>
  )
}
