import { useState, useEffect, useRef, useCallback } from 'react'
import {
  adminGetQueue, adminPickQueue, adminCompleteQueue,
  adminRejectQueue, adminGetStats, adminPollQueue, adminSendMessage,
  adminGetQueueDetail,
  adminLogin, adminVerifyToken, adminLogout,
  adminGetDescriptions, adminGetPrefill,
} from '../api.js'

const BASE = '/api'

/* ── Helpers ─────────────────────────────────────────── */

// Normalize legacy /uploads/ paths to /api/uploads/ for production routing
function normalizeImageUrl(url) {
  if (!url) return url
  if (url.startsWith('/uploads/')) return '/api' + url
  return url
}

// Backend writes `datetime.utcnow().isoformat()` which has no "Z" suffix.
// new Date(iso) would treat it as LOCAL time — causing 5.5h offsets in IST.
// This helper appends Z if no timezone info is present.
function parseUtcIso(iso) {
  if (!iso) return 0
  let s = String(iso).replace(' ', 'T')
  if (!/(Z|[+\-]\d\d:?\d\d)$/.test(s)) s += 'Z'
  const p = Date.parse(s)
  return isNaN(p) ? 0 : p
}

function timeAgo(iso) {
  const ms = parseUtcIso(iso)
  if (!ms) return ''
  const diff = (Date.now() - ms) / 1000
  if (diff < 60)    return `${Math.max(1, Math.floor(diff))}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatDateTime(iso) {
  const ms = parseUtcIso(iso)
  if (!ms) return ''
  const d = new Date(ms)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const day    = d.getDate()
  const month  = months[d.getMonth()]
  let   hours  = d.getHours()
  const mins   = String(d.getMinutes()).padStart(2, '0')
  const ampm   = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  return `${day} ${month}, ${hours}:${mins} ${ampm}`
}

function formatPhone(raw) {
  if (!raw) return ''
  // Strip 'web:' prefix and normalize to "+91 XXXXX XXXXX"
  const cleaned = String(raw).replace(/^web:/, '')
  const m = cleaned.match(/^\+?91(\d{5})(\d{5})$/)
  if (m) return `+91 ${m[1]} ${m[2]}`
  return cleaned
}

function urgencyClass(iso) {
  const ms = parseUtcIso(iso)
  if (!ms) return 'green'
  const mins = (Date.now() - ms) / 60000
  if (mins < 10) return 'green'
  if (mins < 30) return 'yellow'
  return 'red'
}

function todayStr() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

const EMPTY_ROW = () => ({ desc: '', amount: '', type: '', person: '', tag: '', confidence: null })

/* ── Notification + audio helpers ────────────────────── */

let dingAudio = null
function playDing() {
  if (!dingAudio) {
    // Short beep via oscillator
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.value = 0.3
      osc.start()
      osc.stop(ctx.currentTime + 0.15)
    } catch { /* silent fail */ }
  }
}

function notifyNew(count) {
  if (Notification.permission === 'granted') {
    new Notification('MoneyBook Operator', { body: `${count} new item(s) in queue` })
  }
  playDing()
}

/* ── Read-only view of a processed queue item ────────── */

function ProcessedView({ detail, loading, onClose }) {
  const [rotation, setRotation] = useState(0)

  if (!detail) return null
  const isSkipped = detail.status === 'skipped'
  const imageSrc  = detail.image_path ? normalizeImageUrl(detail.image_path) : null
  const inRows    = detail.entries?.in  || []
  const outRows   = detail.entries?.out || []
  const total     = inRows.length + outRows.length

  return (
    <>
      {/* Header strip */}
      <div className="operator-processed-header">
        <div>
          <div className={`operator-status-chip ${isSkipped ? 'skipped' : 'completed'}`}>
            {isSkipped ? '⊘ Skipped' : '✓ Saved'}
          </div>
          <span className="operator-processed-meta">
            <strong>{detail.store_name || 'Unnamed store'}</strong>
            {' · '}
            <span>#{detail.queue_id}</span>
            {detail.store_phone && (
              <> · <span>{formatPhone(detail.store_phone)}</span></>
            )}
          </span>
          <div className="operator-processed-dates">
            <span>Received: {formatDateTime(detail.created_at)}</span>
            {detail.completed_at && (
              <span> · {isSkipped ? 'Skipped' : 'Saved'}: {formatDateTime(detail.completed_at)}</span>
            )}
          </div>
        </div>
        <button type="button" className="operator-btn-sm" onClick={onClose}>✕ Close</button>
      </div>

      {/* Photo */}
      <div className="operator-photo-area">
        <div className="operator-photo-toolbar">
          <button className="operator-btn-sm" onClick={() => setRotation(r => r - 90)}>↶ CCW</button>
          <button className="operator-btn-sm" onClick={() => setRotation(r => r + 90)}>↷ CW</button>
          <button className="operator-btn-sm" onClick={() => setRotation(0)}>Reset</button>
        </div>
        <div className="operator-photo-container">
          {imageSrc ? (
            <img
              className="operator-photo"
              src={imageSrc}
              alt="Ledger"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          ) : (
            <div className="operator-no-photo">No image available</div>
          )}
        </div>
      </div>

      {/* Saved entries — read-only */}
      <div className="operator-form" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#999' }}>Loading...</div>
        ) : total === 0 ? (
          <div className="operator-empty">
            {isSkipped
              ? 'This photo was marked as unclear and no entries were saved.'
              : 'No entries were saved for this photo.'}
          </div>
        ) : (
          <div className="operator-processed-entries">
            <div className="operator-processed-meta" style={{ marginBottom: 12 }}>
              {total} entr{total === 1 ? 'y' : 'ies'} saved
              {detail.date && <> · date <strong>{detail.date}</strong></>}
            </div>

            <ReadOnlyEntryList title="JAMA (IN)" rows={inRows} tone="in" />
            <ReadOnlyEntryList title="NAAM (OUT)" rows={outRows} tone="out" />
          </div>
        )}
      </div>
    </>
  )
}

function ReadOnlyEntryList({ title, rows, tone }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="operator-processed-section">
      <div className={`operator-processed-section-title ${tone}`}>{title} · {rows.length}</div>
      <div className="operator-processed-rows">
        {rows.map((r, i) => (
          <div key={i} className="operator-processed-row">
            <div className="operator-processed-desc">
              <div style={{ fontWeight: 600, color: '#1a1a1a' }}>
                {r.description || r.person || '—'}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                {r.type && <span>{r.type}</span>}
                {r.tag && <span> · {r.tag}</span>}
                {r.person && r.description && <span> · {r.person}</span>}
                {r.payment_mode && <span> · {r.payment_mode}</span>}
              </div>
            </div>
            <div className={`operator-processed-amt ${tone}`}>
              ₹{Number(r.amount || 0).toLocaleString('en-IN')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Component ───────────────────────────────────────── */

export default function OperatorDashboard() {
  /* Auth state */
  const [operator, setOperator]       = useState(null)  // { id, username, name, role }
  const [authChecked, setAuthChecked] = useState(false)
  const [loginUser, setLoginUser]     = useState('')
  const [loginPass, setLoginPass]     = useState('')
  const [loginError, setLoginError]   = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  /* Queue state */
  const [queue, setQueue]             = useState([])
  const [processedQueue, setProcessedQueue] = useState([])
  const [queueTab, setQueueTab]       = useState('active') // 'active' | 'processed'
  const [selected, setSelected]       = useState(null)  // full item after pick
  const [selectedId, setSelectedId]   = useState(null)
  const [stats, setStats]             = useState({})
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [prefillLoading, setPrefillLoading] = useState(false)

  /* Form state */
  const [date, setDate]               = useState(todayStr())
  const [inRows, setInRows]           = useState([EMPTY_ROW()])
  const [outRows, setOutRows]         = useState([EMPTY_ROW()])
  const [rotation, setRotation]       = useState(0)
  const [typeDescriptions, setTypeDescriptions] = useState({})
  const [typeTags, setTypeTags] = useState({})
  const [customMsg, setCustomMsg]     = useState('')
  const [sendingMsg, setSendingMsg]   = useState(false)
  const [msgFeedback, setMsgFeedback] = useState('')   // '', 'sent', or error text
  const [viewing, setViewing]         = useState(null) // read-only processed item detail
  const [viewingLoading, setViewingLoading] = useState(false)

  const prevCountRef   = useRef(0)
  const formRef        = useRef(null)
  const prefillPollRef = useRef(null)  // holds the setInterval ID for prefill polling

  /* ── Verify token on mount ─────────────────────────── */
  useEffect(() => {
    adminVerifyToken().then(data => {
      if (data && data.operator) {
        setOperator(data.operator)
      }
      setAuthChecked(true)
    })
  }, [])

  /* ── Login handler ─────────────────────────────────── */
  async function handleLogin(e) {
    e.preventDefault()
    setLoginError('')
    setLoginLoading(true)
    try {
      const data = await adminLogin(loginUser, loginPass)
      if (data.token && data.operator) {
        setOperator(data.operator)
      } else {
        setLoginError(data.detail || 'Invalid credentials')
      }
    } catch (err) {
      setLoginError('Login failed. Please try again.')
    }
    setLoginLoading(false)
  }

  /* ── Logout handler ────────────────────────────────── */
  function handleLogout() {
    adminLogout()
    setOperator(null)
    setQueue([])
    setSelected(null)
    setSelectedId(null)
    setStats({})
  }

  /* ── Request notification permission on mount ──────── */
  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  /* ── Poll queue every 5s ───────────────────────────── */
  const refreshQueue = useCallback(async () => {
    try {
      const [pendingData, progressData, completedData, skippedData] = await Promise.all([
        adminGetQueue('pending'),
        adminGetQueue('in_progress'),
        adminGetQueue('completed'),
        adminGetQueue('skipped'),
      ])
      const active = [
        ...(pendingData.queue || pendingData.items || []),
        ...(progressData.queue || progressData.items || []),
      ]
      const processed = [
        ...(completedData.queue || completedData.items || []),
        ...(skippedData.queue || skippedData.items || []),
      ]
      // Sort processed newest-first by completion time (fallback to created)
      processed.sort((a, b) => {
        const ax = a.completed_at || a.created_at || ''
        const bx = b.completed_at || b.created_at || ''
        return String(bx).localeCompare(String(ax))
      })
      // Notify only on new ACTIVE arrivals
      if (active.length > prevCountRef.current && prevCountRef.current !== 0) {
        notifyNew(active.length - prevCountRef.current)
      }
      prevCountRef.current = active.length
      setQueue(active)
      setProcessedQueue(processed)
    } catch { /* silent */ }
  }, [])

  const refreshStats = useCallback(async () => {
    try {
      const data = await adminGetStats()
      setStats(data)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    refreshQueue()
    refreshStats()
    const qInt = setInterval(refreshQueue, 5000)
    const sInt = setInterval(refreshStats, 30000)
    return () => { clearInterval(qInt); clearInterval(sInt) }
  }, [refreshQueue, refreshStats])

  /* ── Apply prefill data to the form ────────────────── */
  function applyPrefill(prefill) {
    const inEntries = (prefill.in || prefill.jama || []).map(e => ({
      desc: e.description || e.desc || '',
      amount: String(e.amount || ''),
      type: e.type || 'sale',
      person: e.person || e.person_name || '',
      tag: e.tag || '',
      confidence: e.confidence || null,
    }))
    const outEntries = (prefill.out || prefill.naam || []).map(e => ({
      desc: e.description || e.desc || '',
      amount: String(e.amount || ''),
      type: e.type || 'expense',
      person: e.person || e.person_name || '',
      tag: e.tag || '',
      confidence: e.confidence || null,
    }))
    setInRows(inEntries.length ? inEntries : [EMPTY_ROW()])
    setOutRows(outEntries.length ? outEntries : [EMPTY_ROW()])
    if (prefill.date) setDate(prefill.date)
    else setDate(todayStr())
  }

  /* ── Poll for prefill when AI is still processing ───── */
  function startPrefillPoll(queueId) {
    if (prefillPollRef.current) clearInterval(prefillPollRef.current)
    setPrefillLoading(true)
    let attempts = 0
    const MAX_ATTEMPTS = 10  // 10 × 3s = 30s max
    prefillPollRef.current = setInterval(async () => {
      attempts++
      try {
        const data = await adminGetPrefill(queueId)
        if (data.ready) {
          clearInterval(prefillPollRef.current)
          prefillPollRef.current = null
          setPrefillLoading(false)
          if (data.ai_prefill) applyPrefill(data.ai_prefill)
          return
        }
      } catch { /* silent — keep polling */ }
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(prefillPollRef.current)
        prefillPollRef.current = null
        setPrefillLoading(false)
      }
    }, 3000)
  }

  /* ── Select / pick a queue item ────────────────────── */
  async function handleSelect(item) {
    if (loading) return
    setLoading(true)
    setRotation(0)
    // Cancel any in-flight prefill poll from a previous item
    if (prefillPollRef.current) {
      clearInterval(prefillPollRef.current)
      prefillPollRef.current = null
      setPrefillLoading(false)
    }
    try {
      const picked = await adminPickQueue(item.id || item.queue_id, operator ? String(operator.id) : 'default')
      setSelected({ ...item, ...picked })
      setSelectedId(item.id || item.queue_id)
      // Reset custom message state + close any processed-view pane
      setCustomMsg('')
      setMsgFeedback('')
      setViewing(null)

      // Populate form from AI prefill if available
      const prefill = picked.ai_prefill || item.ai_prefill
      console.log('[OperatorDash] picked response:', JSON.stringify(picked).slice(0, 500))
      console.log('[OperatorDash] prefill:', prefill ? `IN=${(prefill.in||[]).length}, OUT=${(prefill.out||[]).length}` : 'NONE (will poll)')
      if (prefill) {
        applyPrefill(prefill)
      } else {
        // Prefill not ready yet — clear form and poll every 3s until AI finishes
        setInRows([EMPTY_ROW()])
        setOutRows([EMPTY_ROW()])
        setDate(todayStr())
        startPrefillPoll(item.id || item.queue_id)
      }
      // Fetch existing descriptions for grouping
      const storeId = picked.store_id || item.store_id
      if (storeId) {
        Promise.all([
          adminGetDescriptions(storeId, 'other'),
          adminGetDescriptions(storeId, 'staff_payment'),
          adminGetDescriptions(storeId, 'staff_received'),
          adminGetDescriptions(storeId, 'supplier_payment'),
        ]).then(([others, staff, staffRcv, suppliers]) => {
          setTypeDescriptions({
            other: others.descriptions || [],
            staff_payment: staff.descriptions || [],
            staff_received: staffRcv.descriptions || [],
            supplier_payment: suppliers.descriptions || [],
          })
          setTypeTags({
            other: others.tags || [],
            staff_payment: staff.tags || [],
            staff_received: staffRcv.tags || [],
            supplier_payment: suppliers.tags || [],
          })
        }).catch(() => {})
      }
    } catch (e) {
      console.error('Pick failed:', e)
    }
    setLoading(false)
  }

  /* ── Save & Next ───────────────────────────────────── */
  async function handleSave() {
    if (!selectedId || saving) return
    setSaving(true)
    try {
      // Build transactions array with proper type/column fields
      const transactions = []
      inRows.filter(r => r.desc || r.amount).forEach(r => {
        transactions.push({
          description: r.desc,
          amount: parseFloat(r.amount) || 0,
          type: r.type || 'sale',
          column: 'in',
          person_name: r.person || null,
          tag: r.tag || null,
        })
      })
      outRows.filter(r => r.desc || r.amount).forEach(r => {
        transactions.push({
          description: r.desc,
          amount: parseFloat(r.amount) || 0,
          type: r.type || 'expense',
          column: 'out',
          person_name: r.person || null,
          tag: r.tag || null,
        })
      })
      await adminCompleteQueue(selectedId, { date, transactions })
      setSelected(null)
      setSelectedId(null)
      await refreshQueue()
      await refreshStats()
      // Auto-select next pending
      const [fp, fi] = await Promise.all([adminGetQueue('pending'), adminGetQueue('in_progress')])
      const nextItems = [...(fp.queue || fp.items || []), ...(fi.queue || fi.items || [])]
      if (nextItems.length) handleSelect(nextItems[0])
    } catch (e) {
      alert('Save failed: ' + e.message)
    }
    setSaving(false)
  }

  /* ── Reject (bad photo) ────────────────────────────── */
  async function handleReject() {
    if (!selectedId || saving) return
    setSaving(true)
    try {
      await adminRejectQueue(selectedId)
      setSelected(null)
      setSelectedId(null)
      await refreshQueue()
      await refreshStats()
      const [fp, fi] = await Promise.all([adminGetQueue('pending'), adminGetQueue('in_progress')])
      const nextItems = [...(fp.queue || fp.items || []), ...(fi.queue || fi.items || [])]
      if (nextItems.length) handleSelect(nextItems[0])
    } catch (e) {
      alert('Reject failed: ' + e.message)
    }
    setSaving(false)
  }

  /* ── Skip ──────────────────────────────────────────── */
  function handleSkip() {
    setSelected(null)
    setSelectedId(null)
    // Select next item that isn't the current one
    const next = queue.find(q => (q.id || q.queue_id) !== selectedId)
    if (next) handleSelect(next)
  }

  /* ── View a processed (completed/skipped) queue item ─ */
  async function handleViewProcessed(item) {
    const qid = item.id || item.queue_id
    // Close any active selection first
    setSelected(null)
    setSelectedId(null)
    setViewingLoading(true)
    try {
      const detail = await adminGetQueueDetail(qid)
      setViewing(detail)
    } catch (e) {
      console.error('Failed to load detail:', e)
      setViewing(null)
    } finally {
      setViewingLoading(false)
    }
  }

  function handleCloseView() {
    setViewing(null)
  }

  /* ── Send custom message to user ───────────────────── */
  async function handleSendMessage() {
    const body = customMsg.trim()
    if (!body || !selectedId || sendingMsg) return
    setSendingMsg(true)
    setMsgFeedback('')
    try {
      await adminSendMessage({ queueId: selectedId, body })
      setCustomMsg('')
      setMsgFeedback('sent')
      setTimeout(() => setMsgFeedback(''), 2500)
    } catch (e) {
      setMsgFeedback(String(e.message || 'failed').slice(0, 80))
    } finally {
      setSendingMsg(false)
    }
  }

  /* ── Drag & Drop ───────────────────────────────────── */
  const dragRef = useRef(null) // { side, idx }

  function handleDragStart(side, idx) {
    dragRef.current = { side, idx }
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(targetSide, targetIdx) {
    const src = dragRef.current
    if (!src) return
    dragRef.current = null

    const srcRows = src.side === 'in' ? [...inRows] : [...outRows]
    const [movedRow] = srcRows.splice(src.idx, 1)

    if (src.side === targetSide) {
      // Reorder within same column
      srcRows.splice(targetIdx, 0, movedRow)
      if (targetSide === 'in') setInRows(srcRows)
      else setOutRows(srcRows)
    } else {
      // Move between columns
      if (src.side === 'in') setInRows(srcRows.length ? srcRows : [EMPTY_ROW()])
      else setOutRows(srcRows.length ? srcRows : [EMPTY_ROW()])

      const destRows = targetSide === 'in' ? [...inRows] : [...outRows]
      // Update default type when moving between sides
      const updatedRow = { ...movedRow, type: targetSide === 'in' ? 'sale' : 'expense' }
      destRows.splice(targetIdx, 0, updatedRow)
      if (targetSide === 'in') setInRows(destRows)
      else setOutRows(destRows)
    }
  }

  function handleDropOnColumn(e, targetSide) {
    e.preventDefault()
    const src = dragRef.current
    if (!src) return
    // Drop at end of column
    const targetIdx = targetSide === 'in' ? inRows.length : outRows.length
    handleDrop(targetSide, targetIdx)
  }

  /* ── Row management ────────────────────────────────── */
  function updateRow(side, idx, field, value) {
    const setter = side === 'in' ? setInRows : setOutRows
    setter(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }
  function addRow(side) {
    const setter = side === 'in' ? setInRows : setOutRows
    setter(prev => [...prev, EMPTY_ROW()])
  }
  function removeRow(side, idx) {
    const setter = side === 'in' ? setInRows : setOutRows
    setter(prev => prev.length <= 1 ? [EMPTY_ROW()] : prev.filter((_, i) => i !== idx))
  }

  /* ── Keyboard shortcuts ────────────────────────────── */
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
        // Add row to whichever side is focused
        const active = document.activeElement
        if (active && active.dataset.side) {
          e.preventDefault()
          addRow(active.dataset.side)
          // Focus new row after render
          setTimeout(() => {
            const inputs = formRef.current?.querySelectorAll(`input[data-side="${active.dataset.side}"]`)
            if (inputs && inputs.length) inputs[inputs.length - 1].focus()
          }, 50)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ── Confidence styling helper ─────────────────────── */
  function confClass(confidence) {
    if (!confidence) return ''
    return confidence >= 0.8 ? 'operator-conf-high' : 'operator-conf-low'
  }

  /* ── Image path ────────────────────────────────────── */
  const imageSrc = normalizeImageUrl(selected?.image_path || null)

  /* ── Render ────────────────────────────────────────── */

  /* Show loading while checking auth */
  if (!authChecked) {
    return (
      <div className="operator-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: '#888', fontSize: '1.1rem' }}>Loading...</p>
      </div>
    )
  }

  /* Show login screen if not authenticated */
  if (!operator) {
    return (
      <div className="operator-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: '40px 36px', width: 360,
          boxShadow: '0 4px 24px rgba(0,0,0,0.10)', textAlign: 'center'
        }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#1a73e8', marginBottom: 4 }}>MoneyBook</div>
          <div style={{ fontSize: 15, color: '#666', marginBottom: 28 }}>Operator Login</div>
          <form onSubmit={handleLogin}>
            <input
              type="text"
              placeholder="Username"
              value={loginUser}
              onChange={e => setLoginUser(e.target.value)}
              autoFocus
              style={{
                width: '100%', padding: '10px 14px', marginBottom: 12, border: '1px solid #ddd',
                borderRadius: 8, fontSize: 15, boxSizing: 'border-box', outline: 'none'
              }}
            />
            <input
              type="password"
              placeholder="Password"
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: 16, border: '1px solid #ddd',
                borderRadius: 8, fontSize: 15, boxSizing: 'border-box', outline: 'none'
              }}
            />
            {loginError && (
              <div style={{ color: '#d32f2f', fontSize: 13, marginBottom: 12 }}>{loginError}</div>
            )}
            <button
              type="submit"
              disabled={loginLoading || !loginUser || !loginPass}
              style={{
                width: '100%', padding: '11px 0', background: '#1a73e8', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600,
                cursor: loginLoading ? 'wait' : 'pointer', opacity: (loginLoading || !loginUser || !loginPass) ? 0.6 : 1
              }}
            >
              {loginLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="operator-root">
      {/* ── Top Bar ──────────────────────────────────── */}
      <header className="operator-topbar">
        <h1 className="operator-title">MoneyBook Operator</h1>
        <div className="operator-stats">
          <span className="operator-stat">Pending: <b>{stats.pending ?? '—'}</b></span>
          <span className="operator-stat">Completed: <b>{stats.completed_today ?? stats.completed ?? '—'}</b></span>
          <span className="operator-stat">Avg: <b>{stats.avg_minutes ? `${stats.avg_minutes}m` : '—'}</b></span>
        </div>
        {selected && (
          <div className="operator-store-ctx">
            <span>{selected.store_name || selected.phone || 'Unknown store'}</span>
            {selected.segment && <span className="operator-badge">{selected.segment}</span>}
            {selected.language && <span className="operator-badge">{selected.language}</span>}
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: '#ccc' }}>{operator.name} ({operator.role})</span>
          <button
            onClick={handleLogout}
            style={{
              padding: '5px 14px', background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, fontSize: 13,
              cursor: 'pointer'
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <div className="operator-body">
        {/* ── Left Sidebar: Queue ────────────────────── */}
        <aside className="operator-sidebar">
          <div className="operator-tabs">
            <button
              type="button"
              className={`operator-tab ${queueTab === 'active' ? 'active' : ''}`}
              onClick={() => setQueueTab('active')}
            >
              Active <span className="operator-count-badge">{queue.length}</span>
            </button>
            <button
              type="button"
              className={`operator-tab ${queueTab === 'processed' ? 'active' : ''}`}
              onClick={() => setQueueTab('processed')}
            >
              Processed <span className="operator-count-badge">{processedQueue.length}</span>
            </button>
          </div>
          <div className="operator-queue-list">
            {queueTab === 'active' && queue.length === 0 && (
              <div className="operator-empty">No pending items</div>
            )}
            {queueTab === 'processed' && processedQueue.length === 0 && (
              <div className="operator-empty">No processed items yet</div>
            )}

            {/* Active items — clickable to work on */}
            {queueTab === 'active' && queue.map(item => {
              const id = item.id || item.queue_id
              const isActive = id === selectedId
              const createdIso = item.created_at || item.received_at
              const urg = urgencyClass(createdIso)
              const rawPhone = item.store_phone || item.phone
              const phoneDisp = formatPhone(rawPhone)
              return (
                <div
                  key={id}
                  className={`operator-queue-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelect(item)}
                >
                  <div className={`operator-urgency-dot operator-urg-${urg}`} />
                  {item.image_path && (
                    <img
                      className="operator-thumb"
                      src={normalizeImageUrl(item.image_path)}
                      alt=""
                    />
                  )}
                  <div className="operator-queue-info">
                    <div className="operator-queue-name">
                      {item.store_name || <em style={{ color: '#999' }}>Unnamed store</em>}
                      <span className="operator-queue-qid">#{id}</span>
                    </div>
                    {phoneDisp && (
                      <div className="operator-queue-phone">📱 {phoneDisp}</div>
                    )}
                    <div className="operator-queue-time">
                      <span>{formatDateTime(createdIso)}</span>
                      <span className="operator-queue-timeago">· {timeAgo(createdIso)}</span>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Processed items — click to view read-only detail */}
            {queueTab === 'processed' && processedQueue.map(item => {
              const id = item.id || item.queue_id
              const createdIso   = item.created_at || item.received_at
              const completedIso = item.completed_at
              const rawPhone = item.store_phone || item.phone
              const phoneDisp = formatPhone(rawPhone)
              const isSkipped = item.status === 'skipped'
              const isViewing = viewing && viewing.queue_id === id
              return (
                <div
                  key={id}
                  className={`operator-queue-item operator-queue-item--processed ${isViewing ? 'active' : ''}`}
                  onClick={() => handleViewProcessed(item)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={`operator-status-badge ${isSkipped ? 'skipped' : 'completed'}`}>
                    {isSkipped ? '⊘' : '✓'}
                  </div>
                  {item.image_path && (
                    <img
                      className="operator-thumb"
                      src={normalizeImageUrl(item.image_path)}
                      alt=""
                    />
                  )}
                  <div className="operator-queue-info">
                    <div className="operator-queue-name">
                      {item.store_name || <em style={{ color: '#999' }}>Unnamed store</em>}
                      <span className="operator-queue-qid">#{id}</span>
                    </div>
                    {phoneDisp && (
                      <div className="operator-queue-phone">📱 {phoneDisp}</div>
                    )}
                    <div className="operator-queue-time">
                      <span style={{ fontSize: 10, color: '#94A3B8' }}>Received:</span>{' '}
                      <span>{formatDateTime(createdIso)}</span>
                    </div>
                    {completedIso && (
                      <div className="operator-queue-time">
                        <span style={{ fontSize: 10, color: '#94A3B8' }}>
                          {isSkipped ? 'Skipped:' : 'Saved:'}
                        </span>{' '}
                        <span>{formatDateTime(completedIso)}</span>
                        <span className="operator-queue-timeago">· {timeAgo(completedIso)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        {/* ── Main Area ──────────────────────────────── */}
        <main className="operator-main">
          {/* Read-only view of a PROCESSED item — takes precedence over placeholder */}
          {viewing ? (
            <ProcessedView
              detail={viewing}
              loading={viewingLoading}
              onClose={handleCloseView}
            />
          ) : viewingLoading ? (
            <div className="operator-placeholder">
              <div className="operator-placeholder-icon">⏳</div>
              <p>Loading entry details...</p>
            </div>
          ) : !selected ? (
            <div className="operator-placeholder">
              <div className="operator-placeholder-icon">📋</div>
              <p>Select an item from the queue to start</p>
            </div>
          ) : (
            <>
              {/* Photo Viewer */}
              <div className="operator-photo-area">
                <div className="operator-photo-toolbar">
                  <button className="operator-btn-sm" onClick={() => setRotation(r => r - 90)}>↶ CCW</button>
                  <button className="operator-btn-sm" onClick={() => setRotation(r => r + 90)}>↷ CW</button>
                  <button className="operator-btn-sm" onClick={() => setRotation(0)}>Reset</button>
                </div>
                <div className="operator-photo-container">
                  {imageSrc ? (
                    <img
                      className="operator-photo"
                      src={imageSrc}
                      alt="Ledger"
                      style={{ transform: `rotate(${rotation}deg)` }}
                    />
                  ) : (
                    <div className="operator-no-photo">No image available</div>
                  )}
                </div>
              </div>

              {/* Entry Form */}
              <div className="operator-form-area" ref={formRef}>
                <div className="operator-form-header">
                  <label className="operator-date-label">
                    Date:
                    <input
                      type="date"
                      className="operator-date-input"
                      value={date}
                      onChange={e => setDate(e.target.value)}
                    />
                  </label>
                  {prefillLoading && (
                    <span style={{ marginLeft: 12, fontSize: 13, color: '#888', fontStyle: 'italic' }}>
                      ⏳ AI filling entries…
                    </span>
                  )}
                </div>

                <div className="operator-columns">
                  {/* JAMA (IN) Column */}
                  <div className="operator-col" onDragOver={handleDragOver} onDrop={e => handleDropOnColumn(e, 'in')}>
                    <div className="operator-col-header operator-col-in">JAMA (IN)</div>
                    {inRows.map((row, idx) => (
                      <div
                        key={idx}
                        className={`operator-row ${confClass(row.confidence)}`}
                        draggable
                        onDragStart={() => handleDragStart('in', idx)}
                        onDragOver={handleDragOver}
                        onDrop={e => { e.stopPropagation(); handleDrop('in', idx) }}
                      >
                        <input
                          className="operator-input operator-input-desc"
                          placeholder="Description"
                          value={row.desc}
                          list={`desc-list-in-${idx}`}
                          data-side="in"
                          onChange={e => updateRow('in', idx, 'desc', e.target.value)}
                          tabIndex={0}
                        />
                        <datalist id={`desc-list-in-${idx}`}>
                          {(typeDescriptions[row.type] || []).map((d, di) => (
                            <option key={di} value={d} />
                          ))}
                        </datalist>
                        <input
                          className="operator-input operator-input-amt"
                          placeholder="Amt"
                          type="number"
                          value={row.amount}
                          data-side="in"
                          onChange={e => updateRow('in', idx, 'amount', e.target.value)}
                          tabIndex={0}
                        />
                        <select
                          className="operator-type-select"
                          value={row.type || 'sale'}
                          onChange={e => updateRow('in', idx, 'type', e.target.value)}
                          data-side="in"
                        >
                          <option value="sale">Sale</option>
                          <option value="expense">Expense</option>
                          <option value="dues_given">Dues Given</option>
                          <option value="dues_received">Dues Received</option>
                          <option value="staff_payment">Staff Paid</option>
                          <option value="staff_received">Staff Received</option>
                          <option value="supplier_payment">Supplier/Party</option>
                          <option value="bank_deposit">Bank Deposit</option>
                          <option value="receipt">Receipt</option>
                          <option value="opening_balance">Opening Bal</option>
                          <option value="closing_balance">Closing Bal</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          className="operator-person-input"
                          placeholder="Person"
                          value={row.person || ''}
                          onChange={e => updateRow('in', idx, 'person', e.target.value)}
                          data-side="in"
                        />
                        {['other', 'supplier_payment'].includes(row.type) ? (
                          <>
                            <input
                              className="operator-tag-input"
                              list={`sub-list-in-${idx}`}
                              placeholder="Sub-type"
                              value={row.tag || ''}
                              onChange={e => updateRow('in', idx, 'tag', e.target.value)}
                            />
                            <datalist id={`sub-list-in-${idx}`}>
                              {[...new Set([...(typeTags[row.type] || []), ...(typeDescriptions[row.type] || [])])].map((d, di) => (
                                <option key={di} value={d} />
                              ))}
                            </datalist>
                          </>
                        ) : row.type === 'expense' ? (
                          <input
                            className="operator-tag-input"
                            list="tag-list"
                            placeholder="Category"
                            value={row.tag || ''}
                            onChange={e => updateRow('in', idx, 'tag', e.target.value)}
                          />
                        ) : null}
                        <button className="operator-btn-x" onClick={() => removeRow('in', idx)} tabIndex={-1}>&times;</button>
                      </div>
                    ))}
                    <button className="operator-btn-add" onClick={() => addRow('in')}>+ Add row</button>
                  </div>

                  {/* NAAM (OUT) Column */}
                  <div className="operator-col" onDragOver={handleDragOver} onDrop={e => handleDropOnColumn(e, 'out')}>
                    <div className="operator-col-header operator-col-out">NAAM (OUT)</div>
                    {outRows.map((row, idx) => (
                      <div
                        key={idx}
                        className={`operator-row ${confClass(row.confidence)}`}
                        draggable
                        onDragStart={() => handleDragStart('out', idx)}
                        onDragOver={handleDragOver}
                        onDrop={e => { e.stopPropagation(); handleDrop('out', idx) }}
                      >
                        <input
                          className="operator-input operator-input-desc"
                          placeholder="Description"
                          value={row.desc}
                          list={`desc-list-out-${idx}`}
                          data-side="out"
                          onChange={e => updateRow('out', idx, 'desc', e.target.value)}
                          tabIndex={0}
                        />
                        <datalist id={`desc-list-out-${idx}`}>
                          {(typeDescriptions[row.type] || []).map((d, di) => (
                            <option key={di} value={d} />
                          ))}
                        </datalist>
                        <input
                          className="operator-input operator-input-amt"
                          placeholder="Amt"
                          type="number"
                          value={row.amount}
                          data-side="out"
                          onChange={e => updateRow('out', idx, 'amount', e.target.value)}
                          tabIndex={0}
                        />
                        <select
                          className="operator-type-select"
                          value={row.type || 'expense'}
                          onChange={e => updateRow('out', idx, 'type', e.target.value)}
                          data-side="out"
                        >
                          <option value="sale">Sale</option>
                          <option value="expense">Expense</option>
                          <option value="dues_given">Dues Given</option>
                          <option value="dues_received">Dues Received</option>
                          <option value="staff_payment">Staff Paid</option>
                          <option value="staff_received">Staff Received</option>
                          <option value="supplier_payment">Supplier/Party</option>
                          <option value="bank_deposit">Bank Deposit</option>
                          <option value="receipt">Receipt</option>
                          <option value="opening_balance">Opening Bal</option>
                          <option value="closing_balance">Closing Bal</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          className="operator-person-input"
                          placeholder="Person"
                          value={row.person || ''}
                          onChange={e => updateRow('out', idx, 'person', e.target.value)}
                          data-side="out"
                        />
                        {['other', 'supplier_payment'].includes(row.type) ? (
                          <>
                            <input
                              className="operator-tag-input"
                              list={`sub-list-out-${idx}`}
                              placeholder="Sub-type"
                              value={row.tag || ''}
                              onChange={e => updateRow('out', idx, 'tag', e.target.value)}
                            />
                            <datalist id={`sub-list-out-${idx}`}>
                              {[...new Set([...(typeTags[row.type] || []), ...(typeDescriptions[row.type] || [])])].map((d, di) => (
                                <option key={di} value={d} />
                              ))}
                            </datalist>
                          </>
                        ) : row.type === 'expense' ? (
                          <input
                            className="operator-tag-input"
                            list="tag-list"
                            placeholder="Category"
                            value={row.tag || ''}
                            onChange={e => updateRow('out', idx, 'tag', e.target.value)}
                          />
                        ) : null}
                        <button className="operator-btn-x" onClick={() => removeRow('out', idx)} tabIndex={-1}>&times;</button>
                      </div>
                    ))}
                    <button className="operator-btn-add" onClick={() => addRow('out')}>+ Add row</button>
                  </div>
                </div>

                {/* Shared datalist for expense categories */}
                <datalist id="tag-list">
                  <option value="staff_expense" />
                  <option value="rent" />
                  <option value="electricity" />
                  <option value="transport" />
                  <option value="food" />
                  <option value="purchase" />
                  <option value="cleaning" />
                  <option value="office_supplies" />
                  <option value="repair" />
                  <option value="petrol" />
                  <option value="telephone" />
                  <option value="water" />
                  <option value="insurance" />
                  <option value="packaging" />
                  <option value="tailoring" />
                  <option value="washing" />
                  <option value="cash_discount" />
                  <option value="store_expense" />
                  <option value="labour" />
                  <option value="tea" />
                  <option value="stationery" />
                  <option value="courier" />
                </datalist>

                {/* Custom message to user */}
                <div
                  className="operator-custom-msg"
                  style={{
                    marginTop: 14,
                    padding: '10px 12px',
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#475569',
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    <span>💬 Message to user</span>
                    {msgFeedback === 'sent' && (
                      <span style={{ color: '#16A34A', fontWeight: 600, textTransform: 'none' }}>
                        ✓ Sent
                      </span>
                    )}
                    {msgFeedback && msgFeedback !== 'sent' && (
                      <span style={{ color: '#DC2626', fontWeight: 600, textTransform: 'none' }}>
                        {msgFeedback}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={customMsg}
                      onChange={e => { setCustomMsg(e.target.value); setMsgFeedback('') }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSendMessage()
                        }
                      }}
                      placeholder='e.g. "We need 1 more hour to process your photo"'
                      disabled={sendingMsg}
                      maxLength={2000}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        border: '1px solid #CBD5E1',
                        borderRadius: 6,
                        fontSize: 13,
                        outline: 'none',
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleSendMessage}
                      disabled={!customMsg.trim() || sendingMsg}
                      style={{
                        padding: '8px 16px',
                        background: customMsg.trim() && !sendingMsg ? '#2563EB' : '#94A3B8',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: customMsg.trim() && !sendingMsg ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {sendingMsg ? '...' : 'Send'}
                    </button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="operator-actions">
                  <button
                    className="operator-btn operator-btn-save"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save & Next'}
                  </button>
                  <button
                    className="operator-btn operator-btn-reject"
                    onClick={handleReject}
                    disabled={saving}
                  >
                    Bad Photo
                  </button>
                  <button
                    className="operator-btn operator-btn-skip"
                    onClick={handleSkip}
                    disabled={saving}
                  >
                    Skip
                  </button>
                  <span className="operator-shortcut-hint">Ctrl+S to save &middot; Enter to add row</span>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
