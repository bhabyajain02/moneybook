# MoneyBook Goes Mobile — Layman's Guide (For a 10-Year-Old)

## What Did We Build?

Imagine you have a really cool toy that only works on your big desktop computer at home. Now imagine you could take that same toy and make it work on your phone so you can carry it everywhere. That's exactly what we did with MoneyBook!

MoneyBook was a website — you had to open it in a browser on a computer. Now we converted it into a **real phone app** that works on Android and iPhone. Same features, same data, just on your phone.

---

## Why Does This Matter?

The shopkeepers who use MoneyBook are busy people. They're standing at their shop counter, talking to customers, handing over products. They don't have time to run to a computer to record a sale. With the phone app, they can just tap a few buttons and they're done — right there at the counter.

---

## What's Inside the App?

The app has 4 screens you can switch between (like tabs in a folder):

| Screen | Emoji | What It Does |
|---|---|---|
| Chat | 💬 | Talk to MoneyBook like WhatsApp — type "sold chai for ₹20" and it records it |
| Analytics | 📊 | See charts of how much money came in and went out |
| Dues | 👥 | Track who owes you money and who you owe |
| Profile | 👤 | Change your name, language, see your plan |

---

## How Did We Change It?

Think of a Lego set. The website was built with "Lego pieces for computers" — things like `<div>` and `<button>`. Phones use different Lego pieces — `<View>` and `<TouchableOpacity>`. We carefully swapped every computer piece for the matching phone piece.

Here are some fun examples:

| Computer piece | Phone piece |
|---|---|
| A text box | `TextInput` |
| A clickable button | `TouchableOpacity` |
| A scrollable list | `FlatList` |
| A pop-up box | `Modal` |
| Saving data | `AsyncStorage` (like a notebook in your phone) |
| Opening camera | `expo-image-picker` |

---

## How Does It Talk to the Backend?

The "brain" of MoneyBook — the part that understands your messages, stores your data, and figures out what type of transaction something is — stays exactly the same. We didn't touch it. The phone app just sends messages to the brain over the internet, just like the website did.

Imagine the brain is a chef in a kitchen. The website was one waiter, the app is another waiter. Same kitchen, same chef, same food — just a different waiter taking your order.

---

## How Do You Use Each Feature?

### 💬 Chat Screen
- Open the app and you see a WhatsApp-like chat
- Type something like "dal sold 500 rupees" and tap the arrow button
- MoneyBook figures out it was a sale of ₹500 and asks you to confirm
- Tap Confirm → saved!
- You can also tap the 📷 camera button to take a photo of your paper khata (ledger)

### 📊 Analytics Screen
- Tap the chart tab to see your numbers
- Shows a bar chart: how much came in vs went out each day
- You can pick a date range to see a specific time period

### 👥 Dues Screen
- See everyone who owes you money
- Tap a name to see their full history
- Two tabs: Dues (customers/suppliers) and Staff

### 👤 Profile Screen
- See your shop name and phone number
- Change your language (Hindi, English, etc.)
- See your MoneyBook plan
- Contact support via WhatsApp

---

## Any Problems We Solved?

**Problem 1:** The website used to save your login info in the browser's memory. Phones don't have browser memory!
**Fix:** We used "AsyncStorage" — like a little notebook inside the phone app that remembers who you are even after you close the app.

**Problem 2:** The website let you pick files using a file picker. Phones don't have the same file picker!
**Fix:** We used a special camera/gallery tool called `expo-image-picker` that asks permission first, then lets you pick a photo.

**Problem 3:** The website showed pop-up boxes using `window.confirm()`. Phone apps can't do that!
**Fix:** We used `Alert.alert()` — same pop-up box, just the phone version.

**Problem 4:** The website drew little bar charts using special computer drawing code (SVG). Phone apps handle drawing differently!
**Fix:** We made the bars out of colored rectangles stacked next to each other — no special drawing needed!

---

## How Do You Get It on Your Phone?

1. Ask a developer to set the server address in `src/config.js`
2. Run `npm install` (downloads all the pieces)
3. Run `npm start` (starts the cooking)
4. Open "Expo Go" app on your phone
5. Scan the QR code that appears on the computer
6. The MoneyBook app appears on your phone! 🎉
