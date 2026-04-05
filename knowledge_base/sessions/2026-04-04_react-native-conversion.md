# Session: React Native Conversion
**Date:** 2026-04-04
**Topics:** react-native, expo, mobile, architecture, frontend

## Summary

Converted MoneyBook's entire React+Vite web frontend to React Native (Expo 51) without any backend changes. Created 21 files in `moneybook-rn/`.

## What Was Done

### Files Created

**Config / Root:**
- `App.js` — Root navigator with AsyncStorage session loading, Stack + BottomTab navigation
- `app.json` — Expo config with camera permissions
- `package.json` — Expo 51 + react-navigation + async-storage deps
- `babel.config.js` — Standard Expo babel preset
- `src/config.js` — BASE_URL configuration (the only file to change per deployment)
- `src/storage.js` — AsyncStorage wrapper matching localStorage API
- `src/api.js` — All 20 API functions (BASE_URL swapped in, FormData uri format for images)
- `src/translations.js` — Verbatim copy (no DOM dependencies)

**Screens:**
- `src/screens/LoginScreen.js`
- `src/screens/ChatScreen.js`
- `src/screens/AnalyticsScreen.js`
- `src/screens/DuesScreen.js`
- `src/screens/ProfileScreen.js`

**Components:**
- `src/components/MessageBubble.js`
- `src/components/ConfirmCard.js`
- `src/components/InputBar.js`
- `src/components/QuickReplies.js`
- `src/components/TypingIndicator.js`
- `src/components/LedgerEntry.js`
- `src/components/PersonClassifyWidget.js`
- `README.md`

## Key Conversion Patterns

| Web | React Native |
|---|---|
| `localStorage` | `AsyncStorage` (async) |
| CSS show/hide tabs | `@react-navigation/native` Stack + BottomTab |
| `<input type="file">` | `expo-image-picker` |
| `<select>` | `Modal` + `FlatList` |
| SVG bar charts | `View`-based proportional height bars |
| CSS `@keyframes` | `Animated.Value` + `Animated.loop` |
| `window.confirm()` | `Alert.alert()` |
| `window.open()` | `Linking.openURL()` |
| `FormData` with `File` | `FormData` with `{ uri, name, type }` |
| `dangerouslySetInnerHTML` for bold | Regex-parsed nested `<Text>` components |
| Inline SVG avatars | Emoji `<Text>` in colored `<View>` |

## Critical Learning: Async Session Loading

The biggest architectural change: `localStorage.getItem()` is synchronous and can be used in `useState` initializers. `AsyncStorage.getItem()` returns a Promise. This requires:
1. A `loading: true` state in `App.js`
2. A `useEffect` to load session asynchronously
3. A spinner while loading, before showing Login or MainTabs

## Backend: Zero Changes

The Python FastAPI + SQLite backend is completely untouched. The RN app calls the same 20 API endpoints. The only change: `const BASE = BASE_URL` (absolute URL) instead of `const BASE = '/api'` (relative path).

## Knowledge Doc

Full Knowledge Doc at: `docs/knowledge/2026-04-04_react-native-conversion/`
- `layman.md` — 10-year-old explanation
- `intermediate.md` — Full dev reference with code snippets
- `pro.md` — ADRs, failure modes, at-scale notes
- `story.md` — Complete narrative from problem to rebuild
