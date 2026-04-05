// ── LedgerEntry — converted from LedgerEntry.jsx ──────────────────────────
// The manual ledger entry modal AND photo review modal.
// Business logic identical: classifyLedger → confirm.
// UI: Modal, TextInput rows, TouchableOpacity for buttons

import { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Modal, Alert, ActivityIndicator, FlatList,
} from 'react-native'
import { classifyLedger } from '../api'
import { t } from '../translations'

const EMPTY_ROW = () => ({ particulars: '', amount: '', _txn: null })

const IN_TYPES  = new Set(['sale','receipt','dues_received','udhaar_received','cash_in_hand','upi_in_hand','opening_balance'])
const OUT_TYPES = new Set(['expense','dues_given','udhaar_given','bank_deposit','closing_balance','other'])

function txnsToRows(txns = [], display = null) {
  const inRows  = []
  const outRows = []
  const leftSet  = new Set()
  const rightSet = new Set()

  if (display?.layout === 'two_column' && display?.rows?.length > 0) {
    display.rows.forEach(row => {
      const indices = Array.isArray(row.txn_indices) ? row.txn_indices : row.txn_index != null ? [row.txn_index] : []
      const cells = row.cells || []
      const leftEmpty  = !cells[0]?.trim()
      const rightEmpty = !cells[1]?.trim()
      if (indices[0] != null) { if (leftEmpty && !rightEmpty) rightSet.add(indices[0]); else leftSet.add(indices[0]) }
      if (indices[1] != null) { if (rightEmpty && !leftEmpty) leftSet.add(indices[1]); else rightSet.add(indices[1]) }
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

// ── Single ledger row ─────────────────────────────────────────────────────
function LedgerRow({ row, onUpdate, onRemove, side }) {
  const color = side === 'in' ? '#25D366' : '#E53935'
  return (
    <View style={styles.ledgerRow}>
      <TextInput
        style={[styles.rowInput, styles.rowDesc]}
        placeholder="Particulars"
        placeholderTextColor="#bbb"
        value={row.particulars}
        onChangeText={v => onUpdate({ ...row, particulars: v })}
      />
      <TextInput
        style={[styles.rowInput, styles.rowAmt, { color }]}
        placeholder="₹"
        placeholderTextColor="#bbb"
        value={row.amount}
        onChangeText={v => onUpdate({ ...row, amount: v })}
        keyboardType="decimal-pad"
      />
      <TouchableOpacity style={styles.rowRemove} onPress={onRemove}>
        <Text style={{ color: '#aaa', fontSize: 16 }}>×</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function LedgerEntry({ phone, language, onClose, onClassified, prefill }) {
  const today = new Date().toISOString().slice(0, 10)
  const initDate = prefill?.date || today

  // Build initial rows from prefill txns or empty
  const { inRows: initIn, outRows: initOut } = prefill?.txns
    ? txnsToRows(prefill.txns, prefill.display)
    : { inRows: [EMPTY_ROW()], outRows: [EMPTY_ROW()] }

  const [date,    setDate]    = useState(initDate)
  const [inRows,  setInRows]  = useState(initIn.length ? initIn : [EMPTY_ROW()])
  const [outRows, setOutRows] = useState(initOut.length ? initOut : [EMPTY_ROW()])
  const [loading, setLoading] = useState(false)
  const [tab,     setTab]     = useState('general')  // 'general' | 'dues' | 'staff'

  function updateInRow(i, val)  { setInRows(prev  => prev.map((r, idx) => idx === i ? val : r)) }
  function updateOutRow(i, val) { setOutRows(prev => prev.map((r, idx) => idx === i ? val : r)) }
  function removeInRow(i)  { setInRows(prev  => prev.filter((_, idx) => idx !== i)); if (inRows.length  === 1) setInRows([EMPTY_ROW()]) }
  function removeOutRow(i) { setOutRows(prev => prev.filter((_, idx) => idx !== i)); if (outRows.length === 1) setOutRows([EMPTY_ROW()]) }

  async function handleSave() {
    // If photo review with a custom onSave, use that
    if (prefill?.onSave) {
      const txns = rowsToTxns(inRows, outRows, date)
      if (txns.length === 0) { Alert.alert('Empty', 'Add at least one entry.'); return }
      await prefill.onSave(txns, prefill.msgId)
      return
    }

    // Otherwise, use classifyLedger
    const rows = [
      ...inRows.filter(r => r.particulars.trim() && r.amount).map(r => ({ particulars: r.particulars.trim(), amount: parseFloat(r.amount) || 0, section: tab, col: 'in' })),
      ...outRows.filter(r => r.particulars.trim() && r.amount).map(r => ({ particulars: r.particulars.trim(), amount: parseFloat(r.amount) || 0, section: tab, col: 'out' })),
    ]
    if (rows.length === 0) { Alert.alert('Empty', 'Add at least one entry.'); return }

    setLoading(true)
    try {
      const result = await classifyLedger(phone, date, rows, language)
      onClassified(result)
      onClose()
    } catch (e) {
      Alert.alert('Error', 'Failed to save entries: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const inTotal  = inRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const outTotal = outRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {prefill ? '📸 Review Entries' : '📋 Manual Entry'}
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.saveBtn} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>

        {/* Date */}
        <View style={styles.dateRow}>
          <Text style={styles.dateLabel}>📅 Date:</Text>
          <TextInput
            style={styles.dateInput}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#aaa"
          />
        </View>

        {/* Tabs (only for manual entry, not photo review) */}
        {!prefill && (
          <View style={styles.tabRow}>
            {[
              { key: 'general', label: '📊 General' },
              { key: 'dues',    label: '👥 Dues' },
              { key: 'staff',   label: '👷 Staff' },
            ].map(tb => (
              <TouchableOpacity
                key={tb.key}
                style={[styles.tabBtn, tab === tb.key && styles.tabBtnActive]}
                onPress={() => setTab(tb.key)}
              >
                <Text style={[styles.tabBtnText, tab === tb.key && styles.tabBtnTextActive]}>{tb.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Ledger grid */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Column headers */}
          <View style={styles.colHeaders}>
            <View style={styles.colHeaderIn}><Text style={styles.colHeaderText}>{t('jama_in', language)} {inTotal > 0 ? `₹${inTotal.toLocaleString('en-IN')}` : ''}</Text></View>
            <View style={styles.colDivider} />
            <View style={styles.colHeaderOut}><Text style={styles.colHeaderText}>{t('naam_out', language)} {outTotal > 0 ? `₹${outTotal.toLocaleString('en-IN')}` : ''}</Text></View>
          </View>

          {/* Rows */}
          <View style={styles.gridBody}>
            {/* IN column */}
            <View style={styles.colIn}>
              {inRows.map((row, i) => (
                <LedgerRow key={i} row={row} side="in" onUpdate={v => updateInRow(i, v)} onRemove={() => removeInRow(i)} />
              ))}
              <TouchableOpacity style={styles.addRowBtn} onPress={() => setInRows(prev => [...prev, EMPTY_ROW()])}>
                <Text style={[styles.addRowText, { color: '#25D366' }]}>+ Add</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.colDivider} />

            {/* OUT column */}
            <View style={styles.colOut}>
              {outRows.map((row, i) => (
                <LedgerRow key={i} row={row} side="out" onUpdate={v => updateOutRow(i, v)} onRemove={() => removeOutRow(i)} />
              ))}
              <TouchableOpacity style={styles.addRowBtn} onPress={() => setOutRows(prev => [...prev, EMPTY_ROW()])}>
                <Text style={[styles.addRowText, { color: '#E53935' }]}>+ Add</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Totals */}
          {(inTotal > 0 || outTotal > 0) && (
            <View style={styles.totalsRow}>
              <Text style={[styles.totalText, { color: '#25D366' }]}>{inTotal > 0 ? `₹${inTotal.toLocaleString('en-IN')}` : ''}</Text>
              <View style={styles.colDivider} />
              <Text style={[styles.totalText, { color: '#E53935' }]}>{outTotal > 0 ? `₹${outTotal.toLocaleString('en-IN')}` : ''}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00695C', paddingTop: 50, paddingHorizontal: 16, paddingBottom: 14 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#fff', fontSize: 18 },
  headerTitle: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 17, textAlign: 'center' },
  saveBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dateRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  dateLabel: { fontSize: 14, color: '#555', fontWeight: '600', marginRight: 8 },
  dateInput: { flex: 1, fontSize: 14, color: '#1a1a1a', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: '#00695C' },
  tabBtnText: { fontSize: 13, color: '#888', fontWeight: '500' },
  tabBtnTextActive: { color: '#00695C', fontWeight: '700' },
  colHeaders: { flexDirection: 'row', backgroundColor: '#f8f8f8', borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  colHeaderIn:  { flex: 1, padding: 10, alignItems: 'center' },
  colHeaderOut: { flex: 1, padding: 10, alignItems: 'center' },
  colHeaderText: { fontSize: 12, fontWeight: '700', color: '#555' },
  colDivider: { width: 1, backgroundColor: '#e0e0e0' },
  gridBody: { flexDirection: 'row', flex: 1 },
  colIn:  { flex: 1, padding: 8 },
  colOut: { flex: 1, padding: 8 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  rowInput: { flex: 1, fontSize: 13, color: '#1a1a1a', borderBottomWidth: 1, borderBottomColor: '#e8e8e8', paddingVertical: 6, paddingHorizontal: 4 },
  rowDesc: { flex: 2 },
  rowAmt: { flex: 1, marginLeft: 6, fontWeight: '600' },
  rowRemove: { width: 24, alignItems: 'center' },
  addRowBtn: { marginTop: 4, padding: 6 },
  addRowText: { fontSize: 12, fontWeight: '600' },
  totalsRow: { flexDirection: 'row', backgroundColor: '#f4f4f4', borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  totalText: { flex: 1, textAlign: 'center', padding: 10, fontSize: 14, fontWeight: '700' },
})
