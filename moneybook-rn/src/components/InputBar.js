// ── InputBar — converted from InputBar.jsx ────────────────────────────────
// Changes: hidden file input → expo-image-picker, textarea → TextInput multiline,
// SVG icons → emoji Text fallbacks

import { useState } from 'react'
import {
  View, TextInput, TouchableOpacity, Text, StyleSheet, Alert
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { t } from '../translations'

export default function InputBar({ onSend, onImage, onLedger, disabled, language }) {
  const [text, setText] = useState('')

  function submit() {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  async function handleCamera() {
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to send images.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    })
    if (!result.canceled && result.assets?.[0]) {
      onImage(result.assets[0].uri)
    }
  }

  return (
    <View style={styles.container}>
      {/* Ledger entry button */}
      {onLedger && (
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={onLedger}
          disabled={disabled}
        >
          <Text style={styles.iconEmoji}>📋</Text>
        </TouchableOpacity>
      )}

      {/* Camera / image picker */}
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={handleCamera}
        disabled={disabled}
      >
        <Text style={styles.iconEmoji}>📷</Text>
      </TouchableOpacity>

      {/* Text input */}
      <TextInput
        style={styles.input}
        placeholder={t('placeholder_msg', language)}
        placeholderTextColor="#aaa"
        value={text}
        onChangeText={setText}
        multiline
        maxHeight={90}
        onSubmitEditing={submit}
        editable={!disabled}
        returnKeyType="send"
        blurOnSubmit={false}
      />

      {/* Send button */}
      <TouchableOpacity
        style={[styles.sendBtn, (!text.trim() || disabled) && styles.sendBtnDisabled]}
        onPress={submit}
        disabled={!text.trim() || disabled}
      >
        <Text style={styles.sendIcon}>▶</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#f0f0f0',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  iconEmoji: {
    fontSize: 22,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 90,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1a1a1a',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00695C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#ccc',
  },
  sendIcon: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
})
