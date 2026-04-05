// ── DuesScreen — converted from DuesPage.jsx ──────────────────────────────
// All business logic identical. UI: div→View, SVG→emoji/View, CSS→StyleSheet

import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  FlatList, Modal, TextInput, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fetchDues, fetchStaff, updateDuesContact, fetchPersonDuesHistory } from '../api'
import { t } from '../translations'

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

function toISO(d) { return d.toISOString().slice(0, 10) }
function getRange(period) {
  const today = new Date()
  if (period === 'month') return { start: toISO(new Date(today.getFullYear(), today.getMonth(), 1)), end: toISO(today) }
  if (period === 'quarter') { const qm = Math.floor(today.getMonth() / 3) * 3; return { start: toISO(new Date(today.getFullYear(), qm, 1)), end: toISO(today) } }
  if (period === 'year') return { start: toISO(new Date(today.getFullYear(), 0, 1)), end: toISO(today) }
  return { start: null, end: null }
}

const PERIOD_LABELS = [
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All Time' },
]

function extractNameFromDesc(desc) {
  if (!desc) return null
  const m = desc.match(/\b(?:from|to)\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/i)
  if (m) return m[1].trim()
  const stripped = desc.trim()
  if (stripped.length > 0 && stripped.split(' ').length <= 4 && !/received|paid|dues|amount|rs|₹/i.test(stripped)) return stripped
  return null
}

function cleanDesc(desc, personName) {
  if (!desc) return 'Payment received'
  if (personName && desc.toLowerCase().includes(personName.toLowerCase())) {
    return desc.replace(new RegExp(`\\s*(?:from|to)\\s+${personName}`, 'i'), '').replace(/\s+dated[\s\d\-\/]+$/i, '').trim() || 'Payment received'
  }
  return desc.replace(/\s+dated[\s\d\-\/]+$/i, '').trim() || 'Payment received'
}

function looksLikeSentence(s) {
  if (!s) return false
  const words = s.trim().split(/\s+/)
  return words.length > 3 || /received|given|paid|dues|amount|from|to\s/i.test(s)
}

function resolveDisplayName(raw) {
  if (!raw) return '—'
  if (looksLikeSentence(raw)) { const extracted = extractNameFromDesc(raw); if (extracted) return extracted }
  return raw
}

// ── Avatar (emoji-based, no SVG needed in RN) ─────────────────────────────
function AvatarIcon({ name }) {
  const isOrg = /store|enterprises|pvt|ltd|co\.|trading|shop|mart|general/i.test(name || '')
  return (
    <View style={[styles.avatar, { backgroundColor: isOrg ? '#E8EAF6' : '#E3F2FD' }]}>
      <Text style={{ fontSize: 20 }}>{isOrg ? '🏪' : '👤'}</Text>
    </View>
  )
}

// ── Dues Card (pending) ───────────────────────────────────────────────────
function DuesCard({ item, onContactUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const displayName = item.person_name ? resolveDisplayName(item.person_name) : '—'
  const netPending  = parseFloat(item.net_pending) || 0
  const totalGiven  = parseFloat(item.total_given) || 0
  const totalRec    = parseFloat(item.total_received) || 0
  const days = item.last_date ? Math.floor((new Date() - new Date(item.last_date + 'T00:00:00')) / 86400000) : 0
  const isCleared = netPending <= 0

  return (
    <TouchableOpacity style={styles.duesCard} onPress={() => setExpanded(e => !e)} activeOpacity={0.85}>
      <View style={styles.duesCardMain}>
        <AvatarIcon name={displayName} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.duesCardName}>{displayName}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {totalGiven > 0 && (
              <View style={styles.pillGiven}>
                <Text style={styles.pillGivenText}>Given {fmtRs(totalGiven)}</Text>
              </View>
            )}
            {totalRec > 0 && (
              <View style={styles.pillPaid}>
                <Text style={styles.pillPaidText}>Paid {fmtRs(totalRec)}</Text>
              </View>
            )}
          </View>
          {!isCleared && days > 0 && (
            <Text style={[styles.daysText, { color: daysColor(days) }]}>{days} days ago</Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.duesCardAmount, { color: isCleared ? '#25D366' : '#E53935' }]}>
            {isCleared ? '✅ Cleared' : fmtRs(netPending)}
          </Text>
          {!isCleared && <Text style={styles.pendingLabel}>pending</Text>}
        </View>
      </View>

      {expanded && item.transactions?.length > 0 && (
        <View style={styles.duesExpanded}>
          {item.transactions.map((txn, i) => (
            <View key={i} style={styles.txnHistoryRow}>
              <View style={[styles.txnBadge, { backgroundColor: txn.type === 'dues_given' ? '#E53935' : '#25D366' }]}>
                <Text style={styles.txnBadgeText}>{txn.type === 'dues_given' ? '📤' : '📥'}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.txnDesc}>{txn.description || (txn.type === 'dues_given' ? 'Dues given' : 'Payment received')}</Text>
                <Text style={styles.txnDate}>{fmtDate(txn.date)}</Text>
              </View>
              <Text style={[styles.txnAmount, { color: txn.type === 'dues_given' ? '#E53935' : '#25D366' }]}>
                {txn.type === 'dues_given' ? '-' : '+'}{fmtRs(txn.amount)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  )
}

// ── Received Card ─────────────────────────────────────────────────────────
function ReceivedCard({ rec }) {
  const [expanded, setExpanded] = useState(false)
  const rawName    = rec.person_name
  const displayName = rawName ? resolveDisplayName(rawName) : '—'
  const payCount   = rec.transactions?.length || 0
  const lastDate   = rec.last_date ? fmtDate(rec.last_date) : '—'
  const netPending = parseFloat(rec.net_pending) || 0
  const isCleared  = netPending <= 0

  return (
    <TouchableOpacity style={styles.recCard} onPress={() => setExpanded(e => !e)} activeOpacity={0.85}>
      <View style={styles.duesCardMain}>
        <AvatarIcon name={displayName} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.duesCardName}>{displayName}</Text>
          <Text style={styles.recSubtitle}>
            {payCount} payment{payCount !== 1 ? 's' : ''} received · Last: {lastDate}
          </Text>
          {isCleared && <Text style={styles.clearedBadge}>✅ Fully cleared</Text>}
        </View>
        <Text style={styles.recAmount}>+{fmtRs(rec.total_received)}</Text>
      </View>

      {expanded && (
        <View style={styles.duesExpanded}>
          {/* Dues given row */}
          {rec.dues_given_date && rec.dues_given_amount && (
            <View style={styles.txnHistoryRow}>
              <View style={[styles.txnBadge, { backgroundColor: '#FF7043' }]}>
                <Text style={styles.txnBadgeText}>📤</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.txnDesc}>Dues given to {displayName}</Text>
                <Text style={styles.txnDate}>{fmtDate(rec.dues_given_date)}</Text>
              </View>
              <Text style={[styles.txnAmount, { color: '#FF7043' }]}>-{fmtRs(rec.dues_given_amount)}</Text>
            </View>
          )}
          {/* Payment rows */}
          {(rec.transactions || []).map((txn, i) => (
            <View key={i} style={styles.txnHistoryRow}>
              <View style={[styles.txnBadge, { backgroundColor: '#25D366' }]}>
                <Text style={styles.txnBadgeText}>📥</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.txnDesc}>{cleanDesc(txn.description, displayName)}</Text>
                <Text style={styles.txnDate}>{fmtDate(txn.date)}</Text>
              </View>
              <Text style={[styles.txnAmount, { color: '#25D366' }]}>+{fmtRs(txn.amount)}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  )
}

// ── Main DuesScreen ───────────────────────────────────────────────────────
export default function DuesScreen({ phone, storeName, language = 'hinglish' }) {
  const insets = useSafeAreaInsets()
  const [activeTab,   setActiveTab]   = useState('dues')       // 'dues' | 'staff'
  const [duesTab,     setDuesTab]     = useState('pending')    // 'pending' | 'received'
  const [period,      setPeriod]      = useState('all')
  const [duesData,    setDuesData]    = useState(null)
  const [staffData,   setStaffData]   = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [showAllPending,  setShowAllPending]  = useState(false)
  const [showAllReceived, setShowAllReceived] = useState(false)

  useEffect(() => {
    if (!phone) return
    setLoading(true)
    const { start, end } = getRange(period)
    Promise.all([
      fetchDues(phone, start, end),
      fetchStaff(phone, start, end),
    ]).then(([d, s]) => {
      setDuesData(d)
      setStaffData(s)
    }).catch(console.error).finally(() => setLoading(false))
  }, [phone, period])

  const pendingDues  = duesData?.dues     || []
  const receivedDues = duesData?.received || []

  const totalOutstanding = pendingDues.reduce((s, d) => s + (parseFloat(d.net_pending) || 0), 0)
  const totalPending  = pendingDues.length
  const totalReceived = receivedDues.length

  const previewPending  = showAllPending  ? pendingDues  : pendingDues.slice(0, 3)
  const previewReceived = showAllReceived ? receivedDues : receivedDues.slice(0, 3)

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{storeName || 'MoneyBook'}</Text>
        <Text style={styles.headerSubtitle}>Dues & Staff</Text>
        {/* Main tabs */}
        <View style={styles.mainTabs}>
          <TouchableOpacity
            style={[styles.mainTab, activeTab === 'dues' && styles.mainTabActive]}
            onPress={() => setActiveTab('dues')}
          >
            <Text style={[styles.mainTabText, activeTab === 'dues' && styles.mainTabTextActive]}>Dues & Udhaar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mainTab, activeTab === 'staff' && styles.mainTabActive]}
            onPress={() => setActiveTab('staff')}
          >
            <Text style={[styles.mainTabText, activeTab === 'staff' && styles.mainTabTextActive]}>Staff</Text>
          </TouchableOpacity>
        </View>
      </View>

      {activeTab === 'dues' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Period selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodScroll} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
            {PERIOD_LABELS.map(p => (
              <TouchableOpacity
                key={p.key}
                style={[styles.periodChip, period === p.key && styles.periodChipActive]}
                onPress={() => setPeriod(p.key)}
              >
                <Text style={[styles.periodChipText, period === p.key && styles.periodChipTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator color="#00695C" size="large" />
            </View>
          ) : (
            <>
              {/* Total outstanding banner */}
              <View style={styles.outstandingBanner}>
                <Text style={styles.outstandingLabel}>TOTAL OUTSTANDING</Text>
                <Text style={styles.outstandingAmount}>{fmtRs(totalOutstanding)}</Text>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{totalPending}</Text>
                    <Text style={styles.summaryLabel}>Pending</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{totalReceived}</Text>
                    <Text style={styles.summaryLabel}>Received</Text>
                  </View>
                </View>
              </View>

              {/* Sub-tabs */}
              <View style={styles.subTabs}>
                <TouchableOpacity
                  style={[styles.subTab, duesTab === 'pending' && styles.subTabActive]}
                  onPress={() => setDuesTab('pending')}
                >
                  <Text style={[styles.subTabText, duesTab === 'pending' && styles.subTabTextActive]}>
                    Pending ({totalPending})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.subTab, duesTab === 'received' && styles.subTabActive]}
                  onPress={() => setDuesTab('received')}
                >
                  <Text style={[styles.subTabText, duesTab === 'received' && styles.subTabTextActive]}>
                    Received ({totalReceived})
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ paddingHorizontal: 14 }}>
                {duesTab === 'pending' ? (
                  pendingDues.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyEmoji}>🎉</Text>
                      <Text style={styles.emptyText}>No pending dues!</Text>
                    </View>
                  ) : (
                    <>
                      {previewPending.map((item, i) => <DuesCard key={i} item={item} />)}
                      {pendingDues.length > 3 && (
                        <TouchableOpacity style={styles.viewAllBtn} onPress={() => setShowAllPending(s => !s)}>
                          <Text style={styles.viewAllText}>
                            {showAllPending ? '▲ Show Less' : `VIEW ALL (${pendingDues.length})`}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )
                ) : (
                  receivedDues.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyEmoji}>📭</Text>
                      <Text style={styles.emptyText}>No dues received in this period.</Text>
                    </View>
                  ) : (
                    <>
                      {previewReceived.map((rec, i) => <ReceivedCard key={i} rec={rec} />)}
                      {receivedDues.length > 3 && (
                        <TouchableOpacity style={styles.viewAllBtn} onPress={() => setShowAllReceived(s => !s)}>
                          <Text style={styles.viewAllText}>
                            {showAllReceived ? '▲ Show Less' : `VIEW ALL (${receivedDues.length})`}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )
                )}
              </View>
            </>
          )}
        </ScrollView>
      ) : (
        /* Staff tab */
        <ScrollView style={{ flex: 1, padding: 14 }} contentContainerStyle={{ paddingBottom: 24 }}>
          {loading ? (
            <ActivityIndicator color="#00695C" size="large" style={{ marginTop: 40 }} />
          ) : !staffData || staffData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>👷</Text>
              <Text style={styles.emptyText}>No staff records yet.</Text>
              <Text style={styles.emptySubText}>Send salary payments via chat to track staff expenses.</Text>
            </View>
          ) : (
            staffData.map((s, i) => (
              <View key={i} style={styles.staffCard}>
                <View style={styles.staffAvatar}><Text style={{ fontSize: 20 }}>👷</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.staffName}>{s.name || '—'}</Text>
                  {s.last_date && <Text style={styles.staffSub}>Last paid: {fmtDate(s.last_date)}</Text>}
                </View>
                <Text style={styles.staffAmount}>{fmtRs(s.total_paid || s.amount || 0)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4F3' },
  header: { backgroundColor: '#00695C', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 0 },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  headerSubtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 16 },
  mainTabs: { flexDirection: 'row' },
  mainTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  mainTabActive: { borderBottomColor: '#fff' },
  mainTabText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500' },
  mainTabTextActive: { color: '#fff', fontWeight: '700' },
  periodScroll: { flexShrink: 0 },
  periodChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', marginRight: 8, elevation: 1 },
  periodChipActive: { backgroundColor: '#00695C' },
  periodChipText: { color: '#555', fontSize: 13, fontWeight: '500' },
  periodChipTextActive: { color: '#fff', fontWeight: '700' },
  outstandingBanner: { margin: 14, borderRadius: 16, backgroundColor: '#00695C', padding: 20 },
  outstandingLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, letterSpacing: 1.5, fontWeight: '700', marginBottom: 6 },
  outstandingAmount: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.5, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10 },
  summaryItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  summaryDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 8 },
  summaryValue: { color: '#fff', fontSize: 18, fontWeight: '700' },
  summaryLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },
  subTabs: { flexDirection: 'row', marginHorizontal: 14, backgroundColor: '#fff', borderRadius: 10, padding: 4, marginBottom: 12, elevation: 1 },
  subTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  subTabActive: { backgroundColor: '#00695C' },
  subTabText: { color: '#888', fontSize: 13, fontWeight: '600' },
  subTabTextActive: { color: '#fff', fontWeight: '700' },
  duesCard: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 10, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  duesCardMain: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  duesCardName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  daysText: { fontSize: 11, marginTop: 4 },
  duesCardAmount: { fontSize: 17, fontWeight: '800' },
  pendingLabel: { fontSize: 11, color: '#aaa', marginTop: 2 },
  pillGiven: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#FCE4EC' },
  pillGivenText: { fontSize: 11, color: '#E53935', fontWeight: '600' },
  pillPaid: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#E8F5E9' },
  pillPaidText: { fontSize: 11, color: '#00695C', fontWeight: '600' },
  duesExpanded: { borderTopWidth: 1, borderTopColor: '#f0f0f0', padding: 12, backgroundColor: '#FAFAFA' },
  txnHistoryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  txnBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  txnBadgeText: { fontSize: 14 },
  txnDesc: { fontSize: 13, color: '#333' },
  txnDate: { fontSize: 11, color: '#aaa', marginTop: 1 },
  txnAmount: { fontSize: 14, fontWeight: '700' },
  recCard: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 10, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  recSubtitle: { fontSize: 12, color: '#888', marginTop: 3 },
  clearedBadge: { fontSize: 12, color: '#00695C', fontWeight: '600', marginTop: 3 },
  recAmount: { fontSize: 17, fontWeight: '800', color: '#25D366' },
  viewAllBtn: { alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#00695C', marginTop: 4 },
  viewAllText: { color: '#00695C', fontWeight: '700', fontSize: 13 },
  emptyState: { alignItems: 'center', padding: 40 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 6 },
  emptySubText: { fontSize: 13, color: '#888', textAlign: 'center' },
  staffCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  staffAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF3E0', alignItems: 'center', justifyContent: 'center' },
  staffName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  staffSub: { fontSize: 12, color: '#888', marginTop: 2 },
  staffAmount: { fontSize: 16, fontWeight: '800', color: '#E53935' },
})
