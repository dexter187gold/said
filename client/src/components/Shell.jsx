import React, { useState, useEffect, useRef, useCallback } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AppLogo from './AppLogo'
import HelpPanel from './HelpPanel'

const links = [
  { to: '/', label: 'Dashboard', end: true, icon: '⌂' },
  { to: '/invoices', label: 'Invoices', icon: '◈' },
  { to: '/quotes', label: 'Quotes', icon: '◇' },
  { to: '/credits', label: 'Credit notes', icon: '↺' },
  { to: '/tickets', label: 'Tickets', icon: '◉' },
  { to: '/clients', label: 'Clients', icon: '◎' },
  { to: '/documents', label: 'Doc generator', icon: '▤' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
  { to: '/about', label: 'About', icon: 'ⓘ' },
]

const LS_KEY = 'said_sidebar_collapsed'

export default function Shell() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === '1' } catch { return false }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const touchRef = useRef({ x: 0, y: 0, active: false })

  const persist = useCallback((v) => {
    setCollapsed(v)
    try { localStorage.setItem(LS_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }, [])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    const onStart = (e) => {
      if (e.touches.length !== 1) return
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: true }
    }
    const onEnd = (e) => {
      if (!touchRef.current.active) return
      touchRef.current.active = false
      const t = e.changedTouches[0]
      const dx = t.clientX - touchRef.current.x
      const dy = t.clientY - touchRef.current.y
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return
      const isMobile = window.matchMedia('(max-width: 767px)').matches
      if (dx < 0) {
        if (isMobile) setMobileOpen(false)
        else persist(true)
      } else {
        if (isMobile) setMobileOpen(true)
        else persist(false)
      }
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [persist])

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark')
    setDark(document.documentElement.classList.contains('dark'))
  }

  const sidebarWidth = collapsed ? 'w-[4.25rem]' : 'w-56'

  const NavItems = ({ compact }) => (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          title={l.label}
          className={({ isActive }) =>
            `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              isActive
                ? 'bg-brand/15 text-brand-dark dark:text-emerald-300'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            } ${compact ? 'justify-center px-2' : ''}`
          }
        >
          <span className="text-base leading-none w-5 text-center shrink-0 opacity-80">{l.icon}</span>
          {!compact && <span className="truncate">{l.label}</span>}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`
          fixed md:sticky top-0 z-50 flex h-screen flex-col border-r border-slate-200 dark:border-slate-800
          bg-white dark:bg-slate-900 p-2.5 transition-all duration-300 ease-out
          ${sidebarWidth}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <div className={`mb-3 flex items-center gap-2 px-1 ${collapsed ? 'justify-center' : ''}`}>
          <AppLogo size={collapsed ? 32 : 36} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold tracking-tight">SAID</div>
              <div className="text-[10px] text-slate-500">v1.2 · SA Invoice Desk</div>
            </div>
          )}
          <button
            type="button"
            className="hidden md:inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-brand"
            title={collapsed ? 'Expand menu (swipe right)' : 'Collapse menu (swipe left)'}
            onClick={() => persist(!collapsed)}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <NavItems compact={collapsed} />

        <div className={`mt-auto space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-2.5`}>
          {!collapsed && (
            <div className="px-2 text-[11px] text-slate-500 truncate">
              {user?.name}
              <span className="opacity-60"> · {user?.role}</span>
            </div>
          )}
          <button
            type="button"
            title={dark ? 'Light mode' : 'Dark mode'}
            className={`btn-ghost w-full !text-xs ${collapsed ? '!px-2 justify-center' : ''}`}
            onClick={toggleDark}
          >
            {collapsed ? (dark ? '☀' : '☾') : dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            type="button"
            title="Sign out"
            className={`btn-ghost w-full !text-xs text-red-600/80 ${collapsed ? '!px-2 justify-center' : ''}`}
            onClick={() => { logout(); nav('/login') }}
          >
            {collapsed ? '⏻' : 'Sign out'}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-3 py-2 md:px-5">
          <button
            type="button"
            className="md:hidden btn-ghost !px-2.5 !py-1.5 text-lg"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500 truncate">
              {user?.name || 'User'} · {new Date().toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
          <button
            type="button"
            className="hidden sm:inline-flex btn-outline !py-1 !px-2.5 !text-xs"
            title="Toggle sidebar"
            onClick={() => persist(!collapsed)}
          >
            {collapsed ? 'Show menu' : 'Hide menu'}
          </button>
        </header>

        <main className="flex-1 w-full max-w-[1400px] mx-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-6">
          <Outlet context={{ collapsed }} />
        </main>

        <footer className="border-t border-slate-200/60 dark:border-slate-800 px-4 py-2 text-[10px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
          <span>SA Invoice Desk v1.2</span>
          <span className="hidden sm:inline">Swipe ← hide menu · → show menu</span>
          <NavLink to="/about" className="hover:text-brand">About</NavLink>
        </footer>
      </div>

      <HelpPanel />
    </div>
  )
}
