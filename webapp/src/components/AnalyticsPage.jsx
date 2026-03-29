import { useState, useEffect } from 'react'
import { fetchAnalytics } from '../api.js'

const PERIODS = [
  { key: 'day',   label: 'Today' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year' },
]

function fmtRs(val) {
  const n = parseFloat(val) || 0
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function ExpenseRow({ tag, amount, total }) {
  const pct   = total ? Math.round((amount / total) * 100) : 0
  const label = tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return (
    <div className="expense-row">
      <div className="expense-row-top">
        <span className="expense-row-label">{label}</span>
        <span className="expense-row-amount">{fmtRs(amount)}</span>
        <span className="expense-row-pct">{pct}%</span>
      </div>
      <div className="expense-bar-track">
        <div className="expense-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  )
}

// ── Accordion section ────────────────────────────────────────────
function AccordionSection({ icon, title, summary, color, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`accordion-section ${open ? 'open' : ''}`}>
      <button className="accordion-header" onClick={() => setOpen(o => !o)}>
        <span className="accordion-icon">{icon}</span>
        <span className="accordion-title">{title}</span>
        <span className="accordion-summary" style={{ color }}>{summary}</span>
        <span className="accordion-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  )
}

// ── Stat row inside accordion ────────────────────────────────────
function StatRow({ label, value, color, sub }) {
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <div>
        <span className="stat-row-value" style={{ color }}>{fmtRs(value)}</span>
        {sub && <span className="stat-row-sub">{sub}</span>}
      </div>
    </div>
  )
}

export default function AnalyticsPage({ phone, storeName }) {
  const [period,  setPeriod]  = useState('day')
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setData(null)
    setLoading(true)
    setError(null)
    fetchAnalytics(phone, period)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [phone, period])

  const kpis         = data?.kpis || {}
  const pnl          = kpis.net_pnl || 0
  const totalExpTags = Object.values(data?.expense_tags || {}).reduce((a, b) => a + b, 0)
  const expCount     = Object.keys(data?.expense_tags || {}).length
  const staffCount   = data?.staff_payments?.length || 0
  const duesCount    = data?.dues_summary?.length || 0

  return (
    <div className="analytics-page">
      {/* Header */}
      <div className="chat-header">
        <div className="header-avatar">📊</div>
        <div className="header-info">
          <div className="header-name">{storeName || 'Analytics'}</div>
          <div className="header-status">Business Insights</div>
        </div>
      </div>

      {/* Period Selector */}
      <div className="period-tabs">
        {PERIODS.map(p => (
          <button key={p.key}
            className={`period-tab ${period === p.key ? 'active' : ''}`}
            onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="analytics-body">
        {loading && (
          <div className="analytics-loading">
            <div className="typing-bubble" style={{ margin: '0 auto' }}>
              <div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/>
            </div>
            <p style={{ marginTop: 8, color: 'var(--wa-text-meta)', fontSize: 13 }}>Loading...</p>
          </div>
        )}

        {error && <div className="analytics-error">⚠️ {error}</div>}

        {!loading && !error && data && (
          <div className="accordion-list">

            {/* ── 1. Expenses ── */}
            <AccordionSection
              icon="💸" title="Expenses"
              summary={kpis.operating_expenses > 0 ? fmtRs(kpis.operating_expenses) : '₹0'}
              color="#FF7043"
              defaultOpen={true}
            >
              <StatRow label="Total Ops Expenses" value={kpis.operating_expenses} color="#FF7043"
                sub={expCount > 0 ? `${expCount} categories` : undefined} />
              {expCount > 0 ? (
                <div style={{ marginTop: 10 }}>
                  {Object.entries(data.expense_tags)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tag, amt]) => (
                      <ExpenseRow key={tag} tag={tag} amount={amt} total={totalExpTags} />
                    ))
                  }
                </div>
              ) : (
                <p className="drill-empty">Is period mein koi expenses nahi</p>
              )}
            </AccordionSection>

            {/* ── 2. Dues / Udhaar ── */}
            <AccordionSection
              icon="⚠️" title="Udhaar / Dues"
              summary={kpis.udhaar_outstanding > 0 ? fmtRs(kpis.udhaar_outstanding) + ' out' : '₹0'}
              color="#E53935"
            >
              <StatRow label="Total Outstanding" value={kpis.udhaar_outstanding} color="#E53935" />
              {kpis.udhaar_given_period > 0 &&
                <StatRow label="Diya this period" value={kpis.udhaar_given_period} color="#FF7043" />}
              {kpis.udhaar_received_period > 0 &&
                <StatRow label="Aaya this period" value={kpis.udhaar_received_period} color="#25D366" />}
              {duesCount > 0 ? (
                <div style={{ marginTop: 10 }}>
                  {data.dues_summary.map(d => (
                    <div key={d.name} className="staff-analytics-row">
                      <span className="staff-analytics-name">{d.name}</span>
                      <span className="staff-analytics-total" style={{ color: '#E53935' }}>{fmtRs(d.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="drill-empty">Koi pending udhaar nahi</p>
              )}
            </AccordionSection>

            {/* ── 3. Staff ── */}
            <AccordionSection
              icon="👷" title="Staff"
              summary={kpis.staff_expenses > 0 ? fmtRs(kpis.staff_expenses) + ' paid' : '₹0'}
              color="#FF9800"
            >
              <StatRow label="Total Staff Paid" value={kpis.staff_expenses} color="#FF9800"
                sub={staffCount > 0 ? `${staffCount} staff member${staffCount > 1 ? 's' : ''}` : undefined} />
              {staffCount > 0 ? (
                <div style={{ marginTop: 10 }}>
                  {data.staff_payments.map(s => (
                    <div key={s.person_name} className="staff-analytics-row">
                      <span className="staff-analytics-name">{s.person_name}</span>
                      <span className="staff-analytics-count">{s.count} payment{s.count > 1 ? 's' : ''}</span>
                      <span className="staff-analytics-total">{fmtRs(s.total)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="drill-empty">Is period mein koi staff payment nahi</p>
              )}
            </AccordionSection>

            {/* ── 4. Sales ── */}
            <AccordionSection
              icon="💰" title="Sales"
              summary={fmtRs(kpis.total_sales)}
              color="#25D366"
            >
              <StatRow label="Total Sales" value={kpis.total_sales} color="#25D366" />
              <StatRow label="Net Profit / Loss" value={Math.abs(pnl)}
                color={pnl >= 0 ? '#25D366' : '#E53935'}
                sub={pnl >= 0 ? '📈 Faida' : '📉 Nuksan'} />
            </AccordionSection>

          </div>
        )}
      </div>
    </div>
  )
}
