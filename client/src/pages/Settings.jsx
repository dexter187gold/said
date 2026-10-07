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
  const [settings, setSettings] = useState({
    hourly_rate: 450,
    billable_increment_minutes: 15,
    ticket_auto_timer: '0',
    default_priority: 'normal',
    default_ticket_category: 'support',
  })
  const [tplCount, setTplCount] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api('/api/v1/settings')
      .then((r) => {
        setCompany(r.data.company || {})
        setSettings((s) => ({ ...s, ...(r.data.settings || {}) }))
      })
      .catch((e) => notify(e.message, 'error'))
    api('/api/v1/documents/templates')
      .then((r) => setTplCount(r.total || r.data?.length || 0))
      .catch(() => {})
  }, [])

  const save = async (e) => {
    e.preventDefault()
    if (!isAdmin) return notify('Admin required', 'error')
    setSaving(true)
    try {
      const r = await api('/api/v1/settings', {
        method: 'PUT',
        body: {
          company,
          settings: {
            hourly_rate: Number(settings.hourly_rate) || 450,
            billable_increment_minutes: Number(settings.billable_increment_minutes) || 15,
            ticket_auto_timer: String(settings.ticket_auto_timer || '0'),
            default_priority: settings.default_priority || 'normal',
            default_ticket_category: settings.default_ticket_category || 'support',
          },
        },
      })
      setCompany(r.data.company)
      setSettings((s) => ({ ...s, ...(r.data.settings || {}) }))
      notify('Settings saved')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const setC = (k, v) => setCompany({ ...company, [k]: v })
  const setS = (k, v) => setSettings({ ...settings, [k]: v })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        subtitle="Company · invoice preferences · tickets · appearance"
        meta={[`${tplCount} templates`, prefs.style, `R${settings.hourly_rate || 450}/hr`]}
      />

      <div className="card p-4 space-y-4">
        <h2 className="font-bold text-sm">Appearance (glass theme)</h2>
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
        </div>
        <div>
          <label className="label">Accent colour</label>
          <div className="flex flex-wrap gap-2 items-center">
            {ACCENTS.map((c) => (
              <button key={c} type="button" className={`h-8 w-8 rounded-full border-2 ${prefs.accent === c ? 'border-slate-900 dark:border-white scale-110' : 'border-transparent'}`}
                style={{ background: c }} onClick={() => setPrefs({ accent: c })} />
            ))}
            <input type="color" value={prefs.accent} onChange={(e) => setPrefs({ accent: e.target.value })} className="h-8 w-10 cursor-pointer" />
          </div>
        </div>
        <button type="button" className="btn-outline !text-xs" onClick={reset}>Reset appearance</button>
      </div>

      <form className="space-y-4" onSubmit={save}>
        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-sm">Invoice preferences</h2>
          <p className="text-xs text-slate-500">Used when billing ticket hours to an invoice</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Hourly labour rate (ZAR)</label>
              <input className="input" type="number" min="1" value={settings.hourly_rate ?? 450}
                onChange={(e) => setS('hourly_rate', e.target.value)} disabled={!isAdmin} />
            </div>
            <div>
              <label className="label">Billable round-up (minutes)</label>
              <input className="input" type="number" min="1" max="60" value={settings.billable_increment_minutes ?? 15}
                onChange={(e) => setS('billable_increment_minutes', e.target.value)} disabled={!isAdmin} />
            </div>
            <div>
              <label className="label">Default VAT %</label>
              <input className="input" type="number" value={company.default_vat_rate ?? 15}
                onChange={(e) => setC('default_vat_rate', Number(e.target.value))} disabled={!isAdmin} />
            </div>
            <div>
              <label className="label">Invoice prefix</label>
              <input className="input" value={company.invoice_prefix || ''} onChange={(e) => setC('invoice_prefix', e.target.value)} disabled={!isAdmin} />
            </div>
            <div>
              <label className="label">Currency</label>
              <input className="input" value={company.currency || 'ZAR'} onChange={(e) => setC('currency', e.target.value)} disabled={!isAdmin} />
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-sm">Ticket defaults</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Default priority</label>
              <select className="input" value={settings.default_priority || 'normal'} onChange={(e) => setS('default_priority', e.target.value)} disabled={!isAdmin}>
                {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Default category</label>
              <select className="input" value={settings.default_ticket_category || 'support'} onChange={(e) => setS('default_ticket_category', e.target.value)} disabled={!isAdmin}>
                {['support', 'repair', 'install', 'onsite', 'remote', 'jobcard', 'other'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Auto-start timer on open</label>
              <select className="input" value={String(settings.ticket_auto_timer || '0')} onChange={(e) => setS('ticket_auto_timer', e.target.value)} disabled={!isAdmin}>
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-sm">Company profile</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[['name', 'Company name'], ['email', 'Email'], ['phone', 'Phone'], ['vat_number', 'VAT number'],
              ['address', 'Address'], ['website', 'Website'], ['bank_name', 'Bank name'],
              ['account_number', 'Account number'], ['branch_code', 'Branch code']
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
          </div>
        </div>

        {isAdmin && (
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save all settings'}</button>
        )}
        {!isAdmin && <p className="text-xs text-amber-600">Sign in as admin to edit company & rates.</p>}
      </form>
    </div>
  )
}
