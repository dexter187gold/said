import React, { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'

const DEFAULT_VARS = {
  client_name: 'Sample Client Pty Ltd',
  client_address: '1 Main Rd, Johannesburg',
  client_email: 'client@example.com',
  client_phone: '011 555 0100',
  company_name: '',
  company_address: '',
  company_phone: '',
  vat_number: '',
  amount_due: '1,250.00',
  invoice_number: 'INV-0001',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
  payment_note: 'EFT preferred. Use invoice number as reference.',
  site_address: 'Client site',
  technician: 'Tech team',
  devices: 'Laptop / desktop',
  service_type: 'Support',
  serials: '',
  notes: 'Thank you for your business.',
  date: new Date().toISOString().slice(0, 10),
  total: '1,250.00',
  exclusive: '1,087.00',
  vat_amount: '163.00',
  bank_name: '',
  account_number: '',
  branch_code: '',
  po_number: 'PO-100',
  supplier_name: 'Supplier Co',
  line_items_html: '<tr><td>Sample item</td><td>1</td><td>R 1,087.00</td><td>R 1,087.00</td></tr>',
}

function fill(html, vars) {
  return String(html || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : `{{${k}}}`
  )
}

export default function Documents() {
  const { notify } = useAuth()
  const [templates, setTemplates] = useState([])
  const [categories, setCategories] = useState([])
  const [category, setCategory] = useState('')
  const [business, setBusiness] = useState('')
  const [q, setQ] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [tplHtml, setTplHtml] = useState('')
  const [vars, setVars] = useState(DEFAULT_VARS)
  const [total, setTotal] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [loadingTpl, setLoadingTpl] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('preview')
  const [services, setServices] = useState([])

  const load = () => {
    setError('')
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (business) params.set('business', business)
    if (q) params.set('q', q)
    const qs = params.toString() ? `?${params}` : ''
    api(`/api/v1/documents/templates${qs}`)
      .then((r) => {
        const rows = r.data || []
        setTemplates(rows)
        setCategories(r.categories || [])
        setTotal(r.total || rows.length)
        if (!rows.length) {
          setError('No templates found. Click “Reseed templates” or restart the server.')
          setTemplateId('')
          setTplHtml('')
          return
        }
        const still = rows.find((t) => t.id === templateId)
        setTemplateId(still ? still.id : rows[0].id)
      })
      .catch((e) => {
        setError(e.message)
        notify(e.message, 'error')
      })
  }

  useEffect(() => { load() }, [category, business])

  useEffect(() => {
    if (!templateId) return
    setLoadingTpl(true)
    setError('')
    api(`/api/v1/documents/templates/${templateId}`)
      .then((r) => {
        const html = r.data?.html || ''
        if (!html) setError('This template has no HTML body.')
        setTplHtml(html)
      })
      .catch((e) => {
        setError(e.message)
        setTplHtml('')
        notify(e.message, 'error')
      })
      .finally(() => setLoadingTpl(false))
  }, [templateId])

  useEffect(() => {
    api('/api/v1/company').then((r) => {
      if (r.data) {
        setVars((v) => ({
          ...v,
          company_name: r.data.name || v.company_name,
          company_address: r.data.address || v.company_address,
          company_phone: r.data.phone || v.company_phone,
          vat_number: r.data.vat_number || v.vat_number,
          bank_name: r.data.bank_name || v.bank_name,
          account_number: r.data.account_number || v.account_number,
          branch_code: r.data.branch_code || v.branch_code,
        }))
      }
    }).catch(() => {})
  }, [])

  const previewHtml = useMemo(() => fill(tplHtml, vars), [tplHtml, vars])
  const selected = templates.find((t) => t.id === templateId)

  const download = async (format = 'pdf') => {
    if (!templateId) return notify('Select a template', 'error')
    setGenerating(true)
    try {
      const res = await api('/api/v1/documents/render', {
        method: 'POST',
        body: { template_id: templateId, variables: vars, format },
        raw: true,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || `Render failed (${res.status})`)
      }
      if (format === 'html') {
        const j = await res.json()
        const html = j.data?.html || previewHtml
        window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank')
        notify('HTML opened')
        return
      }
      const blob = await res.blob()
      if (!blob.size) throw new Error('Empty PDF — Chromium may be missing on server')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${templateId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      notify('PDF downloaded')
    } catch (e) {
      notify(e.message || 'Generate failed', 'error')
      window.open(URL.createObjectURL(new Blob([previewHtml], { type: 'text/html' })), '_blank')
    } finally {
      setGenerating(false)
    }
  }

  const shareText = () => {
    const title = selected?.label || 'Document'
    return `${title} from ${vars.company_name || 'SAID'}\nClient: ${vars.client_name}\nTotal: R ${vars.total}\nDate: ${vars.date}`
  }

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText())}`, '_blank', 'noopener,noreferrer')
  }

  const shareFacebook = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.origin)}&quote=${encodeURIComponent(shareText())}`
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500')
  }

  const reseed = async () => {
    try {
      const r = await api('/api/v1/documents/reseed', { method: 'POST' })
      notify(`Seeded ${r.count || ''} templates`)
      load()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <PageHeader
        title="Document generator"
        subtitle="Pick a template · fill fields · live preview · PDF / share"
        meta={[`${total} templates`, selected?.category || '—', business || 'all businesses']}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="btn-outline !text-xs" to="/documents/designer">Designer</Link>
            <button type="button" className="btn-outline !text-xs" onClick={reseed}>Reseed templates</button>
          </div>
        }
      />

      {error && (
        <div className="card border-l-4 border-l-amber-500 p-3 text-sm text-amber-800 dark:text-amber-200">{error}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <select className="input max-w-[180px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>{c.category} ({c.c})</option>
          ))}
        </select>
        <select className="input max-w-[160px]" value={business} onChange={(e) => setBusiness(e.target.value)}>
          <option value="">All businesses</option>
          {['pc_repair', 'it', 'msp', 'construction', 'plumbing', 'electrical', 'consulting', 'retail', 'hospitality', 'medical', 'automotive', 'property', 'education'].map((b) => (
            <option key={b} value={b}>{b.replace('_', ' ')}</option>
          ))}
        </select>
        <button type="button" className="btn-outline" onClick={load}>Filter</button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1.1fr)] min-h-[60vh]">
        <div className="card p-2 flex flex-col min-h-[280px] max-h-[70vh]">
          <div className="text-[10px] uppercase text-slate-500 px-2 py-1 shrink-0">Templates</div>
          <div className="overflow-y-auto flex-1 space-y-0.5">
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => setTemplateId(t.id)}
                className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                  templateId === t.id ? 'bg-accent/15 text-accent' : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}>
                <div className="font-semibold truncate">{t.label}</div>
                <div className="text-[10px] text-slate-500">{t.category}</div>
              </button>
            ))}
            {!templates.length && <p className="p-3 text-sm text-slate-500">No templates. Use Reseed templates.</p>}
          </div>
        </div>

        <div className="card p-3 flex flex-col min-h-[280px] max-h-[70vh]">
          <div className="flex gap-2 mb-2 shrink-0 lg:hidden">
            <button type="button" className={`btn-outline !py-1 !text-xs ${tab === 'fields' ? '!border-accent text-accent' : ''}`} onClick={() => setTab('fields')}>Fields</button>
            <button type="button" className={`btn-outline !py-1 !text-xs ${tab === 'preview' ? '!border-accent text-accent' : ''}`} onClick={() => setTab('preview')}>Preview</button>
          </div>
          <div className="overflow-y-auto flex-1 space-y-3">
            {selected && (
              <div>
                <h2 className="font-bold text-sm">{selected.label}</h2>
                <p className="text-[11px] text-slate-500">{selected.description || selected.id}</p>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.keys(vars).map((k) => (
                <div key={k} className={k === 'line_items_html' || k === 'notes' || k === 'payment_note' ? 'sm:col-span-2' : ''}>
                  <label className="label">{`{{${k}}}`}</label>
                  {k === 'line_items_html' || k === 'notes' || k === 'payment_note' ? (
                    <textarea className="input font-mono text-xs" rows={2} value={vars[k]} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} />
                  ) : (
                    <input className="input" value={vars[k]} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} />
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-3 border-t border-white/10 shrink-0 mt-2">
            <button type="button" className="btn-primary" disabled={generating || !templateId} onClick={() => download('pdf')}>
              {generating ? 'Working…' : 'Download PDF'}
            </button>
            <button type="button" className="btn-outline" disabled={generating || !templateId} onClick={() => download('html')}>Open HTML</button>
            <button type="button" className="btn-share bg-[#25D366]" onClick={shareWhatsApp}>WhatsApp</button>
            <button type="button" className="btn-share bg-[#1877F2]" onClick={shareFacebook}>Facebook</button>
            {selected && <Link className="btn-outline !text-xs" to={`/documents/designer/${selected.id}`}>Edit HTML</Link>}
          </div>
        </div>

        <div className={`card p-2 flex flex-col min-h-[320px] max-h-[70vh] ${tab === 'fields' ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex items-center justify-between px-2 py-1 shrink-0">
            <span className="text-[10px] uppercase text-slate-500">Live preview</span>
            {loadingTpl && <span className="text-[10px] text-slate-400">Loading…</span>}
          </div>
          <div className="flex-1 overflow-auto rounded-xl bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
            {previewHtml ? (
              <iframe title="preview" className="w-full min-h-[480px] h-full bg-white" srcDoc={previewHtml} sandbox="" />
            ) : (
              <p className="p-6 text-sm text-slate-500">Select a template to preview.</p>
            )}
          </div>
        </div>
      </div>

      <div className="card p-4 mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-sm">Service catalogue</h2>
            <p className="text-xs text-slate-500">
              Remote &amp; on-site support (and more) — add these as lines on invoices/quotes
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5 pr-2">Service</th>
                <th className="py-1.5 pr-2">Unit</th>
                <th className="py-1.5 pr-2 text-right">Default rate</th>
                <th className="py-1.5">Kind</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-slate-500 max-w-md truncate">{s.description}</div>
                  </td>
                  <td className="py-1.5 pr-2">{s.unit}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">
                    R {Number(s.default_price).toFixed(2)}
                  </td>
                  <td className="py-1.5 capitalize">{s.kind}</td>
                </tr>
              ))}
              {!services.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-slate-500">
                    Services seed on first API call — open an invoice or refresh.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
