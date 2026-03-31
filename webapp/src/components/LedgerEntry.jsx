import { useState, useRef, useEffect } from 'react'
import { classifyLedger, speakLedger, fetchDues, fetchStaff } from '../api.js'

const EMPTY_ROW      = () => ({ particulars: '', amount: '', _txn: null })
const EMPTY_DUES_ROW = () => ({ desc: '', billNo: '', amount: '' })
const EMPTY_PERSON_ROW = () => ({ name: '', amount: '' })

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

  function initAllRows() {
    if (!isPrefill) {
      return {
        inRows:  Array.from({ length: 5 }, EMPTY_ROW),
        outRows: Array.from({ length: 5 }, EMPTY_ROW),
        duesIn: [EMPTY_DUES_ROW()], duesOut: [EMPTY_DUES_ROW()],
        staffIn: [EMPTY_PERSON_ROW()], staffOut: [EMPTY_PERSON_ROW()],
        othersIn: [EMPTY_PERSON_ROW()], othersOut: [EMPTY_PERSON_ROW()],
      }
    }

    // Distribute classified transactions into sub-sections
    const general = { inRows: [], outRows: [] }
    const dues = { in: [], out: [] }
    const staff = { in: [], out: [] }
    const others = { in: [], out: [] }

    const txns = prefill.txns || []
    const display = prefill.display || null

    // Use txnsToRows logic for column assignment (left/right from display)
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
          else leftSet.add(indices[0])
        }
        if (indices[1] != null) {
          if (rightEmpty && !leftEmpty) leftSet.add(indices[1])
          else rightSet.add(indices[1])
        }
      })
    }

    txns.forEach((t, i) => {
      const isIn = leftSet.has(i) ? true
                 : rightSet.has(i) ? false
                 : IN_TYPES.has(t.type)
      const side = isIn ? 'in' : 'out'
      const cat = t.person_category

      // person_category always wins over inferred transaction type
      if (cat === 'staff') {
        staff[side].push({ name: t.person_name || '', amount: String(t.amount || ''), _txn: t })
      } else if (cat === 'supplier' || cat === 'other') {
        // Supplier and "Other" — both go to the Others section regardless of txn type
        others[side].push({ name: t.person_name || '', amount: String(t.amount || ''), _txn: t })
      } else if (cat === 'customer' || (!cat && (t.type === 'udhaar_received' || t.type === 'udhaar_given'))) {
        // Customer explicitly, OR udhaar type with no explicit category override
        dues[side].push({ desc: t.description || '', billNo: t.bill_number || '', amount: String(t.amount || ''), _txn: t })
      } else {
        // General row (home, unknown, no category)
        const row = { particulars: t.description || '', amount: String(t.amount || ''), _txn: t }
        if (isIn) general.inRows.push(row)
        else general.outRows.push(row)
      }
    })

    // Ensure at least one empty row per section
    const ensure = (arr, factory) => arr.length > 0 ? arr : [factory()]

    return {
      inRows: ensure(general.inRows, EMPTY_ROW),
      outRows: ensure(general.outRows, EMPTY_ROW),
      duesIn: ensure(dues.in, EMPTY_DUES_ROW),
      duesOut: ensure(dues.out, EMPTY_DUES_ROW),
      staffIn: ensure(staff.in, EMPTY_PERSON_ROW),
      staffOut: ensure(staff.out, EMPTY_PERSON_ROW),
      othersIn: ensure(others.in, EMPTY_PERSON_ROW),
      othersOut: ensure(others.out, EMPTY_PERSON_ROW),
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const [_init] = useState(() => initAllRows())
  const [date, setDate]               = useState(isPrefill ? (prefill.date || today) : today)
  const [inRows, setInRows]           = useState(_init.inRows)
  const [outRows, setOutRows]         = useState(_init.outRows)
  // ── Sub-section rows ────────────────────────────────────────
  const [duesInRows,    setDuesInRows]    = useState(_init.duesIn)
  const [duesOutRows,   setDuesOutRows]   = useState(_init.duesOut)
  const [staffInRows,   setStaffInRows]   = useState(_init.staffIn)
  const [staffOutRows,  setStaffOutRows]  = useState(_init.staffOut)
  const [othersInRows,  setOthersInRows]  = useState(_init.othersIn)
  const [othersOutRows, setOthersOutRows] = useState(_init.othersOut)
  const [staffOptions,  setStaffOptions]  = useState([])
  const [othersOptions, setOthersOptions] = useState([])

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

  // ── Fetch staff/others names for dropdowns ──────────────────
  useEffect(() => {
    if (!phone) return
    fetchStaff(phone)
      .then(data => setStaffOptions((data || []).map(s => s.name || s).filter(Boolean)))
      .catch(() => {})
    fetchDues(phone)
      .then(data => {
        const names = [...new Set((data || []).map(d => d.person_name).filter(Boolean))]
        setOthersOptions(names)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  // ── Close guard: show confirmation if there is data ─────────
  const validIn      = inRows     .filter(r => r.particulars.trim() && r.amount)
  const validOut     = outRows    .filter(r => r.particulars.trim() && r.amount)
  const validDuesIn  = duesInRows .filter(r => r.amount)
  const validDuesOut = duesOutRows.filter(r => r.amount)
  const validStaffIn   = staffInRows  .filter(r => r.amount)
  const validStaffOut  = staffOutRows .filter(r => r.amount)
  const validOthersIn  = othersInRows .filter(r => r.amount)
  const validOthersOut = othersOutRows.filter(r => r.amount)

  const hasEntries = validIn.length + validOut.length
    + validDuesIn.length + validDuesOut.length
    + validStaffIn.length + validStaffOut.length
    + validOthersIn.length + validOthersOut.length > 0
  const totalCount = validIn.length + validOut.length
    + validDuesIn.length + validDuesOut.length
    + validStaffIn.length + validStaffOut.length
    + validOthersIn.length + validOthersOut.length

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
  // Collects ALL sections (General → Dues → Staff → Others) in visual order
  async function _speak(dateFromPhoto = true) {
    if (audioMuted) return
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    window.speechSynthesis?.cancel()
    setSpeakingIdx(null)

    // Helper: collect valid rows from a section, return { entries, map }
    function collect(rows, section, descKey = 'particulars') {
      const entries = [], map = []
      rows.forEach((r, i) => {
        const desc = (r[descKey] || r.name || r.desc || '').trim()
        const amt = r.amount
        if (desc && amt) { entries.push({ desc, amount: amt }); map.push({ section, rowIdx: i }) }
      })
      return { entries, map }
    }

    // Build composite arrays in visual order: General → Dues → Staff → Others
    const gIn = collect(inRows, 'general')
    const dIn = collect(duesInRows, 'dues', 'desc')
    const sIn = collect(staffInRows, 'staff', 'name')
    const oIn = collect(othersInRows, 'others', 'name')

    const gOut = collect(outRows, 'general')
    const dOut = collect(duesOutRows, 'dues', 'desc')
    const sOut = collect(staffOutRows, 'staff', 'name')
    const oOut = collect(othersOutRows, 'others', 'name')

    const inE  = [...gIn.entries, ...dIn.entries, ...sIn.entries, ...oIn.entries]
    const outE = [...gOut.entries, ...dOut.entries, ...sOut.entries, ...oOut.entries]
    const inMap  = [...gIn.map, ...dIn.map, ...sIn.map, ...oIn.map]
    const outMap = [...gOut.map, ...dOut.map, ...sOut.map, ...oOut.map]

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
            const mapped = ttsIdxMapRef.current[side]?.[parseInt(idxStr)]
            setSpeakingIdx(mapped || null)
          }
        })
      }

      audio_el.onended = () => { setSpeaking(false); setSpeakingIdx(null); setSpeakingDate(false) }
      audio_el.onerror = () => { setSpeaking(false); setSpeakingIdx(null); setSpeakingDate(false) }
      await audio_el.play()
    } catch {
      _browserSpeak(inRows, outRows, dateStr, language || 'hinglish')
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
      const dateFromPhoto = !!(prefill.date)
      _speak(dateFromPhoto)
    }, 700)
    return () => {
      clearTimeout(t)
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
      window.speechSynthesis?.cancel()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSpeak() { _speak() }

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

  // ── Sub-section row helpers ──────────────────────────────────
  const SECTION_SETTERS = {
    duesIn:    setDuesInRows,   duesOut:    setDuesOutRows,
    staffIn:   setStaffInRows,  staffOut:   setStaffOutRows,
    othersIn:  setOthersInRows, othersOut:  setOthersOutRows,
  }
  function updateSectionRow(section, idx, field, val) {
    if (field === 'name' && val === '➕ Add new') val = ''
    SECTION_SETTERS[section](prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }
  function addSectionRow(section, emptyFn) {
    SECTION_SETTERS[section](prev => [...prev, emptyFn()])
  }

  const totalIn  = [...inRows, ...duesInRows, ...staffInRows, ...othersInRows]
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const totalOut = [...outRows, ...duesOutRows, ...staffOutRows, ...othersOutRows]
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const maxRows  = Math.max(inRows.length, outRows.length)

  // ── Save ─────────────────────────────────────────────────────
  async function handleAction() {
    if (!hasEntries || loading) return

    if (isPrefill) {
      setLoading(true)
      try {
        const editedTxns = [
          ...rowsToTxns(inRows, outRows, date),
          ...validDuesIn .map(r => ({ type: 'udhaar_received', description: r.desc || 'Dues received', bill_number: r.billNo || '', amount: parseFloat(r.amount) || 0, date })),
          ...validDuesOut.map(r => ({ type: 'udhaar_given',    description: r.desc || 'Dues given',    bill_number: r.billNo || '', amount: parseFloat(r.amount) || 0, date })),
          ...validStaffIn  .map(r => ({ type: 'receipt', description: r.name || 'Staff',         person_name: r.name || '', amount: parseFloat(r.amount) || 0, date })),
          ...validStaffOut .map(r => ({ type: 'expense', description: r.name || 'Staff expense', person_name: r.name || '', amount: parseFloat(r.amount) || 0, date })),
          ...validOthersIn .map(r => ({ type: 'receipt', description: r.name || 'Others',        person_name: r.name || '', amount: parseFloat(r.amount) || 0, date })),
          ...validOthersOut.map(r => ({ type: 'expense', description: r.name || 'Others',        person_name: r.name || '', amount: parseFloat(r.amount) || 0, date })),
        ]
        await prefill.onSave(editedTxns, prefill.msgId)
        // Don't call onClose() here — prefill.onSave closes via setPhotoReview(null)
      } catch (e) {
        alert('Save failed: ' + e.message)
      } finally {
        setLoading(false)
      }
    } else {
      const duesBillDesc = (r, suffix) =>
        [r.desc, r.billNo ? `Bill#${r.billNo}` : ''].filter(Boolean).join(' ') || suffix
      const rows = [
        ...validIn      .map(r => ({ particulars: r.particulars,                  amount: r.amount, column: 'in',  section: 'general' })),
        ...validOut     .map(r => ({ particulars: r.particulars,                  amount: r.amount, column: 'out', section: 'general' })),
        ...validDuesIn  .map(r => ({ particulars: duesBillDesc(r,'Dues received'), amount: r.amount, column: 'in',  section: 'dues' })),
        ...validDuesOut .map(r => ({ particulars: duesBillDesc(r,'Dues given'),    amount: r.amount, column: 'out', section: 'dues' })),
        ...validStaffIn  .map(r => ({ particulars: r.name || 'Staff',             amount: r.amount, column: 'in',  section: 'staff', person_name: r.name })),
        ...validStaffOut .map(r => ({ particulars: r.name || 'Staff expense',     amount: r.amount, column: 'out', section: 'staff', person_name: r.name })),
        ...validOthersIn .map(r => ({ particulars: r.name || 'Others',            amount: r.amount, column: 'in',  section: 'others', person_name: r.name })),
        ...validOthersOut.map(r => ({ particulars: r.name || 'Others',            amount: r.amount, column: 'out', section: 'others', person_name: r.name })),
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
              const isActiveIn  = speakingIdx?.side === 'in'  && speakingIdx.section === 'general' && speakingIdx.rowIdx === i && i < inRows.length
              const isActiveOut = speakingIdx?.side === 'out' && speakingIdx.section === 'general' && speakingIdx.rowIdx === i && i < outRows.length
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

          {/* Add row buttons — general section */}
          <div className="ledger-add-row">
            <button className="ledger-add-btn" onClick={() => addRow('in')}>+ Add row</button>
            <div className="ledger-center-divider" />
            <button className="ledger-add-btn" onClick={() => addRow('out')}>+ Add row</button>
          </div>

          {/* ══ DUES section ══ */}
          <div className="ledger-section-divider">
            <div className="ledger-section-label">📥 Dues Received</div>
            <div className="ledger-center-divider" />
            <div className="ledger-section-label">📤 Dues Given</div>
          </div>
          {Array.from({ length: Math.max(duesInRows.length, duesOutRows.length) }).map((_, i) => {
            const duesActiveIn  = speakingIdx?.side === 'in'  && speakingIdx.section === 'dues' && speakingIdx.rowIdx === i
            const duesActiveOut = speakingIdx?.side === 'out' && speakingIdx.section === 'dues' && speakingIdx.rowIdx === i
            return (
            <div key={`dues-${i}`} className="ledger-data-row">
              <div className={`ledger-entry-cell ledger-dues-cell${duesActiveIn ? ' ledger-cell--speaking' : ''}`}>
                {i < duesInRows.length ? (
                  <>
                    <input className="ledger-input-desc ledger-input-desc--dues"
                      placeholder="Description"
                      value={duesInRows[i].desc}
                      onChange={e => updateSectionRow('duesIn', i, 'desc', e.target.value)}
                    />
                    <input className="ledger-input-billno"
                      placeholder="Bill#"
                      value={duesInRows[i].billNo}
                      onChange={e => updateSectionRow('duesIn', i, 'billNo', e.target.value)}
                    />
                    <input className="ledger-input-amt" placeholder="0" type="number" inputMode="decimal"
                      value={duesInRows[i].amount}
                      onChange={e => updateSectionRow('duesIn', i, 'amount', e.target.value)}
                    />
                  </>
                ) : <div className="ledger-cell-placeholder" />}
              </div>
              <div className="ledger-center-divider" />
              <div className={`ledger-entry-cell ledger-dues-cell${duesActiveOut ? ' ledger-cell--speaking' : ''}`}>
                {i < duesOutRows.length ? (
                  <>
                    <input className="ledger-input-desc ledger-input-desc--dues"
                      placeholder="Description"
                      value={duesOutRows[i].desc}
                      onChange={e => updateSectionRow('duesOut', i, 'desc', e.target.value)}
                    />
                    <input className="ledger-input-billno"
                      placeholder="Bill#"
                      value={duesOutRows[i].billNo}
                      onChange={e => updateSectionRow('duesOut', i, 'billNo', e.target.value)}
                    />
                    <input className="ledger-input-amt" placeholder="0" type="number" inputMode="decimal"
                      value={duesOutRows[i].amount}
                      onChange={e => updateSectionRow('duesOut', i, 'amount', e.target.value)}
                    />
                  </>
                ) : <div className="ledger-cell-placeholder" />}
              </div>
            </div>
            )
          })}
          <div className="ledger-add-row">
            <button className="ledger-add-btn" onClick={() => addSectionRow('duesIn', EMPTY_DUES_ROW)}>+ Dues row</button>
            <div className="ledger-center-divider" />
            <button className="ledger-add-btn" onClick={() => addSectionRow('duesOut', EMPTY_DUES_ROW)}>+ Dues row</button>
          </div>

          {/* ══ STAFF section ══ */}
          <div className="ledger-section-divider">
            <div className="ledger-section-label">👷 Staff (In)</div>
            <div className="ledger-center-divider" />
            <div className="ledger-section-label">👷 Staff Expense</div>
          </div>
          {Array.from({ length: Math.max(staffInRows.length, staffOutRows.length) }).map((_, i) => {
            const staffActiveIn  = speakingIdx?.side === 'in'  && speakingIdx.section === 'staff' && speakingIdx.rowIdx === i
            const staffActiveOut = speakingIdx?.side === 'out' && speakingIdx.section === 'staff' && speakingIdx.rowIdx === i
            return (
            <div key={`staff-${i}`} className="ledger-data-row">
              <div className={`ledger-entry-cell${staffActiveIn ? ' ledger-cell--speaking' : ''}`}>
                {i < staffInRows.length ? (
                  <>
                    <input className="ledger-input-name" list="staff-list"
                      placeholder="Staff name"
                      value={staffInRows[i].name}
                      onChange={e => updateSectionRow('staffIn', i, 'name', e.target.value)}
                    />
                    <input className="ledger-input-amt" placeholder="0" type="number" inputMode="decimal"
                      value={staffInRows[i].amount}
                      onChange={e => updateSectionRow('staffIn', i, 'amount', e.target.value)}
                    />
                  </>
                ) : <div className="ledger-cell-placeholder" />}
              </div>
              <div className="ledger-center-divider" />
              <div className={`ledger-entry-cell${staffActiveOut ? ' ledger-cell--speaking' : ''}`}>
                {i < staffOutRows.length ? (
                  <>
                    <input className="ledger-input-name" list="staff-list"
                      placeholder="Staff name"
                      value={staffOutRows[i].name}
                      onChange={e => updateSectionRow('staffOut', i, 'name', e.target.value)}
                    />
                    <input className="ledger-input-amt" placeholder="0" type="number" inputMode="decimal"
                      value={staffOutRows[i].amount}
                      onChange={e => updateSectionRow('staffOut', i, 'amount', e.target.value)}
                    />
                  </>
                ) : <div className="ledger-cell-placeholder" />}
              </div>
            </div>
            )
          })}
          <datalist id="staff-list">
            <option value="➕ Add new" />
            {staffOptions.map(n => <option key={n} value={n} />)}
          </datalist>
          <div className="ledger-add-row">
            <button className="ledger-add-btn" onClick={() => addSectionRow('staffIn',  EMPTY_PERSON_ROW)}>+ Staff row</button>
            <div className="ledger-center-divider" />
            <button className="ledger-add-btn" onClick={() => addSectionRow('staffOut', EMPTY_PERSON_ROW)}>+ Staff row</button>
          </div>

          {/* ══ OTHERS section ══ */}
          <div className="ledger-section-divider">
            <div className="ledger-section-label">🔖 Others (In)</div>
            <div className="ledger-center-divider" />
            <div className="ledger-section-label">🔖 Others (Out)</div>
          </div>
          {Array.from({ length: Math.max(othersInRows.length, othersOutRows.length) }).map((_, i) => {
            const othActiveIn  = speakingIdx?.side === 'in'  && speakingIdx.section === 'others' && speakingIdx.rowIdx === i
            const othActiveOut = speakingIdx?.side === 'out' && speakingIdx.section === 'others' && speakingIdx.rowIdx === i
            return (
            <div key={`others-${i}`} className="ledger-data-row">
              <div className={`ledger-entry-cell${othActiveIn ? ' ledger-cell--speaking' : ''}`}>
                {i < othersInRows.length ? (
                  <>
                    <input className="ledger-input-name" list="others-list"
                      placeholder="Name"
                      value={othersInRows[i].name}
                      onChange={e => updateSectionRow('othersIn', i, 'name', e.target.value)}
                    />
                    <input className="ledger-input-amt" placeholder="0" type="number" inputMode="decimal"
                      value={othersInRows[i].amount}
                      onChange={e => updateSectionRow('othersIn', i, 'amount', e.target.value)}
                    />
                  </>
                ) : <div className="ledger-cell-placeholder" />}
              </div>
              <div className="ledger-center-divider" />
              <div className={`ledger-entry-cell${othActiveOut ? ' ledger-cell--speaking' : ''}`}>
                {i < othersOutRows.length ? (
                  <>
                    <input className="ledger-input-name" list="others-list"
                      placeholder="Name"
                      value={othersOutRows[i].name}
                      onChange={e => updateSectionRow('othersOut', i, 'name', e.target.value)}
                    />
                    <input className="ledger-input-amt" placeholder="0" type="number" inputMode="decimal"
                      value={othersOutRows[i].amount}
                      onChange={e => updateSectionRow('othersOut', i, 'amount', e.target.value)}
                    />
                  </>
                ) : <div className="ledger-cell-placeholder" />}
              </div>
            </div>
            )
          })}
          <datalist id="others-list">
            <option value="➕ Add new" />
            {othersOptions.map(n => <option key={n} value={n} />)}
          </datalist>
          <div className="ledger-add-row">
            <button className="ledger-add-btn" onClick={() => addSectionRow('othersIn',  EMPTY_PERSON_ROW)}>+ Others row</button>
            <div className="ledger-center-divider" />
            <button className="ledger-add-btn" onClick={() => addSectionRow('othersOut', EMPTY_PERSON_ROW)}>+ Others row</button>
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
