import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import DocumentActionBar from '../components/DocumentActionBar'

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
  const [snippets, setSnippets] = useState([])
  const [pricingModel, setPricingModel] = useState('flatrate')
  const [templateTouched, setTemplateTouched] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('EFT')
  const [loaded, setLoaded] = useState(null)
  const [templateId, setTemplateId] = useState('')
  const [templates, setTemplates] = useState([])
  const [accountType, setAccountType] = useState('COD Account')
  const [dueDate, setDueDate] = useState('')

  // Auto-pick PDF foundation template from pricing model (user can override)
  useEffect(() => {
    if (templateTouched || !isNew) return
    const map = {
      hourly: pathType === 'quote' ? 'quote_hourly_cod' : 'invoice_hourly_cod',
      flatrate: pathType === 'quote' ? 'quote_flatrate_cod' : 'invoice_flatrate_cod',
      adhoc: pathType === 'quote' ? 'quote_adhoc_cod' : 'invoice_adhoc_cod',
    }
    setTemplateId(map[pricingModel] || map.flatrate)
  }, [pricingModel, pathType, isNew, templateTouched])

  useEffect(() => {
    api('/api/v1/documents/line-snippets').then((r) => setSnippets(r.data || [])).catch(() => {})
  }, [])
  useEffect(() => {
    api('/api/v1/clients').then((r) => setClients(r.data)).catch(() => {})
    api('/api/v1/documents/templates').then((r) => setTemplates(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isNew) return
    if (pathType === 'quote') {
      setTemplateId((prev) => prev || 'quote_flatrate_cod')
      setPaymentNote('100% due on completion and hand-over / collection, unless stated otherwise in writing. Cash, EFT (with proof) or instant payment. Devices released only after payment confirmation.')
      setStatus('unpaid')
      const d = new Date(); d.setDate(d.getDate() + 14)
      setDueDate(d.toISOString().slice(0, 10))
    } else if (pathType === 'invoice') {
      setTemplateId((prev) => prev || 'tax_invoice_full')
    }
  }, [isNew, pathType])

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
        setTemplateId(d.template_id || '')
        setAccountType(d.account_type || 'COD Account')
        if (d.pricing_model) setPricingModel(d.pricing_model)
        if (d.template_id) setTemplateTouched(true)
        setDueDate(d.due_date || '')
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
    template_id: templateId || null,
    account_type: accountType || null,
    pricing_model: pricingModel || null,
    due_date: dueDate || null,
    status,
    notes,
    devices,
    service_type: serviceType,
    po_number: poNumber,
    payment_note: paymentNote,
    vat_rate: 0.15,
    lines: lines.map((l) => ({ description: l.description, qty: Number(l.qty), price: Number(l.price) })),
  })

  const convertQuote = async () => {
    if (!id || isNew) return
    if (!confirm('Convert this quote to a tax invoice?')) return
    try {
      const r = await api(`/api/v1/invoices/${id}/convert`, { method: 'POST' })
      notify('Quote converted to invoice')
      nav(`/invoices/${r.data.id}`)
    } catch (e) {
      notify(e.message, 'error')
    }
  }

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
      await api(`/api/v1/invoices/${id}/payments`, { method: 'POST', body: { amount: Number(payAmount), method: payMethod || 'EFT' } })
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

      {!isNew && (
        <DocumentActionBar
          type={pathType}
          id={id}
          number={loaded?.number}
          status={status}
          onRefresh={(newId) => {
            if (newId) nav(`/${pathType === 'invoice' ? 'invoices' : pathType === 'quote' ? 'quotes' : 'credits'}/${newId}`)
            else window.location.reload()
          }}
          className="mb-4 rounded-xl border border-slate-200 dark:border-slate-700"
        />
      )}

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
            <label className="label">Layout template (layer 1)</label>
            <div className="sm:col-span-2">
              <label className="label">Pricing model</label>
              <select
                className="input"
                value={pricingModel}
                onChange={(e) => {
                  setPricingModel(e.target.value)
                  setTemplateTouched(false)
                }}
                aria-label="Pricing model"
              >
                <option value="hourly">Hourly (time & materials — not SLA)</option>
                <option value="flatrate">Flat rate / package / SLA-style</option>
                <option value="adhoc">Ad-hoc / rate card</option>
              </select>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Chooses the matching PDF layout automatically. Override with template below.
              </p>
            </div>
            <select className="input" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setTemplateTouched(true) }} aria-label="Layout template">
              <option value="">Company default</option>
              {pathType === 'quote' && (
                <>
                  <option value="invoice_hourly_cod">Invoice · Hourly</option>
                  <option value="invoice_flatrate_cod">Invoice · Flat rate</option>
                  <option value="invoice_adhoc_cod">Invoice · Ad-hoc</option>
                  <option value="quote_hourly_cod">Hourly model (COD)</option>
                  <option value="quote_flatrate_cod">Flat rate package (COD)</option>
                  <option value="quote_adhoc_cod">Ad-hoc rate card (COD)</option>
                </>
              )}
              {templates
                .filter((x) => pathType !== 'quote' || !x.id.startsWith('quote_'))
                .map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {['unpaid', 'partial', 'paid', 'overdue', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{pathType === 'quote' ? 'Valid until' : 'Due date'}</label>
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="label">PO / ref</label>
            <input className="input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          </div>
          <div>
            <label className="label">Account type</label>
            <select className="input" value={accountType} onChange={(e) => setAccountType(e.target.value)} aria-label="Account type">
              <option value="COD Account">COD Account</option>
              <option value="Account">Account (terms)</option>
              <option value="Retainer">Retainer</option>
              <option value="Cash">Cash</option>
            </select>
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
            {snippets.length > 0 && (
              <select
                className="input !w-auto !text-xs !py-1"
                defaultValue=""
                onChange={(e) => {
                  const s = snippets.find((x) => x.id === e.target.value)
                  if (!s) return
                  setLines((L) => [...L, { description: s.description, qty: s.default_qty || 1, price: s.default_price || 0 }])
                  e.target.value = ''
                }}
              >
                <option value="">+ From snippet…</option>
                {snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn-ghost !text-[10px]"
              onClick={async () => {
                const desc = prompt('Snippet description (saved for reuse)')
                if (!desc) return
                const label = prompt('Short label', desc.slice(0, 40)) || desc.slice(0, 40)
                try {
                  await api('/api/v1/documents/line-snippets', {
                    method: 'POST',
                    body: { label, description: desc, default_qty: 1, default_price: 0 },
                  })
                  const r = await api('/api/v1/documents/line-snippets')
                  setSnippets(r.data || [])
                  notify('Snippet saved')
                } catch (e) {
                  notify(e.message, 'error')
                }
              }}
            >
              Save snippet
            </button>
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

        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" type="submit">{isNew ? `Create ${typeLabel.toLowerCase()}` : 'Save'}</button>
          {!isNew && pathType === 'quote' && (
            <button type="button" className="btn-outline" onClick={convertQuote}>
              Convert → invoice
            </button>
          )}
        </div>
      </form>

      {!isNew && pathType === 'invoice' && (
        <div className="card mt-4 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase text-slate-500">Log payment</h3>
          <div className="flex flex-wrap gap-2 items-center">
            <input className="input max-w-[120px]" type="number" step="0.01" placeholder="Amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            <select className="input !w-auto" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {['EFT', 'Cash', 'Card', 'SnapScan', 'PayFast', 'Other'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button type="button" className="btn-primary" onClick={logPay}>Record</button>
            <button
              type="button"
              className="btn-outline !text-xs"
              onClick={async () => {
                try {
                  const r = await api(`/api/v1/money/eft-ref/${id}`)
                  window.open(r.data.whatsapp_url, '_blank', 'noopener')
                  notify(`EFT ref ${r.data.reference}`)
                } catch (e) {
                  notify(e.message, 'error')
                }
              }}
            >
              Send EFT details
            </button>
            <button
              type="button"
              className="btn-outline !text-xs"
              onClick={async () => {
                try {
                  const r = await api(`/api/v1/money/payfast/link/${id}`)
                  window.open(r.data.url, '_blank', 'noopener')
                  notify(r.data.configured ? 'PayFast checkout' : 'PayFast sandbox link')
                } catch (e) {
                  notify(e.message, 'error')
                }
              }}
            >
              PayFast link
            </button>
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
