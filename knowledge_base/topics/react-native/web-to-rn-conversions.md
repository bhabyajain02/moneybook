# Web to React Native Conversion Patterns

> Last updated: 2026-04-04 (MoneyBook RN conversion)

## Core API Replacements

| Web API | React Native Equivalent | Notes |
|---|---|---|
| `localStorage` | `AsyncStorage` from `@react-native-async-storage/async-storage` | **Async** — must use `await`, can't use in `useState` initializer |
| `<div>` | `<View>` | |
| `<p>`, `<span>` | `<Text>` | All text must be inside `<Text>` |
| `<button>` | `<TouchableOpacity>` or `<Pressable>` | |
| `<input>` | `<TextInput>` | Use `keyboardType="numeric"` for numbers |
| `<img>` | `<Image source={{ uri: '...' }}>` | |
| `<select>` | `<Modal>` + `<FlatList>` | No native select — build a bottom sheet |
| `<input type="file">` | `expo-image-picker` | Must request permissions first |
| `overflow: scroll` | `<ScrollView>` or `<FlatList>` | FlatList for long lists (virtualizes) |
| `position: fixed` | `<Modal>` component | Renders above all navigation layers |
| CSS `@keyframes` | `Animated.Value` + `Animated.loop` | Use `useNativeDriver: true` for performance |
| Inline SVG | View-based or `react-native-svg` | View-based for simple bars/shapes |
| `window.confirm()` | `Alert.alert(title, msg, buttons)` | |
| `window.open(url)` | `Linking.openURL(url)` | |
| `dangerouslySetInnerHTML` | Regex-parsed nested `<Text>` | |
| `FormData` with `File` | `FormData` with `{ uri, name, type }` | RN fetch doesn't understand File API |
| `gap` CSS | `marginRight`/`marginBottom` | Supported in RN 0.71+, but be cautious |

## AsyncStorage Session Loading Pattern

```js
// App.js — the right way to load async session at startup
const [session, setSession] = useState(null)
const [loading, setLoading] = useState(true)  // ← key: show spinner while loading

useEffect(() => {
  async function load() {
    const phone = await AsyncStorage.getItem('phone_key')
    if (phone) setSession({ phone })
    setLoading(false)
  }
  load()
}, [])

if (loading) return <ActivityIndicator />
return session ? <MainApp /> : <LoginScreen />
```

## Modal as Select Replacement

```js
function SelectPicker({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)}>
        <Text>{value} ▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide">
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
                          onPress={() => setOpen(false)}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '60%' }}>
            <FlatList
              data={options}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => { onChange(item); setOpen(false) }}
                                  style={{ padding: 14, borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
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

## View-Based Bar Chart (No SVG)

```js
function BarChart({ bars }) {
  const maxVal = Math.max(...bars.map(b => b.value), 1)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 80 }}>
      {bars.map((bar, i) => (
        <View key={i} style={{
          flex: 1,
          marginRight: i < bars.length - 1 ? 4 : 0,
          height: Math.max(4, (bar.value / maxVal) * 80),
          backgroundColor: bar.color,
          borderRadius: 3,
        }} />
      ))}
    </View>
  )
}
```

## Animated Typing Indicator

```js
function AnimatedDot({ delay }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(anim, { toValue: -6, duration: 300, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0,  duration: 300, useNativeDriver: true }),
      Animated.delay(600),
    ])).start()
  }, [])
  return <Animated.View style={{ transform: [{ translateY: anim }], width: 8, height: 8,
    borderRadius: 4, backgroundColor: '#888', marginRight: 4 }} />
}
// Usage: <AnimatedDot delay={0} /> <AnimatedDot delay={150} /> <AnimatedDot delay={300} />
```

## expo-image-picker Integration

```js
import * as ImagePicker from 'expo-image-picker'

async function pickImage() {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow photo access to send images.')
    return
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,  // 80% quality reduces size ~40%
  })
  if (!result.canceled) {
    const uri = result.assets[0].uri
    // Use uri for upload
  }
}
```

## Image Upload with RN FormData

```js
// THIS IS WRONG (web File API):
formData.append('file', fileObject)

// THIS IS CORRECT for React Native:
formData.append('file', {
  uri: imageUri,        // 'file:///...' path from expo-image-picker
  name: 'photo.jpg',
  type: 'image/jpeg',
})
```

## Navigation: Login Gate Pattern

```js
// App.js — session-gated navigation
<NavigationContainer>
  <Stack.Navigator>
    {!session ? (
      <Stack.Screen name="Login" component={LoginScreen} />
    ) : (
      <Stack.Screen name="Main" component={MainTabs} />
    )}
  </Stack.Navigator>
</NavigationContainer>
```

## Safe Area Handling

```js
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

// Wrap App.js root with:
<SafeAreaProvider>
  <NavigationContainer>...</NavigationContainer>
</SafeAreaProvider>

// In screens that need custom top padding:
const insets = useSafeAreaInsets()
<View style={{ paddingTop: insets.top }}>...</View>
```

## Expo Config (app.json) for Camera

```json
{
  "expo": {
    "plugins": [
      ["expo-image-picker", {
        "photosPermission": "App needs photo access to upload images.",
        "cameraPermission": "App needs camera access to take photos."
      }]
    ]
  }
}
```
