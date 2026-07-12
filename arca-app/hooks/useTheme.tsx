'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type ThemeName = 'purple' | 'matrix' | 'cyber' | 'ember'

export interface Theme {
  name:  ThemeName
  label: string
  color: [number, number, number]  // RGB for particle idle state
  hex:   string
}

export const THEMES: Record<ThemeName, Theme> = {
  purple: { name: 'purple', label: 'ARCA Purple', color: [123, 116, 224], hex: '#7B74E0' },
  matrix: { name: 'matrix', label: 'Matrix',      color: [0,   255,  65], hex: '#00FF41' },
  cyber:  { name: 'cyber',  label: 'Cyber',        color: [0,   180, 255], hex: '#00B4FF' },
  ember:  { name: 'ember',  label: 'Ember',         color: [255, 107,  53], hex: '#FF6B35' },
}

const STORAGE_KEY = 'arca-theme'

function readTheme(): ThemeName {
  if (typeof window === 'undefined') return 'purple'
  const saved = localStorage.getItem(STORAGE_KEY)
  return (saved && saved in THEMES) ? (saved as ThemeName) : 'purple'
}

interface ThemeContextValue {
  theme:    Theme
  setTheme: (name: ThemeName) => void
}

// Was a plain hook with its own useState — every caller (ArcaProvider, which
// renders the actual orb, and SettingsPanel, where the user picks a color)
// got its own independent, unsynced copy of the theme. Picking a color in
// Settings updated Settings' own copy (and localStorage) but never touched
// ArcaProvider's copy, so the orb never changed color until the next full
// app restart (a fresh mount reads localStorage again). A Context makes
// every consumer share the same state, so a change is visible immediately.
const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(readTheme)

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name)
    localStorage.setItem(STORAGE_KEY, name)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme: THEMES[themeName], setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme() must be used within a <ThemeProvider>')
  return ctx
}
