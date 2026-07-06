import { create } from 'zustand'
import api from '../utils/api'

interface User {
  id: number
  username: string
  email: string
  display_name: string
  avatar_url: string
  is_superuser: boolean
  is_approved: boolean
  can_create_project: boolean
}

interface AuthState {
  token: string | null
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('flowmind_token'),
  user: null,
  loading: false,

  login: async (username, password) => {
    const formData = new URLSearchParams({ username, password })
    const res = await api.post('/auth/login', formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const { access_token } = res.data
    localStorage.setItem('flowmind_token', access_token)
    set({ token: access_token })
    // Load user data
    const userRes = await api.get('/auth/me')
    set({ user: userRes.data })
  },

  register: async (username, email, password) => {
    await api.post('/auth/register', { username, email, password })
  },

  logout: () => {
    localStorage.removeItem('flowmind_token')
    set({ token: null, user: null })
  },

  loadUser: async () => {
    try {
      set({ loading: true })
      const res = await api.get('/auth/me')
      set({ user: res.data, loading: false })
    } catch {
      set({ token: null, user: null, loading: false })
      localStorage.removeItem('flowmind_token')
    }
  },
}))
