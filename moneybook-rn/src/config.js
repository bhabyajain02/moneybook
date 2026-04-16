// ── Server configuration ───────────────────────────────────────────────────
// Change BASE_URL to point to your deployed backend (Railway, Render, VPS, etc.)
// For local development on the same machine:
//   Android emulator: http://10.0.2.2:8000/api
//   iOS simulator:    http://localhost:8000/api
//   Physical device:  http://YOUR_COMPUTER_IP:8000/api
//   Production:       https://your-app.railway.app/api

export const BASE_URL = (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_BACKEND_URL)
  ? process.env.EXPO_PUBLIC_BACKEND_URL + '/api'
  : 'https://YOUR_BACKEND_URL/api'

// Examples:
// export const BASE_URL = 'http://10.0.2.2:8000/api'       // Android emulator local
// export const BASE_URL = 'http://localhost:8000/api'       // iOS simulator local
// export const BASE_URL = 'http://192.168.1.100:8000/api'  // Physical device local
// export const BASE_URL = 'https://moneybook.railway.app/api' // Production
