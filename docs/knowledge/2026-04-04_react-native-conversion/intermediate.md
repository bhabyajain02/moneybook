# MoneyBook React Native Conversion — Intermediate Guide

## Overview

This document covers the complete conversion of MoneyBook's React + Vite web frontend to a React Native (Expo) mobile app. The backend (FastAPI + SQLite) was **not modified**. All 21 files were created from scratch based on the existing web source in `webapp/src/`.

---

## Environment Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI (installed via `npm install -g expo-cli` or just use `npx expo`)
- Android Studio (for Android emulator) OR Xcode (for iOS simulator, Mac only)
- Expo Go app on a physical device (optional, for quick testing)

### Installation
```bash
cd moneybook-rn
npm install
```

### Running
```bash
# Start Expo dev server (Metro bundler)
npm start           # or: npx expo start

# Run on Android emulator
npm run android     # or: npx expo run:android

# Run on iOS simulator (Mac only)
npm run ios         # or: npx expo run:ios

# Scan QR code with Expo Go on physical device
npm start           # then scan the QR
```

### Configuration
Before running, set your backend URL in `src/config.js`:
```js
// Android emulator (maps to localhost on host machine)
export const BASE_URL = 'http://10.0.2.2:8000/api'

// iOS simulator
export const BASE_URL = 'http://localhost:8000/api'

// Physical device (replace with your computer's LAN IP)
export const BASE_URL = 'http://192.168.1.100:8000/api'

// Production (Railway/Render/etc.)
export const BASE_URL = 'https://your-app.railway.app/api'
```

---

## Directory Structure

```
moneybook-rn/
├── App.js                          ← Root: session loader + Stack + BottomTab navigator
├── app.json                        ← Expo config (app name, icons, permissions)
├── package.json                    ← npm dependencies
├── babel.config.js                 ← Standard Expo Babel config
└── src/
    ├── config.js                   ← BASE_URL — only file to edit per deployment
    ├── api.js                      ← All 20 API functions (BASE_URL instead of /api)
    ├── translations.js             ← Copied verbatim from webapp (no DOM deps)
    ├── storage.js                  ← AsyncStorage wrapper (drop-in for localStorage)
    ├── screens/
    │   ├── LoginScreen.js          ← Phone + store name login, language picker
    │   ├── ChatScreen.js           ← Full chat: polling, send, image, confirm, classify
    │   ├── AnalyticsScreen.js      ← Expense/collection charts + date range
    │   ├── DuesScreen.js           ← Dues + Staff tracker with tabs
    │   └── ProfileScreen.js        ← Store profile, settings, plans
    └── components/
        ├── MessageBubble.js        ← Chat bubble: user/bot/ConfirmCard/SavedCard
        ├── ConfirmCard.js          ← Edit + confirm parsed transactions
        ├── InputBar.js             ← Text input + camera + ledger button
        ├── QuickReplies.js         ← Horizontal chip row
        ├── TypingIndicator.js      ← Animated 3-dot bounce indicator
        ├── LedgerEntry.js          ← Manual entry + photo review modal
        └── PersonClassifyWidget.js ← Staff/Customer/Supplier/Home classifier
```

---

## Dependencies

```json
{
  "expo": "~51.0.0",
  "react": "18.2.0",
  "react-native": "0.74.1",
  "@react-navigation/native": "^6.1.17",
  "@react-navigation/bottom-tabs": "^6.5.20",
  "@react-navigation/native-stack": "^6.9.26",
  "@react-native-async-storage/async-storage": "1.23.1",
  "expo-image-picker": "~15.0.7",
  "expo-linking": "~6.3.1",
  "react-native-safe-area-context": "4.10.5",
  "react-native-screens": "3.31.1",
  "react-native-svg": "15.2.0"
}
```

---

## Key Architectural Changes

### 1. Storage: localStorage → AsyncStorage

**Web (`webapp/src/App.jsx`):**
```js
const savedPhone = localStorage.getItem('moneybook_phone')
localStorage.setItem('moneybook_phone', phone)
```

**React Native (`src/storage.js` + `App.js`):**
```js
// storage.js — wrapper with same API shape
import AsyncStorage from '@react-native-async-storage/async-storage'
export const storage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, String(value)),
  removeItem: (key) => AsyncStorage.removeItem(key),
}

// App.js — session loaded in useEffect (async)
const [loading, setLoading] = useState(true)
useEffect(() => {
  async function loadSession() {
    const phone = await storage.getItem(LS_KEY)
    const name = await storage.getItem(LS_NAME)
    const lang = await storage.getItem(LS_LANG)
    if (phone && name) setSession({ phone, storeName: name, language: lang || 'en' })
    setLoading(false)
  }
  loadSession()
}, [])
```
Key difference: AsyncStorage is asynchronous, so App.js has a `loading` state and shows a spinner until session is resolved.

---

### 2. Navigation: CSS show/hide → React Navigation

**Web:** Pages toggled with `activeTab` state and CSS `display: none / block`.

**React Native:** Proper navigator hierarchy:
```js
// App.js
<NavigationContainer>
  <Stack.Navigator>
    {!session ? (
      <Stack.Screen name="Login" component={LoginScreen} />
    ) : (
      <Stack.Screen name="Main" component={MainTabs} />
    )}
  </Stack.Navigator>
</NavigationContainer>

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: '#00695C' }}>
      <Tab.Screen name="Chat"      component={ChatScreen}      options={{ tabBarIcon: () => <Text>💬</Text> }} />
      <Tab.Screen name="Analytics" component={AnalyticsScreen} options={{ tabBarIcon: () => <Text>📊</Text> }} />
      <Tab.Screen name="Dues"      component={DuesScreen}      options={{ tabBarIcon: () => <Text>👥</Text> }} />
      <Tab.Screen name="Profile"   component={ProfileScreen}   options={{ tabBarIcon: () => <Text>👤</Text> }} />
    </Tab.Navigator>
  )
}
```

---

### 3. File Input → expo-image-picker

**Web (`InputBar.jsx`):**
```jsx
<input type="file" accept="image/*" ref={fileRef} onChange={handleFileChange} style={{ display: 'none' }} />
```

**React Native (`InputBar.js`):**
```js
import * as ImagePicker from 'expo-image-picker'

async function handleCamera() {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Please allow photo access to send images.')
    return
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  })
  if (!result.canceled && result.assets[0]) {
    onSendImage(result.assets[0].uri)
  }
}
```

---

### 4. Image Upload FormData: File object → { uri, name, type }

**Web (`api.js`):**
```js
formData.append('file', fileObject)  // File object from <input>
```

**React Native (`api.js`):**
```js
formData.append('file', {
  uri: fileUri,           // Local file URI from expo-image-picker
  name: 'photo.jpg',
  type: 'image/jpeg',
})
```

---

### 5. SVG → View-based bar charts

**Web (`AnalyticsPage.jsx`):**
```jsx
<svg width={w} height={h}>
  {bars.map((b, i) => <rect key={i} x={...} y={...} width={barW} height={barH} fill={b.color} />)}
</svg>
```

**React Native (`AnalyticsScreen.js`):**
```jsx
function MiniBars({ bars }) {
  const maxVal = Math.max(...bars.map(b => b.value), 1)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 40, gap: 3 }}>
      {bars.map((b, i) => (
        <View key={i} style={{
          width: 10,
          height: Math.max(2, (b.value / maxVal) * 40),
          backgroundColor: b.color,
          borderRadius: 2,
        }} />
      ))}
    </View>
  )
}
```

---

### 6. Select Dropdowns → Modal + FlatList

**Web (`ConfirmCard.jsx`):**
```jsx
<select value={txn.type} onChange={e => updateType(e.target.value)}>
  {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
</select>
```

**React Native (`ConfirmCard.js`):**
```jsx
function TypePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.typeBtn}>
        <Text style={styles.typeBtnText}>{value} ▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <FlatList
              data={ALL_TYPES}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => { onChange(item); setOpen(false) }} style={styles.typeItem}>
                  <Text>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}
```

---

### 7. Animated Typing Indicator

**Web:** Pure CSS animation with `@keyframes bounce`.

**React Native (`TypingIndicator.js`):**
```js
function Dot({ delay }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -6, duration: 300, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(600),
      ])
    ).start()
  }, [])
  return <Animated.View style={[styles.dot, { transform: [{ translateY: anim }] }]} />
}
```

---

### 8. window.confirm / window.open replacements

| Web | React Native |
|---|---|
| `window.confirm('Are you sure?')` | `Alert.alert('Title', 'Message', [{ text: 'Cancel' }, { text: 'OK', onPress: fn }])` |
| `window.open(url, '_blank')` | `import { Linking } from 'react-native'; Linking.openURL(url)` |

---

## API Functions (Complete List)

All 20 functions in `api.js` — identical logic to web, only `BASE_URL` changed:

| Function | Endpoint | Purpose |
|---|---|---|
| `checkPhone(phone)` | GET `/check_phone/{phone}` | Check if phone registered |
| `getMessages(phone)` | GET `/messages/{phone}` | Fetch chat history |
| `sendMessage(phone, text, lang)` | POST `/message` | Send text message |
| `sendImage(phone, uri, lang)` | POST `/message` (multipart) | Send photo |
| `confirmTransaction(phone, msgId, confirmed)` | POST `/confirm` | Confirm/reject transaction |
| `cancelTransaction(phone, msgId)` | POST `/cancel` | Cancel transaction |
| `deleteMessage(phone, msgId)` | POST `/delete_message` | Delete saved transaction |
| `getProfile(phone)` | GET `/profile/{phone}` | Get store profile |
| `updateProfile(phone, data)` | POST `/profile/{phone}` | Update profile |
| `getAnalytics(phone, start, end)` | GET `/analytics/{phone}` | Get expense analytics |
| `getDues(phone)` | GET `/dues/{phone}` | Get dues list |
| `confirmDue(phone, msgId, confirmed)` | POST `/confirm_due` | Confirm dues transaction |
| `getStaff(phone)` | GET `/staff/{phone}` | Get staff list |
| `classifyLedger(phone, date, rows, lang)` | POST `/classify_ledger` | Classify manual entries |
| `confirmLedger(phone, txns, msgId)` | POST `/confirm_ledger` | Confirm ledger entries |
| `classifyPersons(phone, persons, lang)` | POST `/classify_persons` | Classify photo persons |
| `confirmPhotoEntry(phone, txns, msgId)` | POST `/confirm_photo` | Confirm photo transactions |
| `clearChat(phone)` | POST `/clear_chat` | Clear all messages |
| `getPlans()` | GET `/plans` | Get plan options |
| `upgradePlan(phone, plan)` | POST `/upgrade_plan` | Upgrade subscription |

---

## Safe Area Handling

Uses `useSafeAreaInsets()` from `react-native-safe-area-context` to respect device notch and home indicator:
```js
import { useSafeAreaInsets } from 'react-native-safe-area-context'

function LoginScreen() {
  const insets = useSafeAreaInsets()
  return (
    <KeyboardAvoidingView style={{ paddingTop: insets.top, flex: 1 }}>
      ...
    </KeyboardAvoidingView>
  )
}
```

In `App.js`, the `NavigationContainer` is wrapped with `SafeAreaProvider`.

---

## Permissions Required

Declared in `app.json`:
```json
{
  "expo": {
    "plugins": [
      ["expo-image-picker", {
        "photosPermission": "MoneyBook needs access to your photos to scan ledger entries.",
        "cameraPermission": "MoneyBook needs camera access to scan ledger entries."
      }]
    ]
  }
}
```
Requested at runtime via `ImagePicker.requestMediaLibraryPermissionsAsync()` before any image action.

---

## Production Build

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android   # → .apk or .aab
eas build --platform ios       # → .ipa (requires Apple Developer account)
```
