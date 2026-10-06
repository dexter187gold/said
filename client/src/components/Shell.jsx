import React, { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AppLogo from './AppLogo'
import HelpPanel from './HelpPanel'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/invoices', label: 'Invoices' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/clients', label: 'Clients' },
  { to: '/documents', label: 'Documents' },
]

export default function Shell() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark')
    setDark(document.documentElement.classList.contains('dark'))
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="mb-4 flex items-center gap-2 px-1">
          <AppLogo size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">SAID</div>
            <div className="text-[11px] text-slate-500">v1.0.0</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive ? 'bg-brand/15 text-brand-dark dark:text-emerald-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3 text-xs text-slate-500">
          <div>{user?.name} · {user?.role}</div>
          <button type="button" className="btn-outline w-full !text-xs" onClick={toggleDark}>
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            type="button"
            className="btn-outline w-full !text-xs"
            onClick={() => {
              logout()
              nav('/login')
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 max-w-6xl">
        <Outlet />
      </main>
      <HelpPanel />
    </div>
  )
}
