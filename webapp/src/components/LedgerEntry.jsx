import { useState, useRef, useEffect } from 'react'
import { classifyLedger, speakLedger } from '../api.js'

const EMPTY_ROW = () => ({ particulars: '', amount: '', _txn: null })

const IN_TYPES  = new Set(['sale','receipt','udhaar_received','cash_in_hand','upi_in_hand','opening_balance'])
const OUT_TYPES = new Set(['expense','udhaar_given','bank_deposit','closing_balance'])

// Convert AI transactions → ledger rows, split by IN/OUT.
function txnsToRows(txns = [], display = null) {
  const inRows  = []
  const outRows = []

  const leftSet  = new Set()
  const rightSet = new Set()
  if (display?.layout === 'two_column' && display?.rows?.length > 0) {
    display.rows.forEach(row => {
      const indices = Array.isArray(row.txn_indices) ? row.txn_indices
                    : row.txn_index != null ? [row.txn_index] : []
      const cells = row.cells || []
      const leftEmpty  = !cells[0]?.trim()
      const rightEmpty = !cells[1]?.trim()

      if (indices[0] != null) {
        if (leftEmpty && !rightEmpty) rightSet.add(indices[0])
        else                          leftSet.add(indices[0])
      }
      if (indices[1] != null) {
        if (rightEmpty && !leftEmpty) leftSet.add(indices[1])
        else                         rightSet.add(indices[1])
      }
    })
  }

  txns.forEach((t, i) => {
    const row = { particulars: t.description || '', amount: String(t.amount || ''), _txn: t }
    if (leftSet.has(i))             inRows.push(row)
    else if (rightSet.has(i))       outRows.push(row)
    else if (IN_TYPES.has(t.type))  inRows.push(row)
    else if (OUT_TYPES.has(t.type)) outRows.push(row)
    else                             inRows.push(row)
  })

  return { inRows, outRows }
}

// Reconstruct full transaction objects from edited rows
function rowsToTxns(inRows, outRows, date) {
  const result = []
  inRows.forEach(r => {
    if (!r.particulars.trim() || !r.amount) return
    const base = r._txn ? { ...r._txn } : {}
    const type = (r._txn && IN_TYPES.has(r._txn.type)) ? r._txn.type : 'sale'
    result.push({ ...base, type, description: r.particulars.trim(), amount: parseFloat(r.amount) || 0, date })
  })
  outRows.forEach(r => {
    if (!r.particulars.trim() || !r.amount) return
    const base = r._txn ? { ...r._txn } : {}
    const type = (r._txn && OUT_TYPES.has(r._txn.type)) ? r._txn.type : 'expense'
    result.push({ ...base, type, description: r.particulars.trim(), amount: parseFloat(r.amount) || 0, date })
  })
  return result
}

// ── Browser TTS fallback (used only if Google TTS API fails) ──
function _browserSpeak(inRows, outRows, dateStr, language) {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const validIn  = inRows .filter(r => r.particulars.trim() && r.amount)
  const validOut = outRows.filter(r => r.particulars.trim() && r.amount)
  if (validIn.length + validOut.length === 0) return

  const langMap = { english: 'en-IN', hindi: 'hi-IN', hinglish: 'hi-IN',
    gujarati: 'gu-IN', marathi: 'mr-IN', bengali: 'bn-IN',
    tamil: 'ta-IN', telugu: 'te-IN', kannada: 'kn-IN', punjabi: 'pa-IN' }

  let text = `Notebook mein ${validIn.length + validOut.length} entries. `
  validIn .forEach((r, i) => { text += `Jama ${i+1}: ${r.particulars}, ${r.amount}. ` })
  validOut.forEach((r, i) => { text += `Naam ${i+1}: ${r.particulars}, ${r.amount}. ` })
  text += `Date check karein: ${dateStr}.`

  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = langMap[language] || 'hi-IN'
  utt.rate = 0.88
  window.speechSynthesis.speak(utt)
}

// prefill = { txns, msgId, date, onSave } — if set, opens in photo-review mode
export default function LedgerEntry({ phone, language, onClose, onClassified, prefill }) {
  const isPrefill = !!prefill

  function initRows() {
    if (isPrefill) return txnsToRows(prefill.txns, prefill.display || null)
    return {
      inRows:  Array.from({ length: 5 }, EMPTY_ROW),
      outRows: Array.from({ length: 5 }, EMPTY_ROW),
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate]               = useState(isPrefill ? (prefill.date || today) : today)
  const [inRows, setInRows]           = useState(() => initRows().inRows)
  const [outRows, setOutRows]         = useState(() => initRows().outRows)
  const [loading, setLoading]         = useState(false)
  const [speaking, setSpeaking]         = useState(false)
  const [speakingIdx, setSpeakingIdx]   = useState(null)  // { side:'in'|'out', rowIdx:number } | null
  const [speakingDate, setSpeakingDate] = useState(false)
  const [audioMuted, setAudioMuted]     = useState(false)
  const [showConfirm, setShowConfirm]   = useState(false)
  const overlayRef    = useRef()
  const audioRef      = useRef(null)   // holds the current Audio object
  const ttsIdxMapRef  = useRef({ in: [], out: [] })  // TTS entry index → inRows/outRows index

  const dateStr = new Date(date + 'T00:00:00').toLocaleDateString('en-IN',
    { day: 'numeric', month: 'long', year: 'numeric' })

  // ── Close guard: show confirmation if there is data ─────────
  const validIn  = inRows .filter(r => r.particulars.trim() && r.amount)
  const validOut = outRows.filter(r => r.particulars.trim() && r.amount)
  const hasEntries = validIn.length > 0 || validOut.length > 0
  const totalCount = validIn.length + validOut.length

  function requestClose() {
    // Always confirm in prefill mode (data came from photo); confirm in manual
    // mode only when entries have been filled in
    if (isPrefill || hasEntries) {
      setShowConfirm(true)
    } else {
      doClose()
    }
  }

  function doClose() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    window.speechSynthesis?.cancel()
    onClose()
  }

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) requestClose()
  }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') requestClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.speechSynthesis?.cancel()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEntries, isPrefill])

  // ── Core speak function: Google TTS → browser fallback ─────
  // dateFromPhoto: true = date was read from the notebook image
  //                false = date was not found, defaulted to today → stronger warning
  async function _speak(ir, or, dateFromPhoto = true) {
    if (audioMuted) return
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    window.speechSynthesis?.cancel()
    setSpeakingIdx(null)

    // Build entries and store TTS-index → row-index mapping
    const inMap  = []  // inMap[ttsIdx] = actual index in ir
    const outMap = []
    const inE  = []
    const outE = []
    ir.forEach((r, i) => {
      if (r.particulars.trim() && r.amount) { inMap.push(i); inE.push({ desc: r.particulars, amount: r.amount }) }
    })
    or.forEach((r, i) => {
      if (r.particulars.trim() && r.amount) { outMap.push(i); outE.push({ desc: r.particulars, amount: r.amount }) }
    })
    if (inE.length + outE.length === 0) return
    ttsIdxMapRef.current = { in: inMap, out: outMap }

    setSpeaking(true)
    try {
      const { audio, timepoints } = await speakLedger(inE, outE, dateStr, language || 'hinglish', dateFromPhoto)
      const audio_el = new Audio(`data:audio/mp3;base64,${audio}`)
      audioRef.current = audio_el

      // Highlight active row via timepoints
      if (timepoints?.length > 0) {
        audio_el.addEventListener('timeupdate', () => {
          const t = audio_el.currentTime
          let active = null
          for (const tp of timepoints) {
            if (tp.timeSeconds <= t + 0.05) active = tp.markName
            else break
          }
          if (active === 'date') {
            setSpeakingDate(true)
            setSpeakingIdx(null)
          } else if (active) {
            setSpeakingDate(false)
            const [side, idxStr] = active.split('_')
            const rowIdx = ttsIdxMapRef.current[side]?.[parseInt(idxStr)] ?? null
            setSpeakingIdx(rowIdx != null ? { side, rowIdx } : null)
          }
        })
      }

      audio_el.onended = () => { setSpeaking(false); setSpeakingIdx(null); setSpeakingDate(false) }
      audio_el.onerror = () => { setSpeaking(false); setSpeakingIdx(null); setSpeakingDate(false) }
      await audio_el.play()
    } catch {
      _browserSpeak(ir, or, dateStr, language || 'hinglish')
      const check = setInterval(() => {
        if (!window.speechSynthesis?.speaking) { setSpeaking(false); clearInterval(check) }
      }, 300)
    }
  }

  // ── Shrink font for long descriptions on mount/update ──
  useEffect(() => {
    document.querySelectorAll('.ledger-input-desc').forEach(ta => {
      const len = ta.value.length
      ta.style.fontSize = len > 35 ? '9px' : len > 22 ? '10.5px' : '12px'
    })
  }, [inRows, outRows])

  // ── Auto-speak on open (prefill mode only) ───────────────────
  useEffect(() => {
    if (!isPrefill) return
    const t = setTimeout(() => {
      const { inRows: ir, outRows: or } = txnsToRows(prefill.txns, prefill.display || null)
      // dateFromPhoto: true only if the backend actually found a date in the image
      const dateFromPhoto = !!(prefill.date)
      _speak(ir, or, dateFromPhoto)
    }, 700)
    return () => {
      clearTimeout(t)
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
      window.speechSynthesis?.cancel()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSpeak() { _speak(inRows, outRows) }

  function updateRow(side, idx, field, val) {
    const setter = side === 'in' ? setInRows : setOutRows
    setter(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }

  function addRow(side) {
    const setter = side === 'in' ? setInRows : setOutRows
    setter(prev => [...prev, EMPTY_ROW()])
  }

  function handleAmtKeyDown(side, idx, e) {
    const rows = side === 'in' ? inRows : outRows
    if (e.key === 'Tab' && !e.shiftKey && idx === rows.length - 1) {
      e.preventDefault()
      addRow(side)
    }
  }

  const totalIn  = inRows .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const totalOut = outRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const maxRows  = Math.max(inRows.length, outRows.length)

  // ── Save ─────────────────────────────────────────────────────
  async function handleAction() {
    if (!hasEntries || loading) return

    if (isPrefill) {
      setLoading(true)
      try {
        const editedTxns = rowsToTxns(inRows, outRows, date)
        await prefill.onSave(editedTxns, prefill.msgId)
        // Don't call onClose() here — prefill.onSave closes via setPhotoReview(null)
      } catch (e) {
        alert('Save failed: ' + e.message)
      } finally {
        setLoading(false)
      }
    } else {
      const rows = [
        ...validIn .map(r => ({ particulars: r.particulars, amount: r.amount, column: 'in'  })),
        ...validOut.map(r => ({ particulars: r.particulars, amount: r.amount, column: 'out' })),
      ]
      setLoading(true)
      try {
        const result = await classifyLedger(phone, date, rows, language)
        onClassified(result)
        onClose()
      } catch (e) {
        alert('Classification failed: ' + e.message)
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className="ledger-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="ledger-panel">

        {/* ── Header bar ── */}
        <div className="ledger-header">
          <span className="ledger-title">
            {isPrefill ? '📋 Review Entries' : '📒 Khata Bahi'}
          </span>
          {isPrefill && (
            <>
              <button
                className={`ledger-speak-btn${speaking ? ' ledger-speak-btn--active' : ''}`}
                onClick={handleSpeak}
                aria-label="Read entries aloud"
                disabled={audioMuted}
              >
                {speaking ? '🔊' : '🔈'}
              </button>
              <button
                className={`ledger-mute-btn${audioMuted ? ' ledger-mute-btn--on' : ''}`}
                onClick={() => {
                  if (!audioMuted && audioRef.current) {
                    audioRef.current.pause(); audioRef.current = null
                    setSpeaking(false); setSpeakingIdx(null); setSpeakingDate(false)
                  }
                  setAudioMuted(m => !m)
                }}
                aria-label={audioMuted ? 'Enable audio' : 'Mute audio'}
              >
                {audioMuted ? '🔇' : '🔉'}
              </button>
            </>
          )}
          <button className="ledger-close-btn" onClick={requestClose} aria-label="Close">✕</button>
        </div>

        {/* ── Date banner ── */}
        <div className={`ledger-date-banner${speakingDate ? ' ledger-date-banner--speaking' : ''}`}>
          <span className="ledger-date-banner-icon">📅</span>
          <input type="date" className="ledger-date-banner-input-visible" value={date}
            onChange={e => setDate(e.target.value)} />
        </div>

        {/* ── Ledger paper ── */}
        <div className="ledger-paper">

          {/* Column headers */}
          <div className="ledger-col-header-row">
            <div className="ledger-col-header ledger-jama-header">
              <span className="ledger-col-label-hindi">जमा</span>
              <span className="ledger-col-label-en">JAMA (IN)</span>
            </div>
            <div className="ledger-center-divider" />
            <div className="ledger-col-header ledger-naam-header">
              <span className="ledger-col-label-hindi">नाम</span>
              <span className="ledger-col-label-en">NAAM (OUT)</span>
            </div>
          </div>

          {/* Sub-header */}
          <div className="ledger-sub-header">
            <div className="ledger-subh-cell">
              <span className="ledger-subh-desc">Particulars</span>
              <span className="ledger-subh-amt">₹</span>
            </div>
            <div className="ledger-center-divider" />
            <div className="ledger-subh-cell">
              <span className="ledger-subh-desc">Particulars</span>
              <span className="ledger-subh-amt">₹</span>
            </div>
          </div>

          {/* Data rows */}
          <div className="ledger-rows-body">
            {Array.from({ length: maxRows }).map((_, i) => {
              const isActiveIn  = speakingIdx?.side === 'in'  && speakingIdx.rowIdx === i && i < inRows.length
              const isActiveOut = speakingIdx?.side === 'out' && speakingIdx.rowIdx === i && i < outRows.length
              return (
              <div key={i} className="ledger-data-row">
                <div className={`ledger-entry-cell${isActiveIn ? ' ledger-cell--speaking' : ''}`}>
                  {i < inRows.length ? (
                    <>
                      <textarea
                        className="ledger-input-desc"
                        placeholder="Description"
                        rows={1}
                        value={inRows[i].particulars}
                        onChange={e => updateRow('in', i, 'particulars', e.target.value)}
                        onInput={e => { const l = e.target.value.length; e.target.style.fontSize = l > 35 ? '9px' : l > 22 ? '10.5px' : '12px' }}
                      />
                      <input
                        className="ledger-input-amt"
                        placeholder="0"
                        type="number"
                        inputMode="decimal"
                        value={inRows[i].amount}
                        onChange={e => updateRow('in', i, 'amount', e.target.value)}
                        onKeyDown={e => handleAmtKeyDown('in', i, e)}
                      />
                    </>
                  ) : <div className="ledger-cell-placeholder" />}
                </div>

                <div className="ledger-center-divider" />

                <div className={`ledger-entry-cell${isActiveOut ? ' ledger-cell--speaking' : ''}`}>
                  {i < outRows.length ? (
                    <>
                      <textarea
                        className="ledger-input-desc"
                        placeholder="Description"
                        rows={1}
                        value={outRows[i].particulars}
                        onChange={e => updateRow('out', i, 'particulars', e.target.value)}
                        onInput={e => { const l = e.target.value.length; e.target.style.fontSize = l > 35 ? '9px' : l > 22 ? '10.5px' : '12px' }}
                      />
                      <input
                        className="ledger-input-amt"
                        placeholder="0"
                        type="number"
                        inputMode="decimal"
                        value={outRows[i].amount}
                        onChange={e => updateRow('out', i, 'amount', e.target.value)}
                        onKeyDown={e => handleAmtKeyDown('out', i, e)}
                      />
                    </>
                  ) : <div className="ledger-cell-placeholder" />}
                </div>
              </div>
              )
            })}
          </div>

          {/* Add row buttons */}
          <div className="ledger-add-row">
            <button className="ledger-add-btn" onClick={() => addRow('in')}>+ Add row</button>
            <div className="ledger-center-divider" />
            <button className="ledger-add-btn" onClick={() => addRow('out')}>+ Add row</button>
          </div>

          {/* Totals */}
          <div className="ledger-totals-row">
            <div className="ledger-total-cell">
              <span className="ledger-total-label">Total JAMA</span>
              <span className="ledger-total-amt ledger-total-in">
                ₹{totalIn.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="ledger-center-divider" />
            <div className="ledger-total-cell">
              <span className="ledger-total-label">Total NAAM</span>
              <span className="ledger-total-amt ledger-total-out">
                ₹{totalOut.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </div>

        {/* ── Action ── */}
        <div className="ledger-actions">
          <button
            className="ledger-classify-btn"
            onClick={handleAction}
            disabled={!hasEntries || loading}
          >
            {loading
              ? <><span className="ledger-spinner" /> {isPrefill ? 'Saving…' : 'Classifying…'}</>
              : isPrefill
                ? `✅ Save All (${totalCount})`
                : '🤖 Classify & Review'}
          </button>
          <div className="ledger-entry-count">
            {hasEntries
              ? `${totalCount} entr${totalCount === 1 ? 'y' : 'ies'} ready`
              : isPrefill ? 'Edit entries above' : 'Fill in entries above'}
          </div>
        </div>

        {/* ── Close confirmation overlay ── */}
        {showConfirm && (
          <div className="ledger-confirm-overlay">
            <div className="ledger-confirm-box">
              <p className="ledger-confirm-msg">
                {isPrefill
                  ? 'Band karo? Abhi tak ki saari entries kho jayengi.'
                  : 'Band karo? Bhari hui entries kho jayengi.'}
              </p>
              <div className="ledger-confirm-btns">
                <button className="ledger-confirm-cancel" onClick={() => setShowConfirm(false)}>
                  Wapas jao
                </button>
                <button className="ledger-confirm-ok" onClick={doClose}>
                  Haan, band karo
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
