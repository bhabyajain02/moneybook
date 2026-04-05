// ── ConfirmCard — converted from ConfirmCard.jsx ──────────────────────────
// Changes: div→View, span/p→Text, button→TouchableOpacity, input→TextInput,
// select→custom Picker via Modal, <table>→FlatList rows

import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Modal, FlatList, Alert,
} from 'react-native'
import { quickParse } from '../api'
import { t } from '../translations'

function extractDisplayName(name) {
  if (!name) return ''
  const m = name.match(/\b(?:from|to)\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/i)
  if (m) return m[1].trim()
  return name
}

export const TYPE_OPTIONS = [
  { value: 'sale',             label: '💰 Sale' },
  { value: 'expense',          label: '💸 Expense' },
  { value: 'dues_given',       label: '📤 Dues Given' },
  { value: 'dues_received',    label: '📥 Dues Received' },
  { value: 'bank_deposit',     label: '🏦 Bank Deposit' },
  { value: 'receipt',          label: '📨 Receipt' },
  { value: 'opening_balance',  label: '🔓 Opening Bal' },
  { value: 'closing_balance',  label: '🔒 Closing Bal' },
  { value: 'cash_in_hand',     label: '💵 Cash in Hand' },
  { value: 'upi_in_hand',      label: '📱 UPI in Hand' },
  { value: 'other',            label: '📋 Other' },
]

export const TYPE_COLORS = {
  sale: '#25D366', receipt: '#25D366', dues_given: '#E53935', dues_received: '#25D366',
  expense: '#FF7043', bank_deposit: '#9C27B0', other: '#78909C',
  opening_balance: '#607D8B', closing_balance: '#607D8B',
  cash_in_hand: '#607D8B', upi_in_hand: '#2196F3',
}

export function fmtRs(val) {
  const n = parseFloat(val) || 0
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

// ── Type Picker Modal ──────────────────────────────────────────────────────
function TypePicker({ visible, current, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Select Type</Text>
          <FlatList
            data={TYPE_OPTIONS}
            keyExtractor={item => item.value}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.pickerItem, item.value === current && styles.pickerItemActive]}
                onPress={() => { onSelect(item.value); onClose() }}
              >
                <Text style={[styles.pickerItemText, item.value === current && styles.pickerItemTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  )
}

// ── Inline edit form ───────────────────────────────────────────────────────
function EditForm({ txn, onSave, onDiscard, language }) {
  const [draft, setDraft] = useState({ ...txn })
  const [saving, setSaving] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [more, setMore] = useState(false)

  async function save() {
    const descChanged = (draft.description || '').trim() !== (txn.description || '').trim()
    if (descChanged && !more) {
      setSaving(true)
      try {
        const res = await quickParse(draft.description, draft.amount, draft.person_name || '')
        onSave({ ...draft, type: res.transaction.type, tag: res.transaction.tag })
      } catch {
        onSave(draft)
      } finally {
        setSaving(false)
      }
    } else {
      onSave(draft)
    }
  }

  const typeLabel = TYPE_OPTIONS.find(o => o.value === draft.type)?.label || draft.type

  return (
    <View style={styles.editForm}>
      <View style={styles.editRow}>
        <Text style={styles.editLabel}>{t('description_label', language)}</Text>
        <TextInput
          style={styles.editInput}
          value={draft.description || ''}
          placeholder="What was this?"
          onChangeText={v => setDraft({ ...draft, description: v })}
        />
      </View>
      <View style={styles.editRow}>
        <Text style={styles.editLabel}>{t('amount_label', language)}</Text>
        <TextInput
          style={styles.editInput}
          value={String(draft.amount)}
          keyboardType="decimal-pad"
          onChangeText={v => setDraft({ ...draft, amount: parseFloat(v) || 0 })}
        />
      </View>
      <View style={styles.editRow}>
        <Text style={styles.editLabel}>{t('person_label', language)}</Text>
        <TextInput
          style={styles.editInput}
          value={draft.person_name || ''}
          placeholder="Name (optional)"
          onChangeText={v => setDraft({ ...draft, person_name: v || null })}
        />
      </View>

      <TouchableOpacity style={styles.moreBtn} onPress={() => setMore(s => !s)}>
        <Text style={styles.moreBtnText}>{more ? '▲ Less' : '▼ Change Type'}</Text>
      </TouchableOpacity>

      {more && (
        <TouchableOpacity style={styles.typeSelectorBtn} onPress={() => setShowPicker(true)}>
          <Text style={styles.typeSelectorText}>{typeLabel}</Text>
          <Text style={{ color: '#888' }}>›</Text>
        </TouchableOpacity>
      )}

      <TypePicker
        visible={showPicker}
        current={draft.type}
        onSelect={v => setDraft({ ...draft, type: v })}
        onClose={() => setShowPicker(false)}
      />

      <View style={styles.editActions}>
        <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? '⏳' : t('done_btn', language)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.discardBtn} onPress={onDiscard}>
          <Text style={styles.discardBtnText}>Discard</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── Confidence pill ────────────────────────────────────────────────────────
export function ConfPill({ value }) {
  if (value == null) return null
  const v = Math.round(value)
  const bg = v >= 80 ? '#dcfce7' : v >= 70 ? '#fef3c7' : '#fee2e2'
  const fg = v >= 80 ? '#166534' : v >= 70 ? '#92400e' : '#991b1b'
  return (
    <View style={[styles.confPill, { backgroundColor: bg }]}>
      <Text style={[styles.confPillText, { color: fg }]}>{v}</Text>
    </View>
  )
}

// ── Transaction row ────────────────────────────────────────────────────────
function TxnRow({ txn, index, onUpdate, onDelete, language }) {
  const [editing, setEditing] = useState(false)
  const color = TYPE_COLORS[txn.type] || '#ccc'
  const typeLabel = TYPE_OPTIONS.find(o => o.value === txn.type)?.label || txn.type

  if (editing) {
    return (
      <View style={[styles.txnRow, { borderLeftColor: color, borderLeftWidth: 3 }]}>
        <EditForm
          txn={txn}
          onSave={u => { onUpdate(index, u); setEditing(false) }}
          onDiscard={() => setEditing(false)}
          language={language}
        />
      </View>
    )
  }

  return (
    <View style={[styles.txnRow, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <View style={{ flex: 1 }}>
        <View style={[styles.typePill, { backgroundColor: color + '1a' }]}>
          <Text style={[styles.typePillText, { color }]}>{typeLabel}</Text>
        </View>
        <Text style={styles.txnDesc}>{txn.description || '—'}</Text>
        {txn.tag && (
          <Text style={styles.txnTag}>🏷️ {txn.tag.replace(/_/g, ' ')}</Text>
        )}
        {txn.person_name && (
          <Text style={styles.txnPerson}>👤 {extractDisplayName(txn.person_name)}</Text>
        )}
      </View>
      <View style={styles.txnRight}>
        <Text style={styles.txnAmount}>
          ₹{parseFloat(txn.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </Text>
        <ConfPill value={txn.confidence} />
        <View style={styles.txnActions}>
          <TouchableOpacity onPress={() => setEditing(true)} style={styles.actionBtn}>
            <Text>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(index)} style={styles.actionBtn}>
            <Text>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// ── Add entry form ────────────────────────────────────────────────────────
function AddEntryForm({ onAdd, onCancel, language }) {
  const [desc,   setDesc]   = useState('')
  const [amount, setAmount] = useState('')
  const [person, setPerson] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!desc.trim() || !amount) return
    setLoading(true)
    try {
      const res = await quickParse(desc, parseFloat(amount), person)
      onAdd(res.transaction)
    } catch {
      onAdd({
        type: 'expense', amount: parseFloat(amount), description: desc,
        tag: 'other', person_name: person || null, needs_tracking: !!person,
        payment_mode: 'cash', date: new Date().toISOString().slice(0, 10),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.addForm}>
      <Text style={styles.addFormTitle}>{t('new_entry', language)}</Text>
      <TextInput style={styles.addInput} placeholder="Description (e.g. Rent paid)" value={desc} onChangeText={setDesc} />
      <TextInput style={styles.addInput} placeholder="Amount ₹" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <TextInput style={styles.addInput} placeholder="Person (optional)" value={person} onChangeText={setPerson} />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSubmit} disabled={loading || !desc.trim() || !amount}>
          <Text style={styles.saveBtnText}>{loading ? '...' : '➕ Add'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.discardBtn} onPress={onCancel}>
          <Text style={styles.discardBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── Main ConfirmCard ───────────────────────────────────────────────────────
export default function ConfirmCard({ metadata, onConfirm, onCancel, onPendingEdit, language }) {
  const rawTxns = metadata.pending_transactions || []
  const initDate = metadata.page_date || rawTxns[0]?.date || new Date().toISOString().slice(0, 10)

  const [txns,      setTxns]      = useState(rawTxns)
  const [batchDate, setBatchDate] = useState(initDate)
  const [adding,    setAdding]    = useState(false)

  function syncUp(newTxns) {
    onPendingEdit?.(newTxns.filter(Boolean))
  }

  function handleUpdate(idx, updated) {
    setTxns(prev => { const next = prev.map((t, i) => i === idx ? updated : t); syncUp(next); return next })
  }
  function handleDelete(idx) {
    setTxns(prev => { const next = prev.map((t, i) => i === idx ? null : t); syncUp(next); return next })
  }

  const liveTxns = txns.filter(Boolean)
  const IN_TYPES  = new Set(['sale','receipt','dues_received','udhaar_received'])
  const OUT_TYPES = new Set(['expense','dues_given','udhaar_given','bank_deposit'])
  const totalIn  = liveTxns.filter(t => IN_TYPES.has(t.type) || (t.type === 'other' && t.column === 'in')).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
  const totalOut = liveTxns.filter(t => OUT_TYPES.has(t.type) || (t.type === 'other' && t.column !== 'in')).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)

  return (
    <View style={styles.wrapper}>
      {/* Date row */}
      <View style={styles.dateRow}>
        <Text style={styles.dateLabel}>📅 {batchDate}</Text>
      </View>

      {/* Summary */}
      {(totalIn > 0 || totalOut > 0) && (
        <View style={styles.summaryBar}>
          {totalIn  > 0 && <Text style={styles.summaryIn}>📥 In: <Text style={{ fontWeight: '700', color: '#25D366' }}>{fmtRs(totalIn)}</Text></Text>}
          {totalOut > 0 && <Text style={styles.summaryOut}>📤 Out: <Text style={{ fontWeight: '700', color: '#E53935' }}>{fmtRs(totalOut)}</Text></Text>}
        </View>
      )}

      {/* Transaction list */}
      <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
        {txns.map((txn, i) => txn ? (
          <TxnRow key={i} txn={txn} index={i} onUpdate={handleUpdate} onDelete={handleDelete} language={language} />
        ) : null)}
      </ScrollView>

      {/* Add entry */}
      {adding ? (
        <AddEntryForm
          onAdd={txn => { setTxns(prev => [...prev, txn]); setAdding(false) }}
          onCancel={() => setAdding(false)}
          language={language}
        />
      ) : (
        <TouchableOpacity style={styles.addEntryBtn} onPress={() => setAdding(true)}>
          <Text style={styles.addEntryText}>{t('add_entry', language)}</Text>
        </TouchableOpacity>
      )}

      {/* Actions */}
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.confirmSaveBtn} onPress={() => onConfirm(liveTxns)}>
          <Text style={styles.confirmSaveBtnText}>{t('save_all', language)} ({liveTxns.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelBtnText}>❌</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: '#f8f9fa', borderRadius: 12, overflow: 'hidden', marginTop: 4 },
  dateRow: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  dateLabel: { fontSize: 13, color: '#555', fontWeight: '600' },
  summaryBar: { flexDirection: 'row', justifyContent: 'space-around', padding: 8, backgroundColor: '#f0f4f0' },
  summaryIn:  { fontSize: 13, color: '#555' },
  summaryOut: { fontSize: 13, color: '#555' },
  txnRow: { flexDirection: 'row', backgroundColor: '#fff', marginBottom: 1, padding: 10 },
  typePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginBottom: 4 },
  typePillText: { fontSize: 11, fontWeight: '600' },
  txnDesc: { fontSize: 13, color: '#333', marginBottom: 2 },
  txnTag: { fontSize: 11, color: '#888' },
  txnPerson: { fontSize: 11, color: '#666' },
  txnRight: { alignItems: 'flex-end', justifyContent: 'flex-start', minWidth: 80 },
  txnAmount: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  txnActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { padding: 4 },
  confPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, marginBottom: 2 },
  confPillText: { fontSize: 10, fontWeight: '700' },
  addEntryBtn: { margin: 10, padding: 10, alignItems: 'center', borderRadius: 8, borderWidth: 1.5, borderColor: '#00695C', borderStyle: 'dashed' },
  addEntryText: { color: '#00695C', fontWeight: '600' },
  cardActions: { flexDirection: 'row', padding: 10, gap: 8 },
  confirmSaveBtn: { flex: 1, backgroundColor: '#00695C', borderRadius: 10, padding: 12, alignItems: 'center' },
  confirmSaveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cancelBtn: { width: 44, backgroundColor: '#f0f0f0', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 18 },
  editForm: { padding: 10 },
  editRow: { marginBottom: 10 },
  editLabel: { fontSize: 11, color: '#888', fontWeight: '600', marginBottom: 4 },
  editInput: { borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: '#1a1a1a' },
  moreBtn: { alignSelf: 'flex-start', marginBottom: 8 },
  moreBtnText: { color: '#00695C', fontSize: 12, fontWeight: '600' },
  typeSelectorBtn: { flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, marginBottom: 8 },
  typeSelectorText: { fontSize: 14, color: '#1a1a1a' },
  editActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  saveBtn: { flex: 1, backgroundColor: '#00695C', borderRadius: 8, padding: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  discardBtn: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 8, padding: 10, alignItems: 'center' },
  discardBtnText: { color: '#555', fontWeight: '600' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, maxHeight: '60%' },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  pickerItem: { padding: 12, borderRadius: 8 },
  pickerItemActive: { backgroundColor: '#E8F5E9' },
  pickerItemText: { fontSize: 15, color: '#333' },
  pickerItemTextActive: { color: '#00695C', fontWeight: '700' },
  addForm: { padding: 10 },
  addFormTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },
  addInput: { borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: '#1a1a1a', marginBottom: 8 },
})
