import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const STARTER = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:system-ui,sans-serif;padding:36px;max-width:800px;margin:0 auto;color:#0f172a}
  .brand{color:#007A4D;font-weight:800;font-size:11px;letter-spacing:.08em}
  h1{font-size:24px;margin:.4rem 0 1rem}
  .box{border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:10px 0}
  .muted{color:#64748b;font-size:12px}
</style></head><body>
  <div class="brand">SA INVOICE DESK</div>
  <h1>{{title}}</h1>
  <div class="box">
    <div class="muted">Client</div>
    <strong>{{client_name}}</strong><br>{{client_address}}
  </div>
  <p>{{notes}}</p>
  <p class="muted">{{company_name}} · {{company_address}}</p>
</body></html>`

export default function TemplateDesigner() {
  const { id } = useParams()
  const { notify, user } = useAuth()
  const nav = useNavigate()
  const isAdmin = user?.role === 'owner' || user?.role === 'admin'
  const [form, setForm] = useState({
    id: '',
    label: '',
    category: 'Custom',
    business_types: 'all',
    description: '',
    html: STARTER,
  })
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    api(`/api/v1/documents/templates/${id}`)
      .then((r) => {
        const t = r.data
        setForm({
          id: t.id,
          label: t.label,
          category: t.category || 'Custom',
          business_types: t.business_types || 'all',
          description: t.description || '',
          html: t.html,
        })
      })
      .catch((e) => notify(e.message, 'error'))
  }, [id])

  const doPreview = () => {
    let html = form.html
    const sample = {
      title: form.label || 'Preview',
      client_name: 'Sample Client Pty Ltd',
      client_address: '1 Main Rd, Johannesburg',
      notes: 'This is a live preview of your template.',
      company_name: 'SA Invoice Desk',
      company_address: 'Johannesburg, South Africa',
      amount_due: '1,250.00',
      invoice_number: 'INV-0001',
      date: new Date().toISOString().slice(0, 10),
    }
    html = html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => sample[k] ?? `{{${k}}}`)
    setPreview(html)
  }

  useEffect(() => { doPreview() }, [form.html, form.label])

  const save = async (e) => {
    e.preventDefault()
    if (!isAdmin) return notify('Admin role required to save templates', 'error')
    setSaving(true)
    try {
      if (id) {
        await api(`/api/v1/documents/templates/${id}`, {
          method: 'PUT',
          body: {
            label: form.label,
            category: form.category,
            business_types: form.business_types,
            description: form.description,
            html: form.html,
          },
        })
        notify('Template updated')
      } else {
        const body = {
          label: form.label,
          category: form.category,
          business_types: form.business_types,
          description: form.description,
          html: form.html,
        }
        if (form.id) body.id = form.id
        const r = await api('/api/v1/documents/templates', { method: 'POST', body })
        notify('Template created')
        nav(`/documents/designer/${r.data.id}`, { replace: true })
      }
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Template designer</h1>
          <p className="text-sm text-slate-500">HTML + variables · live preview · PDF-ready</p>
        </div>
        <Link className="btn-outline" to="/documents">Back to Documents</Link>
      </div>

      <form className="mt-4 grid gap-4 lg:grid-cols-2" onSubmit={save}>
        <div className="space-y-3">
          <div className="card space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Label</label>
                <input className="input" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div>
                <label className="label">ID (optional, new only)</label>
                <input className="input font-mono text-xs" disabled={!!id} placeholder="my_template" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.replace(/\s/g, '_') })} />
              </div>
              <div>
                <label className="label">Category</label>
                <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div>
                <label className="label">Business types</label>
                <input className="input" placeholder="all,pc_repair,it" value={form.business_types} onChange={(e) => setForm({ ...form, business_types: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <label className="label">HTML template</label>
              <textarea
                className="input font-mono text-xs min-h-[320px]"
                value={form.html}
                onChange={(e) => setForm({ ...form, html: e.target.value })}
                spellCheck={false}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Use placeholders like client_name, amount_due, company_name, notes, line_items_html inside double curly braces.
            </p>
            {isAdmin && (
              <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : id ? 'Save changes' : 'Create template'}</button>
            )}
            {!isAdmin && <p className="text-xs text-amber-600">Sign in as admin to save custom templates.</p>}
          </div>
        </div>
        <div className="card p-2 overflow-hidden">
          <div className="text-[11px] uppercase text-slate-500 px-2 py-1">Live preview</div>
          <iframe
            title="preview"
            className="w-full min-h-[520px] rounded-xl border border-slate-100 dark:border-slate-800 bg-white"
            srcDoc={preview}
            sandbox=""
          />
        </div>
      </form>
    </div>
  )
}
