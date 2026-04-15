import { useState, useEffect, useRef, useCallback } from 'react'
import {
  adminGetQueue, adminPickQueue, adminCompleteQueue,
  adminRejectQueue, adminGetStats, adminPollQueue,
  adminLogin, adminVerifyToken, adminLogout,
  adminGetDescriptions,
} from '../api.js'

const BASE = '/api'

/* ── Helpers ─────────────────────────────────────────── */

function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function urgencyClass(iso) {
  if (!iso) return 'green'
  const mins = (Date.now() - new Date(iso).getTime()) / 60000
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
  const [selected, setSelected]       = useState(null)  // full item after pick
  const [selectedId, setSelectedId]   = useState(null)
  const [stats, setStats]             = useState({})
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)

  /* Form state */
  const [date, setDate]               = useState(todayStr())
  const [inRows, setInRows]           = useState([EMPTY_ROW()])
  const [outRows, setOutRows]         = useState([EMPTY_ROW()])
  const [rotation, setRotation]       = useState(0)
  const [typeDescriptions, setTypeDescriptions] = useState({})
  const [typeTags, setTypeTags] = useState({})

  const prevCountRef = useRef(0)
  const formRef = useRef(null)

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
      const [pendingData, progressData] = await Promise.all([
        adminGetQueue('pending'),
        adminGetQueue('in_progress'),
      ])
      const items = [
        ...(pendingData.queue || pendingData.items || []),
        ...(progressData.queue || progressData.items || []),
      ]
      // Notify on new arrivals
      if (items.length > prevCountRef.current && prevCountRef.current !== 0) {
        notifyNew(items.length - prevCountRef.current)
      }
      prevCountRef.current = items.length
      setQueue(items)
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

  /* ── Select / pick a queue item ────────────────────── */
  async function handleSelect(item) {
    if (loading) return
    setLoading(true)
    setRotation(0)
    try {
      const picked = await adminPickQueue(item.id || item.queue_id, operator ? String(operator.id) : 'default')
      setSelected({ ...item, ...picked })
      setSelectedId(item.id || item.queue_id)

      // Populate form from AI prefill if available
      const prefill = picked.ai_prefill || item.ai_prefill
      console.log('[OperatorDash] picked response:', JSON.stringify(picked).slice(0, 500))
      console.log('[OperatorDash] prefill:', prefill ? `IN=${(prefill.in||[]).length}, OUT=${(prefill.out||[]).length}` : 'NONE')
      if (prefill) {
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
      } else {
        setInRows([EMPTY_ROW()])
        setOutRows([EMPTY_ROW()])
        setDate(todayStr())
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
  const imageSrc = selected?.image_path || null

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
          <div className="operator-sidebar-header">
            Queue <span className="operator-count-badge">{queue.length}</span>
          </div>
          <div className="operator-queue-list">
            {queue.length === 0 && (
              <div className="operator-empty">No pending items</div>
            )}
            {queue.map(item => {
              const id = item.id || item.queue_id
              const isActive = id === selectedId
              const urg = urgencyClass(item.created_at || item.received_at)
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
                      src={item.image_path}
                      alt=""
                    />
                  )}
                  <div className="operator-queue-info">
                    <div className="operator-queue-name">{item.store_name || item.phone || `#${id}`}</div>
                    <div className="operator-queue-time">{timeAgo(item.created_at || item.received_at)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        {/* ── Main Area ──────────────────────────────── */}
        <main className="operator-main">
          {!selected ? (
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
