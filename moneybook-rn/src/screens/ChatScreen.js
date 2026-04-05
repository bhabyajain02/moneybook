// ── ChatScreen — converted from ChatWindow.jsx ────────────────────────────
// All business logic (polling, send, confirm, classify, etc.) is identical.
// UI changes: div→View, CSS→StyleSheet, scrollIntoView→FlatList.scrollToEnd,
// window.confirm→Alert, document.addEventListener→not needed (RN handles outside taps)

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Modal,
  ActivityIndicator, SafeAreaView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MessageBubble    from '../components/MessageBubble'
import TypingIndicator  from '../components/TypingIndicator'
import QuickReplies     from '../components/QuickReplies'
import InputBar         from '../components/InputBar'
import LedgerEntry      from '../components/LedgerEntry'
import PersonClassifyWidget from '../components/PersonClassifyWidget'
import {
  sendMessage, sendImage, pollMessages, confirmTransactions,
  dismissMessage, dismissBulk, fetchStaff, classifyPersonsBatch, clearChat,
} from '../api'
import { t } from '../translations'

const LANGUAGES = [
  { key: 'english',  label: 'English' },
  { key: 'hindi',    label: 'हिंदी' },
  { key: 'hinglish', label: 'Hinglish' },
  { key: 'gujarati', label: 'ગુજરાતી' },
  { key: 'marathi',  label: 'मराठी' },
  { key: 'bengali',  label: 'বাংলা' },
  { key: 'tamil',    label: 'தமிழ்' },
  { key: 'telugu',   label: 'తెలుగు' },
  { key: 'kannada',  label: 'ಕನ್ನಡ' },
  { key: 'punjabi',  label: 'ਪੰਜਾਬੀ' },
]

const POLL_INTERVAL = 2500

function _inferTag(desc) {
  const d = (desc || '').toLowerCase()
  if (/\b(salary|staff|wages?|labour)\b/.test(d)) return 'staff_expense'
  if (/\b(rent|kiraya)\b/.test(d)) return 'rent'
  if (/\b(electric|bijli|power)\b/.test(d)) return 'electricity'
  if (/\b(petrol|diesel|fuel|gas)\b/.test(d)) return 'petrol'
  if (/\b(food|khana|lunch|dinner|breakfast|chai|tea|coffee)\b/.test(d)) return 'refreshment'
  if (/\b(transport|auto|taxi|bus|freight|courier)\b/.test(d)) return 'transport'
  if (/\b(repair|maintenance|service)\b/.test(d)) return 'repair'
  if (/\b(phone|mobile|telephone|recharge)\b/.test(d)) return 'telephone'
  if (/\b(water|pani)\b/.test(d)) return 'water'
  if (/\b(insurance|bima)\b/.test(d)) return 'insurance'
  if (/\b(packaging|packing)\b/.test(d)) return 'packaging'
  if (/\b(cleaning|safai|sweep)\b/.test(d)) return 'cleaning'
  if (/\b(discount|cash discount)\b/.test(d)) return 'cash_discount'
  if (/\b(purchase|khareed|buy|bought|saman)\b/.test(d)) return 'purchase'
  return 'store_expense'
}

function deriveChips(quickReplies) {
  if (!quickReplies || quickReplies.length === 0) return []
  return quickReplies.map(qr => {
    if (qr === 'haan' || qr === 'cancel' || qr.startsWith('galat')) return null
    const num = parseInt(qr, 10)
    const labels = { 1:'👷 Staff', 2:'🛒 Customer', 3:'📦 Supplier', 4:'🏠 Ghar' }
    if (labels[num]) return { label: labels[num], value: qr, type: 'default' }
    return { label: qr, value: qr, type: 'default' }
  }).filter(Boolean)
}

function groupByDate(messages) {
  const groups = []
  let lastDate = null
  messages.forEach(m => {
    const d = new Date(m.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    if (d !== lastDate) { groups.push({ type: 'date', label: d, key: `date-${d}` }); lastDate = d }
    groups.push({ type: 'msg', msg: m, key: `msg-${m.id}` })
  })
  return groups
}

export default function ChatScreen({ phone, storeName, language = 'hinglish', onLogout, onLanguageChange }) {
  const insets = useSafeAreaInsets()
  const [messages,       setMessages]       = useState([])
  const [processing,     setProcessing]     = useState(false)
  const [quickReplies,   setQuickReplies]   = useState([])
  const [sending,        setSending]        = useState(false)
  const [langOpen,       setLangOpen]       = useState(false)
  const [showLedger,     setShowLedger]     = useState(false)
  const [photoReview,    setPhotoReview]    = useState(null)
  const [classifyWidget, setClassifyWidget] = useState(null)
  const [staffOptions,   setStaffOptions]   = useState([])
  const pendingPhotoRef  = useRef(null)
  const lastIdRef        = useRef(0)
  const listRef          = useRef()
  const pollRef          = useRef()
  const originalTxnsRef  = useRef({})

  useEffect(() => {
    if (!phone) return
    fetchStaff(phone).then(data => setStaffOptions((data || []).map(s => s.name || s).filter(Boolean))).catch(() => {})
  }, [phone])

  const poll = useCallback(async () => {
    try {
      const data = await pollMessages(phone, lastIdRef.current)
      if (data.messages?.length > 0) {
        setMessages(prev => {
          const existing = new Set(prev.map(m => m.id))
          const fresh = data.messages.filter(m => !existing.has(m.id))
          if (fresh.length === 0) return prev
          lastIdRef.current = Math.max(lastIdRef.current, ...fresh.map(m => m.id))
          const processed = fresh.map(m => {
            if (m.direction === 'bot' && m.metadata?.pending_transactions?.length > 0) {
              if (!originalTxnsRef.current[m.id]) {
                originalTxnsRef.current[m.id] = JSON.parse(JSON.stringify(m.metadata.pending_transactions))
              }
              if (m.metadata?.display || m.metadata?.source === 'image') {
                pendingPhotoRef.current = { msgId: m.id, txns: m.metadata.pending_transactions, date: m.metadata.page_date, display: m.metadata.display || null }
                return { ...m, metadata: { ...m.metadata, overwritten: true } }
              }
            }
            return m
          })
          return [...prev, ...processed]
        })

        if (pendingPhotoRef.current) {
          const pending = pendingPhotoRef.current
          pendingPhotoRef.current = null
          const personNames = [...new Set((pending.txns || []).filter(t => t.person_name && t.needs_tracking !== false).map(t => t.person_name))]
          if (personNames.length > 0) {
            const persons = personNames.map(name => {
              const txn = pending.txns.find(t => t.person_name === name)
              return { name, description: txn?.description || '', amount: txn?.amount || 0 }
            })
            setClassifyWidget({ persons, txns: pending.txns, msgId: pending.msgId, date: pending.date, display: pending.display })
          } else {
            setPhotoReview(pending)
          }
        }

        const latestBot = [...data.messages].reverse().find(m => m.direction === 'bot')
        if (latestBot?.quick_replies) setQuickReplies(latestBot.quick_replies)
      }
      setProcessing(data.processing || false)
    } catch {}
  }, [phone])

  useEffect(() => {
    poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [poll])

  // Scroll to bottom when messages change
  useEffect(() => {
    if (listRef.current && messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [messages, processing])

  async function handleSend(text) {
    if (sending) return
    setSending(true)
    setQuickReplies([])
    const tempId = Date.now()
    const tempMsg = { id: tempId, direction: 'user', body: text, created_at: new Date().toISOString() }
    setMessages(prev => [...prev, tempMsg])
    try {
      const resp = await sendMessage(phone, text, language)
      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempId)
        const realUser = { id: resp.user_message_id, direction: 'user', body: text, created_at: new Date().toISOString() }
        return [...withoutTemp, realUser]
      })
      lastIdRef.current = Math.max(lastIdRef.current, resp.user_message_id)
      if (resp.processing) setProcessing(true)
      await poll()
    } catch (e) {
      setMessages(prev => [...prev, { id: tempId + 1, direction: 'bot', body: `⚠️ Error: ${e.message}`, created_at: new Date().toISOString() }])
    } finally {
      setSending(false)
    }
  }

  async function handleImage(fileUri) {
    if (sending) return
    setSending(true)
    const tempId = Date.now()
    setMessages(prev => [...prev, { id: tempId, direction: 'user', media_url: fileUri, body: null, created_at: new Date().toISOString() }])
    try {
      const resp = await sendImage(phone, fileUri, language)
      const realId = resp?.user_message_id
      if (realId) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: realId, ...(resp.media_url ? { media_url: resp.media_url } : {}) } : m))
        lastIdRef.current = Math.max(lastIdRef.current, realId)
      }
      setProcessing(true)
    } catch (e) {
      setMessages(prev => [...prev, { id: tempId + 1, direction: 'bot', body: `⚠️ Upload failed: ${e.message}`, created_at: new Date().toISOString() }])
    } finally {
      setSending(false)
    }
  }

  function removeIntermediates(prev, msgId) {
    const msgIndex = prev.findIndex(m => m.id === msgId)
    if (msgIndex === -1) return prev
    let imageIndex = -1
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (prev[i].direction === 'user' && prev[i].media_url) { imageIndex = i; break }
    }
    if (imageIndex === -1) return prev
    return prev.filter((m, i) => !(i > imageIndex && i < msgIndex && m.direction === 'bot'))
  }

  function findAckIds(msgs, msgId) {
    const msgIndex = msgs.findIndex(m => m.id === msgId)
    if (msgIndex === -1) return []
    let imageIndex = -1
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (msgs[i].direction === 'user' && msgs[i].media_url) { imageIndex = i; break }
    }
    if (imageIndex === -1) return []
    return msgs.slice(imageIndex + 1, msgIndex).filter(m => m.direction === 'bot' && typeof m.id === 'number').map(m => m.id)
  }

  async function handleConfirm(editedTxns, botMsgId) {
    try {
      const originals = originalTxnsRef.current[botMsgId] || null
      const resp = await confirmTransactions(phone, editedTxns, botMsgId, originals)
      const ackIds = findAckIds(messages, botMsgId)
      if (ackIds.length > 0) dismissBulk(phone, ackIds).catch(() => {})
      setMessages(prev => {
        const cleaned = removeIntermediates(prev, botMsgId)
        return cleaned.map(m => m.id === botMsgId ? { ...m, metadata: { confirmed_transactions: resp.confirmed_transactions } } : m)
      })
      delete originalTxnsRef.current[botMsgId]
      setQuickReplies([])
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now(), direction: 'bot', body: `⚠️ Save failed: ${e.message}`, created_at: new Date().toISOString() }])
    }
  }

  function handlePendingEdit(botMsgId, updatedTxns) {
    setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, metadata: { ...m.metadata, pending_transactions: updatedTxns } } : m))
  }

  async function handleLedgerClassified(result) {
    if (result.message_id) lastIdRef.current = Math.max(lastIdRef.current, result.message_id)
    const txns = result.pending_transactions || []
    if (txns.length > 0 && result.message_id) {
      try {
        await confirmTransactions(phone, txns, result.message_id)
        setMessages(prev => [...prev, { id: Date.now(), direction: 'bot', body: `✅ ${txns.length} entries saved from ledger.`, created_at: new Date().toISOString() }])
      } catch (e) {
        setMessages(prev => [...prev, { id: Date.now(), direction: 'bot', body: `⚠️ Save failed: ${e.message}`, created_at: new Date().toISOString() }])
      }
    }
    await poll()
  }

  async function handlePhotoConfirm(editedTxns, msgId) {
    const originals = originalTxnsRef.current[msgId] || null
    try {
      const resp = await confirmTransactions(phone, editedTxns, msgId, originals)
      const ackIds = findAckIds(messages, msgId)
      if (ackIds.length > 0) dismissBulk(phone, ackIds).catch(() => {})
      setMessages(prev => {
        const cleaned = removeIntermediates(prev, msgId)
        return cleaned.map(m => m.id === msgId ? { ...m, metadata: { confirmed_transactions: resp.confirmed_transactions } } : m)
      })
      delete originalTxnsRef.current[msgId]
      setPhotoReview(null)
      if (resp.classification_pending) await poll()
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now(), direction: 'bot', body: `⚠️ Save failed: ${e.message}`, created_at: new Date().toISOString() }])
      setPhotoReview(null)
    }
  }

  async function handlePhotoCancel() {
    const msgId = photoReview?.msgId
    if (msgId) {
      const tempId = Date.now()
      const cancelMsg = { id: tempId, direction: 'bot', body: t('cancel_expense', language), created_at: new Date().toISOString() }
      const ackIds = findAckIds(messages, msgId)
      setMessages(prev => { const cleaned = removeIntermediates(prev, msgId).filter(m => m.id !== msgId); return [...cleaned, cancelMsg] })
      delete originalTxnsRef.current[msgId]
      dismissBulk(phone, [...ackIds, msgId], t('cancel_expense', language)).then(res => {
        if (res?.cancel_msg_id) setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: res.cancel_msg_id } : m))
      }).catch(() => {})
    }
    setPhotoReview(null)
  }

  async function handleClassifyComplete(classifications) {
    if (!classifyWidget) return
    const { txns, msgId, date, display } = classifyWidget
    const items = Object.entries(classifications).map(([name, c]) => ({ name: c.staffName || name, category: c.category }))
    try { await classifyPersonsBatch(phone, items) } catch {}
    const annotated = txns.map(t => {
      if (!t.person_name) return t
      const c = classifications[t.person_name]
      if (!c) return t
      const updated = { ...t, person_category: c.category, person_name: c.category === 'staff' && c.staffName ? c.staffName : t.person_name, needs_tracking: false }
      if (c.category === 'store_expense') { updated.type = 'expense'; if (!updated.tag) updated.tag = _inferTag(updated.description || t.person_name || '') }
      if (c.category === 'staff' && (t.type === 'expense' || t.type === 'udhaar_given')) { updated.type = 'expense'; updated.tag = 'staff_expense' }
      return updated
    })
    fetchStaff(phone).then(data => setStaffOptions((data || []).map(s => s.name || s).filter(Boolean))).catch(() => {})
    setClassifyWidget(null)
    setPhotoReview({ msgId, txns: annotated, date, display })
  }

  async function handleClassifyCancel() {
    const msgId = classifyWidget?.msgId
    if (msgId) {
      const tempId = Date.now()
      const cancelMsg = { id: tempId, direction: 'bot', body: t('cancel_expense', language), created_at: new Date().toISOString() }
      const ackIds = findAckIds(messages, msgId)
      setMessages(prev => { const cleaned = removeIntermediates(prev, msgId).filter(m => m.id !== msgId); return [...cleaned, cancelMsg] })
      delete originalTxnsRef.current[msgId]
      dismissBulk(phone, [...ackIds, msgId], t('cancel_expense', language)).then(res => {
        if (res?.cancel_msg_id) setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: res.cancel_msg_id } : m))
      }).catch(() => {})
    }
    setClassifyWidget(null)
  }

  async function handleCancelConfirm(botMsgId) {
    const tempId = Date.now()
    const cancelMsg = { id: tempId, direction: 'bot', body: t('cancel_expense', language), created_at: new Date().toISOString() }
    const ackIds = findAckIds(messages, botMsgId)
    setMessages(prev => { const cleaned = removeIntermediates(prev, botMsgId).filter(m => m.id !== botMsgId); return [...cleaned, cancelMsg] })
    delete originalTxnsRef.current[botMsgId]
    dismissBulk(phone, [...ackIds, botMsgId], t('cancel_expense', language)).then(res => {
      if (res?.cancel_msg_id) setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: res.cancel_msg_id } : m))
    }).catch(() => {})
  }

  async function handleClearChat() {
    Alert.alert(t('clear_chat', language), t('clear_confirm', language), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        try {
          await clearChat(phone)
          setMessages([])
          lastIdRef.current = 0
          setQuickReplies([])
          setProcessing(false)
        } catch (e) { console.error('Clear chat failed:', e) }
      }}
    ])
  }

  const chips   = deriveChips(quickReplies)
  const grouped = groupByDate(messages)

  function renderItem({ item }) {
    if (item.type === 'date') {
      return (
        <View style={styles.dateDivider}>
          <Text style={styles.dateDividerText}>{item.label}</Text>
        </View>
      )
    }
    const msg = item.msg
    const isLastConfirm = msg.direction === 'bot' &&
      msg.metadata?.pending_transactions &&
      !messages.slice(messages.indexOf(msg) + 1).some(m => m.direction === 'bot' && m.metadata?.pending_transactions)
    return (
      <MessageBubble
        msg={msg}
        phone={phone}
        onConfirm={isLastConfirm ? txns => handleConfirm(txns, msg.id) : null}
        onCancel={isLastConfirm ? () => handleCancelConfirm(msg.id) : null}
        onPendingEdit={isLastConfirm ? txns => handlePendingEdit(msg.id, txns) : null}
        onOpenLedger={() => setShowLedger(true)}
        language={language}
      />
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <Text style={{ fontSize: 18 }}>📒</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{storeName || 'MoneyBook'}</Text>
          <Text style={styles.headerStatus}>
            {processing ? t('processing_status', language) : '🟢 Online'}
          </Text>
        </View>
        {/* Language selector */}
        <TouchableOpacity style={styles.langBtn} onPress={() => setLangOpen(true)}>
          <Text style={styles.langBtnText}>🌐 {LANGUAGES.find(l => l.key === language)?.label || 'Lang'}</Text>
        </TouchableOpacity>
        {/* Clear button */}
        <TouchableOpacity style={styles.iconBtn} onPress={handleClearChat}>
          <Text>🗑️</Text>
        </TouchableOpacity>
        {/* Logout button */}
        <TouchableOpacity style={styles.iconBtn} onPress={onLogout}>
          <Text>⇥</Text>
        </TouchableOpacity>
      </View>

      {/* Language modal */}
      <Modal visible={langOpen} transparent animationType="fade" onRequestClose={() => setLangOpen(false)}>
        <TouchableOpacity style={styles.langOverlay} activeOpacity={1} onPress={() => setLangOpen(false)}>
          <View style={styles.langDropdown}>
            {LANGUAGES.map(l => (
              <TouchableOpacity
                key={l.key}
                style={[styles.langOption, language === l.key && styles.langOptionActive]}
                onPress={() => { onLanguageChange && onLanguageChange(l.key); setLangOpen(false) }}
              >
                <Text style={[styles.langOptionText, language === l.key && styles.langOptionTextActive]}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Message list */}
      {messages.length === 0 && !processing ? (
        <View style={styles.emptyChat}>
          <Text style={styles.emptyChatEmoji}>📒</Text>
          <Text style={styles.emptyChatTitle}>{t('empty_title', language)}</Text>
          <Text style={styles.emptyChatBody}>{t('empty_body', language)}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={grouped}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          style={styles.messageList}
          contentContainerStyle={{ paddingVertical: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListFooterComponent={processing ? <TypingIndicator /> : null}
        />
      )}

      {/* Quick replies */}
      <QuickReplies chips={chips} onSend={handleSend} />

      {/* Input bar */}
      <View style={{ paddingBottom: insets.bottom }}>
        <InputBar
          onSend={handleSend}
          onImage={handleImage}
          onLedger={() => setShowLedger(true)}
          disabled={sending}
          language={language}
        />
      </View>

      {/* Ledger entry modal */}
      {showLedger && !photoReview && (
        <LedgerEntry
          phone={phone}
          language={language}
          onClose={() => setShowLedger(false)}
          onClassified={handleLedgerClassified}
        />
      )}

      {/* Person classify widget */}
      {classifyWidget && (
        <PersonClassifyWidget
          persons={classifyWidget.persons}
          staffOptions={staffOptions}
          onComplete={handleClassifyComplete}
          onCancel={handleClassifyCancel}
          language={language}
        />
      )}

      {/* Photo review */}
      {photoReview && (
        <LedgerEntry
          phone={phone}
          language={language}
          onClose={handlePhotoCancel}
          onClassified={handleLedgerClassified}
          prefill={{
            txns:    photoReview.txns,
            display: photoReview.display,
            msgId:   photoReview.msgId,
            date:    photoReview.date,
            onSave:  handlePhotoConfirm,
          }}
        />
      )}

      {/* Sending indicator overlay */}
      {sending && (
        <View style={styles.sendingOverlay}>
          <ActivityIndicator color="#fff" size="small" />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECE5DD' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#00695C', paddingHorizontal: 12, paddingVertical: 10,
    gap: 8,
  },
  headerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  headerName: { color: '#fff', fontWeight: '700', fontSize: 16 },
  headerStatus: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  langBtn: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12 },
  langBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  langOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-start', alignItems: 'flex-end', padding: 60 },
  langDropdown: { backgroundColor: '#fff', borderRadius: 12, padding: 8, minWidth: 140, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  langOption: { padding: 10, borderRadius: 8 },
  langOptionActive: { backgroundColor: '#E8F5E9' },
  langOptionText: { fontSize: 14, color: '#333' },
  langOptionTextActive: { color: '#00695C', fontWeight: '700' },
  messageList: { flex: 1 },
  dateDivider: { alignItems: 'center', marginVertical: 10 },
  dateDividerText: { backgroundColor: 'rgba(0,0,0,0.15)', color: '#555', fontSize: 12, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyChatEmoji: { fontSize: 48, marginBottom: 16 },
  emptyChatTitle: { fontSize: 17, fontWeight: '700', color: '#333', marginBottom: 8 },
  emptyChatBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  sendingOverlay: { position: 'absolute', bottom: 80, right: 16, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 10 },
})
