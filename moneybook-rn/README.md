# MoneyBook — React Native App

This is the React Native (Expo) version of MoneyBook. All functionality is identical to the web app.
The backend (FastAPI + SQLite) is **unchanged** — only the frontend has been converted.

---

## Project Structure

```
moneybook-rn/
├── App.js                      ← Root navigator (Stack + BottomTabs)
├── app.json                    ← Expo config (app name, icons, permissions)
├── package.json                ← Dependencies
├── babel.config.js
└── src/
    ├── config.js               ← ✅ SET YOUR SERVER URL HERE
    ├── api.js                  ← All API calls (identical to web, just BASE_URL changed)
    ├── translations.js         ← All language strings (copied as-is)
    ├── storage.js              ← AsyncStorage wrapper (replaces localStorage)
    ├── screens/
    │   ├── LoginScreen.js      ← Login with phone + store name
    │   ├── ChatScreen.js       ← WhatsApp-style chat (polling, send, image, confirm)
    │   ├── AnalyticsScreen.js  ← Expense analytics + charts
    │   ├── DuesScreen.js       ← Dues & Staff tracker
    │   └── ProfileScreen.js    ← Store profile + settings + plans
    └── components/
        ├── MessageBubble.js    ← Chat bubble (user/bot + ConfirmCard + SavedCard)
        ├── ConfirmCard.js      ← Edit/confirm parsed transactions
        ├── InputBar.js         ← Text input + camera + ledger button
        ├── QuickReplies.js     ← Chip buttons for quick replies
        ├── TypingIndicator.js  ← Animated three-dot indicator
        ├── LedgerEntry.js      ← Manual entry + photo review modal
        └── PersonClassifyWidget.js  ← Staff/Customer/Supplier classifier
```

---

## Step 1 — Configure Server URL

Open `src/config.js` and set your backend URL:

```js
// For local development with Android emulator:
export const BASE_URL = 'http://10.0.2.2:8000/api'

// For local development with iOS simulator:
export const BASE_URL = 'http://localhost:8000/api'

// For local development with physical device (replace with your computer's IP):
export const BASE_URL = 'http://192.168.1.100:8000/api'

// For production (Railway/Render):
export const BASE_URL = 'https://your-app.railway.app/api'
```

---

## Step 2 — Install Dependencies

```bash
cd moneybook-rn
npm install
```

---

## Step 3 — Run the App

```bash
# Start Expo dev server
npm start

# Run on Android emulator
npm run android

# Run on iOS simulator (Mac only)
npm run ios
```

---

## Step 4 — Run on Physical Device

1. Install **Expo Go** app from App Store / Play Store
2. Run `npm start`
3. Scan the QR code with Expo Go (Android) or Camera app (iOS)

---

## Step 5 — Build for Production

Install EAS CLI and build:

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android   # produces .apk or .aab
eas build --platform ios       # produces .ipa (requires Apple Developer account)
```

---

## Key Differences from Web Version

| Web (React + Vite) | React Native (Expo) |
|---|---|
| `<div>` | `<View>` |
| `<p>`, `<span>` | `<Text>` |
| `<button>` | `<TouchableOpacity>` |
| `<input>` | `<TextInput>` |
| `<img>` | `<Image>` |
| CSS classes | `StyleSheet.create({})` |
| `localStorage` | `AsyncStorage` |
| `position: fixed` | `position: 'absolute'` |
| `overflow: scroll` | `<ScrollView>` |
| `window.confirm()` | `Alert.alert()` |
| `window.open()` | `Linking.openURL()` |
| `<input type="file">` | `expo-image-picker` |
| Browser routing | `@react-navigation` |
| CSS `gap` | `marginRight`/`marginBottom` |
| Inline SVG | Emoji or `react-native-svg` |

---

## Backend (Unchanged)

The Python FastAPI backend requires **zero changes**. Just make sure it's running and accessible from your device/emulator at the `BASE_URL` you configured.

To deploy the backend:
- **Railway**: Connect your GitHub repo → deploy → get a URL like `https://moneybook.railway.app`
- **Render**: Same flow, free tier available
- **Local**: `cd execution && python moneybook_webhook.py`

---

## Permissions Required

- **Camera** — to scan khata/ledger photos
- **Photo Library** — to pick existing photos

These are configured in `app.json` and requested at runtime via `expo-image-picker`.

---

## Dependencies

```
expo ~51.0.0
react-native 0.74.1
@react-navigation/native + bottom-tabs + native-stack
@react-native-async-storage/async-storage
expo-image-picker
expo-linking
react-native-safe-area-context
react-native-screens
react-native-svg
```
