import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const PAGE_MAP = [
  { match: /^\/invoices/, key: 'invoice', label: 'Invoice Settings' },
  { match: /^\/quotes/, key: 'quote', label: 'Quote Settings' },
  { match: /^\/credits/, key: 'credit', label: 'Credit Settings' },
  { match: /^\/tickets/, key: 'ticket', label: 'Ticket Settings' },
  { match: /^\/clients/, key: 'client', label: 'Client Settings' },
  { match: /^\/documents/, key: 'documents', label: 'Document Settings' },
  { match: /^\/ageing/, key: 'ageing', label: 'Ageing Settings' },
]

const TABS = ['General', 'Appearance', 'Defaults', 'Notifications', 'Advanced']

function detectPage(pathname) {
  for (const p of PAGE_MAP) {
    if (p.match.test(pathname)) return p
  }
  return null
}

export default function PageSettingsSidebar({ open, onClose }) {
  const location = useLocation()
  const { notify } = useAuth()
  const page = detectPage(location.pathname)
  const [tab, setTab] = useState('General')
  const [prefs, setPrefs] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const panelRef = useRef(null)

  const load = useCallback(() => {
    if (!page) return
    setLoading(true)
    api(`/api/v1/page-prefs/${page.key}`)
      .then((r) => setPrefs(r.data.prefs || {}))
      .catch(() => setPrefs({}))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => {
    if (open && page) load()
  }, [open, page, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Swipe: right-edge → left opens page settings; left→right closes
  useEffect(() => {
    let startX = 0
    let startY = 0
    let tracking = false
    const EDGE = 72 // px from right edge
    const onStart = (e) => {
      if (!e.touches || e.touches.length !== 1) return
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      tracking = startX >= window.innerWidth - EDGE || open
    }
    const onEnd = (e) => {
      if (!tracking || !e.changedTouches?.length) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return
      // swipe left (dx negative) from right edge → open
      if (dx < -50 && startX >= window.innerWidth - EDGE) {
        if (page) window.dispatchEvent(new CustomEvent('said:open-page-settings'))
      }
      // swipe right while open → close
      if (dx > 50 && open) onClose()
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [open, onClose, page])

  const save = async (patch) => {
    if (!page) return
    setSaving(true)
    const next = { ...prefs, ...patch }
    setPrefs(next)
    try {
      await api(`/api/v1/page-prefs/${page.key}`, { method: 'PUT', body: { prefs: next } })
      notify('Settings saved', 'success')
    } catch (e) {
      notify(e.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    if (!page) return
    try {
      const r = await api(`/api/v1/page-prefs/${page.key}`, { method: 'DELETE' })
      setPrefs(r.data.prefs || {})
      notify('Reset to defaults', 'success')
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  if (!page) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-label={page.label}
        className={`fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out dark:border-slate-700 dark:bg-slate-900 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{page.label}</h2>
            <p className="text-xs text-slate-500">Page-specific · only applies here</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2 dark:border-slate-700">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === t
                  ? 'bg-accent/15 text-accent'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <PrefsForm pageKey={page.key} tab={tab} prefs={prefs} onChange={save} saving={saving} />
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={reset}
            className="text-xs text-slate-500 hover:text-red-600"
          >
            Reset to defaults
          </button>
          <span className="text-xs text-slate-400">{saving ? 'Saving…' : 'Auto-saved'}</span>
        </footer>
      </aside>
    </>
  )
}

function PrefsForm({ pageKey, tab, prefs, onChange, saving }) {
  const set = (key, value) => onChange({ [key]: value })

  if (tab === 'General' || tab === 'Defaults') {
    if (pageKey === 'invoice') {
      return (
        <div className="space-y-4">
          <Toggle label="Show devices field" checked={!!prefs.show_devices} onChange={(v) => set('show_devices', v)} />
          <Toggle label="Show technician field" checked={!!prefs.show_technician} onChange={(v) => set('show_technician', v)} />
          <Toggle label="Show PO number" checked={!!prefs.show_po} onChange={(v) => set('show_po', v)} />
          <Toggle label="Auto-number invoices" checked={!!prefs.auto_number} onChange={(v) => set('auto_number', v)} />
          <Field label="Default payment terms">
            <textarea
              className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
              rows={3}
              value={prefs.default_payment_terms || ''}
              onChange={(e) => set('default_payment_terms', e.target.value)}
              onBlur={(e) => set('default_payment_terms', e.target.value)}
            />
          </Field>
          <Field label="Default VAT %">
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
              value={prefs.default_vat_rate ?? 15}
              onChange={(e) => set('default_vat_rate', Number(e.target.value))}
            />
          </Field>
        </div>
      )
    }
    if (pageKey === 'ticket') {
      return (
        <div className="space-y-4">
          <Field label="Default priority">
            <select
              className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
              value={prefs.default_priority || 'normal'}
              onChange={(e) => set('default_priority', e.target.value)}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
          <Field label="Default category">
            <input
              className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
              value={prefs.default_category || ''}
              onChange={(e) => set('default_category', e.target.value)}
            />
          </Field>
          <Toggle label="Auto-start timer on open" checked={!!prefs.auto_timer} onChange={(v) => set('auto_timer', v)} />
          <Field label="Billable increment (minutes)">
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
              value={prefs.billable_increment_minutes ?? 15}
              onChange={(e) => set('billable_increment_minutes', Number(e.target.value))}
            />
          </Field>
          <Field label="Default SLA hours">
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
              value={prefs.sla_hours ?? 24}
              onChange={(e) => set('sla_hours', Number(e.target.value))}
            />
          </Field>
          <Toggle label="Require photo on close" checked={!!prefs.require_photo} onChange={(v) => set('require_photo', v)} />
          <Toggle label="Require signature" checked={!!prefs.require_signature} onChange={(v) => set('require_signature', v)} />
        </div>
      )
    }
    if (pageKey === 'quote') {
      return (
        <div className="space-y-4">
          <Field label="Validity (days)">
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
              value={prefs.validity_days ?? 14}
              onChange={(e) => set('validity_days', Number(e.target.value))}
            />
          </Field>
          <Toggle label="Draft watermark" checked={!!prefs.watermark} onChange={(v) => set('watermark', v)} />
        </div>
      )
    }
    if (pageKey === 'ageing') {
      return (
        <div className="space-y-4">
          <Toggle label="Include credits" checked={!!prefs.include_credits} onChange={(v) => set('include_credits', v)} />
          <p className="text-xs text-slate-500">Buckets: {(prefs.buckets || [30, 60, 90, 120]).join(' / ')} days</p>
        </div>
      )
    }
  }

  if (tab === 'Notifications') {
    return (
      <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <p>Reminder cadence and notification channels for this page will appear here in a later Expert update.</p>
        {pageKey === 'invoice' && (
          <p className="text-xs">Current reminder days: {(prefs.reminder_days || [7, 3, 0]).join(', ')}</p>
        )}
      </div>
    )
  }

  if (tab === 'Appearance' || tab === 'Advanced') {
    return (
      <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <p>
          {tab === 'Appearance'
            ? 'Logo size, colour accents and template overrides for this page.'
            : 'Power-user options, keyboard shortcuts and experimental flags.'}
        </p>
        <p className="text-xs text-slate-400">More controls shipping in EA-Q1 remaining items.</p>
      </div>
    )
  }

  return <p className="text-sm text-slate-500">No settings for this tab yet.</p>
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-600'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </label>
  )
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}

/** Hook used by Shell to open/close and keyboard shortcut */
export function usePageSettings() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const page = detectPage(location.pathname)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('said:open-page-settings', onOpen)
    return () => window.removeEventListener('said:open-page-settings', onOpen)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('input,textarea,select,[contenteditable]')) return
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        if (page) setOpen((v) => !v)
      }
      if (e.key === ']' && page) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page])

  return { open, setOpen, page, hasPageSettings: !!page }
}
