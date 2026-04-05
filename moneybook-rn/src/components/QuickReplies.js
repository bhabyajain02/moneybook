// ── QuickReplies — converted from QuickReplies.jsx ────────────────────────

import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'

export default function QuickReplies({ chips, onSend }) {
  if (!chips || chips.length === 0) return null
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {chips.map((c, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.chip, c.type === 'confirm' && styles.chipConfirm, c.type === 'danger' && styles.chipDanger]}
          onPress={() => onSend(c.value)}
        >
          <Text style={[styles.chipText, c.type === 'confirm' && styles.chipTextConfirm, c.type === 'danger' && styles.chipTextDanger]}>
            {c.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    flexShrink: 0,
  },
  content: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#00695C',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  chipConfirm: {
    backgroundColor: '#00695C',
    borderColor: '#00695C',
  },
  chipDanger: {
    borderColor: '#E53935',
    backgroundColor: '#fff',
  },
  chipText: {
    color: '#00695C',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextConfirm: {
    color: '#fff',
  },
  chipTextDanger: {
    color: '#E53935',
  },
})
