import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  toggle: () => void
  setTheme: (theme: Theme) => void
}

const getInitialTheme = (): Theme => {
  const stored = localStorage.getItem('flowmind_theme')
  if (stored === 'dark' || stored === 'light') return stored
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('flowmind_theme', theme)
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = getInitialTheme()
  applyTheme(initial)

  return {
    theme: initial,
    toggle: () => {
      const next = get().theme === 'light' ? 'dark' : 'light'
      applyTheme(next)
      set({ theme: next })
    },
    setTheme: (theme: Theme) => {
      applyTheme(theme)
      set({ theme })
    },
  }
})
