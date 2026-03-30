const BASE = '/api'

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
  if (!r.ok) throw new Error((await r.json()).detail || 'Send failed')
  return r.json()
  // returns { user_message_id, bot_message_id, bot_reply, quick_replies, processing }
}

export async function sendImage(phone, file, language = 'hinglish') {
  const fd = new FormData()
  fd.append('phone', phone)
  fd.append('file', file)
  fd.append('language', language)
  const r = await fetch(`${BASE}/image`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error((await r.json()).detail || 'Upload failed')
  return r.json()
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
  if (start) url += `&start=${start}`
  if (end)   url += `&end=${end}`
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

export async function fetchStaff(phone) {
  const r = await fetch(`${BASE}/staff?phone=${encodeURIComponent(phone)}`)
  if (!r.ok) throw new Error('Staff fetch failed')
  return r.json()
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
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try { const d = await r.json(); detail = d.detail || JSON.stringify(d) } catch {}
    throw new Error(detail)
  }
  return r.json()
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

export async function fetchProfile(phone) {
  const r = await fetch(`${BASE}/profile?phone=${encodeURIComponent(phone)}`)
  if (!r.ok) throw new Error('Could not load profile')
  return r.json()
  // returns { name, phone, segment, language, joined }
}

export async function updateProfile(phone, { name, language } = {}) {
  const r = await fetch(`${BASE}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name, language }),
  })
  if (!r.ok) throw new Error('Update failed')
  return r.json()
}

export async function dismissMessage(phone, botMessageId) {
  const r = await fetch(`${BASE}/dismiss?phone=${encodeURIComponent(phone)}&bot_message_id=${botMessageId}`, {
    method: 'POST',
  })
  if (!r.ok) return  // non-critical
  return r.json()
}
