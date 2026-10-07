import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

const KEY = 'said_theme_prefs'

const defaults = {
  mode: 'system',
  style: 'glass',
  accent: '#007A4D',
  blur: 16,
  opacity: 0.72,
  radius: 16,
  density: 'comfortable',
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

const ThemeCtx = createContext(null)

export function ThemeProvider({ children }) {
  const [prefs, setPrefs] = useState(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch { /* ignore */ }

    const root = document.documentElement
    const wantDark =
      prefs.mode === 'dark' ||
      (prefs.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.toggle('dark', wantDark)

    root.style.setProperty('--said-accent', prefs.accent)
    root.style.setProperty('--said-blur', `${prefs.blur}px`)
    root.style.setProperty('--said-glass-opacity', String(prefs.opacity))
    root.style.setProperty('--said-radius', `${prefs.radius}px`)
    root.dataset.style = prefs.style
    root.dataset.density = prefs.density
  }, [prefs])

  const api = useMemo(
    () => ({
      prefs,
      setPrefs: (patch) => setPrefs((p) => ({ ...p, ...patch })),
      reset: () => setPrefs({ ...defaults }),
    }),
    [prefs]
  )

  return <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme outside provider')
  return ctx
}
