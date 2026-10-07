import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import PageHeader from '../components/PageHeader'

const BUSINESS_TYPES = [
  'general', 'pc_repair', 'it', 'msp', 'construction', 'plumbing', 'electrical',
  'hvac', 'consulting', 'legal', 'accounting', 'retail', 'hospitality',
  'medical', 'dental', 'automotive', 'property', 'education', 'manufacturing',
]

const ACCENTS = ['#007A4D', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#1e293b']

export default function Settings() {
  const { notify, user } = useAuth()
  const { prefs, setPrefs, reset } = useTheme()
  const isAdmin = user?.role === 'owner' || user?.role === 'admin'
  const [company, setCompany] = useState({})
  const [settings, setSettings] = useState({})
  const [tplCount, setTplCount] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api('/api/v1/settings').then((r) => {
      setCompany(r.data.company || {})
      setSettings(r.data.settings || {})
    }).catch((e) => notify(e.message, 'error'))
    api('/api/v1/documents/templates').then((r) => setTplCount(r.total || r.data?.length || 0)).catch(() => {})
  }, [])

  const save = async (e) => {
    e.preventDefault()
    if (!isAdmin) return notify('Admin required', 'error')
    setSaving(true)
    try {
      const r = await api('/api/v1/settings', { method: 'PUT', body: { company, settings } })
      setCompany(r.data.company)
      setSettings(r.data.settings)
      notify('Settings saved')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const setC = (k, v) => setCompany({ ...company, [k]: v })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        subtitle="Company · appearance · business defaults"
        meta={[`${tplCount} templates`, prefs.style, prefs.mode]}
      />

      <div className="card p-4 space-y-4">
        <h2 className="font-bold text-sm">Appearance (glass theme)</h2>
        <p className="text-xs text-slate-500">Saved on this device. Double-tap or press G to toggle glass.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Mode</label>
            <select className="input" value={prefs.mode} onChange={(e) => setPrefs({ mode: e.target.value })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div>
            <label className="label">Style</label>
            <select className="input" value={prefs.style} onChange={(e) => setPrefs({ style: e.target.value })}>
              <option value="glass">Glass</option>
              <option value="solid">Solid</option>
            </select>
          </div>
          <div>
            <label className="label">Density</label>
            <select className="input" value={prefs.density} onChange={(e) => setPrefs({ density: e.target.value })}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="roomy">Roomy</option>
            </select>
          </div>
          <div>
            <label className="label">Blur ({prefs.blur}px)</label>
            <input type="range" min="4" max="40" value={prefs.blur} onChange={(e) => setPrefs({ blur: Number(e.target.value) })} className="w-full" />
          </div>
          <div>
            <label className="label">Glass opacity ({Math.round(prefs.opacity * 100)}%)</label>
            <input type="range" min="40" max="95" value={Math.round(prefs.opacity * 100)} onChange={(e) => setPrefs({ opacity: Number(e.target.value) / 100 })} className="w-full" />
          </div>
          <div>
            <label className="label">Corner radius ({prefs.radius}px)</label>
            <input type="range" min="4" max="28" value={prefs.radius} onChange={(e) => setPrefs({ radius: Number(e.target.value) })} className="w-full" />
          </div>
        </div>
        <div>
          <label className="label">Accent colour</label>
          <div className="flex flex-wrap gap-2 items-center">
            {ACCENTS.map((c) => (
              <button key={c} type="button" title={c}
                className={`h-8 w-8 rounded-full border-2 ${prefs.accent === c ? 'border-slate-900 dark:border-white scale-110' : 'border-transparent'}`}
                style={{ background: c }} onClick={() => setPrefs({ accent: c })} />
            ))}
            <input type="color" value={prefs.accent} onChange={(e) => setPrefs({ accent: e.target.value })} className="h-8 w-10 cursor-pointer" />
          </div>
        </div>
        <button type="button" className="btn-outline !text-xs" onClick={reset}>Reset appearance</button>
      </div>

      <form className="space-y-4" onSubmit={save}>
        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-sm">Company profile</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[['name', 'Company name'], ['email', 'Email'], ['phone', 'Phone'], ['vat_number', 'VAT number'],
              ['address', 'Address'], ['website', 'Website'], ['bank_name', 'Bank name'],
              ['account_number', 'Account number'], ['branch_code', 'Branch code'], ['invoice_prefix', 'Invoice prefix']
            ].map(([k, label]) => (
              <div key={k}>
                <label className="label">{label}</label>
                <input className="input" value={company[k] || ''} onChange={(e) => setC(k, e.target.value)} disabled={!isAdmin} />
              </div>
            ))}
            <div>
              <label className="label">Business type</label>
              <select className="input" value={company.business_type || 'general'} onChange={(e) => setC('business_type', e.target.value)} disabled={!isAdmin}>
                {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Default VAT %</label>
              <input className="input" type="number" value={company.default_vat_rate ?? 15} onChange={(e) => setC('default_vat_rate', Number(e.target.value))} disabled={!isAdmin} />
            </div>
          </div>
        </div>
        {isAdmin && (
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save company settings'}</button>
        )}
        {!isAdmin && <p className="text-xs text-amber-600">Sign in as admin to edit company settings.</p>}
      </form>
    </div>
  )
}
