// ── MessageBubble — converted from MessageBubble.jsx ──────────────────────
// Changes: div→View, span/p→Text, img→Image, window.confirm→Alert,
// CSS classes→StyleSheet, SavedCard converted inline

import { useState } from 'react'
import {
  View, Text, Image, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native'
import ConfirmCard from './ConfirmCard'
import { deleteTransaction } from '../api'
import { t } from '../translations'

// ── Inline text formatting (bold/italic) ────────────────────────────────
function FormatText({ text }) {
  if (!text) return null
  const parts = []
  const regex = /(\*[^*]+\*|_[^_]+_)/g
  let last = 0, m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(<Text key={`t${m.index}`}>{text.slice(last, m.index)}</Text>)
    const token = m[0]
    if (token.startsWith('*'))
      parts.push(<Text key={`b${m.index}`} style={{ fontWeight: '700' }}>{token.slice(1, -1)}</Text>)
    else
      parts.push(<Text key={`i${m.index}`} style={{ fontStyle: 'italic' }}>{token.slice(1, -1)}</Text>)
    last = m.index + token.length
  }
  if (last < text.length) parts.push(<Text key="tail">{text.slice(last)}</Text>)
  return <Text style={styles.bubbleText}>{parts}</Text>
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

// ── SavedCard colors & labels ─────────────────────────────────────────────
const SC_COLORS = {
  sale:'#25D366', receipt:'#25D366', dues_given:'#E53935', udhaar_given:'#E53935',
  dues_received:'#25D366', udhaar_received:'#25D366', expense:'#FF7043',
  bank_deposit:'#9C27B0', opening_balance:'#607D8B', closing_balance:'#607D8B',
  cash_in_hand:'#607D8B', upi_in_hand:'#2196F3', other:'#78909C',
}
const SC_IN  = new Set(['sale','receipt','dues_received','udhaar_received','cash_in_hand','upi_in_hand','opening_balance'])
const SC_OUT = new Set(['expense','dues_given','udhaar_given','bank_deposit','closing_balance'])

function SavedCell({ txn, onDelete }) {
  if (!txn) return null
  const color = SC_COLORS[txn.type] || '#94a3b8'
  return (
    <View style={[styles.scCell, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <View style={[styles.scTypePill, { backgroundColor: color + '18' }]}>
        <Text style={[styles.scTypeText, { color }]}>{(txn.type || '').replace(/_/g, ' ')}</Text>
      </View>
      <Text style={styles.scDesc}>{txn.description || '—'}</Text>
      <Text style={[styles.scAmount, { color }]}>₹{parseFloat(txn.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</Text>
      {txn.person_name && <Text style={styles.scPerson}>👤 {txn.person_name}</Text>}
      {txn.id && (
        <TouchableOpacity onPress={() => onDelete(txn.id)} style={styles.scDeleteBtn}>
          <Text>🗑️</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

function SavedCard({ transactions: initialTxns, phone, language }) {
  const [txns, setTxns] = useState(initialTxns || [])

  async function handleDelete(txnId) {
    Alert.alert('Delete entry?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteTransaction(phone, txnId)
            setTxns(prev => prev.filter(t => t.id !== txnId))
          } catch (e) {
            Alert.alert('Error', 'Delete failed: ' + e.message)
          }
        }
      }
    ])
  }

  if (txns.length === 0) {
    return (
      <View style={styles.savedCardEmpty}>
        <Text style={styles.savedCardEmptyText}>🗑️ All entries deleted</Text>
      </View>
    )
  }

  const inEntries  = txns.filter(t => SC_IN.has(t.type) || (t.type === 'other' && t.column === 'in'))
  const outEntries = txns.filter(t => SC_OUT.has(t.type) || (t.type === 'other' && t.column !== 'in'))
  const totalIn    = inEntries .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
  const totalOut   = outEntries.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
  const cardDate   = txns[0]?.date
  const dateStr    = cardDate
    ? new Date(cardDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  const maxRows = Math.max(inEntries.length, outEntries.length)

  return (
    <View style={styles.savedCard}>
      {/* Header */}
      <View style={styles.scHeader}>
        <Text style={styles.scHeaderText}>✅ {txns.length} entr{txns.length === 1 ? 'y' : 'ies'} saved</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {totalIn  > 0 && <Text style={styles.scTotalIn}>+₹{totalIn.toLocaleString('en-IN')}</Text>}
          {totalOut > 0 && <Text style={styles.scTotalOut}>−₹{totalOut.toLocaleString('en-IN')}</Text>}
        </View>
      </View>
      {dateStr && <Text style={styles.scDateRow}>{dateStr}</Text>}

      {/* Column headers */}
      <View style={styles.scColHeaders}>
        <Text style={[styles.scColLabel, { color: '#25D366' }]}>{t('jama_in', language)}</Text>
        <View style={styles.scVDivider} />
        <Text style={[styles.scColLabel, { color: '#E53935' }]}>{t('naam_out', language)}</Text>
      </View>

      {/* Grid rows */}
      {Array.from({ length: maxRows }).map((_, i) => (
        <View key={i} style={styles.scGridRow}>
          <View style={{ flex: 1 }}>
            <SavedCell txn={inEntries[i] ?? null} onDelete={handleDelete} />
          </View>
          <View style={styles.scVDivider} />
          <View style={{ flex: 1 }}>
            <SavedCell txn={outEntries[i] ?? null} onDelete={handleDelete} />
          </View>
        </View>
      ))}

      {/* Totals */}
      {maxRows > 0 && (
        <View style={styles.scTotalsRow}>
          <Text style={[styles.scTotalCell, { color: '#25D366' }]}>{totalIn > 0 ? `₹${totalIn.toLocaleString('en-IN')}` : ''}</Text>
          <View style={styles.scVDivider} />
          <Text style={[styles.scTotalCell, { color: '#E53935' }]}>{totalOut > 0 ? `₹${totalOut.toLocaleString('en-IN')}` : ''}</Text>
        </View>
      )}
    </View>
  )
}

// ── Main MessageBubble ─────────────────────────────────────────────────────
export default function MessageBubble({ msg, phone, onConfirm, onCancel, onPendingEdit, onOpenLedger, language }) {
  const { direction, body, media_url, created_at, metadata } = msg
  const isUser = direction === 'user'

  if (!isUser && (metadata?.dismissed || metadata?.overwritten)) return null

  const pendingTxns   = !isUser && metadata?.pending_transactions
  const confirmedTxns = !isUser && metadata?.confirmed_transactions
  const isPhotoSource = !isUser && !!metadata?.display

  const isLowConfImage = isPhotoSource && (() => {
    const txns = pendingTxns || []
    if (!txns.length) return true
    const avg = txns.reduce((s, t) => s + (t.confidence ?? 100), 0) / txns.length
    return avg < 70
  })()

  const showLowConfWarning = isLowConfImage && onConfirm
  const showConfirmCard    = !isPhotoSource && pendingTxns?.length > 0 && onConfirm
  const showSavedCard      = confirmedTxns?.length > 0
  const count = pendingTxns?.length || 0
  const txnDate = pendingTxns?.[0]?.date

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>

        {/* Image */}
        {media_url && (
          <Image
            source={{ uri: media_url }}
            style={styles.bubbleImage}
            resizeMode="cover"
          />
        )}

        {/* Plain text */}
        {body && !showConfirmCard && !showSavedCard && (
          <FormatText text={body} />
        )}

        {/* Confirm card header */}
        {showConfirmCard && (
          <Text style={styles.confirmHeader}>
            📋 <Text style={{ fontWeight: '700' }}>{count} entries found</Text>
            {txnDate ? ` · ${txnDate}` : ''}{'\n'}
            <Text style={{ fontSize: 11, color: '#888' }}>Review and edit below, then save</Text>
          </Text>
        )}

        {/* Low confidence warning */}
        {showLowConfWarning && (
          <View style={styles.lowConfWarn}>
            <Text style={styles.lowConfTitle}>⚠️ {t('low_conf_title', language)}</Text>
            <Text style={styles.lowConfBody}>{t('low_conf_body', language)}</Text>
            <TouchableOpacity style={styles.lowConfBtn} onPress={() => { onCancel?.(); onOpenLedger?.() }}>
              <Text style={styles.lowConfBtnText}>{t('low_conf_btn', language)}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Confirm card */}
        {showConfirmCard && (
          <ConfirmCard
            metadata={metadata}
            onConfirm={onConfirm}
            onCancel={onCancel}
            onPendingEdit={onPendingEdit}
            language={language}
          />
        )}

        {/* Saved card */}
        {showSavedCard && (
          <SavedCard transactions={confirmedTxns} phone={phone} language={language} />
        )}

        {/* Timestamp */}
        <View style={styles.bubbleMeta}>
          <Text style={styles.bubbleTime}>{formatTime(created_at)}</Text>
          {isUser && <Text style={styles.tick}>✓✓</Text>}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 3 },
  rowUser: { justifyContent: 'flex-end' },
  rowBot:  { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '85%', borderRadius: 12, padding: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  bubbleUser: { backgroundColor: '#DCF8C6', borderBottomRightRadius: 3 },
  bubbleBot:  { backgroundColor: '#fff',    borderBottomLeftRadius: 3 },
  bubbleText: { fontSize: 15, color: '#1a1a1a', lineHeight: 21 },
  bubbleImage: { width: 200, height: 200, borderRadius: 8, marginBottom: 4 },
  bubbleMeta: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4, gap: 4 },
  bubbleTime: { fontSize: 11, color: '#888' },
  tick: { fontSize: 12, color: '#25D366' },
  confirmHeader: { fontSize: 13, color: '#333', marginBottom: 6, lineHeight: 18 },
  lowConfWarn: { backgroundColor: '#FFF3E0', borderRadius: 10, padding: 12 },
  lowConfTitle: { fontSize: 14, fontWeight: '700', color: '#E65100', marginBottom: 4 },
  lowConfBody:  { fontSize: 13, color: '#555', marginBottom: 10 },
  lowConfBtn:   { backgroundColor: '#FF9800', borderRadius: 8, padding: 8, alignItems: 'center' },
  lowConfBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  savedCard: { backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', marginTop: 4 },
  savedCardEmpty: { padding: 16, alignItems: 'center' },
  savedCardEmptyText: { color: '#888', fontSize: 14 },
  scHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, backgroundColor: '#f8f9fa' },
  scHeaderText: { fontSize: 13, fontWeight: '700', color: '#333' },
  scTotalIn: { fontSize: 12, color: '#25D366', fontWeight: '700' },
  scTotalOut: { fontSize: 12, color: '#E53935', fontWeight: '700' },
  scDateRow: { fontSize: 11, color: '#888', paddingHorizontal: 10, paddingBottom: 4 },
  scColHeaders: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#f0f0f0' },
  scColLabel: { flex: 1, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  scVDivider: { width: 1, backgroundColor: '#e0e0e0' },
  scGridRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  scCell: { padding: 8, flex: 1 },
  scTypePill: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginBottom: 2 },
  scTypeText: { fontSize: 10, fontWeight: '700' },
  scDesc: { fontSize: 12, color: '#333' },
  scAmount: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  scPerson: { fontSize: 11, color: '#666', marginTop: 1 },
  scDeleteBtn: { alignSelf: 'flex-end', marginTop: 4 },
  scTotalsRow: { flexDirection: 'row', padding: 8, backgroundColor: '#f8f9fa' },
  scTotalCell: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700' },
})
