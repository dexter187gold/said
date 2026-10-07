import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AppLogo from '../components/AppLogo'

const TYPES = [
  'general', 'pc_repair', 'it', 'msp', 'construction', 'plumbing', 'electrical',
  'consulting', 'retail', 'hospitality', 'medical', 'automotive', 'property', 'education',
]

export default function Setup() {
  const { completeSetup, notify, user } = useAuth()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: user?.email || '',
    phone: '',
    vat_number: '',
    address: '',
    business_type: 'general',
    bank_name: '',
    account_number: '',
    branch_code: '',
  })

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || form.name.trim().length < 2) {
      return notify('Company name is required', 'error')
    }
    setBusy(true)
    try {
      await completeSetup(form)
      notify('Company setup complete')
      nav('/', { replace: true })
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-10 right-10 h-64 w-64 rounded-full opacity-30 blur-3xl" style={{ background: 'var(--said-accent)' }} />
      </div>
      <div className="card glass-panel w-full max-w-lg p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <AppLogo size={48} />
          <div>
            <h1 className="text-xl font-extrabold">Company setup</h1>
            <p className="text-xs text-slate-500">One-time profile for invoices & documents</p>
          </div>
        </div>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Company name *</label>
              <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Your business name" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="label">VAT number</label>
              <input className="input" value={form.vat_number} onChange={(e) => set('vat_number', e.target.value)} />
            </div>
            <div>
              <label className="label">Business type</label>
              <select className="input" value={form.business_type} onChange={(e) => set('business_type', e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div>
              <label className="label">Bank</label>
              <input className="input" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} placeholder="FNB / Standard / Capitec…" />
            </div>
            <div>
              <label className="label">Account number</label>
              <input className="input" value={form.account_number} onChange={(e) => set('account_number', e.target.value)} />
            </div>
            <div>
              <label className="label">Branch code</label>
              <input className="input" value={form.branch_code} onChange={(e) => set('branch_code', e.target.value)} />
            </div>
          </div>
          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Finish setup & open dashboard'}
          </button>
        </form>
      </div>
    </div>
  )
}
