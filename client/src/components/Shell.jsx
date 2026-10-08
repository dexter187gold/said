import React, { useState, useEffect, useRef, useCallback } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import AppLogo from './AppLogo'
import HelpPanel from './HelpPanel'
import PageSettingsSidebar, { usePageSettings } from './PageSettingsSidebar'

const navGroups = [
  {
    label: 'Work',
    items: [
      { to: '/', label: 'Dashboard', end: true, icon: '⌂' },
      { to: '/tickets', label: 'Tickets', icon: '◉' },
      { to: '/clients', label: 'Clients', icon: '◎' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/invoices', label: 'Invoices', icon: '◈' },
      { to: '/quotes', label: 'Quotes', icon: '◇' },
      { to: '/credits', label: 'Credit notes', icon: '↺' },
      { to: '/money', label: 'Money', icon: '₵' },
      { to: '/ageing', label: 'Ageing', icon: '▦' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/documents', label: 'Templates', icon: '▤' },
      { to: '/settings', label: 'Settings', icon: '⚙' },
      { to: '/platform', label: 'Platform', icon: '⬡' },
      { to: '/about', label: 'About', icon: 'ⓘ' },
    ],
  },
]
const links = navGroups.flatMap((g) => g.items)

const LS_KEY = 'said_sidebar_collapsed'

export default function Shell() {
  const { user, logout } = useAuth()
  const { prefs, setPrefs } = useTheme()
  const nav = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === '1' } catch { return false }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const touchRef = useRef({ x: 0, y: 0, t: 0, active: false, taps: 0 })
  const mainRef = useRef(null)
  const { open: pageSettingsOpen, setOpen: setPageSettingsOpen, hasPageSettings } = usePageSettings()

  const persist = useCallback((v) => {
    setCollapsed(v)
    try { localStorage.setItem(LS_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }, [])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    const onStart = (e) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now(), active: true, taps: touchRef.current.taps }
    }
    const onEnd = (e) => {
      if (!touchRef.current.active) return
      touchRef.current.active = false
      const t = e.changedTouches[0]
      const dx = t.clientX - touchRef.current.x
      const dy = t.clientY - touchRef.current.y
      const dt = Date.now() - touchRef.current.t
      const isMobile = window.matchMedia('(max-width: 767px)').matches
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 280) {
        touchRef.current.taps += 1
        setTimeout(() => {
          if (touchRef.current.taps >= 2) setPrefs({ style: prefs.style === 'glass' ? 'solid' : 'glass' })
          touchRef.current.taps = 0
        }, 280)
        return
      }
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        if (dx < 0) { if (isMobile) setMobileOpen(false); else persist(true) }
        else { if (isMobile) setMobileOpen(true); else persist(false) }
        return
      }
      if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.5 && (mainRef.current?.scrollTop || 0) < 40) {
        mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [persist, prefs.style, setPrefs])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('input,textarea,select')) return
      if (e.key === '[') persist(true)
      // ] is reserved for page settings sidebar (usePageSettings)
      if (e.key === 'g' || e.key === 'G') setPrefs({ style: prefs.style === 'glass' ? 'solid' : 'glass' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [persist, prefs.style, setPrefs])

  const sidebarWidth = collapsed ? 'w-[4.25rem]' : 'w-56'

  const NavItems = ({ compact }) => (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto min-h-0">
      {(compact ? [{ label: null, items: links }] : navGroups).map((g) => (
        <div key={g.label || 'all'} className="mb-1">
          {!compact && g.label && (
            <div className="px-2.5 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
              {g.label}
            </div>
          )}
          {g.items.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              title={l.label}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5'
                } ${compact ? 'justify-center px-2' : ''}`
              }
            >
              <span className="text-base leading-none w-5 text-center shrink-0 opacity-80">{l.icon}</span>
              {!compact && <span className="truncate">{l.label}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-dvh">
      {mobileOpen && (
        <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <aside className={`fixed md:sticky top-0 z-50 flex h-dvh flex-col border-r border-white/20 dark:border-white/10 glass-panel p-2.5 transition-all duration-300 ease-out ${sidebarWidth} ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className={`mb-3 flex items-center gap-2 px-1 ${collapsed ? 'justify-center' : ''}`}>
          <AppLogo size={collapsed ? 32 : 36} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold tracking-tight">SAID</div>
              <div className="text-[10px] text-slate-500">v1.8 · Q4</div>
            </div>
          )}
          <button type="button" className="hidden md:inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-accent hover:bg-black/5" onClick={() => persist(!collapsed)}>{collapsed ? '›' : '‹'}</button>
        </div>
        <NavItems compact={collapsed} />
        <div className="mt-auto space-y-1.5 border-t border-white/10 pt-2.5 shrink-0">
          {!collapsed && <div className="px-2 text-[11px] text-slate-500 truncate">{user?.name}<span className="opacity-60"> · {user?.role}</span></div>}
          <button type="button" className={`btn-ghost w-full !text-xs ${collapsed ? '!px-2 justify-center' : ''}`} onClick={() => setPrefs({ style: prefs.style === 'glass' ? 'solid' : 'glass' })}>{collapsed ? '◇' : prefs.style === 'glass' ? 'Glass on' : 'Solid'}</button>
          <button type="button" className={`btn-ghost w-full !text-xs ${collapsed ? '!px-2 justify-center' : ''}`} onClick={() => setPrefs({ mode: document.documentElement.classList.contains('dark') ? 'light' : 'dark' })}>{collapsed ? '☾' : 'Theme light/dark'}</button>
          <button type="button" className={`btn-ghost w-full !text-xs text-red-600/80 ${collapsed ? '!px-2 justify-center' : ''}`} onClick={() => { logout(); nav('/login') }}>{collapsed ? '⏻' : 'Sign out'}</button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col max-h-dvh">
        <header className="sticky top-0 z-30 flex items-center gap-3 glass-panel border-b border-white/20 dark:border-white/10 px-3 py-2 md:px-5 shrink-0 rounded-none">
          <button type="button" className="md:hidden btn-ghost !px-2.5 !py-1.5 text-lg" onClick={() => setMobileOpen(true)}>☰</button>
          <div className="min-w-0 flex-1 text-xs text-slate-500 truncate">{user?.name || 'User'} · {new Date().toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          {hasPageSettings && (
            <button
              type="button"
              className="btn-outline !py-1 !px-2.5 !text-xs"
              title="Page settings ( ] or Ctrl+, )"
              onClick={() => setPageSettingsOpen(true)}
            >
              ⚙ Page
            </button>
          )}
          <button type="button" className="hidden sm:inline-flex btn-outline !py-1 !px-2.5 !text-xs" onClick={() => persist(!collapsed)}>{collapsed ? 'Show menu' : 'Hide menu'}</button>
        </header>
        <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full">
          <div className="max-w-[1400px] mx-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-6 pb-16">
            <Outlet context={{ collapsed }} />
          </div>
        </main>
        <footer className="shrink-0 border-t border-white/10 px-4 py-2 text-[10px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1 glass-panel rounded-none">
          <span>SAID v2.2</span>
          <NavLink to="/about" className="hover:text-accent">About</NavLink>
          <NavLink to="/settings" className="hover:text-accent">Theme</NavLink>
        </footer>
      </div>
      <HelpPanel />
      <PageSettingsSidebar open={pageSettingsOpen} onClose={() => setPageSettingsOpen(false)} />
      {hasPageSettings && !pageSettingsOpen && (
        <button
          type="button"
          aria-label="Open page settings"
          title="Page settings (swipe from right or ])"
          onClick={() => setPageSettingsOpen(true)}
          className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-slate-200 bg-white/95 px-1.5 py-4 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900/95"
        >
          ⚙
        </button>
      )}
    </div>
  )
}
