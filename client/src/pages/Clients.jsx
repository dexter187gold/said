import React, { useEffect, useState, useRef } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'

const empty = { name: '', email: '', phone: '', address: '', vat_number: '', notes: '', tags: '', credit_limit: '' }

export default function Clients() {
  const { notify } = useAuth()
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [history, setHistory] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const load = () => {
    const params = q ? `?q=${encodeURIComponent(q)}` : ''
    api(`/api/v1/clients${params}`).then((r) => setList(r.data || [])).catch((e) => notify(e.message, 'error'))
  }
  useEffect(() => { load() }, [])

  const openHistory = async (id) => {
    setSelected(id)
    try { setHistory((await api(`/api/v1/clients/${id}/history`)).data) }
    catch (e) { notify(e.message, 'error') }
  }

  const save = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return notify('Name required', 'error')
    setBusy(true)
    try {
      const body = { ...form, credit_limit: form.credit_limit === '' ? null : Number(form.credit_limit) }
      if (editId) { await api(`/api/v1/clients/${editId}`, { method: 'PUT', body }); notify('Client updated') }
      else { await api('/api/v1/clients', { method: 'POST', body }); notify('Client created') }
      setForm(empty); setEditId(null); load()
    } catch (err) { notify(err.message, 'error') }
    finally { setBusy(false) }
  }

  const startEdit = (c) => {
    setEditId(c.id)
    setForm({ name: c.name || '', email: c.email || '', phone: c.phone || '', address: c.address || '', vat_number: c.vat_number || '', notes: c.notes || '', tags: c.tags || '', credit_limit: c.credit_limit != null ? String(c.credit_limit) : '' })
  }

  const printStatement = async (id) => {
    try {
      const res = await api(`/api/v1/clients/${id}/statement`, { raw: true })
      if (!res.ok) throw new Error('Statement failed')
      const html = await res.text()
      const w = window.open('', '_blank')
      if (w) { w.document.write(html); w.document.close() }
    } catch (e) { notify(e.message, 'error') }
  }

  const importCsv = async (file) => {
    if (!file) return
    const text = await file.text()
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return notify('CSV needs header + rows', 'error')
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''))
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''))
      const obj = {}
      headers.forEach((h, idx) => { obj[h] = cols[idx] || '' })
      if (!obj.name) continue
      rows.push({ name: obj.name, email: obj.email || null, phone: obj.phone || null, address: obj.address || null, vat_number: obj.vat_number || obj.vat || null, tags: obj.tags || null, credit_limit: obj.credit_limit ? Number(obj.credit_limit) : null })
    }
    if (!rows.length) return notify('No valid rows', 'error')
    try {
      const r = await api('/api/v1/clients/import', { method: 'POST', body: { rows } })
      notify(`Imported ${r.data.created} clients`); load()
    } catch (e) { notify(e.message, 'error') }
  }

  const fmt = (n) => `R ${Number(n || 0).toFixed(2)}`

  return (
    <div className="space-y-3">
      <PageHeader title="Clients" subtitle="Q2 · tags · credit limits · statements · CSV · service history"
        meta={[`${list.length} clients`, `${list.filter((c) => c.over_limit).length} over limit`]}
        actions={<><button type="button" className="btn-outline !text-xs" onClick={() => fileRef.current?.click()}>Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} /></>} />
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button type="button" className="btn-outline" onClick={load}>Search</button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_minmax(300px,380px)]">
        <div className="card overflow-hidden"><div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/90 dark:bg-slate-900/90 text-left text-[10px] uppercase text-slate-500">
              <tr><th className="px-3 py-2">Name</th><th className="px-2 py-2">Contact</th><th className="px-2 py-2">Tags</th><th className="px-2 py-2 text-right">Outstanding</th><th className="px-2 py-2 text-right">Limit</th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} onClick={() => openHistory(c.id)} className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 hover:bg-accent/5 ${selected === c.id ? 'bg-accent/10' : ''}`}>
                  <td className="px-3 py-2.5"><div className="font-semibold">{c.name}</div>{c.over_limit && <span className="text-[10px] text-red-600 font-bold">OVER LIMIT</span>}</td>
                  <td className="px-2 py-2 text-xs">{c.phone || c.email || '—'}</td>
                  <td className="px-2 py-2 text-[10px]">{c.tags || '—'}</td>
                  <td className={`px-2 py-2 text-xs text-right tabular-nums ${c.outstanding > 0 ? 'text-amber-700 font-semibold' : ''}`}>{fmt(c.outstanding)}</td>
                  <td className="px-2 py-2 text-xs text-right tabular-nums">{c.credit_limit != null ? fmt(c.credit_limit) : '—'}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No clients yet</td></tr>}
            </tbody>
          </table>
        </div></div>
        <div className="space-y-3">
          <form className="card p-3 space-y-2" onSubmit={save}>
            <h2 className="font-bold text-sm">{editId ? 'Edit client' : 'New client'}</h2>
            {['name', 'email', 'phone', 'address', 'vat_number', 'tags'].map((k) => (
              <div key={k}><label className="label capitalize">{k.replace('_', ' ')}</label>
                <input className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required={k === 'name'} placeholder={k === 'tags' ? 'vip, retail' : ''} /></div>
            ))}
            <div><label className="label">Credit limit (ZAR)</label>
              <input className="input" type="number" min="0" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></div>
            <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex gap-2">
              {editId && <button type="button" className="btn-outline flex-1" onClick={() => { setEditId(null); setForm(empty) }}>Cancel</button>}
              <button type="submit" className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : editId ? 'Update' : 'Create'}</button>
            </div>
          </form>
          {history && (
            <div className="card p-3 space-y-2 max-h-[50vh] overflow-y-auto">
              <div className="flex justify-between gap-2"><h2 className="font-bold text-sm">{history.client?.name}</h2>
                <div className="flex gap-1"><button type="button" className="btn-outline !text-xs" onClick={() => startEdit(history.client)}>Edit</button>
                  <button type="button" className="btn-outline !text-xs" onClick={() => printStatement(history.client.id)}>Statement</button></div></div>
              <p className="text-[11px] text-slate-500">Outstanding {fmt(history.client?.outstanding)}{history.client?.credit_limit != null && ` · Limit ${fmt(history.client.credit_limit)}`}</p>
              <div className="label">Invoices</div>
              <ul className="text-xs space-y-1">{(history.invoices || []).slice(0, 8).map((i) => <li key={i.id} className="flex justify-between"><span>{i.number} · {i.status}</span><span>{fmt(i.total)}</span></li>)}</ul>
              <div className="label">Tickets</div>
              <ul className="text-xs space-y-1">{(history.tickets || []).slice(0, 6).map((t) => <li key={t.id}>{t.title} · {t.status}</li>)}</ul>
              <div className="label">Payments</div>
              <ul className="text-xs space-y-1">{(history.payments || []).slice(0, 6).map((p) => <li key={p.id}>{p.date} · {p.invoice_number} · {fmt(p.amount)}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
