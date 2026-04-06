// ── MoneyBook React Native — Root Navigator ────────────────────────────────
// Replaces App.jsx's localStorage + CSS show/hide approach with proper
// react-navigation Stack + BottomTabs. All functionality identical.

import { useEffect, useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Text, View, ActivityIndicator } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { storage, LS_KEY, LS_NAME, LS_LANG } from './src/storage'
import { updateProfile } from './src/api'

import LoginScreen   from './src/screens/LoginScreen'
import ChatScreen    from './src/screens/ChatScreen'
import AnalyticsScreen from './src/screens/AnalyticsScreen'
import DuesScreen    from './src/screens/DuesScreen'
import ProfileScreen from './src/screens/ProfileScreen'

const Stack = createNativeStackNavigator()
const Tab   = createBottomTabNavigator()

// ── Bottom tab navigator (shown after login) ───────────────────────────────
function MainTabs({ phone, storeName, language, onLogout, onLanguageChange }) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#00695C',
        tabBarInactiveTintColor: '#888',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#e0e0e0',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Chat"
        options={{
          tabBarLabel: 'Chat',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>💬</Text>,
        }}
      >
        {() => (
          <ChatScreen
            phone={phone}
            storeName={storeName}
            language={language}
            onLogout={onLogout}
            onLanguageChange={onLanguageChange}
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Analytics"
        options={{
          tabBarLabel: 'Analytics',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📊</Text>,
        }}
      >
        {() => <AnalyticsScreen phone={phone} storeName={storeName} language={language} />}
      </Tab.Screen>

      <Tab.Screen
        name="DuesStaff"
        options={{
          tabBarLabel: 'Dues & Staff',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👥</Text>,
        }}
      >
        {() => <DuesScreen phone={phone} storeName={storeName} language={language} />}
      </Tab.Screen>

      <Tab.Screen
        name="Profile"
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text>,
        }}
      >
        {() => (
          <ProfileScreen
            phone={phone}
            storeName={storeName}
            language={language}
            onLanguageChange={onLanguageChange}
            onLogout={onLogout}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  )
}

// ── Root app ───────────────────────────────────────────────────────────────
export default function App() {
  const [loading,    setLoading]    = useState(true)
  const [phone,      setPhone]      = useState(null)
  const [storeName,  setStoreName]  = useState('')
  const [language,   setLanguage]   = useState('hinglish')

  // Load persisted session on startup
  useEffect(() => {
    async function loadSession() {
      const [savedPhone, savedName, savedLang] = await Promise.all([
        storage.getItem(LS_KEY),
        storage.getItem(LS_NAME),
        storage.getItem(LS_LANG),
      ])
      if (savedPhone) setPhone(savedPhone)
      if (savedName)  setStoreName(savedName)
      if (savedLang)  setLanguage(savedLang)
      setLoading(false)
    }
    loadSession()
  }, [])

  async function handleLogin(digits, storeData, lang) {
    const normalized = `web:+91${digits}`
    await Promise.all([
      storage.setItem(LS_KEY,  normalized),
      storage.setItem(LS_NAME, storeData.name || ''),
    ])
    if (lang) {
      await storage.setItem(LS_LANG, lang)
      setLanguage(lang)
      updateProfile(normalized, { language: lang }).catch(() => {})
    }
    setPhone(normalized)
    setStoreName(storeData.name || '')
  }

  async function handleLogout() {
    await Promise.all([
      storage.removeItem(LS_KEY),
      storage.removeItem(LS_NAME),
    ])
    setPhone(null)
    setStoreName('')
  }

  async function handleLanguageChange(key) {
    await storage.setItem(LS_LANG, key)
    setLanguage(key)
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00695C' }}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>📒</Text>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!phone ? (
            <Stack.Screen name="Login">
              {() => <LoginScreen onLogin={handleLogin} initialLanguage={language} />}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Main">
              {() => (
                <MainTabs
                  phone={phone}
                  storeName={storeName}
                  language={language}
                  onLogout={handleLogout}
                  onLanguageChange={handleLanguageChange}
                />
              )}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
