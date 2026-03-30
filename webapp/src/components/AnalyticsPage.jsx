import { useState, useEffect } from 'react'
import { fetchAnalytics } from '../api.js'

const PERIODS = [
  { key: 'day',    label: 'Today' },
  { key: 'week',   label: 'Week'  },
  { key: 'month',  label: 'Month' },
  { key: 'year',   label: 'Year'  },
  { key: 'custom', label: 'Custom' },
]

// ── Formatters ────────────────────────────────────────────────
function fmtRs(val) {
  const n = parseFloat(val) || 0
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}


function toISO(d) {
  // Date object → YYYY-MM-DD
  return d.toISOString().slice(0, 10)
}

function getPresetRange(period) {
  const now = new Date()
  if (period === 'day')   return { start: toISO(now), end: toISO(now) }
  if (period === 'week') {
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { start: toISO(mon), end: toISO(sun) }
  }
  if (period === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: toISO(s), end: toISO(now) }
  }
  // year
  const s = new Date(now.getFullYear(), 0, 1)
  return { start: toISO(s), end: toISO(now) }
}

function fmtPill(start, end) {
  const fmt = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  if (!start || !end) return '—'
  if (start === end) return fmt(start)
  const sy = start.slice(0, 4), ey = end.slice(0, 4)
  if (sy === ey) return `${fmt(start)} – ${fmt(end)}`
  return `${fmt(start)} ${sy} – ${fmt(end)} ${ey}`
}

// ── Date range picker bottom sheet ───────────────────────────
function DateRangePicker({ start, end, onApply, onClose }) {
  const [s, setS] = useState(start || toISO(new Date()))
  const [e, setE] = useState(end   || toISO(new Date()))

  const today = toISO(new Date())

  function apply() {
    if (s > e) { alert('Start date must be before end date'); return }
    onApply(s, e)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'flex-end', zIndex:999 }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:'20px 20px 0 0', padding:'24px 20px 40px', width:'100%', boxShadow:'0 -4px 20px rgba(0,0,0,0.15)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:17, color:'#1a1a2e' }}>Custom Date Range</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#888' }}>✕</button>
        </div>

        <label style={{ display:'block', fontSize:12, color:'#888', fontWeight:600, marginBottom:6 }}>From</label>
        <input type="date" value={s} max={today} onChange={ev => setS(ev.target.value)}
          style={{ width:'100%', boxSizing:'border-box', border:'1.5px solid #e0e0e0', borderRadius:10, padding:'10px 12px', fontSize:15, marginBottom:16, outline:'none' }} />

        <label style={{ display:'block', fontSize:12, color:'#888', fontWeight:600, marginBottom:6 }}>To</label>
        <input type="date" value={e} max={today} onChange={ev => setE(ev.target.value)}
          style={{ width:'100%', boxSizing:'border-box', border:'1.5px solid #e0e0e0', borderRadius:10, padding:'10px 12px', fontSize:15, marginBottom:24, outline:'none' }} />

        {/* Quick presets */}
        <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
          {[
            { label: 'Last 7 days',  days: 7  },
            { label: 'Last 30 days', days: 30 },
            { label: 'Last 90 days', days: 90 },
          ].map(preset => {
            const from = new Date(); from.setDate(from.getDate() - preset.days + 1)
            return (
              <button key={preset.label}
                onClick={() => { setS(toISO(from)); setE(today) }}
                style={{ padding:'6px 12px', borderRadius:20, border:'1.5px solid #2E7D32', background:'#fff', color:'#2E7D32', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                {preset.label}
              </button>
            )
          })}
        </div>

        <button onClick={apply} style={{ width:'100%', padding:'13px 0', background:'#1B5E20', color:'#fff', border:'none', borderRadius:12, fontWeight:700, fontSize:15, cursor:'pointer' }}>
          Apply Range
        </button>
      </div>
    </div>
  )
}

// ── Accordion card ────────────────────────────────────────────
function AccordionCard({ iconBg, icon, label, amount, amountColor, children, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div style={{
      background: '#fff', borderRadius: 16,
      boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
      overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          width: '100%', padding: '16px 16px',
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: iconBg, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 20, flexShrink: 0,
        }}>{icon}</div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#999', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>
            {label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: amountColor || '#1a1a2e', letterSpacing: -0.5 }}>
            {amount}
          </div>
        </div>

        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: '#f4f4f4', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#888', fontSize: 12, flexShrink: 0,
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▼</div>
      </button>

      {/* Body */}
      {open && (
        <div style={{ borderTop: '1px solid #f2f2f2', padding: '16px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Stat row inside accordion ─────────────────────────────────
function StatRow({ label, value, color, sub, noBorder }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: noBorder ? 'none' : '1px solid #f5f5f5',
    }}>
      <span style={{ fontSize: 13, color: '#666' }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: color || '#1a1a2e' }}>{fmtRs(value)}</div>
        {sub && <div style={{ fontSize: 11, color: '#aaa' }}>{sub}</div>}
      </div>
    </div>
  )
}

// ── Expense category colours ──────────────────────────────────
const EXP_COLORS = ['#FF7043','#F9A825','#7B1FA2','#1976D2','#00897B','#E53935','#558B2F','#6D4C41']

function expColor(i) { return EXP_COLORS[i % EXP_COLORS.length] }

// ── Expense category card row ─────────────────────────────────
function ExpenseRow({ tag, amount, total, rank }) {
  const pct   = total ? (amount / total) * 100 : 0
  const label = tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const color = expColor(rank)
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#333', fontWeight: 500 }}>{label}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color }}>{fmtRs(amount)}</span>
          <span style={{ fontSize: 11, color: '#bbb', marginLeft: 5 }}>{Math.round(pct)}%</span>
        </div>
      </div>
      <div style={{ height: 6, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: color,
          width: `${Math.max(2, pct)}%`,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

// ── Expense summary strip (top of expanded section) ───────────
function ExpenseSummary({ total, count, topCategory }) {
  return (
    <div style={{
      display: 'flex', gap: 10, marginBottom: 16,
    }}>
      <div style={{ flex: 1, background: '#FFF3F0', borderRadius: 12, padding: '12px 14px' }}>
        <div style={{ fontSize: 11, color: '#FF7043', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Total</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#FF7043' }}>{fmtRs(total)}</div>
      </div>
      <div style={{ flex: 1, background: '#F3F0FF', borderRadius: 12, padding: '12px 14px' }}>
        <div style={{ fontSize: 11, color: '#7B1FA2', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Categories</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#7B1FA2' }}>{count}</div>
      </div>
      {topCategory && (
        <div style={{ flex: 1.4, background: '#FFF8E1', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, color: '#F9A825', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Top</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#F9A825', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{topCategory}</div>
        </div>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────
function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: '#f0f0f0', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 24, margin: '0 auto 12px',
        color: '#bbb',
      }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#333', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#aaa' }}>{subtitle}</div>
    </div>
  )
}


// ── Main component ────────────────────────────────────────────
export default function AnalyticsPage({ phone, storeName }) {
  const [period,      setPeriod]      = useState('week')
  const [customStart, setCustomStart] = useState(null)
  const [customEnd,   setCustomEnd]   = useState(null)
  const [showPicker,  setShowPicker]  = useState(false)
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)

  // Derive the actual start/end to query
  const { start: presetStart, end: presetEnd } = period !== 'custom' ? getPresetRange(period) : { start: customStart, end: customEnd }
  const activeStart = period === 'custom' ? customStart : presetStart
  const activeEnd   = period === 'custom' ? customEnd   : presetEnd

  useEffect(() => {
    if (period === 'custom' && (!customStart || !customEnd)) return  // wait for picker
    setData(null)
    setLoading(true)
    setError(null)
    fetchAnalytics(phone, period, activeStart, activeEnd)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [phone, period, customStart, customEnd])

  function handlePeriodClick(key) {
    if (key === 'custom') {
      setShowPicker(true)
    } else {
      setPeriod(key)
      setCustomStart(null)
      setCustomEnd(null)
    }
  }

  function handlePickerApply(s, e) {
    setCustomStart(s)
    setCustomEnd(e)
    setPeriod('custom')
    setShowPicker(false)
  }

  const kpis         = data?.kpis || {}
  const pnl          = kpis.net_pnl || 0
  const totalExpTags = Object.values(data?.expense_tags || {}).reduce((a, b) => a + b, 0)
  const expCount     = Object.keys(data?.expense_tags || {}).length
  const staffCount   = data?.staff_payments?.length || 0
  const duesCount    = data?.dues_summary?.length   || 0
  const pillLabel    = period === 'custom' && customStart && customEnd
    ? fmtPill(customStart, customEnd)
    : fmtPill(presetStart, presetEnd)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f5f0' }}>

      {/* ── Dark green header ── */}
      <div style={{ background: '#1B5E20', flexShrink: 0 }}>
        {/* Store name row */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 16px 12px', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, flexShrink: 0,
          }}>🏪</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 18, lineHeight: 1.2 }}>
              {storeName || 'My Store'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1 }}>
              Business Insights
            </div>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 22 }}>📊</div>
        </div>

        {/* Period tabs */}
        <div style={{ display: 'flex', padding: '0 8px 0' }}>
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => handlePeriodClick(p.key)}
              style={{
                flex: 1, padding: '10px 0 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: period === p.key ? '#fff' : 'rgba(255,255,255,0.5)',
                fontWeight: period === p.key ? 700 : 400,
                fontSize: 13,
                borderBottom: period === p.key ? '2px solid #fff' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px' }}>

        {/* Date range pill — tapping opens picker */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <button onClick={() => setShowPicker(true)} style={{
            background: '#d6ecd6', borderRadius: 20,
            padding: '6px 14px', fontSize: 13, fontWeight: 600, color: '#2E7D32',
            border: 'none', cursor: 'pointer',
          }}>
            {pillLabel}
          </button>
          <button onClick={() => setShowPicker(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>📅</button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>
            <div style={{ fontSize: 13 }}>Loading…</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: '#fff3f3', borderRadius: 12, padding: 16, color: '#c62828', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Accordion cards */}
        {!loading && !error && data && (
          <>
            {/* Expenses */}
            <AccordionCard
              iconBg="#FBE9E7" icon="💸"
              label="Expenses"
              amount={fmtRs(kpis.operating_expenses)}
              amountColor="#FF7043"
              defaultOpen={true}
            >
              {expCount > 0 ? (
                <>
                  {/* Summary strip */}
                  <ExpenseSummary
                    total={kpis.operating_expenses}
                    count={expCount}
                    topCategory={Object.entries(data.expense_tags).sort((a,b)=>b[1]-a[1])[0]?.[0]
                      ?.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
                  />
                  {/* Divider */}
                  <div style={{ height: 1, background: '#f0f0f0', marginBottom: 16 }} />
                  {/* Category bars */}
                  {Object.entries(data.expense_tags)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tag, amt], i) => (
                      <ExpenseRow key={tag} tag={tag} amount={amt} total={totalExpTags} rank={i} />
                    ))}
                </>
              ) : (
                <EmptyState icon="🧾" title="No Expenses" subtitle="No expenses recorded this period" />
              )}
            </AccordionCard>

            {/* Udhaar / Dues */}
            <AccordionCard
              iconBg="#FFF8E1" icon="📒"
              label="Udhaar / Dues"
              amount={fmtRs(kpis.udhaar_outstanding)}
              amountColor="#F9A825"
            >
              {duesCount > 0 ? (
                <>
                  <StatRow label="Total Outstanding" value={kpis.udhaar_outstanding} color="#E53935" />
                  {kpis.udhaar_given_period > 0 &&
                    <StatRow label="Given this period" value={kpis.udhaar_given_period} color="#FF7043" />}
                  {kpis.udhaar_received_period > 0 &&
                    <StatRow label="Received this period" value={kpis.udhaar_received_period} color="#2E7D32" noBorder />}
                  <div style={{ marginTop: 12 }}>
                    {data.dues_summary.map((d, i) => (
                      <div key={d.name} style={{
                        display: 'flex', justifyContent: 'space-between',
                        padding: '8px 0', borderBottom: i < duesCount - 1 ? '1px solid #f5f5f5' : 'none',
                      }}>
                        <span style={{ fontSize: 13, color: '#444' }}>{d.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#E53935' }}>{fmtRs(d.balance)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState icon="✅" title="No Outstanding Dues" subtitle="All udhaar is clear" />
              )}
            </AccordionCard>

            {/* Staff */}
            <AccordionCard
              iconBg="#E8F5E9" icon="👷"
              label="Staff"
              amount={fmtRs(kpis.staff_expenses)}
              amountColor="#2E7D32"
            >
              {staffCount > 0 ? (
                <>
                  <StatRow label="Total Staff Paid" value={kpis.staff_expenses} color="#2E7D32"
                    sub={`${staffCount} member${staffCount > 1 ? 's' : ''}`} />
                  <div style={{ marginTop: 12 }}>
                    {data.staff_payments.map((s, i) => (
                      <div key={s.person_name} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 0', borderBottom: i < staffCount - 1 ? '1px solid #f5f5f5' : 'none',
                      }}>
                        <span style={{ fontSize: 13, color: '#444' }}>{s.person_name}</span>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#2E7D32' }}>{fmtRs(s.total)}</div>
                          <div style={{ fontSize: 11, color: '#aaa' }}>{s.count} payment{s.count > 1 ? 's' : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState icon="👷" title="No Staff Payments" subtitle="No staff payments this period" />
              )}
            </AccordionCard>

            {/* Sales */}
            <AccordionCard
              iconBg="#E8F5E9" icon="📈"
              label="Sales"
              amount={fmtRs(kpis.total_sales)}
              amountColor="#2E7D32"
            >
              <StatRow label="Total Sales" value={kpis.total_sales} color="#2E7D32" />
              <StatRow
                label="Net Profit / Loss"
                value={Math.abs(pnl)}
                color={pnl >= 0 ? '#2E7D32' : '#E53935'}
                sub={pnl >= 0 ? '📈 Profit' : '📉 Loss'}
                noBorder
              />
            </AccordionCard>

          <div style={{ height: 16 }} />
          </>
        )}
      </div>

      {/* Date range picker sheet */}
      {showPicker && (
        <DateRangePicker
          start={activeStart}
          end={activeEnd}
          onApply={handlePickerApply}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
