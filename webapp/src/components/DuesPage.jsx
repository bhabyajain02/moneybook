import { useState, useEffect } from 'react'
import { fetchDues, fetchStaff, updateDuesContact, fetchPersonDuesHistory } from '../api.js'
import { t } from '../translations.js'

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

/* ── Date helpers ────────────────────────────────────────── */
function toISO(d) { return d.toISOString().slice(0, 10) }
function getRange(period) {
  const today = new Date()
  if (period === 'month') return { start: toISO(new Date(today.getFullYear(), today.getMonth(), 1)), end: toISO(today) }
  if (period === 'quarter') {
    const qm = Math.floor(today.getMonth() / 3) * 3
    return { start: toISO(new Date(today.getFullYear(), qm, 1)), end: toISO(today) }
  }
  if (period === 'year') return { start: toISO(new Date(today.getFullYear(), 0, 1)), end: toISO(today) }
  return { start: null, end: null } // 'all'
}

const PERIOD_LABELS = [
  { key: 'month',   label: 'This Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year',    label: 'Year' },
  { key: 'all',     label: 'All Time' },
]


// ── Full ledger for one customer ────────────────────────────────
function DuesCard({ due, phone, language, onContactSaved }) {
  const [expanded,  setExpanded]  = useState(false)
  const [history,   setHistory]   = useState(null)
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
      <div className="dues-card-top" onClick={toggleExpand} style={{ cursor: 'pointer' }}>
        <div>
          <div className="dues-name">{due.person_name}</div>
          {due.phone
            ? <a href={`tel:${due.phone}`} className="dues-phone" onClick={e => e.stopPropagation()}>📞 {due.phone}</a>
            : <span className="dues-phone" style={{ color: '#bbb' }}>{t('no_contact', language)}</span>
          }
        </div>
        <div className="dues-right">
          <div className="dues-amount">{fmtRs(due.balance)}</div>
          <div className="dues-days" style={{ color }}>
            {days > 0 ? `${days} ${t('days_ago', language)}` : t('today_label', language)}
          </div>
          <span style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
            {expanded ? t('hide_label', language) : t('ledger_label', language)}
          </span>
        </div>
      </div>

      {/* Add contact */}
      {!due.phone && !editing && !expanded && (
        <button className="add-contact-btn" onClick={() => setEditing(true)}>
          {t('add_contact', language)}
        </button>
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
            <p className="dues-ledger-loading">{t('loading', language)}</p>
          ) : txns.length === 0 ? (
            <p className="dues-ledger-empty">{t('no_history', language)}</p>
          ) : (
            <table className="dues-ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="dl-num">Amount</th>
                  <th className="dl-num">{t('outstanding', language)}</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((txn, i) => {
                  const isGiven = txn.type === 'given'
                  return (
                    <tr key={i} className={isGiven ? 'dl-row-given' : 'dl-row-received'}>
                      <td className="dl-date">{fmtDate(txn.date)}</td>
                      <td className="dl-desc">
                        <span className={`dl-badge ${isGiven ? 'dl-badge-given' : 'dl-badge-rcvd'}`}>
                          {isGiven ? t('given_badge', language) : t('received_badge', language)}
                        </span>
                        {txn.description || (isGiven ? t('udhaar_given', language) : t('udhaar_received', language))}
                      </td>
                      <td className={`dl-num dl-amt ${isGiven ? 'dl-amt-given' : 'dl-amt-rcvd'}`}>
                        {isGiven ? '+' : '−'}{fmtRs(txn.amount)}
                      </td>
                      <td className="dl-num dl-bal">{fmtRs(txn.running_bal)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="dl-foot">
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>{t('outstanding', language)}:</td>
                  <td className="dl-num" style={{ fontWeight: 700, color: '#E53935' }}>{fmtRs(due.balance)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* Add contact from within ledger */}
          {!due.phone && !editing && (
            <button className="add-contact-btn" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
              {t('add_contact', language)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}


// ── Staff card (updated for net total) ──────────────────────
function StaffCard({ member, language }) {
  const [expanded, setExpanded] = useState(false)
  const isNeg = member.net_total < 0

  return (
    <div className="staff-card">
      <div className="staff-card-top" onClick={() => setExpanded(!expanded)}>
        <div className="staff-card-left">
          <div className="staff-name">👷 {member.name}</div>
          <div className="staff-meta">
            {(member.recent_payments || []).length} transaction{(member.recent_payments || []).length !== 1 ? 's' : ''} in period
          </div>
        </div>
        <div className="staff-right">
          <div className="staff-total" style={{ color: isNeg ? '#2E7D32' : '#E65100' }}>
            {isNeg ? '+' : ''}{fmtRs(Math.abs(member.net_total))}
          </div>
          <div className="staff-sublabel" style={{ color: isNeg ? '#4CAF50' : '#999' }}>
            {isNeg ? 'received more' : 'net paid'}
          </div>
          <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="staff-expanded">
          {member.recent_payments && member.recent_payments.length > 0 ? (
            <div className="staff-section">
              <div className="staff-section-title">Recent Transactions</div>
              {member.recent_payments.map((p, i) => {
                const isReceipt = p.type === 'receipt'
                return (
                  <div key={i} className="staff-payment-row">
                    <span className="staff-pay-date">{p.date}</span>
                    <span className="staff-pay-desc">{p.description || (isReceipt ? 'Received' : 'Payment')}</span>
                    <span className="staff-pay-amt" style={{ color: isReceipt ? '#2E7D32' : '#E65100' }}>
                      {isReceipt ? '+' : '−'}{fmtRs(p.amount)}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="staff-empty">{t('no_payments', language)}</p>
          )}
        </div>
      )}
    </div>
  )
}


// ── Main DuesPage ────────────────────────────────────────────────
export default function DuesPage({ phone, storeName, language = 'hinglish' }) {
  const [tab,     setTab]     = useState('dues')
  const [period,  setPeriod]  = useState('all')
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
          const { start, end } = getRange(period)
          const res = await fetchStaff(phone, start, end)
          setStaff(res.staff || [])
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [phone, tab, period])

  async function handleContactSaved(personName, contactPhone) {
    await updateDuesContact(phone, personName, contactPhone)
    const res = await fetchDues(phone)
    setDues(res.dues || [])
  }

  const totalDues = dues.reduce((s, d) => s + (d.balance || 0), 0)
  const totalStaffExpense = staff.reduce((s, m) => s + (m.net_total > 0 ? m.net_total : 0), 0)
  const totalStaffReceived = staff.reduce((s, m) => s + (m.net_total < 0 ? Math.abs(m.net_total) : 0), 0)

  return (
    <div className="dues-page">
      <div className="chat-header">
        <div className="header-avatar">👥</div>
        <div className="header-info">
          <div className="header-name">{storeName || 'Dues & Staff'}</div>
          <div className="header-status">{t('dues_status', language)}</div>
        </div>
      </div>

      {/* ── Period selector ── */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 12px', background: '#f5f5f5',
        borderBottom: '1px solid #e0e0e0', overflowX: 'auto', flexShrink: 0,
      }}>
        {PERIOD_LABELS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)} style={{
            padding: '5px 12px', borderRadius: 16, border: 'none', fontSize: 12, fontWeight: 600,
            background: period === p.key ? '#00695C' : '#fff',
            color: period === p.key ? '#fff' : '#555',
            boxShadow: period === p.key ? '0 2px 6px rgba(0,105,92,0.3)' : '0 1px 3px rgba(0,0,0,0.08)',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="dues-tabs">
        <button className={`dues-tab ${tab === 'dues' ? 'active' : ''}`} onClick={() => setTab('dues')}>
          {t('tab_dues', language)}
        </button>
        <button className={`dues-tab ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>
          {t('tab_staff', language)}
        </button>
      </div>

      <div className="dues-body">
        {loading && <div className="dues-loading">{t('loading', language)}</div>}
        {error   && <div className="dues-error">⚠️ {error}</div>}

        {!loading && !error && tab === 'dues' && (
          <>
            {dues.length === 0 ? (
              <div className="dues-empty">{t('no_dues', language)}</div>
            ) : (
              <>
                <div className="dues-total-banner">
                  <span>{t('total_outstanding', language)}</span>
                  <span style={{ fontWeight: 700, color: '#E53935' }}>{fmtRs(totalDues)}</span>
                </div>
                {dues.map(d => (
                  <DuesCard key={d.person_name} due={d} phone={phone} language={language} onContactSaved={handleContactSaved} />
                ))}
              </>
            )}
          </>
        )}

        {!loading && !error && tab === 'staff' && (
          <>
            {staff.length === 0 ? (
              <div className="dues-empty">{t('no_staff', language)}</div>
            ) : (
              <>
                {/* Staff totals banner */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', padding: '10px 14px',
                  background: '#FFF3E0', borderRadius: 10, margin: '8px 0 12px', fontSize: 13,
                }}>
                  <div>
                    <div style={{ color: '#999', fontSize: 10, fontWeight: 600 }}>PAID</div>
                    <div style={{ fontWeight: 700, color: '#E65100' }}>{fmtRs(totalStaffExpense)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#999', fontSize: 10, fontWeight: 600 }}>RECEIVED</div>
                    <div style={{ fontWeight: 700, color: '#2E7D32' }}>{fmtRs(totalStaffReceived)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#999', fontSize: 10, fontWeight: 600 }}>NET</div>
                    <div style={{ fontWeight: 700, color: '#1a1a1a' }}>{fmtRs(totalStaffExpense - totalStaffReceived)}</div>
                  </div>
                </div>
                {staff.map(s => <StaffCard key={s.name} member={s} language={language} />)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
