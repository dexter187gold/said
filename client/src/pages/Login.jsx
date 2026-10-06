import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AppLogo from '../components/AppLogo'

const SPLASH_MS = 5000

export default function Login() {
  const { login, register, user, notify } = useAuth()
  const nav = useNavigate()
  const [mode, setMode] = useState('in')
  const [form, setForm] = useState({ email: '', password: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [splash, setSplash] = useState(() => sessionStorage.getItem('said_splash') !== '1')
  const [fade, setFade] = useState(false)

  useEffect(() => {
    if (user) nav('/', { replace: true })
  }, [user, nav])

  useEffect(() => {
    if (!splash) return
    const t1 = setTimeout(() => setFade(true), SPLASH_MS - 400)
    const t2 = setTimeout(() => {
      setSplash(false)
      sessionStorage.setItem('said_splash', '1')
    }, SPLASH_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [splash])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'in') await login(form.email, form.password)
      else await register({ email: form.email, password: form.password, name: form.name || form.email })
      notify('Welcome to SAID')
      nav('/')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-gradient-to-br from-slate-950 via-slate-900 to-brand p-4">
      {splash && (
        <div
          className={`fixed inset-0 z-50 grid place-items-center bg-gradient-to-br from-slate-950 to-brand transition-all duration-500 ${
            fade ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <div className="text-center text-emerald-50">
            <AppLogo size={96} />
            <div className="mt-4 text-sm font-extrabold tracking-[0.25em]">SA INVOICE DESK</div>
            <p className="mt-1 text-xs text-emerald-100/70">Invoices · Tickets · Documents</p>
            <div className="mx-auto mt-6 h-1 w-28 overflow-hidden rounded-full bg-white/20">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-white" />
            </div>
          </div>
        </div>
      )}

      <div className="card w-full max-w-md border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl">
        <div className="mb-4 flex justify-center">
          <AppLogo size={64} />
        </div>
        <h1 className="text-center text-lg font-extrabold tracking-wide">SAID</h1>
        <p className="mb-4 text-center text-xs text-emerald-100/70">Express · Puppeteer · Tailwind</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button type="button" className={`rounded-xl py-2 text-sm font-semibold ${mode === 'in' ? 'bg-brand' : 'bg-white/10'}`} onClick={() => setMode('in')}>
            Sign in
          </button>
          <button type="button" className={`rounded-xl py-2 text-sm font-semibold ${mode === 'up' ? 'bg-brand' : 'bg-white/10'}`} onClick={() => setMode('up')}>
            Register
          </button>
        </div>
        <form className="space-y-3" onSubmit={submit}>
          {mode === 'up' && (
            <div>
              <label className="label text-emerald-100/80">Name</label>
              <input className="input border-white/20 bg-slate-950/40 text-white" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          )}
          <div>
            <label className="label text-emerald-100/80">Email</label>
            <input className="input border-white/20 bg-slate-950/40 text-white" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label text-emerald-100/80">Password</label>
            <input className="input border-white/20 bg-slate-950/40 text-white" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <button className="btn-primary w-full" disabled={busy} type="submit">
            {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="mt-4 text-center text-[11px] text-emerald-100/50">Default: admin@said.local / admin123</p>
      </div>
    </div>
  )
}
