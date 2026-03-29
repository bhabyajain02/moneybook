import { useState, useEffect } from 'react'
import { fetchDues, fetchStaff, updateDuesContact, fetchPersonDuesHistory } from '../api.js'

function fmtRs(val) {
  const n = parseFloat(val) || 0
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

function daysColor(days) {
  if (days > 60) return '#D32F2F'
  if (days > 30) return '#E64A19'
  return '#F57C00'
}

// ── Full ledger for one customer ────────────────────────────────
function DuesCard({ due, phone, onContactSaved }) {
  const [expanded,  setExpanded]  = useState(false)
  const [history,   setHistory]   = useState(null)   // null = not loaded
  const [loadingH,  setLoadingH]  = useState(false)
  const [editing,   setEditing]   = useState(false)
  const [contact,   setContact]   = useState('')
  const [saving,    setSaving]    = useState(false)

  const days  = due.days_overdue || 0
  const color = daysColor(days)

  async function toggleExpand() {
    if (!expanded && !history) {
      setLoadingH(true)
      try {
        const res = await fetchPersonDuesHistory(phone, due.person_name)
        setHistory(res)
      } catch {
        setHistory({ transactions: [] })
      } finally {
        setLoadingH(false)
      }
    }
    setExpanded(e => !e)
  }

  async function handleSaveContact(e) {
    e.preventDefault()
    if (!contact.replace(/\D/g, '').length) return
    setSaving(true)
    try {
      await onContactSaved(due.person_name, contact)
      setEditing(false)
    } catch (err) {
      alert('Could not save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const txns = history?.transactions || []

  return (
    <div className="dues-card">
      {/* Card header — always visible, click to expand */}
      <div className="dues-card-top" onClick={toggleExpand} style={{ cursor: 'pointer' }}>
        <div>
          <div className="dues-name">{due.person_name}</div>
          {due.phone
            ? <a href={`tel:${due.phone}`} className="dues-phone" onClick={e => e.stopPropagation()}>📞 {due.phone}</a>
            : <span className="dues-phone" style={{ color: '#bbb' }}>No contact</span>
          }
        </div>
        <div className="dues-right">
          <div className="dues-amount">{fmtRs(due.balance)}</div>
          <div className="dues-days" style={{ color }}>{days > 0 ? `${days} days ago` : 'Today'}</div>
          <span style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{expanded ? '▲ Hide' : '▼ Ledger'}</span>
        </div>
      </div>

      {/* Add contact */}
      {!due.phone && !editing && !expanded && (
        <button className="add-contact-btn" onClick={() => setEditing(true)}>📞 Add Contact</button>
      )}
      {editing && (
        <form className="contact-form" onSubmit={handleSaveContact}>
          <input type="tel" inputMode="numeric" maxLength={10} placeholder="10 digit number"
            value={contact} onChange={e => setContact(e.target.value.replace(/\D/g,'').slice(0,10))}
            className="contact-input" />
          <button type="submit" className="contact-save-btn" disabled={saving}>{saving ? '...' : 'Save'}</button>
          <button type="button" className="contact-cancel-btn" onClick={() => setEditing(false)}>✕</button>
        </form>
      )}

      {/* Full ledger */}
      {expanded && (
        <div className="dues-ledger">
          {loadingH ? (
            <p className="dues-ledger-loading">Loading...</p>
          ) : txns.length === 0 ? (
            <p className="dues-ledger-empty">Koi history nahi mili</p>
          ) : (
            <table className="dues-ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="dl-num">Amount</th>
                  <th className="dl-num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t, i) => {
                  const isGiven = t.type === 'given'
                  return (
                    <tr key={i} className={isGiven ? 'dl-row-given' : 'dl-row-received'}>
                      <td className="dl-date">{fmtDate(t.date)}</td>
                      <td className="dl-desc">
                        <span className={`dl-badge ${isGiven ? 'dl-badge-given' : 'dl-badge-rcvd'}`}>
                          {isGiven ? '↑ Diya' : '↓ Liya'}
                        </span>
                        {t.description || (isGiven ? 'Udhaar diya' : 'Wapas liya')}
                      </td>
                      <td className={`dl-num dl-amt ${isGiven ? 'dl-amt-given' : 'dl-amt-rcvd'}`}>
                        {isGiven ? '+' : '−'}{fmtRs(t.amount)}
                      </td>
                      <td className="dl-num dl-bal">{fmtRs(t.running_bal)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="dl-foot">
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Outstanding:</td>
                  <td className="dl-num" style={{ fontWeight: 700, color: '#E53935' }}>{fmtRs(due.balance)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* Add contact from within ledger */}
          {!due.phone && !editing && (
            <button className="add-contact-btn" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
              📞 Add Contact
            </button>
          )}
        </div>
      )}
    </div>
  )
}


// ── Staff card (unchanged structure) ────────────────────────────
function StaffCard({ member }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="staff-card">
      <div className="staff-card-top" onClick={() => setExpanded(!expanded)}>
        <div className="staff-card-left">
          <div className="staff-name">👷 {member.name}</div>
          <div className="staff-meta">
            This month: <strong>{fmtRs(member.total_this_month)}</strong>
          </div>
        </div>
        <div className="staff-right">
          <div className="staff-total">{fmtRs(member.total_all_time)}</div>
          <div className="staff-sublabel">total paid</div>
          <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="staff-expanded">
          {member.recent_payments && member.recent_payments.length > 0 ? (
            <div className="staff-section">
              <div className="staff-section-title">💸 Payments</div>
              {member.recent_payments.map((p, i) => (
                <div key={i} className="staff-payment-row">
                  <span className="staff-pay-date">{p.date}</span>
                  <span className="staff-pay-desc">{p.description || 'Salary'}</span>
                  <span className="staff-pay-amt">{fmtRs(p.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="staff-empty">Koi payment nahi mili</p>
          )}
        </div>
      )}
    </div>
  )
}


// ── Main DuesPage ────────────────────────────────────────────────
export default function DuesPage({ phone, storeName }) {
  const [tab,     setTab]     = useState('dues')
  const [dues,    setDues]    = useState([])
  const [staff,   setStaff]   = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        if (tab === 'dues') {
          const res = await fetchDues(phone)
          setDues(res.dues || [])
        } else {
          const res = await fetchStaff(phone)
          setStaff(res.staff || [])
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [phone, tab])

  async function handleContactSaved(personName, contactPhone) {
    await updateDuesContact(phone, personName, contactPhone)
    const res = await fetchDues(phone)
    setDues(res.dues || [])
  }

  const totalDues = dues.reduce((s, d) => s + (d.balance || 0), 0)

  return (
    <div className="dues-page">
      <div className="chat-header">
        <div className="header-avatar">👥</div>
        <div className="header-info">
          <div className="header-name">{storeName || 'Dues & Staff'}</div>
          <div className="header-status">Track udhaar and staff</div>
        </div>
      </div>

      <div className="dues-tabs">
        <button className={`dues-tab ${tab === 'dues' ? 'active' : ''}`} onClick={() => setTab('dues')}>
          👥 Udhaar / Dues
        </button>
        <button className={`dues-tab ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>
          👷 Staff
        </button>
      </div>

      <div className="dues-body">
        {loading && <div className="dues-loading">Loading...</div>}
        {error   && <div className="dues-error">⚠️ {error}</div>}

        {!loading && !error && tab === 'dues' && (
          <>
            {dues.length === 0 ? (
              <div className="dues-empty">✅ Koi udhaar baaki nahi!</div>
            ) : (
              <>
                <div className="dues-total-banner">
                  <span>Total Outstanding</span>
                  <span style={{ fontWeight: 700, color: '#E53935' }}>{fmtRs(totalDues)}</span>
                </div>
                {dues.map(d => (
                  <DuesCard key={d.person_name} due={d} phone={phone} onContactSaved={handleContactSaved} />
                ))}
              </>
            )}
          </>
        )}

        {!loading && !error && tab === 'staff' && (
          <>
            {staff.length === 0 ? (
              <div className="dues-empty">Koi staff member nahi</div>
            ) : (
              staff.map(s => <StaffCard key={s.name} member={s} />)
            )}
          </>
        )}
      </div>
    </div>
  )
}
