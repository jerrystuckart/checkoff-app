import React, { createContext, useContext, useState, useEffect, useMemo } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

const THEME_KEY = 'checkoff_theme_v1'

export const lightColors = {
  BG:             '#FFF9F2',
  CARD:           '#FFFFFF',
  TEXT:           '#243045',
  MUTED:          '#6F7785',
  LABEL:          '#6F7785',
  BORDER:         '#E6D8C7',
  SOFT:           '#FFF1DB',
  SOFT_2:         '#F8F3EC',
  AMBER:          '#F5A623',
  NAVY:           '#1A1A2E',
  GREEN:          '#1D9E75',
  RED:            '#D85A30',
  SUCCESS_BG:     '#EAF8F2',
  SUCCESS_BORDER: '#BFE7D7',
  ENDED_BG:       '#F4EEF9',
  ENDED_BORDER:   '#DCCCED',
  ENDED_TEXT:     '#7A4DB3',
  INFO_BG:        '#EAF3FC',
  INFO_BORDER:    '#C8DDF5',
  INFO_TEXT:      '#378ADD',
  CARD_URGENT:    '#FFFCF5',
  // Home 2026 tactile system: a second, visibly-elevated surface step above
  // CARD (see components/PressableTactile.jsx / EditorialCard.jsx) — real
  // depth via shadow, not another outline. SHADOW_COLOR feeds Pressable's
  // shadow* / elevation props directly.
  CARD_ELEVATED:  '#FFFFFF',
  SHADOW_COLOR:   'rgba(36,48,69,0.18)',
  STATUS_BAR:     'dark-content',
  isDark:         false,
}

export const darkColors = {
  BG:             '#0F0F1E',
  CARD:           '#1A1A2E',
  TEXT:           '#E8E6DF',
  MUTED:          '#8A8880',
  LABEL:          '#B0AEA3',
  BORDER:         'rgba(255,255,255,0.12)',
  SOFT:           '#232336',
  SOFT_2:         '#1E1E2E',
  AMBER:          '#F5A623',
  NAVY:           '#0A0A15',
  GREEN:          '#1D9E75',
  RED:            '#D85A30',
  SUCCESS_BG:     'rgba(29,158,117,0.12)',
  SUCCESS_BORDER: 'rgba(29,158,117,0.3)',
  ENDED_BG:       'rgba(122,77,179,0.12)',
  ENDED_BORDER:   'rgba(122,77,179,0.3)',
  ENDED_TEXT:     '#B08AE0',
  INFO_BG:        'rgba(55,138,221,0.12)',
  INFO_BORDER:    'rgba(55,138,221,0.3)',
  INFO_TEXT:      '#6FB1F0',
  CARD_URGENT:    'rgba(245,166,35,0.08)',
  // Home 2026 tactile system — see the light-mode note above. Dark mode's
  // elevation step must actually read as lighter than CARD, not just a
  // different hue, or "elevated" surfaces vanish into the page background.
  CARD_ELEVATED:  '#26263F',
  SHADOW_COLOR:   'rgba(0,0,0,0.55)',
  STATUS_BAR:     'light-content',
  isDark:         true,
}

const ThemeContext = createContext({
  colors:       darkColors,
  isDark:       true,
  toggleTheme:  () => {},
  themeReady:   false,
})

export function ThemeProvider({ children }) {
  // App is designed dark-first; default to dark for new/logged-out users
  // regardless of OS appearance. Only an explicit stored 'light' choice
  // (from a prior toggleTheme call) overrides this.
  const [isDark, setIsDark]     = useState(true)
  const [themeReady, setReady]  = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then(val => { if (val === 'light') setIsDark(false) })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  function toggleTheme() {
    setIsDark(prev => {
      const next = !prev
      AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light').catch(() => {})
      return next
    })
  }

  const value = useMemo(() => ({
    colors: isDark ? darkColors : lightColors,
    isDark,
    toggleTheme,
    themeReady,
  }), [isDark, themeReady])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
