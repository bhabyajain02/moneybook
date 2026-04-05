// ── PersonClassifyWidget — converted from PersonClassifyWidget.jsx ─────────
// Lets user classify persons as Staff / Customer / Supplier / Home after photo scan

import { useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Modal,
  FlatList, TextInput,
} from 'react-native'
import { t } from '../translations'

const CATEGORIES = [
  { key: 'staff',        label: '👷 Staff',        color: '#FF9800', desc: 'Employee / worker' },
  { key: 'customer',     label: '🛒 Customer',      color: '#2196F3', desc: 'Buyer / client' },
  { key: 'supplier',     label: '📦 Supplier',      color: '#9C27B0', desc: 'Vendor / supplier' },
  { key: 'store_expense',label: '🏪 Store Expense', color: '#795548', desc: 'Store cost / expense' },
  { key: 'home',         label: '🏠 Ghar',          color: '#E91E63', desc: 'Personal / family' },
]

export default function PersonClassifyWidget({ persons, staffOptions, onComplete, onCancel, language }) {
  // classifications: { [personName]: { category, staffName? } }
  const [classifications, setClassifications] = useState(
    () => Object.fromEntries(persons.map(p => [p.name, { category: null, staffName: null }]))
  )
  const [currentIdx, setCurrentIdx] = useState(0)
  const [showStaffPick, setShowStaffPick] = useState(false)

  const current = persons[currentIdx]
  const currentClass = classifications[current?.name] || {}
  const allDone = persons.every(p => classifications[p.name]?.category !== null)

  function setCategory(personName, category) {
    setClassifications(prev => ({ ...prev, [personName]: { ...prev[personName], category } }))
    if (category === 'staff' && staffOptions.length > 0) {
      setShowStaffPick(true)
    } else if (currentIdx < persons.length - 1) {
      setCurrentIdx(i => i + 1)
    }
  }

  function setStaffName(name) {
    setClassifications(prev => ({
      ...prev,
      [current.name]: { ...prev[current.name], staffName: name }
    }))
    setShowStaffPick(false)
    if (currentIdx < persons.length - 1) setCurrentIdx(i => i + 1)
  }

  function handleDone() {
    if (!allDone) return
    onComplete(classifications)
  }

  if (!current) return null

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Who is this person?</Text>
          <Text style={styles.headerSub}>{currentIdx + 1} of {persons.length}</Text>
        </View>

        {/* Progress dots */}
        <View style={styles.progressDots}>
          {persons.map((_, i) => (
            <View key={i} style={[styles.dot, i === currentIdx && styles.dotActive, i < currentIdx && classifications[persons[i].name]?.category && styles.dotDone]} />
          ))}
        </View>

        {/* Person info */}
        <View style={styles.personCard}>
          <Text style={styles.personName}>{current.name}</Text>
          {current.description && (
            <Text style={styles.personDesc}>{current.description}</Text>
          )}
          {current.amount > 0 && (
            <Text style={styles.personAmount}>₹{parseFloat(current.amount).toLocaleString('en-IN')}</Text>
          )}
        </View>

        {/* Category options */}
        <Text style={styles.selectLabel}>Select category:</Text>
        {CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.catBtn, currentClass.category === cat.key && { borderColor: cat.color, backgroundColor: cat.color + '15' }]}
            onPress={() => setCategory(current.name, cat.key)}
          >
            <View style={[styles.catIcon, { backgroundColor: cat.color + '20' }]}>
              <Text style={{ fontSize: 20 }}>{cat.label.split(' ')[0]}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.catLabel, currentClass.category === cat.key && { color: cat.color }]}>
                {cat.label}
              </Text>
              <Text style={styles.catDesc}>{cat.desc}</Text>
            </View>
            {currentClass.category === cat.key && <Text style={[styles.catCheck, { color: cat.color }]}>✓</Text>}
          </TouchableOpacity>
        ))}

        {/* Navigation */}
        <View style={styles.navRow}>
          {currentIdx > 0 && (
            <TouchableOpacity style={styles.prevBtn} onPress={() => setCurrentIdx(i => i - 1)}>
              <Text style={styles.prevBtnText}>← Prev</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          {allDone && (
            <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
              <Text style={styles.doneBtnText}>Done →</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Staff picker bottom sheet */}
        <Modal visible={showStaffPick} transparent animationType="slide" onRequestClose={() => setShowStaffPick(false)}>
          <TouchableOpacity style={styles.staffOverlay} activeOpacity={1} onPress={() => { setShowStaffPick(false); if (currentIdx < persons.length - 1) setCurrentIdx(i => i + 1) }}>
            <View style={styles.staffSheet}>
              <Text style={styles.staffTitle}>Is this an existing staff member?</Text>
              <TouchableOpacity style={styles.staffNewItem} onPress={() => setStaffName(current.name)}>
                <Text style={{ color: '#00695C', fontWeight: '600' }}>➕ New staff member: {current.name}</Text>
              </TouchableOpacity>
              {staffOptions.map(name => (
                <TouchableOpacity key={name} style={styles.staffItem} onPress={() => setStaffName(name)}>
                  <Text style={styles.staffItemText}>👷 {name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  header: { backgroundColor: '#00695C', padding: 20, paddingTop: 50, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 4 },
  progressDots: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 12, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ddd' },
  dotActive: { backgroundColor: '#00695C', width: 20 },
  dotDone: { backgroundColor: '#A5D6A7' },
  personCard: { margin: 16, backgroundColor: '#fff', borderRadius: 14, padding: 18, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
  personName: { fontSize: 22, fontWeight: '800', color: '#1a1a1a', marginBottom: 4 },
  personDesc: { fontSize: 14, color: '#666', marginBottom: 4 },
  personAmount: { fontSize: 16, fontWeight: '700', color: '#E53935' },
  selectLabel: { fontSize: 13, fontWeight: '600', color: '#888', paddingHorizontal: 16, marginBottom: 8 },
  catBtn: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, padding: 14, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e0e0', elevation: 1 },
  catIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  catDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  catCheck: { fontSize: 18, fontWeight: '700' },
  navRow: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16, gap: 10, marginTop: 'auto' },
  prevBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#00695C' },
  prevBtnText: { color: '#00695C', fontWeight: '600' },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#ccc' },
  cancelBtnText: { color: '#888', fontWeight: '600' },
  doneBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#00695C' },
  doneBtnText: { color: '#fff', fontWeight: '700' },
  staffOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  staffSheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, maxHeight: '60%' },
  staffTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 14 },
  staffNewItem: { padding: 12, borderRadius: 8, backgroundColor: '#E8F5E9', marginBottom: 8 },
  staffItem: { padding: 12, borderRadius: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  staffItemText: { fontSize: 15, color: '#333' },
})
