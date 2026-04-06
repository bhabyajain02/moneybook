// ── AnalyticsScreen — converted from AnalyticsPage.jsx ────────────────────
// Business logic identical. UI: div→View, SVG MiniBars→View-based bars,
// position:fixed modal→Modal component, input[type=date]→TextInput/Picker

import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, TextInput, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fetchAnalytics } from '../api'
import { t } from '../translations'

function fmtRsFull(val) {
  const n = parseFloat(val) || 0
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtRs(val) {
  const n = parseFloat(val) || 0
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)}L`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

const TAG_META = {
  upi: { icon: '💳', color: '#4CAF50' }, upi_collection: { icon: '💳', color: '#4CAF50' },
  pos: { icon: '🖥️', color: '#1E88E5' }, cash: { icon: '💵', color: '#43A047' },
  bank: { icon: '🏦', color: '#039BE5' }, neft: { icon: '🏦', color: '#039BE5' },
  staff_expense: { icon: '👷', color: '#FF9800' }, staff: { icon: '👷', color: '#FF9800' },
  cash_discount: { icon: '🏷️', color: '#9C27B0' }, discount: { icon: '🏷️', color: '#9C27B0' },
  rent: { icon: '🏠', color: '#F44336' }, electricity: { icon: '⚡', color: '#FFC107' },
  food: { icon: '🍽️', color: '#8BC34A' }, refreshment: { icon: '☕', color: '#8BC34A' },
  transport: { icon: '🚗', color: '#03A9F4' }, purchase: { icon: '🛒', color: '#FF5722' },
  cleaning: { icon: '🧹', color: '#26A69A' }, repair: { icon: '🔧', color: '#5C6BC0' },
  petrol: { icon: '⛽', color: '#EF6C00' }, packaging: { icon: '📦', color: '#8D6E63' },
  insurance: { icon: '🛡️', color: '#00838F' }, water: { icon: '💧', color: '#0288D1' },
  telephone: { icon: '📞', color: '#7B1FA2' }, other: { icon: '📋', color: '#607D8B' },
  store_expense: { icon: '🏪', color: '#795548' },
}

const COLLECTION_KEYWORDS = ['upi','pos','cash','neft','rtgs','imps','paytm','gpay','phonepe','online','digital','collection','receipt','received','settlement']
function isCollection(tag) { const l = (tag||'').toLowerCase(); return COLLECTION_KEYWORDS.some(k => l.includes(k)) }
function getMeta(tag) {
  const l = (tag||'').toLowerCase()
  for (const [key, meta] of Object.entries(TAG_META)) { if (l.includes(key)) return meta }
  return { icon: '📊', color: '#00897B' }
}
function toLabel(tag) { return tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }

// ── Mini bar chart (View-based) ──────────────────────────────────────────
function MiniBars({ pct, color }) {
  const heights = [45, 70, Math.max(20, pct), 85]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 24, width: 34 }}>
      {heights.map((h, i) => (
        <View key={i} style={{
          width: 7, height: (24 * h / 100), marginRight: 2,
          backgroundColor: i === 2 ? color : color + '55',
          borderRadius: 2,
        }} />
      ))}
    </View>
  )
}

const PERIOD_KEYS = [
  { key: 'day',   tKey: 'period_today' },
  { key: 'week',  tKey: 'period_week' },
  { key: 'month', tKey: 'period_month' },
  { key: 'year',  tKey: 'period_year' },
]

// ── Date range modal ──────────────────────────────────────────────────────
function DateRangeModal({ onApply, onClose, language }) {
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(today)
  const [to,   setTo]   = useState(today)
  const valid = from && to && from <= to

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.dateModal}>
          <Text style={styles.dateModalTitle}>📅 {t('date_range_title', language)}</Text>
          <Text style={styles.dateModalLabel}>{t('from_label', language)}</Text>
          <TextInput style={styles.dateInput} value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" placeholderTextColor="#aaa" />
          <Text style={styles.dateModalLabel}>{t('to_label', language)}</Text>
          <TextInput style={styles.dateInput} value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" placeholderTextColor="#aaa" />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity style={styles.dateModalCancelBtn} onPress={onClose}>
              <Text style={{ color: '#666', fontWeight: '600' }}>{t('cancel_btn', language)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dateModalApplyBtn, !valid && { backgroundColor: '#ccc' }]}
              onPress={() => { if (valid) onApply(from, to) }}
              disabled={!valid}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>{t('apply_btn', language)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export default function AnalyticsScreen({ phone, storeName, language = 'hinglish' }) {
  const insets = useSafeAreaInsets()
  const [period,        setPeriod]        = useState('day')
  const [customRange,   setCustomRange]   = useState(null)
  const [showDatePick,  setShowDatePick]  = useState(false)
  const [data,          setData]          = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)

  useEffect(() => {
    setData(null); setLoading(true); setError(null)
    const { start, end } = customRange || {}
    fetchAnalytics(phone, period, start || null, end || null)
      .then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [phone, period, customRange])

  function handlePeriodClick(key) { setPeriod(key); setCustomRange(null) }
  function handleCustomApply(start, end) { setCustomRange({ start, end }); setPeriod('custom'); setShowDatePick(false) }
  const calLabel = customRange ? `${customRange.start.slice(5)} → ${customRange.end.slice(5)}` : null

  const kpis = data?.kpis || {}
  const totalExpenses = kpis.total_expenses || 0

  const { expenseCats, collectionCats } = (() => {
    if (!data) return { expenseCats: [], collectionCats: [] }
    const collections = []
    let staffTotal = kpis.staff_expenses || 0
    let discountTotal = 0
    const storeExpenseByTag = {}
    Object.entries(data.expense_tags || {}).forEach(([tag, amt]) => {
      const lower = tag.toLowerCase()
      if (lower.includes('discount')) { discountTotal += amt; return }
      if (isCollection(tag)) { collections.push({ tag, amt }); return }
      if (lower.includes('staff')) { staffTotal += amt } else { storeExpenseByTag[tag] = (storeExpenseByTag[tag] || 0) + amt }
    })
    const expenses = []
    if (staffTotal > 0)   expenses.push({ tag: 'staff_expense', amt: staffTotal })
    if (discountTotal > 0) expenses.push({ tag: 'cash_discount', amt: discountTotal })
    Object.entries(storeExpenseByTag).forEach(([tag, amt]) => { if (amt > 0) expenses.push({ tag, amt }) })
    return { expenseCats: expenses.sort((a, b) => b.amt - a.amt), collectionCats: collections.sort((a, b) => b.amt - a.amt) }
  })()

  const expenseTotal    = expenseCats.reduce((s, c) => s + c.amt, 0) || 1
  const collectionTotal = collectionCats.reduce((s, c) => s + c.amt, 0) || 1

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Hero header */}
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.heroAvatar}><Text style={{ fontSize: 16 }}>👤</Text></View>
            <View>
              <Text style={styles.heroStoreName}>{storeName || 'Store'}</Text>
              <Text style={styles.heroSubtitle}>{t('business_insights', language)}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.heroLabel}>{t('total_expenses_label', language)}</Text>
        <Text style={styles.heroAmount}>{loading ? '—' : fmtRsFull(totalExpenses)}</Text>

        {/* Period tabs */}
        <View style={styles.periodRow}>
          {PERIOD_KEYS.map(p => (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodTab, period === p.key && styles.periodTabActive]}
              onPress={() => handlePeriodClick(p.key)}
            >
              <Text style={[styles.periodTabText, period === p.key && styles.periodTabTextActive]}>
                {t(p.tKey, language)}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.periodTab, period === 'custom' && styles.periodTabActive]}
            onPress={() => setShowDatePick(true)}
          >
            <Text style={styles.periodTabText}>📅</Text>
            {calLabel && <Text style={[styles.calLabel]}>{calLabel}</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable body */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 24 }}>
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}

        {loading && (
          <View style={{ alignItems: 'center', padding: 40 }}>
            <Text style={{ fontSize: 28, marginBottom: 8 }}>⏳</Text>
            <ActivityIndicator color="#00695C" />
            <Text style={{ color: '#aaa', marginTop: 8 }}>{t('loading', language)}</Text>
          </View>
        )}

        {/* Expense categories */}
        {!loading && (
          <View style={{ marginBottom: 20 }}>
            <Text style={styles.sectionTitle}>{t('expense_categories', language)}</Text>
            {expenseCats.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>{t('no_expenses_period', language)}</Text>
              </View>
            ) : expenseCats.map(({ tag, amt }) => {
              const pct = totalExpenses > 0 ? Math.round((amt / totalExpenses) * 100) : 0
              const { icon, color } = getMeta(tag)
              return (
                <View key={tag} style={styles.catCard}>
                  <View style={[styles.catIcon, { backgroundColor: color + '18' }]}>
                    <Text style={{ fontSize: 22 }}>{icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catTagLabel}>{toLabel(tag).toUpperCase()}</Text>
                    <Text style={styles.catAmount}>{fmtRs(amt)}</Text>
                    <Text style={styles.catPct}>{pct}% {t('of_total', language)}</Text>
                  </View>
                  <MiniBars pct={pct} color={color} />
                </View>
              )
            })}
          </View>
        )}

        {/* Collections */}
        {!loading && collectionCats.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.sectionTitle}>{t('revenue_channels', language)}</Text>
              <Text style={{ fontSize: 11, color: '#888' }}>{t('how_money_in', language)}</Text>
            </View>
            {collectionCats.map(({ tag, amt }) => {
              const pct = Math.round((amt / collectionTotal) * 100)
              const { icon, color } = getMeta(tag)
              return (
                <View key={tag} style={[styles.catCard, { borderLeftWidth: 3, borderLeftColor: color }]}>
                  <View style={[styles.catIcon, { backgroundColor: color + '18' }]}>
                    <Text style={{ fontSize: 22 }}>{icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catTagLabel}>{toLabel(tag).toUpperCase()}</Text>
                    <Text style={styles.catAmount}>{fmtRs(amt)}</Text>
                    <Text style={styles.catPct}>{pct}% {t('of_collections', language)}</Text>
                  </View>
                  <MiniBars pct={pct} color={color} />
                </View>
              )
            })}
          </View>
        )}

        {/* Expense composition bar */}
        {!loading && expenseCats.length > 0 && (
          <View style={styles.compositionCard}>
            <Text style={styles.compositionTitle}>{t('expense_composition', language)}</Text>
            <View style={styles.compositionBar}>
              {expenseCats.map(({ tag, amt }) => (
                <View key={tag} style={{ flex: amt / expenseTotal, backgroundColor: getMeta(tag).color }} />
              ))}
            </View>
            {expenseCats.map(({ tag, amt }) => {
              const pct = Math.round((amt / expenseTotal) * 100)
              const { color } = getMeta(tag)
              return (
                <View key={tag} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: color }]} />
                  <Text style={styles.legendLabel}>{toLabel(tag).toUpperCase()}</Text>
                  <Text style={styles.legendPct}>{pct}%</Text>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>

      {showDatePick && (
        <DateRangeModal onApply={handleCustomApply} onClose={() => setShowDatePick(false)} language={language} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4F3' },
  hero: {
    background: 'transparent',
    backgroundColor: '#00695C',
    padding: 18, paddingBottom: 0,
  },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  heroAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  heroStoreName: { color: '#fff', fontWeight: '600', fontSize: 14 },
  heroSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  heroLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 10, letterSpacing: 2, fontWeight: '600', marginBottom: 6 },
  heroAmount: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginBottom: 18 },
  periodRow: { flexDirection: 'row', alignItems: 'flex-end' },
  periodTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  periodTabActive: { borderBottomColor: '#fff' },
  periodTabText: { color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  periodTabTextActive: { color: '#fff', fontWeight: '700' },
  calLabel: { color: '#fff', fontSize: 9, opacity: 0.85 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  catCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10 },
  catIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  catTagLabel: { fontSize: 10, color: '#999', fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  catAmount: { fontSize: 20, fontWeight: '800', color: '#1a1a1a', lineHeight: 24 },
  catPct: { fontSize: 10, color: '#bbb', marginTop: 2 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 14, padding: 24, alignItems: 'center' },
  emptyCardText: { color: '#aaa', fontSize: 14 },
  errorBox: { backgroundColor: '#FFEBEE', borderRadius: 10, padding: 12, marginBottom: 14 },
  errorText: { color: '#C62828', fontSize: 13 },
  compositionCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10 },
  compositionTitle: { fontSize: 11, fontWeight: '700', color: '#888', letterSpacing: 1.5, marginBottom: 12 },
  compositionBar: { height: 10, borderRadius: 6, overflow: 'hidden', flexDirection: 'row', marginBottom: 14 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, fontSize: 12, color: '#555' },
  legendPct: { fontSize: 12, color: '#888', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  dateModal: { backgroundColor: '#fff', borderRadius: 18, padding: 24, width: 300, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.22, shadowRadius: 40, elevation: 12 },
  dateModalTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 20 },
  dateModalLabel: { fontSize: 11, color: '#888', letterSpacing: 0.8, marginBottom: 5 },
  dateInput: { width: '100%', borderWidth: 1.5, borderColor: '#00897B', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1a1a1a', marginBottom: 14 },
  dateModalCancelBtn: { flex: 1, padding: 11, borderRadius: 9, borderWidth: 1.5, borderColor: '#e0e0e0', alignItems: 'center' },
  dateModalApplyBtn: { flex: 1, padding: 11, borderRadius: 9, backgroundColor: '#00897B', alignItems: 'center' },
})
