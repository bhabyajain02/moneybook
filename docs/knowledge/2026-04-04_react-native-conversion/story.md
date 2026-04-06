# The Story: MoneyBook Goes Mobile

## Part 1 — The Problem (For Everyone)

MoneyBook was a web app. You opened it in Chrome on your computer, typed in your transactions, and it recorded them. Simple. Powerful.

But there was a fundamental mismatch: the people who need MoneyBook most — small shopkeepers in India — don't sit at desktop computers. They stand at counters. They're handing change, answering questions, managing deliveries. Their computer *is* their phone.

So the task was clear: take everything MoneyBook does on the web, and make it run as a real Android/iOS app. Not a "mobile website" — a proper native app that installs on your phone, works with your camera, saves your session, and feels native.

The backend — the Python FastAPI server that runs Claude to understand natural language transactions, stores data in SQLite, handles photo OCR — that stays exactly as it is. It's already working and deployed. We only need a new *front door* for it: a React Native app instead of a React web app.

---

## Part 2 — The Plan (The Tech Stack)

### What is React Native?

React Native lets you write JavaScript (the same language as the web app) but instead of rendering HTML `<div>` and `<button>` elements, it renders native iOS and Android UI components. The logic stays the same; only the UI layer changes.

We chose **Expo** as our React Native toolchain. Expo wraps React Native and adds:
- A simple build/run system (`npm start` → QR code → app on phone in 30 seconds)
- Pre-built native modules (`expo-image-picker` for camera, `expo-linking` for URLs)
- EAS Build for production `.apk` and `.ipa` files without needing native compilers locally

### The Tech Stack

| Layer | Web | React Native |
|---|---|---|
| Framework | React 18 + Vite | React Native 0.74 + Expo 51 |
| Routing | CSS show/hide with `activeTab` state | @react-navigation/native v6 |
| Storage | `localStorage` (synchronous) | AsyncStorage (asynchronous) |
| Camera/files | `<input type="file">` | expo-image-picker |
| Animations | CSS @keyframes | `Animated.Value` + `Animated.loop` |
| Charts | Inline SVG `<rect>` | View-based proportional height bars |
| Dropdowns | `<select>` element | Modal + FlatList |
| Pop-ups | `window.confirm()` | `Alert.alert()` |
| External links | `window.open()` | `Linking.openURL()` |
| Status bar | Not needed | useSafeAreaInsets() |
| Build tooling | Vite | Metro (bundler) + EAS Build |

### What We Kept Identical

- All 20 API function signatures in `api.js` (just `BASE_URL` changed)
- All translation strings in `translations.js` (zero DOM dependencies, copied verbatim)
- All business logic: polling interval, confirm/cancel flows, ledger row math, dues grouping, analytics date filtering
- All UI structure: 4 main screens (Chat, Analytics, Dues, Profile) + all subcomponents

### What We Rejected

- **Expo Router** (file-based routing): Would require restructuring all screen files. React Navigation gives explicit control needed for the Login-gated navigation pattern.
- **MMKV** (faster key-value store): Not Expo-compatible without ejecting. AsyncStorage is fine for this data size.
- **react-native-svg for charts**: The bar charts are decorative mini-bars in cards. View-based implementation has zero cost and works perfectly.
- **Redux/Zustand**: Session info (phone, storeName, language) is the only global state. Prop drilling from App.js suffices.

---

## Part 3 — The Build (Everything That Happened)

### File 1: `package.json`

First, we defined the dependency manifest. Core packages:

```json
{
  "expo": "~51.0.0",
  "react-native": "0.74.1",
  "@react-navigation/native": "^6.1.17",
  "@react-navigation/bottom-tabs": "^6.5.20",
  "@react-navigation/native-stack": "^6.9.26",
  "@react-native-async-storage/async-storage": "1.23.1",
  "expo-image-picker": "~15.0.7",
  "react-native-safe-area-context": "4.10.5",
  "react-native-screens": "3.31.1",
  "react-native-svg": "15.2.0"
}
```

### File 2: `app.json`

Expo configuration. Key decisions:
- App name: "MoneyBook"
- Slug: "moneybook"
- Splash screen color: `#00695C` (same teal as the web app header)
- Camera + photo library permissions configured via `expo-image-picker` plugin
- `android.package`: `com.moneybook.app`
- `ios.bundleIdentifier`: `com.moneybook.app`

### File 3: `src/config.js` (NEW — no web equivalent)

This file didn't exist in the web app because the web app is served from the same origin as the backend (`/api` is relative). For a mobile app, you need an absolute URL.

```js
// Commented options for each deployment scenario:
// Android emulator: http://10.0.2.2:8000/api
// iOS simulator: http://localhost:8000/api
// Physical device: http://192.168.1.100:8000/api (LAN IP)
// Production: https://your-app.railway.app/api
export const BASE_URL = 'https://YOUR_BACKEND_URL/api'
```

### File 4: `src/storage.js` (NEW)

A thin wrapper that matches the `localStorage` API surface, backed by AsyncStorage:

```js
import AsyncStorage from '@react-native-async-storage/async-storage'

export const storage = {
  getItem:    (key)        => AsyncStorage.getItem(key),
  setItem:    (key, value) => AsyncStorage.setItem(key, String(value)),
  removeItem: (key)        => AsyncStorage.removeItem(key),
}

export const LS_KEY  = 'moneybook_phone'
export const LS_NAME = 'moneybook_store_name'
export const LS_LANG = 'moneybook_lang'
```

The key insight: AsyncStorage is async. The web app could do `localStorage.getItem('key')` synchronously in a `useState` initializer. AsyncStorage requires `await`. This changed how App.js initializes: it now has a `loading` state and renders a spinner until the session is resolved.

### File 5: `App.js`

The root navigator. The key pattern:

```js
// Session loaded asynchronously from AsyncStorage
const [session, setSession] = useState(null)
const [loading, setLoading] = useState(true)

useEffect(() => {
  async function loadSession() {
    const phone = await storage.getItem(LS_KEY)
    const name  = await storage.getItem(LS_NAME)
    const lang  = await storage.getItem(LS_LANG)
    if (phone && name) setSession({ phone, storeName: name, language: lang || 'en' })
    setLoading(false)
  }
  loadSession()
}, [])

// Navigator structure
<SafeAreaProvider>
  <NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!session ? (
        <Stack.Screen name="Login">
          {props => <LoginScreen {...props} onLogin={handleLogin} />}
        </Stack.Screen>
      ) : (
        <Stack.Screen name="Main">
          {props => <MainTabs {...props} session={session} onLogout={handleLogout} />}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  </NavigationContainer>
</SafeAreaProvider>
```

The `MainTabs` component sets up the bottom tab navigator with emoji tab icons and passes session down to each screen.

### File 6: `src/api.js`

Identical logic to `webapp/src/api.js` with two changes:

1. `import { BASE_URL } from './config'` → `const BASE = BASE_URL`
2. Image upload FormData format:
   ```js
   // Web: formData.append('file', fileObject)  ← File API
   // RN:
   formData.append('file', {
     uri:  fileUri,          // 'file:///...' local path from expo-image-picker
     name: 'photo.jpg',
     type: 'image/jpeg',
   })
   ```
   This is critical — React Native's fetch doesn't understand the browser `File` API. The `{ uri, name, type }` object is the correct FormData format for native file uploads.

### File 7: `screens/LoginScreen.js`

Web had a grid of language flags rendered with CSS grid. React Native version:
- Root: `KeyboardAvoidingView` (moves content up when keyboard appears)
- Phone input: `TextInput` with `keyboardType="numeric"` and `maxLength={10}`
- Language selection: Array of `TouchableOpacity` pills in a `View` with `flexWrap: 'wrap'`
- Session persistence: saves language to AsyncStorage on change
- Safe area: `useSafeAreaInsets()` adds `paddingTop: insets.top` to the header

### File 8: `screens/ChatScreen.js`

This was the most complex conversion — the web `ChatWindow.jsx` was ~600 lines. Key patterns:

**Message list:**
```js
<FlatList
  ref={flatRef}
  data={messages}
  renderItem={({ item }) => <MessageBubble message={item} ... />}
  keyExtractor={m => m.id?.toString() || m.timestamp}
  onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
/>
```

**Polling:**
```js
useEffect(() => {
  fetchMessages()
  const interval = setInterval(fetchMessages, 3000)
  return () => clearInterval(interval)  // cleanup on unmount
}, [phone])
```

**Language picker:** Web used a `<select>`. RN uses a `Modal` with `FlatList` of language options — same pattern repeated throughout the app.

**Clear chat confirmation:**
```js
// Web: if (window.confirm('Clear all messages?')) { ... }
// RN:
Alert.alert('Clear Chat', 'Delete all messages?', [
  { text: 'Cancel', style: 'cancel' },
  { text: 'Clear', style: 'destructive', onPress: handleClear },
])
```

### File 9: `screens/AnalyticsScreen.js`

The most visually challenging conversion. Web used inline SVG:
```jsx
<svg>
  {bars.map(b => <rect key={b.label} x={...} y={...} width={barW} height={barH} fill={b.color} />)}
</svg>
```

React Native version uses proportional View heights:
```jsx
function MiniBars({ bars }) {
  const maxVal = Math.max(...bars.map(b => b.value), 1)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 40 }}>
      {bars.map((b, i) => (
        <View key={i} style={{
          width: 10,
          height: Math.max(2, (b.value / maxVal) * 40),
          backgroundColor: b.color,
          borderRadius: 2,
          marginRight: 3,
        }} />
      ))}
    </View>
  )
}
```
The `alignItems: 'flex-end'` on the container makes bars "grow upward" — shorter bars are bottom-aligned. Same visual result as SVG, zero dependencies.

Date range input uses `TextInput` (YYYY-MM-DD format) instead of `<input type="date">` since React Native has no native date picker (would need `@react-native-community/datetimepicker`).

### File 10: `screens/DuesScreen.js`

The web `DuesPage.jsx` had inline SVG for avatar icons:
```jsx
<svg viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="20" fill={color} />
  <text x="20" y="26" textAnchor="middle" fill="white">{initial}</text>
</svg>
```

React Native version uses emoji in a colored `View`:
```jsx
function AvatarIcon({ type }) {
  const emoji = type === 'store_expense' ? '🏪' : '👤'
  return (
    <View style={[styles.avatar, { backgroundColor: type === 'store_expense' ? '#795548' : '#2196F3' }]}>
      <Text style={{ fontSize: 20 }}>{emoji}</Text>
    </View>
  )
}
```

The main/sub tab structure (Dues tab → Pending/Received sub-tabs, Staff tab → Staff list) is all rendered as in-screen `TouchableOpacity` tab buttons — no nested navigator needed.

### File 11: `screens/ProfileScreen.js`

Key patterns:
- `Linking.openURL('https://wa.me/...')` for WhatsApp contact button
- Language picker: Modal + FlatList (same pattern as ChatScreen)
- Plans modal: Modal with tier cards
- Toggle component built from scratch with `Animated.Value` and `TouchableOpacity`:
  ```js
  function Toggle({ value, onChange }) {
    const anim = useRef(new Animated.Value(value ? 1 : 0)).current
    const handlePress = () => {
      const next = !value
      Animated.timing(anim, { toValue: next ? 1 : 0, duration: 200, useNativeDriver: false }).start()
      onChange(next)
    }
    const thumbLeft = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 22] })
    return (
      <TouchableOpacity onPress={handlePress} style={[styles.track, value && styles.trackOn]}>
        <Animated.View style={[styles.thumb, { left: thumbLeft }]} />
      </TouchableOpacity>
    )
  }
  ```

### File 12: `components/MessageBubble.js`

The web `MessageBubble.jsx` used `dangerouslySetInnerHTML` for bold/italic formatting. React Native can't inject HTML. Solution: `FormatText` component with regex parsing:

```js
function FormatText({ text, style }) {
  const parts = []
  const regex = /(\*\*[^*]+\*\*|_[^_]+_)/g
  let last = 0
  text.replace(regex, (match, _, offset) => {
    if (offset > last) parts.push({ text: text.slice(last, offset), bold: false, italic: false })
    if (match.startsWith('**')) parts.push({ text: match.slice(2, -2), bold: true })
    else parts.push({ text: match.slice(1, -1), italic: true })
    last = offset + match.length
  })
  if (last < text.length) parts.push({ text: text.slice(last), bold: false, italic: false })
  return (
    <Text style={style}>
      {parts.map((p, i) => (
        <Text key={i} style={[p.bold && { fontWeight: '700' }, p.italic && { fontStyle: 'italic' }]}>
          {p.text}
        </Text>
      ))}
    </Text>
  )
}
```

The `SavedCard` two-column layout uses `flexDirection: 'row'` Views instead of CSS grid.

### File 13: `components/ConfirmCard.js`

The `TypePicker` replacement for `<select>` was the most reused pattern in the whole conversion:

```js
function TypePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.typeBtn}>
        <Text>{value} ▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <FlatList
              data={ALL_TYPES}
              keyExtractor={t => t}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => { onChange(item); setOpen(false) }} style={styles.item}>
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

`nestedScrollEnabled` on the transaction list ScrollView is needed on Android when a ScrollView is inside another ScrollView.

### File 14: `components/InputBar.js`

The camera integration:
```js
import * as ImagePicker from 'expo-image-picker'

async function handleCamera() {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Please allow photo access.')
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

The `TextInput multiline` auto-grows via `maxHeight`:
```js
<TextInput
  multiline
  style={[styles.input, { maxHeight: 120 }]}
  value={text}
  onChangeText={setText}
  placeholder="Type a message..."
/>
```

### File 15: `components/TypingIndicator.js`

Three animated dots with staggered delays:
```js
function Dot({ delay }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -6, duration: 300, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0,  duration: 300, useNativeDriver: true }),
        Animated.delay(600),
      ])
    ).start()
  }, [])
  return (
    <Animated.View style={[styles.dot, { transform: [{ translateY: anim }] }]} />
  )
}

export default function TypingIndicator() {
  return (
    <View style={styles.container}>
      <Dot delay={0} />
      <Dot delay={150} />
      <Dot delay={300} />
    </View>
  )
}
```

`useNativeDriver: true` is critical — it offloads the animation to the native thread, preventing JS thread jank during heavy render cycles (like receiving new messages).

### Files 16-17: `LedgerEntry.js` + `PersonClassifyWidget.js`

Both converted as full-screen Modals (`animationType="slide"`). The two-column ledger grid uses `flexDirection: 'row'` with a 1px `View` divider:
```js
<View style={{ flexDirection: 'row' }}>
  <View style={{ flex: 1 }}>  {/* IN column */}
    {inRows.map(...)}
  </View>
  <View style={{ width: 1, backgroundColor: '#e0e0e0' }} />  {/* divider */}
  <View style={{ flex: 1 }}>  {/* OUT column */}
    {outRows.map(...)}
  </View>
</View>
```

PersonClassifyWidget uses a nested `Modal` within the outer `Modal` for the staff picker bottom sheet — React Native allows this pattern.

### File 18: `README.md`

Complete setup guide covering:
- Config → Install → Run → Physical device → Production build
- Web vs RN comparison table
- Backend deployment options (Railway, Render, local)

---

## Part 4 — The Lessons

### For the 10-Year-Old
If you want to take a website and put it on a phone, you have to swap every "computer piece" for a matching "phone piece." The pieces do the same thing, they just have different names. The hardest part isn't the code — it's knowing *which piece goes where*.

### For the CS Graduate
The biggest architectural change isn't any single component — it's the shift from synchronous to asynchronous session management. Web `localStorage` is synchronous and can initialize `useState`. AsyncStorage is Promise-based, which cascades into a loading state pattern that every screen depends on. Get that right first, and everything else follows.

### For the Senior Engineer
The SVG-to-View and select-to-Modal patterns reveal a deeper truth: React Native is not "React for phones" — it's a completely different rendering target that happens to share React's component model. Every assumption you have about browser APIs (File, SVG, select, localStorage, position: fixed) must be explicitly re-evaluated. The conversion is successful when every web primitive has been consciously replaced with its native equivalent, not when the code "looks similar."

---

## Rebuild in One Paragraph

MoneyBook's web frontend (`webapp/src/`) was converted to React Native Expo (`moneybook-rn/`) by creating 21 files: `App.js` (session loading from AsyncStorage, Stack + BottomTab navigation), `src/config.js` (BASE_URL for backend), `src/storage.js` (AsyncStorage wrapper), `src/api.js` (all 20 API calls with FormData uri format for images), `src/translations.js` (verbatim copy), 5 screens (`LoginScreen`, `ChatScreen`, `AnalyticsScreen`, `DuesScreen`, `ProfileScreen`), and 7 components (`MessageBubble`, `ConfirmCard`, `InputBar`, `QuickReplies`, `TypingIndicator`, `LedgerEntry`, `PersonClassifyWidget`). Key conversions: localStorage → AsyncStorage, CSS show/hide → React Navigation, `<input type="file">` → expo-image-picker, `<select>` → Modal+FlatList, SVG bars → View-based proportional heights, CSS @keyframes → Animated.Value loop, `window.confirm` → Alert.alert, `window.open` → Linking.openURL. The backend (FastAPI + SQLite) was not touched. To run: set `BASE_URL` in `src/config.js`, run `npm install`, then `npm start` and scan the QR with Expo Go — or `npm run android`/`npm run ios` for emulators.
