import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'

const DEFAULT_VARS = {
  client_name: '',
  client_address: '',
  client_email: '',
  client_phone: '',
  company_name: '',
  company_address: '',
  company_phone: '',
  vat_number: '',
  amount_due: '0.00',
  invoice_number: '',
  invoice_date: '',
  due_date: '',
  payment_note: 'EFT preferred.',
  site_address: '',
  technician: '',
  devices: '',
  service_type: '',
  serials: '',
  notes: '',
  date: new Date().toISOString().slice(0, 10),
  total: '0.00',
  exclusive: '0.00',
  vat_amount: '0.00',
  bank_name: '',
  account_number: '',
  branch_code: '',
  line_items_html: '<tr><td>Sample item</td><td>1</td><td>R 100.00</td><td>R 100.00</td></tr>',
}

export default function Documents() {
  const { notify } = useAuth()
  const [templates, setTemplates] = useState([])
  const [categories, setCategories] = useState([])
  const [category, setCategory] = useState('')
  const [business, setBusiness] = useState('')
  const [q, setQ] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [vars, setVars] = useState(DEFAULT_VARS)
  const [total, setTotal] = useState(0)
  const [generating, setGenerating] = useState(false)

  const load = () => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (business) params.set('business', business)
    if (q) params.set('q', q)
    const qs = params.toString() ? `?${params}` : ''
    api(`/api/v1/documents/templates${qs}`)
      .then((r) => {
        setTemplates(r.data || [])
        setCategories(r.categories || [])
        setTotal(r.total || (r.data || []).length)
        if (r.data?.length && !r.data.find((t) => t.id === templateId)) {
          setTemplateId(r.data[0].id)
        }
      })
      .catch((e) => notify(e.message, 'error'))
  }

  useEffect(() => { load() }, [category, business])

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
        throw new Error(j.message || j.error || `Render failed (${res.status})`)
      }
      if (format === 'html') {
        const j = await res.json()
        const html = j.data?.html || ''
        const blob = new Blob([html], { type: 'text/html' })
        window.open(URL.createObjectURL(blob), '_blank')
        notify('HTML preview opened')
        return
      }
      const blob = await res.blob()
      if (!blob.size) throw new Error('Empty PDF — install Chromium on the server')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${templateId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      notify('PDF downloaded')
    } catch (e) {
      notify(e.message || 'Generate failed', 'error')
      if (format === 'pdf') {
        try {
          const res = await api('/api/v1/documents/render', {
            method: 'POST',
            body: { template_id: templateId, variables: vars, format: 'html' },
            raw: true,
          })
          if (res.ok) {
            const j = await res.json()
            const html = j.data?.html || ''
            window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank')
            notify('PDF engine unavailable — opened HTML instead')
          }
        } catch { /* ignore */ }
      }
    } finally {
      setGenerating(false)
    }
  }

  const selected = templates.find((t) => t.id === templateId)

  return (
    <div>
      <PageHeader
        title="Document generator"
        subtitle={`${total}+ templates · filter by business · PDF or HTML`}
        meta={['Business filters', 'Custom templates', 'PDF / HTML export']}
        actions={<Link className="btn-primary" to="/documents/designer">Template designer</Link>}
      />

      <div className="mt-2 flex flex-wrap gap-2">
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="card max-h-[70vh] overflow-auto p-2 space-y-0.5">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTemplateId(t.id)}
              className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                templateId === t.id ? 'bg-brand/15 text-brand-dark dark:text-emerald-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <div className="font-semibold truncate">{t.label}</div>
              <div className="text-[10px] text-slate-500">{t.category}</div>
            </button>
          ))}
          {!templates.length && <p className="p-3 text-sm text-slate-500">No templates match. Restart server to seed templates.</p>}
        </div>

        <div className="card space-y-3 p-4">
          {selected ? (
            <>
              <div>
                <h2 className="font-bold">{selected.label}</h2>
                <p className="text-xs text-slate-500">{selected.description || selected.id} · {selected.business_types}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 max-h-[45vh] overflow-auto">
                {Object.keys(vars).map((k) => (
                  <div key={k}>
                    <label className="label">{`{{${k}}}`}</label>
                    {k === 'line_items_html' || k === 'notes' ? (
                      <textarea className="input font-mono text-xs" rows={2} value={vars[k]} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} />
                    ) : (
                      <input className="input" value={vars[k]} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={generating} onClick={() => download('pdf')}>
                  {generating ? 'Generating…' : 'Download PDF'}
                </button>
                <button type="button" className="btn-outline" disabled={generating} onClick={() => download('html')}>
                  Preview HTML
                </button>
                <Link className="btn-outline" to={`/documents/designer/${selected.id}`}>Edit template</Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Select a template from the list.</p>
          )}
        </div>
      </div>
    </div>
  )
}
