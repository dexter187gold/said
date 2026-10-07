import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../context/I18nContext'
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
  const { locale, setLocale, t } = useI18n()
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
  const [sec, setSec] = useState({ current: '', next: '', otp: '', busy: false })
  const [tab, setTab] = useState('company')
  const TABS = [
    { id: 'company', label: 'Company' },
    { id: 'invoice', label: 'Invoices' },
    { id: 'tickets', label: 'Tickets' },
    { id: 'documents', label: 'Documents' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'security', label: 'Security' },
  ]
  const [templates, setTemplates] = useState([])

  useEffect(() => {
    api('/api/v1/settings')
      .then((r) => {
        setCompany(r.data.company || {})
        setSettings((s) => ({ ...s, ...(r.data.settings || {}) }))
      })
      .catch((e) => notify(e.message, 'error'))
    api('/api/v1/documents/templates')
      .then((r) => {
        setTplCount(r.total || r.data?.length || 0)
        setTemplates(r.data || [])
      })
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
  const onLogo = (file) => {
    if (!file || !isAdmin) return
    if (file.size > 800_000) return notify('Logo max ~800KB', 'error')
    const reader = new FileReader()
    reader.onload = () => setC('logo_url', reader.result)
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('settings')}
        subtitle="Company · invoice · tickets · security · appearance · tabs"
        meta={[`${tplCount} templates`, prefs.style, `R${settings.hourly_rate || 450}/hr`]}
      />

      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === t.id
                ? 'bg-accent/15 text-accent'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      
      {tab === 'documents' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="font-bold text-sm">3-way document model</h2>
            <p className="text-xs text-slate-500">
              <strong>Layer 1 — Layout:</strong> blank system template (structure only).<br/>
              <strong>Layer 2 — Company:</strong> your logo, VAT, bank, address filled in automatically.<br/>
              <strong>Layer 3 — Instance:</strong> this client, lines, dates, status for the live document.
            </p>
            <div>
              <label className="label">Default invoice layout template</label>
              <select
                className="input"
                value={company.invoice_template_id || 'tax_invoice_full'}
                onChange={(e) => setC('invoice_template_id', e.target.value)}
                disabled={!isAdmin}
              >
                <option value="tax_invoice_full">Tax invoice (full)</option>
                {templates.filter((x) => /invoice|tax|quote/i.test(x.category + x.label + x.id)).map((x) => (
                  <option key={x.id} value={x.id}>{x.label} ({x.category})</option>
                ))}
                {templates.length > 0 && templates.slice(0, 40).map((x) => (
                  <option key={`all-${x.id}`} value={x.id}>{x.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 mt-1">{tplCount} templates available · used when PDF is generated</p>
            </div>
            <div>
              <label className="label">Business type (filters suggested templates)</label>
              <select className="input" value={company.business_type || 'general'} onChange={(e) => setC('business_type', e.target.value)} disabled={!isAdmin}>
                {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

{tab === 'appearance' && <div className="card p-4 space-y-4">
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
        {tab === 'invoice' && (
        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-sm">Invoice preferences</h2>
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
        )}

        {tab === 'tickets' && (
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
        )}

        {tab === 'company' && (
        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-sm">Company profile</h2>
          <div className="flex flex-wrap items-center gap-3">
            {company.logo_url ? (
              <img src={company.logo_url} alt="Logo" className="h-14 max-w-[160px] object-contain rounded-lg border border-white/10 bg-white/50 p-1" />
            ) : (
              <div className="h-14 w-28 rounded-lg border border-dashed border-slate-300 grid place-items-center text-[10px] text-slate-400">No logo</div>
            )}
            <div>
              <label className="label">Logo upload</label>
              <input type="file" accept="image/*" className="text-xs" disabled={!isAdmin}
                onChange={(e) => onLogo(e.target.files?.[0])} />
              <p className="text-[10px] text-slate-500 mt-0.5">PNG/JPG · max ~800KB · used on docs</p>
              {company.logo_url && isAdmin && (
                <button type="button" className="btn-ghost !text-[10px] !px-1" onClick={() => setC('logo_url', '')}>Remove</button>
              )}
            </div>
          </div>
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
        )}

        {isAdmin && (tab === 'company' || tab === 'invoice' || tab === 'tickets') && (
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save all settings'}</button>
        )}
        {!isAdmin && (tab === 'company' || tab === 'invoice' || tab === 'tickets') && (
          <p className="text-xs text-amber-600">Sign in as admin to edit company & rates.</p>
        )}
      </form>

      {tab === 'security' && (
      <div className="card p-4 space-y-3">
        <h2 className="font-bold text-sm">Security & privacy</h2>
        <p className="text-xs text-slate-500">2FA · password · POPIA export · database backup · language</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t('language')}</label>
            <select className="input" value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="en">English</option>
              <option value="af">Afrikaans</option>
              <option value="zu">isiZulu</option>
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" className="btn-outline !text-xs" disabled={sec.busy} onClick={async () => {
              setSec((s) => ({ ...s, busy: true }))
              try {
                const r = await api('/api/v1/auth/2fa/enable', { method: 'POST' })
                setSec((s) => ({ ...s, otp: '', busy: false }))
                if (r.data?.dev_otp) notify(`Dev OTP: ${r.data.dev_otp}`)
                else notify('OTP sent to your email')
              } catch (e) { notify(e.message, 'error'); setSec((s) => ({ ...s, busy: false })) }
            }}>Enable 2FA (email OTP)</button>
            <button type="button" className="btn-ghost !text-xs" onClick={async () => {
              try {
                await api('/api/v1/auth/2fa/confirm', { method: 'POST', body: { code: sec.otp || '000000', enable: false } })
                notify('2FA disabled')
              } catch (e) { notify(e.message, 'error') }
            }}>Disable 2FA</button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className="input" placeholder="OTP to confirm 2FA enable" value={sec.otp} onChange={(e) => setSec({ ...sec, otp: e.target.value })} />
          <button type="button" className="btn-primary !text-xs" onClick={async () => {
            try {
              await api('/api/v1/auth/2fa/confirm', { method: 'POST', body: { code: sec.otp, enable: true } })
              notify('2FA enabled')
            } catch (e) { notify(e.message, 'error') }
          }}>Confirm enable</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className="input" type="password" placeholder="Current password" value={sec.current} onChange={(e) => setSec({ ...sec, current: e.target.value })} />
          <input className="input" type="password" placeholder="New password" value={sec.next} onChange={(e) => setSec({ ...sec, next: e.target.value })} />
          <button type="button" className="btn-outline !text-xs" onClick={async () => {
            try {
              await api('/api/v1/auth/password', { method: 'POST', body: { current: sec.current, next: sec.next } })
              notify('Password updated')
              setSec((s) => ({ ...s, current: '', next: '' }))
            } catch (e) { notify(e.message, 'error') }
          }}>Change password</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline !text-xs" onClick={async () => {
            try {
              const res = await api('/api/v1/auth/me/export', { raw: true })
              const blob = await res.blob()
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'said-popia-export.json'; a.click()
              notify(t('popia_export'))
            } catch (e) { notify(e.message, 'error') }
          }}>{t('popia_export')}</button>
          {isAdmin && (
            <button type="button" className="btn-outline !text-xs" onClick={async () => {
              try {
                const res = await api('/api/v1/auth/backup', { raw: true })
                if (!res.ok) throw new Error('Backup failed')
                const blob = await res.blob()
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'said-backup.db'; a.click()
                notify(t('backup'))
              } catch (e) { notify(e.message, 'error') }
            }}>{t('backup')}</button>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
