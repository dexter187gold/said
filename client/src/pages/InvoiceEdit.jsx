import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

export default function InvoiceEdit() {
  const { id } = useParams()
  const location = useLocation()
  const isNew = !id || id === 'new'
  const nav = useNavigate()
  const { notify } = useAuth()

  const pathType = location.pathname.startsWith('/quotes')
    ? 'quote'
    : location.pathname.startsWith('/credits')
      ? 'credit'
      : 'invoice'
  const listPath = pathType === 'quote' ? '/quotes' : pathType === 'credit' ? '/credits' : '/invoices'
  const typeLabel = pathType === 'quote' ? 'Quote' : pathType === 'credit' ? 'Credit note' : 'Invoice'

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState('unpaid')
  const [notes, setNotes] = useState('')
  const [devices, setDevices] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [paymentNote, setPaymentNote] = useState('Payment due as stated. EFT / cash / card.')
  const [lines, setLines] = useState([{ description: '', qty: 1, price: 0 }])
  const [payAmount, setPayAmount] = useState('')
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    api('/api/v1/clients').then((r) => setClients(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (isNew) return
    api(`/api/v1/invoices/${id}`)
      .then((r) => {
        const d = r.data
        setLoaded(d)
        setClientId(d.client_id)
        setStatus(d.status)
        setNotes(d.notes || '')
        setDevices(d.devices || '')
        setServiceType(d.service_type || '')
        setPoNumber(d.po_number || '')
        setPaymentNote(d.payment_note || '')
        setLines(d.lines?.length ? d.lines : [{ description: '', qty: 1, price: 0 }])
      })
      .catch((e) => notify(e.message, 'error'))
  }, [id, isNew])

  const totals = useMemo(() => {
    const exclusive = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0)
    const vat = Math.round(exclusive * 0.15 * 100) / 100
    return { exclusive, vat, total: Math.round((exclusive + vat) * 100) / 100 }
  }, [lines])

  const body = () => ({
    client_id: clientId,
    doc_type: loaded?.doc_type || pathType,
    status,
    notes,
    devices,
    service_type: serviceType,
    po_number: poNumber,
    payment_note: paymentNote,
    vat_rate: 0.15,
    lines: lines.map((l) => ({ description: l.description, qty: Number(l.qty), price: Number(l.price) })),
  })

  const save = async (e) => {
    e.preventDefault()
    try {
      if (!clientId) throw new Error('Select a client')
      if (isNew) {
        const r = await api('/api/v1/invoices', { method: 'POST', body: body() })
        notify(`${typeLabel} created`)
        nav(`${listPath}/${r.data.id}`)
      } else {
        await api(`/api/v1/invoices/${id}`, { method: 'PUT', body: body() })
        notify('Saved')
        const r = await api(`/api/v1/invoices/${id}`)
        setLoaded(r.data)
      }
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const pdf = async () => {
    try {
      if (isNew) throw new Error('Save first')
      const res = await api(`/api/v1/invoices/${id}/pdf`, { raw: true })
      if (!res.ok) throw new Error('PDF failed')
      const blob = await res.blob()
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const logPay = async () => {
    try {
      await api(`/api/v1/invoices/${id}/payments`, { method: 'POST', body: { amount: Number(payAmount), method: 'EFT' } })
      setPayAmount('')
      notify('Payment logged')
      const r = await api(`/api/v1/invoices/${id}`)
      setLoaded(r.data)
      setStatus(r.data.status)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-brand">
        {typeLabel} module
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">{isNew ? `New ${typeLabel.toLowerCase()}` : (loaded?.number || typeLabel)}</h1>
          <p className="text-sm text-slate-500">VAT 15% · {pathType}</p>
        </div>
        <div className="flex gap-2">
          <Link className="btn-outline" to={listPath}>Back</Link>
          {!isNew && <button type="button" className="btn-outline" onClick={pdf}>PDF</button>}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          { k: 'Status', v: status },
          { k: 'Exclusive', v: `R ${totals.exclusive.toFixed(2)}` },
          { k: 'Total', v: `R ${totals.total.toFixed(2)}` },
          { k: 'Paid', v: `R ${Number(loaded?.amount_paid || 0).toFixed(2)}` },
        ].map((c) => (
          <div key={c.k} className="card border-l-4 border-l-brand p-3">
            <div className="text-[11px] uppercase text-slate-500">{c.k}</div>
            <div className="font-extrabold capitalize">{c.v}</div>
          </div>
        ))}
      </div>

      <form className="space-y-4" onSubmit={save}>
        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label className="label">Client</label>
            <select className="input" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {['unpaid', 'partial', 'paid', 'overdue', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">PO / ref</label>
            <input className="input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          </div>
          <div>
            <label className="label">Devices</label>
            <input className="input" value={devices} onChange={(e) => setDevices(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Service type</label>
            <input className="input" value={serviceType} onChange={(e) => setServiceType(e.target.value)} />
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Line items</h3>
            <button type="button" className="btn-outline !py-1 text-xs" onClick={() => setLines((L) => [...L, { description: '', qty: 1, price: 0 }])}>+ Line</button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_80px_100px_36px]">
              <input className="input" placeholder="Description" required value={l.description} onChange={(e) => setLines((L) => L.map((row, idx) => (idx === i ? { ...row, description: e.target.value } : row)))} />
              <input className="input" type="number" step="0.01" value={l.qty} onChange={(e) => setLines((L) => L.map((row, idx) => (idx === i ? { ...row, qty: e.target.value } : row)))} />
              <input className="input" type="number" step="0.01" value={l.price} onChange={(e) => setLines((L) => L.map((row, idx) => (idx === i ? { ...row, price: e.target.value } : row)))} />
              {lines.length > 1 ? (
                <button type="button" className="btn-outline" onClick={() => setLines((L) => L.filter((_, idx) => idx !== i))}>×</button>
              ) : <span />}
            </div>
          ))}
        </div>

        <div className="card space-y-3 p-4">
          <div>
            <label className="label">Payment note</label>
            <textarea className="input" rows={2} value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <button className="btn-primary" type="submit">{isNew ? `Create ${typeLabel.toLowerCase()}` : 'Save'}</button>
      </form>

      {!isNew && pathType === 'invoice' && (
        <div className="card mt-4 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase text-slate-500">Log payment</h3>
          <div className="flex flex-wrap gap-2">
            <input className="input max-w-[160px]" type="number" step="0.01" placeholder="Amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            <button type="button" className="btn-primary" onClick={logPay}>Record</button>
          </div>
          {!!loaded?.payments?.length && (
            <ul className="mt-3 space-y-1 text-sm text-slate-500">
              {loaded.payments.map((p) => (
                <li key={p.id}>{p.date} · R {Number(p.amount).toFixed(2)} · {p.method}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
