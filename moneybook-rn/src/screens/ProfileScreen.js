// ── ProfileScreen — converted from ProfilePage.jsx ────────────────────────
// window.open → Linking.openURL, select → Modal picker, position:fixed → Modal

import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, FlatList, Alert, Linking,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fetchProfile, updateProfile } from '../api'
import { t } from '../translations'

const SEGMENT_LABELS = {
  textile: 'Textile / Clothing', grocery: 'Grocery / Kirana',
  pharmacy: 'Pharmacy / Medicine', hardware: 'Hardware / Tools',
  food: 'Food / Restaurant', electronics: 'Electronics', general: 'General Store',
}

const LANGUAGES = [
  { key: 'hinglish', label: 'Hinglish' }, { key: 'english', label: 'English' },
  { key: 'hindi', label: 'हिंदी' }, { key: 'gujarati', label: 'ગુજરાતી' },
  { key: 'marathi', label: 'मराठी' }, { key: 'bengali', label: 'বাংলা' },
  { key: 'tamil', label: 'தமிழ்' }, { key: 'telugu', label: 'తెలుగు' },
  { key: 'kannada', label: 'ಕನ್ನಡ' }, { key: 'punjabi', label: 'ਪੰਜਾਬੀ' },
]

const PLANS = [
  { id: 'free', name: 'Free', price: '₹0', period: 'forever', color: '#757575', current: true, features: ['Unlimited WhatsApp entries','Daily & monthly summaries','Udhaar tracking','Photo scanning'] },
  { id: 'pro',  name: 'Pro',  price: '₹299', period: '/month', color: '#1565C0', badge: '⭐ Popular', features: ['Everything in Free','Analytics dashboard','Staff tracking','CSV export','Up to 3 stores'] },
  { id: 'business', name: 'Business', price: '₹999', period: '/month', color: '#6A1B9A', badge: '🚀 Best Value', features: ['Everything in Pro','Unlimited stores','Priority support','Custom reports','API access'] },
]

function formatPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.length === 12) return `+${digits.slice(0, 2)} ${digits.slice(2, 7)} ${digits.slice(7)}`
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
  return raw?.replace('web:', '') || '—'
}

function formatJoined(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

function getInitials(name) {
  if (!name) return '🏪'
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

// ── Toggle ─────────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <TouchableOpacity
      onPress={() => onChange(!on)}
      style={[styles.toggleTrack, { backgroundColor: on ? '#2E7D32' : '#ccc' }]}
    >
      <View style={[styles.toggleThumb, { left: on ? 24 : 2 }]} />
    </TouchableOpacity>
  )
}

// ── Setting row ────────────────────────────────────────────────────────────
function SettingRow({ icon, title, subtitle, right, onPress, noBorder }) {
  return (
    <TouchableOpacity
      style={[styles.settingRow, noBorder && { borderBottomWidth: 0 }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.settingIcon}><Text style={{ fontSize: 18 }}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.settingTitle}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      <Text style={styles.settingChevron}>{right ?? '›'}</Text>
    </TouchableOpacity>
  )
}

function SectionLabel({ label }) {
  return <Text style={styles.sectionLabel}>{label}</Text>
}

// ── Language Picker Modal ──────────────────────────────────────────────────
function LangPicker({ visible, current, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Select Language</Text>
          <FlatList
            data={LANGUAGES}
            keyExtractor={item => item.key}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.pickerItem, item.key === current && styles.pickerItemActive]}
                onPress={() => { onSelect(item.key); onClose() }}
              >
                <Text style={[styles.pickerItemText, item.key === current && styles.pickerItemTextActive]}>
                  {item.label}
                </Text>
                {item.key === current && <Text style={{ color: '#00695C' }}>✓</Text>}
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  )
}

// ── Edit Modal ─────────────────────────────────────────────────────────────
function EditModal({ profile, onSave, onClose, language }) {
  const [name, setName] = useState(profile?.name || '')
  const [lang, setLang] = useState(profile?.language || 'hinglish')
  const [busy, setBusy] = useState(false)
  const [showLangPicker, setShowLangPicker] = useState(false)

  async function save() {
    setBusy(true)
    await onSave({ name, language: lang })
    setBusy(false)
  }

  const langLabel = LANGUAGES.find(l => l.key === lang)?.label || lang

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.editSheet} onStartShouldSetResponder={() => true}>
          <Text style={styles.editTitle}>{t('edit_profile', language)}</Text>

          <Text style={styles.editLabel}>{t('store_name', language)}</Text>
          <TextInput
            style={styles.editInput}
            value={name}
            onChangeText={setName}
            placeholder={t('store_name_ph', language)}
          />

          <Text style={[styles.editLabel, { marginTop: 14 }]}>{t('lang_setting', language)}</Text>
          <TouchableOpacity style={styles.editInput} onPress={() => setShowLangPicker(true)}>
            <Text style={{ fontSize: 14, color: '#1a1a1a' }}>{langLabel} ›</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
            <TouchableOpacity style={styles.btnOutline} onPress={onClose}>
              <Text style={{ color: '#555', fontWeight: '600' }}>{t('cancel', language)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnBlue} onPress={save} disabled={busy}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>
                {busy ? t('saving', language) : t('save_changes', language)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>

      <LangPicker
        visible={showLangPicker}
        current={lang}
        onSelect={setLang}
        onClose={() => setShowLangPicker(false)}
      />
    </Modal>
  )
}

// ── Plans Modal ────────────────────────────────────────────────────────────
function PlansModal({ onClose, language }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={[styles.pickerSheet, { maxHeight: '80%' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={styles.pickerTitle}>Choose a Plan</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ fontSize: 20, color: '#888' }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView>
            {PLANS.map(plan => (
              <View key={plan.id} style={[styles.planCard, { borderColor: plan.current ? plan.color : '#e8e8e8', borderWidth: plan.current ? 2 : 1.5 }]}>
                {plan.badge && (
                  <View style={[styles.planBadge, { backgroundColor: plan.color }]}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{plan.badge}</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <View>
                    <Text style={{ fontWeight: '800', fontSize: 16, color: plan.color }}>{plan.name}</Text>
                    {plan.current && <Text style={{ fontSize: 11, color: plan.color, fontWeight: '600' }}>✓ Current Plan</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontWeight: '800', fontSize: 20, color: '#1a1a2e' }}>{plan.price}</Text>
                    <Text style={{ fontSize: 11, color: '#888' }}>{plan.period}</Text>
                  </View>
                </View>
                {plan.features.map((f, i) => (
                  <Text key={i} style={{ fontSize: 12, color: '#555', lineHeight: 22 }}>✅ {f}</Text>
                ))}
                {!plan.current && (
                  <TouchableOpacity
                    style={[styles.upgBtn, { backgroundColor: plan.color }]}
                    onPress={() => Linking.openURL(`https://wa.me/917600000000?text=Upgrade to MoneyBook ${plan.name}`)}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Upgrade to {plan.name} →</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  )
}

// ── Main ProfileScreen ─────────────────────────────────────────────────────
export default function ProfileScreen({ phone, storeName, language, onLanguageChange, onLogout }) {
  const insets = useSafeAreaInsets()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [notifs,  setNotifs]  = useState(true)
  const [saved,   setSaved]   = useState(false)
  const [showPlans, setShowPlans] = useState(false)

  useEffect(() => {
    if (!phone) return
    fetchProfile(phone).then(p => setProfile(p)).catch(() => {}).finally(() => setLoading(false))
  }, [phone])

  async function handleSave({ name, language: lang }) {
    await updateProfile(phone, { name, language: lang })
    setProfile(p => ({ ...p, name, language: lang }))
    if (lang !== profile?.language && onLanguageChange) onLanguageChange(lang)
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const displayName = profile?.name || storeName || 'My Store'
  const segment = SEGMENT_LABELS[profile?.segment] || 'General Store'
  const langLabel = LANGUAGES.find(l => l.key === (language || profile?.language || 'hinglish'))?.label || 'Hinglish'

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={{ width: 32 }} />
        <Text style={styles.topBarTitle}>Profile</Text>
        <View style={{ width: 32, alignItems: 'flex-end' }}>
          {saved && <Text style={{ fontSize: 18 }}>✅</Text>}
        </View>
      </View>

      {/* Hero card */}
      <View style={{ padding: 14 }}>
        <View style={styles.heroCard}>
          {/* Decorative circles */}
          <View style={styles.decorCircle1} />
          <View style={styles.decorCircle2} />

          {/* Avatar */}
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <View style={styles.avatarWrap}>
              <Text style={styles.avatarText}>{loading ? '…' : getInitials(displayName)}</Text>
              <TouchableOpacity style={styles.editPencil} onPress={() => setEditing(true)}>
                <Text style={{ fontSize: 13 }}>✏️</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.heroName}>{loading ? '…' : displayName}</Text>
          <Text style={styles.heroSegment}>{loading ? '' : segment.toUpperCase()}</Text>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>{t('status_label', language)}</Text>
              <Text style={styles.statValue}>🟢 {t('active_label', language)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>{t('joined_label', language)}</Text>
              <Text style={styles.statValue}>{loading ? '…' : formatJoined(profile?.joined)}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Account Settings */}
      <SectionLabel label={t('section_account', language)} />
      <View style={styles.settingsCard}>
        <SettingRow icon="🌐" title={t('lang_setting', language)} subtitle={langLabel} onPress={() => setEditing(true)} />
        <SettingRow icon="💳" title={t('plan_title', language)} subtitle={t('plan_subtitle', language)} onPress={() => setShowPlans(true)} noBorder />
      </View>

      {/* Preferences */}
      <SectionLabel label={t('section_prefs', language)} />
      <View style={styles.settingsCard}>
        <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
          <View style={styles.settingIcon}><Text style={{ fontSize: 18 }}>🔔</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingTitle}>{t('notifs_title', language)}</Text>
            <Text style={styles.settingSubtitle}>{t('notifs_subtitle', language)}</Text>
          </View>
          <Toggle on={notifs} onChange={setNotifs} />
        </View>
      </View>

      {/* Support */}
      <SectionLabel label={t('section_support', language)} />
      <View style={styles.settingsCard}>
        <SettingRow
          icon="❓"
          title={t('help_title', language)}
          subtitle={t('help_subtitle', language)}
          right={<Text style={{ fontSize: 15 }}>↗</Text>}
          onPress={() => Linking.openURL('https://wa.me/917600000000?text=Help')}
        />
        <SettingRow icon="🔒" title={t('privacy_title', language)} subtitle={t('privacy_subtitle', language)} noBorder />
      </View>

      {/* Logout */}
      <View style={{ alignItems: 'center', paddingTop: 24 }}>
        <TouchableOpacity onPress={onLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>⇥ {t('logout', language)}</Text>
        </TouchableOpacity>
      </View>

      {/* Version */}
      <Text style={styles.version}>MONEYBOOK V1.0 • STORE EDITION</Text>

      {/* Modals */}
      {editing && (
        <EditModal
          profile={{ ...profile, language: language || profile?.language || 'hinglish' }}
          onSave={handleSave}
          onClose={() => setEditing(false)}
          language={language}
        />
      )}
      {showPlans && <PlansModal onClose={() => setShowPlans(false)} language={language} />}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingBottom: 0 },
  topBarTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a2e' },
  heroCard: {
    borderRadius: 20, padding: 28, paddingBottom: 24,
    alignItems: 'center', overflow: 'hidden',
    background: 'transparent',
    backgroundColor: '#00695C',
    position: 'relative',
  },
  decorCircle1: { position: 'absolute', top: -30, left: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.05)' },
  decorCircle2: { position: 'absolute', bottom: -20, right: -20, width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.06)' },
  avatarWrap: { width: 80, height: 80, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30, fontWeight: '700', color: '#fff' },
  editPencil: { position: 'absolute', bottom: -6, right: -6, width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  heroName: { color: '#fff', fontWeight: '700', fontSize: 20, marginBottom: 4, textAlign: 'center' },
  heroSegment: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginBottom: 18 },
  statsRow: { flexDirection: 'row', width: '100%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden' },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 8 },
  statLabel: { fontSize: 9, color: 'rgba(255,255,255,0.6)', fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  statValue: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#999', letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6, textTransform: 'uppercase' },
  settingsCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' },
  settingIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#EEF4FF', alignItems: 'center', justifyContent: 'center' },
  settingTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a2e' },
  settingSubtitle: { fontSize: 12, color: '#888', marginTop: 2 },
  settingChevron: { color: '#aaa', fontSize: 18 },
  toggleTrack: { width: 48, height: 26, borderRadius: 13, position: 'relative' },
  toggleThumb: { position: 'absolute', top: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', elevation: 3 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoutText: { color: '#D32F2F', fontWeight: '700', fontSize: 16 },
  version: { textAlign: 'center', fontSize: 11, color: '#bbb', letterSpacing: 1, paddingTop: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  editSheet: { backgroundColor: '#fff', borderRadius: 20, padding: 24, paddingBottom: 36, margin: 0 },
  editTitle: { fontWeight: '700', fontSize: 17, marginBottom: 20, color: '#1a1a2e' },
  editLabel: { fontSize: 12, color: '#888', fontWeight: '600', marginBottom: 6 },
  editInput: { width: '100%', borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1a1a1a' },
  btnBlue: { flex: 1, padding: 12, backgroundColor: '#1565C0', borderRadius: 10, alignItems: 'center' },
  btnOutline: { flex: 1, padding: 12, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#ddd', borderRadius: 10, alignItems: 'center' },
  pickerSheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, maxHeight: '60%' },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  pickerItem: { padding: 12, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between' },
  pickerItemActive: { backgroundColor: '#E8F5E9' },
  pickerItemText: { fontSize: 15, color: '#333' },
  pickerItemTextActive: { color: '#00695C', fontWeight: '700' },
  planCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, position: 'relative' },
  planBadge: { position: 'absolute', top: -10, right: 12, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10 },
  upgBtn: { marginTop: 12, padding: 10, borderRadius: 10, alignItems: 'center' },
})
