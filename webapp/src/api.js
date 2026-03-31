const BASE = '/api'

// Safely parse JSON — returns {} if the response is HTML/empty (e.g. proxy error)
async function safeJson(r) {
  const text = await r.text()
  try { return JSON.parse(text) } catch { return {} }
}

export async function checkPhone(phone) {
  // Read-only check — does NOT create a store record
  const r = await fetch(`${BASE}/check?phone=${encodeURIComponent(phone)}`)
  if (!r.ok) return null
  return r.json()
  // returns { exists: bool, name: string, phone: string }
}

export async function login(phone, storeName = '') {
  const r = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, store_name: storeName }),
  })
  if (!r.ok) throw new Error((await r.json()).detail || 'Login failed')
  return r.json()
}

export async function sendMessage(phone, body, language = 'hinglish') {
  const r = await fetch(`${BASE}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, body, language }),
  })
  const data = await safeJson(r)
  if (!r.ok) throw new Error(data.detail || `Server error (${r.status})`)
  return data
  // returns { user_message_id, bot_message_id, bot_reply, quick_replies, processing }
}

export async function sendImage(phone, file, language = 'hinglish') {
  const fd = new FormData()
  fd.append('phone', phone)
  fd.append('file', file)
  fd.append('language', language)
  const r = await fetch(`${BASE}/image`, { method: 'POST', body: fd })
  const data = await safeJson(r)
  if (!r.ok) throw new Error(data.detail || `Server error (${r.status})`)
  return data
  // returns { user_message_id, processing: true }
}

export async function pollMessages(phone, afterId = 0) {
  const r = await fetch(`${BASE}/messages?phone=${encodeURIComponent(phone)}&after_id=${afterId}`)
  if (!r.ok) return { messages: [], processing: false }
  return r.json()
  // returns { messages: [{id, direction, body, media_url, created_at}], processing }
}

export async function fetchAnalytics(phone, period = 'day', start = null, end = null) {
  let url = `${BASE}/analytics?phone=${encodeURIComponent(phone)}&period=${period}`
  if (start && end) url += `&start=${start}&end=${end}`
  const r = await fetch(url)
  if (!r.ok) throw new Error('Analytics fetch failed')
  return r.json()
}

export async function fetchDues(phone) {
  const r = await fetch(`${BASE}/dues?phone=${encodeURIComponent(phone)}`)
  if (!r.ok) throw new Error('Dues fetch failed')
  return r.json()
}

export async function updateDuesContact(phone, personName, contactPhone) {
  const r = await fetch(`${BASE}/dues/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, person_name: personName, contact_phone: contactPhone }),
  })
  if (!r.ok) throw new Error('Contact update failed')
  return r.json()
}

export async function fetchStaff(phone, start = null, end = null) {
  let url = `${BASE}/staff?phone=${encodeURIComponent(phone)}`
  if (start) url += `&start=${start}`
  if (end) url += `&end=${end}`
  const r = await fetch(url)
  if (!r.ok) throw new Error('Staff fetch failed')
  return r.json()
}

export async function fetchExpenseCategories(phone) {
  const r = await fetch(`${BASE}/expense-categories?phone=${encodeURIComponent(phone)}`)
  if (!r.ok) return { categories: [] }
  return r.json()
  // returns { categories: [{tag, label, emoji, count}] }
}

export async function confirmTransactions(phone, transactions, botMessageId = null, originalTransactions = null) {
  const r = await fetch(`${BASE}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      transactions,
      bot_message_id: botMessageId,
      original_transactions: originalTransactions,
    }),
  })
  const data = await safeJson(r)
  if (!r.ok) throw new Error(data.detail ? JSON.stringify(data.detail) : `Server error (${r.status})`)
  return data
}

export async function quickParse(description, amount, personName = '') {
  const r = await fetch(`${BASE}/quick-parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, amount: parseFloat(amount) || 0, person_name: personName }),
  })
  if (!r.ok) throw new Error('Parse failed')
  return r.json()  // { transaction: {...} }
}

export async function deleteTransaction(phone, txnId) {
  const r = await fetch(`${BASE}/transaction?phone=${encodeURIComponent(phone)}&txn_id=${txnId}`, {
    method: 'DELETE',
  })
  if (!r.ok) throw new Error('Delete failed')
  return r.json()
}

export async function fetchPersonDuesHistory(phone, personName) {
  const r = await fetch(`${BASE}/dues/person?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(personName)}`)
  if (!r.ok) throw new Error('Could not load history')
  return r.json()
}

export async function classifyLedger(phone, date, rows, language = 'hinglish') {
  const r = await fetch(`${BASE}/ledger-classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, date, rows, language }),
  })
  if (!r.ok) throw new Error((await r.json()).detail || 'Classify failed')
  return r.json()
  // returns { message_id, pending_transactions, response_message }
}

export async function classifyPersonsBatch(phone, classifications) {
  const r = await fetch(`${BASE}/classify-persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, classifications }),
  })
  if (!r.ok) throw new Error('Classification failed')
  return r.json()
}

export async function clearChat(phone) {
  const r = await fetch(`${BASE}/messages?phone=${encodeURIComponent(phone)}`, {
    method: 'DELETE',
  })
  if (!r.ok) throw new Error('Clear chat failed')
  return r.json()
}

export async function fetchProfile(phone) {
  const r = await fetch(`${BASE}/profile?phone=${encodeURIComponent(phone)}`)
  if (!r.ok) throw new Error('Profile fetch failed')
  return r.json()
  // returns { name, language, segment, joined, phone }
}

export async function updateProfile(phone, updates) {
  const r = await fetch(`${BASE}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, ...updates }),
  })
  if (!r.ok) throw new Error('Profile update failed')
  return r.json()
}

export async function dismissMessage(phone, botMessageId) {
  const r = await fetch(`${BASE}/dismiss?phone=${encodeURIComponent(phone)}&bot_message_id=${botMessageId}`, {
    method: 'POST',
  })
  if (!r.ok) return  // non-critical
  return r.json()
}

export async function dismissBulk(phone, messageIds, cancelText = null) {
  // Bulk-dismiss ack messages and optionally persist a cancel message.
  // Returns { ok, cancel_msg_id } — cancel_msg_id is the DB id of the persisted cancel message (or null).
  const r = await fetch(`${BASE}/dismiss-bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message_ids: messageIds, cancel_text: cancelText }),
  })
  if (!r.ok) return { ok: false, cancel_msg_id: null }  // best-effort, non-critical
  return r.json()
}

export async function speakLedger(inEntries, outEntries, dateStr, language = 'hinglish', dateFromPhoto = true) {
  const r = await fetch(`${BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      in_entries: inEntries, out_entries: outEntries,
      date_str: dateStr, language,
      date_from_photo: dateFromPhoto,
    }),
  })
  if (!r.ok) throw new Error('TTS unavailable')
  return r.json()  // { audio: '<base64 mp3>', voice: '...' }
}
