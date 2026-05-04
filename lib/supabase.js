import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import 'react-native-url-polyfill/auto'

const SUPABASE_URL      = 'https://uggusbbswybyplypkbxz.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZ3VzYmJzd3lieXBseXBrYnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODUwNDEsImV4cCI6MjA5MTM2MTA0MX0.EVk1t_u93uAMk9T9_uIs5Hy7kDwK3d5oYzBAl7cGpfc'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage:           AsyncStorage,
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: false,
    // Keep session alive — token refreshes automatically before expiry.
    // No manual re-login needed during development.
  },
})

// Extend session on app resume so you never get kicked out.
// Supabase tokens expire after 1 hour by default — this refreshes
// them silently whenever the app comes back to the foreground.
import { AppState } from 'react-native'

AppState.addEventListener('change', state => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh()
  } else {
    supabase.auth.stopAutoRefresh()
  }
})
