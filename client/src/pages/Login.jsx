import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import AppLogo from '../components/AppLogo'

const SPLASH_MS = 2800

function strength(pw) {
  let s = 0
  if (pw.length >= 8) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/[0-9]/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return s
}

export default function Login() {
  const { login, login2fa, register, verifyOtp, sendOtp, loginGoogle, user, setupComplete, oauthConfig, notify } = useAuth()
  const { prefs, setPrefs } = useTheme()
  const nav = useNavigate()
  const [mode, setMode] = useState('in') // in | up | otp | 2fa
  const [form, setForm] = useState({ email: '', password: '', name: '', phone: '', otp: '' })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState({})
  const [devOtp, setDevOtp] = useState('')
  const [splash, setSplash] = useState(() => sessionStorage.getItem('said_splash') !== '1')
  const [fade, setFade] = useState(false)
  const googleBtn = useRef(null)

  useEffect(() => {
    if (!user) return
    nav(setupComplete ? '/' : '/setup', { replace: true })
  }, [user, setupComplete, nav])

  useEffect(() => {
    if (!splash) return
    const t1 = setTimeout(() => setFade(true), SPLASH_MS - 350)
    const t2 = setTimeout(() => {
      setSplash(false)
      sessionStorage.setItem('said_splash', '1')
    }, SPLASH_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [splash])

  useEffect(() => {
    if (!oauthConfig.google_enabled || !oauthConfig.google_client_id || mode === 'otp' || mode === '2fa') return
    const scriptId = 'gis-client'
    const init = () => {
      if (!window.google?.accounts?.id || !googleBtn.current) return
      window.google.accounts.id.initialize({
        client_id: oauthConfig.google_client_id,
        callback: async (resp) => {
          setBusy(true)
          try {
            const data = await loginGoogle(resp.credential)
            notify('Signed in with Google')
            nav(data.setup_complete ? '/' : '/setup', { replace: true })
          } catch (e) {
            notify(e.message, 'error')
          } finally {
            setBusy(false)
          }
        },
      })
      googleBtn.current.innerHTML = ''
      window.google.accounts.id.renderButton(googleBtn.current, {
        theme: document.documentElement.classList.contains('dark') ? 'filled_black' : 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
        shape: 'pill',
      })
    }
    if (!document.getElementById(scriptId)) {
      const s = document.createElement('script')
      s.id = scriptId
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = init
      document.body.appendChild(s)
    } else init()
  }, [oauthConfig, mode, prefs.mode])

  const validate = () => {
    const e = {}
    if (mode !== 'otp' && mode !== '2fa' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email'
    if (mode === 'up') {
      if (!form.name || form.name.trim().length < 2) e.name = 'Full name required'
      if (form.password.length < 8) e.password = 'At least 8 characters'
      else if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) e.password = 'Use letters and numbers'
    } else if (mode === 'in') {
      if (!form.password) e.password = 'Password required'
    } else if (mode === 'otp' || mode === '2fa') {
      if (!/^\d{6}$/.test(form.otp)) e.otp = 'Enter the 6-digit code'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const afterAuth = (data) => {
    notify('Welcome to SAID')
    nav(data.setup_complete ? '/' : '/setup', { replace: true })
  }

  const submit = async (ev) => {
    ev.preventDefault()
    if (!validate()) return
    setBusy(true)
    setDevOtp('')
    try {
      if (mode === 'in') {
        try {
          const data = await login(form.email, form.password)
          if (data?.requires_2fa) {
            setMode('2fa')
            setDevOtp(data.dev_otp || '')
            notify('Enter the 2FA code sent to your email')
            return
          }
          afterAuth(data)
        } catch (err) {
          if (err.code === 'EMAIL_NOT_VERIFIED' || err.status === 403) {
            setMode('otp')
            setDevOtp(err.data?.dev_otp || '')
            notify(err.message || 'Verify your email', 'error')
          } else throw err
        }
      } else if (mode === 'up') {
        const r = await register({
          email: form.email,
          password: form.password,
          name: form.name,
          phone: form.phone || undefined,
        })
        setDevOtp(r.data?.dev_otp || '')
        setMode('otp')
        notify(r.data?.message || 'OTP sent to your email')
      } else if (mode === '2fa') {
        const data = await login2fa(form.email, form.otp)
        afterAuth(data)
      } else {
        const data = await verifyOtp(form.email, form.otp, 'register')
        afterAuth(data)
      }
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setBusy(true)
    try {
      const r = await sendOtp(form.email, 'register')
      setDevOtp(r.data?.dev_otp || '')
      notify('Code resent')
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const pwScore = strength(form.password)

  return (
    <div className="relative min-h-dvh flex items-center justify-center p-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full opacity-40 blur-3xl" style={{ background: 'var(--said-accent)' }} />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full opacity-25 blur-3xl" style={{ background: 'var(--said-accent)' }} />
      </div>

      {splash && (
        <div className={`fixed inset-0 z-50 grid place-items-center transition-all duration-500 ${fade ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          style={{ background: 'radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--said-accent) 35%, #0f172a), #0f172a)' }}>
          <div className="text-center text-white">
            <AppLogo size={88} />
            <div className="mt-4 text-sm font-extrabold tracking-[0.28em]">SA INVOICE DESK</div>
            <p className="mt-1 text-xs text-white/60">Secure · SA VAT-ready · Modern</p>
          </div>
        </div>
      )}

      <div className="card glass-panel w-full max-w-[420px] p-6 sm:p-8 shadow-2xl">
        <div className="mb-5 flex flex-col items-center gap-2">
          <AppLogo size={56} />
          <h1 className="text-xl font-extrabold tracking-tight">
            {mode === '2fa' ? 'Two-factor code' : mode === 'otp' ? 'Verify email' : mode === 'up' ? 'Create account' : 'Sign in'}
          </h1>
          <p className="text-center text-xs text-slate-500">
            {mode === 'otp' || mode === '2fa'
              ? `Enter the 6-digit code sent to ${form.email}`
              : 'OAuth · email OTP · 2FA · company onboarding'}
          </p>
        </div>

        {mode !== 'otp' && mode !== '2fa' && oauthConfig.google_enabled && (
          <div className="mb-4 flex flex-col items-center gap-2">
            <div ref={googleBtn} className="min-h-[40px] w-full flex justify-center" />
            <div className="flex w-full items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              or email
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        )}

        <form className="space-y-3" onSubmit={submit} noValidate>
          {mode === 'up' && (
            <>
              <div>
                <label className="label">Full name</label>
                <input className="input" autoComplete="name" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Thabo Molefe" />
                {errors.name && <p className="mt-1 text-[11px] text-red-500">{errors.name}</p>}
              </div>
              <div>
                <label className="label">Phone (optional)</label>
                <input className="input" autoComplete="tel" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="082 000 0000" />
              </div>
            </>
          )}

          {mode !== 'otp' && mode !== '2fa' && (
            <>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" autoComplete="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.co.za" />
                {errors.email && <p className="mt-1 text-[11px] text-red-500">{errors.email}</p>}
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                  value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={mode === 'up' ? 'Min 8 chars · letters + numbers' : '••••••••'} />
                {errors.password && <p className="mt-1 text-[11px] text-red-500">{errors.password}</p>}
                {mode === 'up' && form.password && (
                  <div className="mt-1.5 flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className={`h-1 flex-1 rounded-full ${pwScore > i ? 'bg-accent' : 'bg-slate-200 dark:bg-slate-700'}`} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {(mode === 'otp' || mode === '2fa') && (
            <div>
              <label className="label">One-time code</label>
              <input className="input text-center text-2xl tracking-[0.4em] font-bold" inputMode="numeric"
                maxLength={6} value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                placeholder="000000" autoFocus />
              {errors.otp && <p className="mt-1 text-[11px] text-red-500">{errors.otp}</p>}
              {devOtp && (
                <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                  Dev OTP: <strong className="tracking-widest">{devOtp}</strong> (SMTP not configured)
                </p>
              )}
              {mode === 'otp' && (
                <button type="button" className="btn-ghost !text-xs mt-2 w-full" disabled={busy} onClick={resend}>
                  Resend code
                </button>
              )}
            </div>
          )}

          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'otp' || mode === '2fa' ? 'Verify & continue' : mode === 'up' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          {mode === 'otp' || mode === '2fa' ? (
            <button type="button" className="hover:text-accent" onClick={() => setMode(mode === '2fa' ? 'in' : 'up')}>← Back</button>
          ) : (
            <button type="button" className="hover:text-accent" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
              {mode === 'in' ? 'Need an account? Register' : 'Have an account? Sign in'}
            </button>
          )}
          <button type="button" className="hover:text-accent" onClick={() => setPrefs({ style: prefs.style === 'glass' ? 'solid' : 'glass' })}>
            {prefs.style === 'glass' ? 'Glass' : 'Solid'} theme
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] text-slate-400">
          Demo admin: admin@said.local / admin123
        </p>
      </div>
    </div>
  )
}
