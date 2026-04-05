// ── TypingIndicator — converted from TypingIndicator.jsx ──────────────────
// Animated three-dot typing bubble (WhatsApp style)

import { useEffect, useRef } from 'react'
import { View, Animated, StyleSheet } from 'react-native'

function Dot({ delay }) {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -6, duration: 300, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0,  duration: 300, useNativeDriver: true }),
        Animated.delay(600 - delay),
      ])
    ).start()
  }, [])

  return (
    <Animated.View style={[styles.dot, { transform: [{ translateY: anim }] }]} />
  )
}

export default function TypingIndicator() {
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Dot delay={0}   />
        <Dot delay={150} />
        <Dot delay={300} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignItems: 'flex-end',
  },
  bubble: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#90A4AE',
    marginHorizontal: 2,
  },
})
