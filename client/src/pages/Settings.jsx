import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const BUSINESS_TYPES = [
  'general', 'pc_repair', 'it', 'msp', 'construction', 'plumbing', 'electrical',
  'hvac', 'consulting', 'legal', 'accounting', 'retail', 'hospitality',
  'medical', 'dental', 'automotive', 'property', 'education', 'manufacturing',
]

export default function Settings() {
  const { notify, user } = useAuth()
  const isAdmin = user?.role === 'owner' || user?.role === 'admin'
  const [company, setCompany] = useState({})
  const [settings, setSettings] = useState({})
  const [templates, setTemplates] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api('/api/v1/settings').then((r) => {
      setCompany(r.data.company || {})
      setSettings(r.data.settings || {})
    }).catch((e) => notify(e.message, 'error'))
    api('/api/v1/documents/templates').then((r) => setTemplates(r.data || [])).catch(() => {})
  }, [])

  const save = async (e) => {
    e.preventDefault()
    if (!isAdmin) return notify('Admin required', 'error')
    setSaving(true)
    try {
      const r = await api('/api/v1/settings', {
        method: 'PUT',
        body: { company, settings },
      })
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
  const setS = (k, v) => setSettings({ ...settings, [k]: v })

  return (
    <div>
      <h1 className="text-2xl font-extrabold">Configuration</h1>
      <p className="text-sm text-slate-500">Company profile · invoice defaults · business type · preferences</p>

      <form className="mt-4 space-y-4" onSubmit={save}>
        <div className="card p-4 space-y-3">
          <h2 className="font-bold">Company profile</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['name', 'Company name'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['vat_number', 'VAT number'],
              ['address', 'Address'],
              ['website', 'Website'],
              ['bank_name', 'Bank name'],
              ['account_number', 'Account number'],
              ['branch_code', 'Branch code'],
              ['invoice_prefix', 'Invoice prefix'],
              ['currency', 'Currency'],
            ].map(([k, label]) => (
              <div key={k}>
                <label className="label">{label}</label>
                <input className="input" value={company[k] || ''} onChange={(e) => setC(k, e.target.value)} disabled={!isAdmin} />
              </div>
            ))}
            <div>
              <label className="label">Default VAT %</label>
              <input className="input" type="number" step="0.1" value={company.default_vat_rate ?? 15} onChange={(e) => setC('default_vat_rate', parseFloat(e.target.value))} disabled={!isAdmin} />
            </div>
            <div>
              <label className="label">Business type</label>
              <select className="input" value={company.business_type || 'general'} onChange={(e) => setC('business_type', e.target.value)} disabled={!isAdmin}>
                {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Default invoice template</label>
              <select className="input" value={company.invoice_template_id || ''} onChange={(e) => setC('invoice_template_id', e.target.value)} disabled={!isAdmin}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.category}: {t.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Default payment / footer note</label>
            <textarea className="input" rows={2} value={company.footer_note || ''} onChange={(e) => setC('footer_note', e.target.value)} disabled={!isAdmin} />
          </div>
          <div>
            <label className="label">Default terms</label>
            <textarea className="input" rows={2} value={company.terms_default || ''} onChange={(e) => setC('terms_default', e.target.value)} disabled={!isAdmin} />
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="font-bold">App preferences</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Default ticket priority</label>
              <select className="input" value={settings.default_priority || 'normal'} onChange={(e) => setS('default_priority', e.target.value)} disabled={!isAdmin}>
                {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Auto-start timer on ticket open</label>
              <select className="input" value={String(settings.ticket_auto_timer || '0')} onChange={(e) => setS('ticket_auto_timer', e.target.value)} disabled={!isAdmin}>
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
            </div>
          </div>
        </div>

        {isAdmin && (
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</button>
        )}
        {!isAdmin && <p className="text-xs text-amber-600">View only — admin role required to change settings.</p>}
      </form>
    </div>
  )
}
