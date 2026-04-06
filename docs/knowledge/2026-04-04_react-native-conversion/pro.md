# MoneyBook React Native Conversion — Pro Reference

## Architecture Decision Records (ADRs)

### ADR-001: Expo vs Bare React Native
**Rejected:** Bare React Native (`react-native init`)
**Chosen:** Expo (`~51.0.0`)
**Why:** The project has no native modules that require custom native code. Expo provides `expo-image-picker` with permission handling, OTA updates via EAS, and dramatically simpler CI/CD (EAS Build). The cost of ejecting later is low. Going bare adds toolchain complexity with no benefit at this scale.

### ADR-002: React Navigation vs Expo Router
**Rejected:** Expo Router (file-based routing, ~Expo 50+)
**Chosen:** `@react-navigation/native` v6 with `native-stack` + `bottom-tabs`
**Why:** Expo Router uses a file-system convention that would require restructuring the entire `src/screens/` layout. React Navigation gives explicit control over the navigator hierarchy needed for the Login → MainTabs conditional stack pattern. The session-gated navigation (show Login if no session, MainTabs if session exists) is cleaner in explicit navigator config than file-based routing.

### ADR-003: AsyncStorage vs MMKV vs SecureStore
**Rejected:** MMKV (requires native module, not Expo-compatible without bare workflow)
**Rejected:** SecureStore (Expo's `expo-secure-store` — overkill for non-sensitive session data like phone number and store name)
**Chosen:** `@react-native-async-storage/async-storage`
**Why:** Directly matches the key-value API of `localStorage`. The phone number and store name are not sensitive enough to require keychain/keystore storage. MMKV would be the right call at scale (synchronous reads, 10x faster), but adds dependency complexity.

### ADR-004: View-based bar charts vs react-native-svg vs Skia
**Rejected:** `react-native-svg` (though it's in the dependencies for potential future use)
**Rejected:** `@shopify/react-native-skia` (heavy dependency, Canvas API)
**Chosen:** View-based `MiniBars` with proportional `height` style
**Why:** The analytics bar chart is decorative — small bars in a card, not a full-screen chart. A View-based implementation has zero dependency cost, renders at native speed, and is trivially maintainable. The only limitation is no animation, which isn't a requirement.

### ADR-005: Modal pattern for all overlays
**Chosen:** React Native `Modal` component for all overlay UIs (type picker, language picker, plans, photo review, ledger entry, person classify)
**Why:** `position: 'absolute'` + `zIndex` works in RN but has z-index compositing issues across navigation layers. The `Modal` component renders into a separate React Native portal above the entire navigation stack, guaranteeing correct overlay behavior on both iOS and Android.

### ADR-006: FlatList vs ScrollView for message list
**Chosen:** `FlatList` for `ChatScreen` message list
**Why:** `FlatList` virtualizes rendering — only renders visible rows. With potentially hundreds of messages in a long chat session, a `ScrollView` would render all messages at once, causing significant memory pressure and slow initial render. `FlatList` + `scrollToEnd` handles the "scroll to bottom on new message" pattern cleanly.

### ADR-007: No state management library
**Rejected:** Redux, Zustand, Jotai
**Chosen:** React `useState` / prop drilling
**Why:** State is localized — each screen manages its own messages, dues, analytics, etc. Global state is just session info (phone, storeName, language) passed down from App.js via route params. Adding a state library would be premature optimization for this structure.

---

## Performance Characteristics

### FlatList tuning
```js
<FlatList
  data={messages}
  renderItem={renderItem}
  keyExtractor={m => m.id?.toString() || m.timestamp}
  onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
  removeClippedSubviews={true}   // ← frees memory for off-screen items
  maxToRenderPerBatch={20}       // ← limits JS thread load per frame
  windowSize={10}                // ← keeps 5 screens above + below in memory
/>
```

### Polling
- `ChatScreen` polls `/messages/{phone}` every 3 seconds via `setInterval`
- Interval cleared on `useEffect` cleanup (unmount)
- No debounce on send — send is user-initiated
- Polling continues even when tab is in background (React Native doesn't suspend JS thread on tab switch within the same app, unlike browser tabs)

### AsyncStorage
- Reads happen once at app start in `App.js`
- All subsequent reads/writes are synchronous state updates (no re-reads needed)
- `storage.setItem` is fire-and-forget (not awaited on login)

### Image upload
- `quality: 0.8` in `launchImageLibraryAsync` — reduces payload ~40% vs lossless
- No local resizing before upload — backend handles if needed
- FormData `{ uri, name, type }` pattern is the only correct format for RN fetch; passing a Blob or File object throws a native error

---

## Failure Modes and Handling

| Failure Mode | Current Handling | Gap |
|---|---|---|
| Network offline | API calls throw, `catch` shows `Alert.alert` | No offline queue / retry |
| Backend 500 | `Alert.alert('Error', e.message)` | No structured error codes from backend |
| AsyncStorage failure | Unhandled — would crash App.js session load | Should wrap in try/catch with fallback to login |
| Image picker permission denied | `Alert.alert` explaining need | Could link to settings via `Linking.openSettings()` |
| Poll interval accumulation | Interval cleared on unmount | If ChatScreen remounts rapidly (navigation bug), could accumulate intervals |
| Android back button | `onRequestClose` on Modals handles back press | Stack navigator back is handled by React Navigation |
| Large message list scroll | `FlatList` + `scrollToEnd` — may miss if render is slow | Could add `maintainVisibleContentPosition` |
| Expired session | Backend returns 401/403 | No token refresh — user must re-login manually |

---

## Prompt Engineering Notes (Backend, Unchanged)

The backend uses Claude/GPT (per existing implementation) to parse natural language transactions. Relevant to RN only in:
- Image uploads: photo goes to `/message` as multipart, backend runs OCR + LLM parse
- `classifyLedger`: sends structured rows with `section` and `col` fields to guide type classification
- `classifyPersons`: sends person names extracted from photo for Staff/Customer/Supplier classification

No prompt changes were made during this session — all AI interactions remain in the backend.

---

## Complete Bug Registry (This Session)

No runtime bugs encountered — all work was file creation. The following are **anticipated** bugs for the first run:

| Anticipated Issue | Likely Cause | Fix |
|---|---|---|
| Metro bundler can't find module | Wrong import path (`.js` vs `.jsx`) | All RN files use `.js` extension; imports use `./ComponentName` without extension |
| `gap` style warning on old RN | `gap` not supported in RN < 0.71 | RN 0.74.1 supports `gap`; if downgraded, replace with `marginRight`/`marginBottom` |
| Android camera permission crash | `expo-image-picker` not configured in `app.json` | Already configured in `app.json` with `expo-image-picker` plugin |
| `useSafeAreaInsets` returns 0 | Missing `SafeAreaProvider` at root | Wrapped in `App.js` |
| Image upload fails | `fetch` with FormData on Android has known URI encoding bugs | May need `expo-file-system` to read URI as blob if RN FormData fails |
| `FlatList` scroll position off | `onContentSizeChange` fires before layout | Add `getItemLayout` for fixed-height messages for precise scrollToEnd |

---

## At Scale Notes

**10x messages (1000+ per user):** FlatList handles this well with virtualization. The polling endpoint should be paginated — currently `getMessages` returns all messages. At 1000+ messages, initial load will be slow. Fix: paginate with `?limit=50&offset=N` and implement infinite scroll upward.

**10x users (100+ concurrent):** The backend (FastAPI + SQLite) is the bottleneck. SQLite doesn't handle concurrent writes well. Fix: migrate to PostgreSQL. The React Native app itself scales trivially — it's stateless per device.

**10x API calls:** Polling at 3s × 100 users = 33 req/s to `/messages/{phone}`. FastAPI handles ~500-2000 req/s on a single Railway instance. Fine at this scale.

**Memory per device:** FlatList with `removeClippedSubviews` keeps RSS stable. Main risk is uncompressed image assets in the bundle. Use `expo-asset` optimization and EAS's asset fingerprinting for production builds.

**OTA updates:** Expo's EAS Update supports pushing JS bundle changes without App Store review. This is critical for a B2B app like MoneyBook where shopkeepers can't be expected to update frequently. Configure `updates.url` in `app.json` for EAS Update.

---

## File-by-File Conversion Map

| Web File | RN File | Key Changes |
|---|---|---|
| `App.jsx` | `App.js` | AsyncStorage load, NavigationContainer, Stack+Tab navigator |
| `api.js` | `src/api.js` | BASE_URL from config, FormData uri format for images |
| `translations.js` | `src/translations.js` | Verbatim copy |
| _(none)_ | `src/config.js` | New: BASE_URL config |
| _(none)_ | `src/storage.js` | New: AsyncStorage wrapper |
| `components/LoginScreen.jsx` | `screens/LoginScreen.js` | KeyboardAvoidingView, TextInput, language pills, SafeAreaInsets |
| `components/ChatWindow.jsx` | `screens/ChatScreen.js` | FlatList, Modal language picker, Alert for clear, expo-image-picker wired via InputBar |
| `components/AnalyticsPage.jsx` | `screens/AnalyticsScreen.js` | View-based MiniBars, TextInput date range, Modal for date picker |
| `components/DuesPage.jsx` | `screens/DuesScreen.js` | Emoji AvatarIcon, in-screen tabs, ScrollView for dues cards |
| `components/ProfilePage.jsx` | `screens/ProfileScreen.js` | Linking.openURL, Modal bottom sheets, FlatList for languages |
| `components/MessageBubble.jsx` | `components/MessageBubble.js` | FormatText with nested Text, Image component, Alert for delete |
| `components/ConfirmCard.jsx` | `components/ConfirmCard.js` | TypePicker Modal+FlatList replaces select, nestedScrollEnabled |
| `components/InputBar.jsx` | `components/InputBar.js` | expo-image-picker, TextInput multiline, emoji icons |
| `components/QuickReplies.jsx` | `components/QuickReplies.js` | Horizontal ScrollView with chips |
| `components/TypingIndicator.jsx` | `components/TypingIndicator.js` | Animated.Value loop with staggered delays |
| `components/LedgerEntry.jsx` | `components/LedgerEntry.js` | Modal slide, two-column View grid, LedgerRow TextInput rows |
| `components/PersonClassifyWidget.jsx` | `components/PersonClassifyWidget.js` | Modal, progress dots, staff picker sheet Modal |

---

## Open Items

1. **No `react-native-svg`** used despite being in dependencies — MiniBars is View-based. Remove or use for future chart improvements.
2. **No push notifications** — Expo Notifications (`expo-notifications`) would enable background transaction confirmations.
3. **No offline mode** — Transactions can't be drafted offline. Would require SQLite via `expo-sqlite` as local cache.
4. **No biometric lock** — `expo-local-authentication` could add fingerprint/face lock for sensitive financial data.
5. **No deep linking** — `expo-linking` is installed but not configured for deep link handling.
6. **Date input** — Uses plain `TextInput` with `YYYY-MM-DD` format. `@react-native-community/datetimepicker` would give a native date picker UI.
