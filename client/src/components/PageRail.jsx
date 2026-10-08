import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const PAGE_KEYS = {
  invoices: 'page_prefs_invoices',
  quotes: 'page_prefs_quotes',
  credits: 'page_prefs_credits',
  tickets: 'page_prefs_tickets',
  clients: 'page_prefs_clients',
  documents: 'page_prefs_documents',
  ageing: 'page_prefs_ageing',
  home: 'page_prefs_dashboard',
}

function resolvePage(pathname) {
  if (pathname.startsWith('/invoices')) return 'invoices'
  if (pathname.startsWith('/quotes')) return 'quotes'
  if (pathname.startsWith('/credits')) return 'credits'
  if (pathname.startsWith('/tickets')) return 'tickets'
  if (pathname.startsWith('/clients')) return 'clients'
  if (pathname.startsWith('/documents')) return 'documents'
  if (pathname.startsWith('/ageing')) return 'ageing'
  if (pathname === '/' || pathname.startsWith('/dashboard')) return 'home'
  return null
}

const DEFAULTS = {
  invoices: { default_status: '', show_totals: true, density: 'comfortable', auto_open_pdf: false, whatsapp_template: 'Hi, please find invoice {{number}} for R{{total}}.' },
  quotes: { default_status: '', show_totals: true, density: 'comfortable', expiry_days: 14, whatsapp_template: 'Hi, quote {{number}} is ready for your review.' },
  credits: { default_status: '', show_totals: true, density: 'comfortable' },
  tickets: { default_view: 'table', default_priority: 'normal', auto_timer: false, show_sla: true, density: 'comfortable' },
  clients: { density: 'comfortable', show_credit_limit: true },
  documents: { preview_mode: 'live', default_category: '' },
  ageing: { bucket_days: '30,60,90,120' },
  home: { show_cashflow: true, show_tickets: true },
}

const TITLES = {
  invoices: 'Invoice settings', quotes: 'Quote settings', credits: 'Credit note settings',
  tickets: 'Ticket settings', clients: 'Client settings', documents: 'Document settings',
  ageing: 'Ageing settings', home: 'Dashboard settings',
}

export default function PageRail({ open, onOpenChange }) {
  const location = useLocation()
  const { notify, user } = useAuth()
  const page = resolvePage(location.pathname)
  const [prefs, setPrefs] = useState({})
  const [saving, setSaving] = useState(false)
  const isAdmin = user?.role === 'owner' || user?.role === 'admin'

  useEffect(() => {
    if (!page) return
    const key = PAGE_KEYS[page]
    api('/api/v1/settings')
      .then((r) => {
        const raw = r.data?.settings?.[key]
        const base = { ...DEFAULTS[page] }
        if (raw && typeof raw === 'object') Object.assign(base, raw)
        setPrefs(base)
      })
      .catch(() => setPrefs({ ...DEFAULTS[page] }))
  }, [page])

  const title = useMemo(() => (page ? TITLES[page] : 'Page settings'), [page])
  if (!page) return null
  const set = (k, v) => setPrefs((p) => ({ ...p, [k]: v }))

  const save = async () => {
    if (!isAdmin) return notify('Admin required to save page defaults', 'error')
    setSaving(true)
    try {
      await api('/api/v1/settings', { method: 'PUT', body: { settings: { [PAGE_KEYS[page]]: prefs } } })
      try { localStorage.setItem(PAGE_KEYS[page], JSON.stringify(prefs)) } catch {}
      notify('Page settings saved')
      onOpenChange?.(false)
    } catch (e) { notify(e.message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <>
      {open && (
        <button type="button" aria-label="Close page settings" className="fixed inset-0 z-[55] bg-black/30 backdrop-blur-[1px]" onClick={() => onOpenChange?.(false)} />
      )}
      <aside className={`fixed top-0 right-0 z-[60] flex h-dvh w-[min(100vw,20rem)] flex-col border-l border-white/20 dark:border-white/10 glass-panel p-3 transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="mb-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate">{title}</div>
            <div className="text-[10px] text-slate-500">Swipe from right · \\ key</div>
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => onOpenChange?.(false)}>✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 text-sm">
          {(page === 'invoices' || page === 'quotes' || page === 'credits') && (
            <>
              <div>
                <label className="label">Default status filter</label>
                <select className="input" value={prefs.default_status || ''} onChange={(e) => set('default_status', e.target.value)}>
                  <option value="">All</option>
                  <option value="draft">Draft</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="sent">Sent</option>
                  <option value="accepted">Accepted</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!prefs.show_totals} onChange={(e) => set('show_totals', e.target.checked)} /> Show list totals</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!prefs.auto_open_pdf} onChange={(e) => set('auto_open_pdf', e.target.checked)} /> Auto-open PDF after save</label>
              <div>
                <label className="label">Density</label>
                <select className="input" value={prefs.density || 'comfortable'} onChange={(e) => set('density', e.target.value)}>
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                  <option value="roomy">Roomy</option>
                </select>
              </div>
              {page === 'quotes' && (
                <div>
                  <label className="label">Default expiry (days)</label>
                  <input className="input" type="number" min="1" max="365" value={prefs.expiry_days ?? 14} onChange={(e) => set('expiry_days', Number(e.target.value))} />
                </div>
              )}
              <div>
                <label className="label">WhatsApp message template</label>
                <textarea className="input min-h-[72px] text-xs" value={prefs.whatsapp_template || ''} onChange={(e) => set('whatsapp_template', e.target.value)} />
              </div>
            </>
          )}
          {page === 'tickets' && (
            <>
              <div>
                <label className="label">Default view</label>
                <select className="input" value={prefs.default_view || 'table'} onChange={(e) => set('default_view', e.target.value)}>
                  <option value="table">Table</option>
                  <option value="kanban">Kanban</option>
                </select>
              </div>
              <div>
                <label className="label">Default priority</label>
                <select className="input" value={prefs.default_priority || 'normal'} onChange={(e) => set('default_priority', e.target.value)}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!prefs.auto_timer} onChange={(e) => set('auto_timer', e.target.checked)} /> Suggest timer on open ticket</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!prefs.show_sla} onChange={(e) => set('show_sla', e.target.checked)} /> Show SLA countdown</label>
              <Link to="/settings" className="text-xs text-accent underline" onClick={() => onOpenChange?.(false)}>Global hourly rate →</Link>
            </>
          )}
          {page === 'clients' && (
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!prefs.show_credit_limit} onChange={(e) => set('show_credit_limit', e.target.checked)} /> Show credit limit column</label>
          )}
          {page === 'documents' && (
            <div>
              <label className="label">Preview mode</label>
              <select className="input" value={prefs.preview_mode || 'live'} onChange={(e) => set('preview_mode', e.target.value)}>
                <option value="live">Live HTML</option>
                <option value="pdf">PDF preference</option>
              </select>
            </div>
          )}
          {page === 'ageing' && (
            <div>
              <label className="label">Bucket days</label>
              <input className="input" value={prefs.bucket_days || '30,60,90,120'} onChange={(e) => set('bucket_days', e.target.value)} />
            </div>
          )}
          {page === 'home' && (
            <>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!prefs.show_cashflow} onChange={(e) => set('show_cashflow', e.target.checked)} /> Show cash cards</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!prefs.show_tickets} onChange={(e) => set('show_tickets', e.target.checked)} /> Show tickets card</label>
            </>
          )}
        </div>
        <div className="mt-3 flex gap-2 border-t border-white/10 pt-3 shrink-0">
          <button type="button" className="btn-primary flex-1 !text-xs" disabled={saving || !isAdmin} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn-outline !text-xs" onClick={() => onOpenChange?.(false)}>Close</button>
        </div>
      </aside>
    </>
  )
}

export { resolvePage, PAGE_KEYS, DEFAULTS as PAGE_DEFAULTS }
