import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const rememberPreferenceKey = 'syntap-remember-session'
const selectedStorage = () => localStorage.getItem(rememberPreferenceKey) === 'false' ? sessionStorage : localStorage
const authStorage = {
  getItem: (key) => selectedStorage().getItem(key),
  setItem: (key, value) => selectedStorage().setItem(key, value),
  removeItem: (key) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { storage: authStorage } })
  : null

export function setRememberSession(remember) {
  localStorage.setItem(rememberPreferenceKey, remember ? 'true' : 'false')
}

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Connect your Supabase project to enable this feature.')
  }
  return supabase
}
