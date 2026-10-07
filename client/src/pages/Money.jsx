import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import { EmptyState, SkeletonRows } from '../components/EmptyState'

const STAGES = [
  { id: 'friendly', label: 'Friendly' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'final', label: 'Final notice' },
]

export default function Money() {
  const { notify } = useAuth()
  const [tab, setTab] = useState('open')
  const [open, setOpen] = useState([])
  const [totalOpen, setTotalOpen] = useState(0)
  const [payments, setPayments] = useState([])
  const [paySum, setPaySum] = useState(0)
  const [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [payForm, setPayForm] = useState({ invoiceId: '', amount: '', method: 'EFT', note: '' })
  const [deposits, setDeposits] = useState([])
  const [unapplied, setUnapplied] = useState(0)
  const [clients, setClients] = useState([])
  const [depForm, setDepForm] = useState({ client_id: '', amount: '', method: 'EFT', note: '' })
  const [pfConfig, setPfConfig] = useState(null)
  const [pfForm, setPfForm] = useState({ merchant_id: '', merchant_key: '', passphrase: '', sandbox: true })

  const load = async () => {
    setLoading(true)
    try {
      const [o, p, m, d, cl] = await Promise.all([
        api('/api/v1/money/open-balances'),
        api('/api/v1/money/payments?limit=40'),
        api('/api/v1/money/methods'),
        api('/api/v1/money/deposits'),
        api('/api/v1/clients'),
      ])
      setOpen(o.data || [])
      setTotalOpen(o.total_open || 0)
      setPayments(p.data || [])
      setPaySum(p.sum || 0)
      setMethods(m.data || ['EFT', 'Cash', 'Card'])
      setDeposits(d.data || [])
      setUnapplied(d.unapplied_total || 0)
      setClients(cl.data || [])
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const downloadCsv = async (kind) => {
    try {
      const token = localStorage.getItem('said_token')
      const path =
        kind === 'payments'
          ? '/api/v1/money/export/payments.csv'
          : kind === 'xero'
            ? '/api/v1/money/export/xero-invoices.csv?type=invoice'
            : '/api/v1/money/export/invoices.csv?type=invoice'
      const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = kind === 'payments' ? 'said-payments.csv' : kind === 'xero' ? 'said-xero-invoices.csv' : 'said-invoices.csv'
      a.click()
      notify('CSV downloaded')
    } catch (e) {
      // fallback via api helper if available
      try {
        const res = await api(kind === 'payments' ? '/api/v1/money/export/payments.csv' : '/api/v1/money/export/invoices.csv?type=invoice', {
          raw: true,
        })
        const blob = await res.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = kind === 'payments' ? 'said-payments.csv' : kind === 'xero' ? 'said-xero-invoices.csv' : 'said-invoices.csv'
        a.click()
        notify('CSV downloaded')
      } catch (err) {
        notify(err.message || e.message, 'error')
      }
    }
  }

  const sendEft = async (invoiceId) => {
    try {
      const r = await api(`/api/v1/money/eft-ref/${invoiceId}`)
      window.open(r.data.whatsapp_url, '_blank', 'noopener')
      notify(`EFT ref ${r.data.reference}`)
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const dunning = async (invoiceId, stage) => {
    try {
      const r = await api(`/api/v1/money/dunning/${invoiceId}`, { method: 'POST', body: { stage } })
      window.open(r.data.url, '_blank', 'noopener')
      notify(`${stage} reminder opened`)
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const recordPay = async (e) => {
    e.preventDefault()
    if (!payForm.invoiceId || !payForm.amount) return notify('Invoice and amount required', 'error')
    try {
      await api(`/api/v1/money/invoices/${payForm.invoiceId}/pay`, {
        method: 'POST',
        body: {
          amount: Number(payForm.amount),
          method: payForm.method,
          note: payForm.note || null,
        },
      })
      notify('Payment recorded')
      setPayForm({ invoiceId: '', amount: '', method: 'EFT', note: '' })
      load()
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const fmt = (n) => `R ${Number(n || 0).toFixed(2)}`

  return (
    <div className="space-y-3">
      <PageHeader
        title="Money"
        subtitle="Hermes-Metal · open balances · payments · EFT · dunning · CSV"
        meta={[fmt(totalOpen) + ' open', `${payments.length} recent payments`, fmt(paySum) + ' listed']}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline !text-xs" onClick={() => downloadCsv('invoices')}>
              Export invoices CSV
            </button>
            <button type="button" className="btn-outline !text-xs" onClick={() => downloadCsv('payments')}>
              Export payments CSV
            </button>
            <button type="button" className="btn-outline !text-xs" onClick={() => downloadCsv('xero')}>
              Xero invoices CSV
            </button>
            <Link className="btn-outline !text-xs" to="/ageing">
              Ageing
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700 pb-2">
        {[
          { id: 'open', label: 'Open balances' },
          { id: 'payments', label: 'Payment ledger' },
          { id: 'record', label: 'Record payment' },
          { id: 'deposits', label: 'Deposits' },
          { id: 'payfast', label: 'PayFast' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              tab === t.id ? 'bg-accent/15 text-accent' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="card"><SkeletonRows rows={5} cols={4} /></div>}

      {!loading && tab === 'open' && (
        <div className="card overflow-hidden">
          {!open.length ? (
            <EmptyState title="No open balances" body="All invoices are paid or there are no invoices yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-slate-500 text-left bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-2 py-2">Client</th>
                    <th className="px-2 py-2 hidden sm:table-cell">Due</th>
                    <th className="px-2 py-2 text-right">Balance</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">
                        <Link className="font-semibold text-brand hover:underline" to={`/invoices/${r.id}`}>
                          {r.number}
                        </Link>
                        <div className="text-[10px] text-slate-500 capitalize">{r.status}</div>
                      </td>
                      <td className="px-2 py-2 truncate max-w-[120px]">{r.client_name}</td>
                      <td className="px-2 py-2 text-xs text-slate-500 hidden sm:table-cell">{r.due_date || '—'}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmt(r.balance)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          <button type="button" className="btn-outline !text-[10px] !py-0.5" onClick={() => sendEft(r.id)}>
                            EFT + WA
                          </button>
                          <button
                            type="button"
                            className="btn-outline !text-[10px] !py-0.5"
                            onClick={async () => {
                              try {
                                const res = await api(`/api/v1/money/payfast/link/${r.id}`)
                                window.open(res.data.url, '_blank', 'noopener')
                                notify(res.data.configured ? 'PayFast opened' : 'PayFast sandbox demo link')
                              } catch (e) {
                                notify(e.message, 'error')
                              }
                            }}
                          >
                            PayFast
                          </button>
                          {STAGES.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className="btn-outline !text-[10px] !py-0.5"
                              onClick={() => dunning(r.id, s.id)}
                              title={s.label}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'payments' && (
        <div className="card overflow-hidden">
          {!payments.length ? (
            <EmptyState title="No payments recorded" body="Record EFT, cash, or card against an invoice." />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 text-left bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-2 py-2">Invoice</th>
                  <th className="px-2 py-2 hidden sm:table-cell">Client</th>
                  <th className="px-2 py-2">Method</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-xs">{p.date}</td>
                    <td className="px-2 py-2">
                      <Link className="text-brand hover:underline font-medium" to={`/invoices/${p.invoice_id}`}>
                        {p.invoice_number}
                      </Link>
                    </td>
                    <td className="px-2 py-2 hidden sm:table-cell truncate max-w-[120px]">{p.client_name}</td>
                    <td className="px-2 py-2 text-xs">{p.method}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold">{fmt(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && tab === 'record' && (
        <form className="card p-4 space-y-3 max-w-lg" onSubmit={recordPay}>
          <h2 className="font-bold text-sm">Record a payment</h2>
          <div>
            <label className="label">Open invoice</label>
            <select
              className="input"
              required
              value={payForm.invoiceId}
              onChange={(e) => {
                const id = e.target.value
                const row = open.find((x) => x.id === id)
                setPayForm((f) => ({
                  ...f,
                  invoiceId: id,
                  amount: row ? String(Number(row.balance).toFixed(2)) : f.amount,
                }))
              }}
            >
              <option value="">Select…</option>
              {open.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} · {r.client_name} · {fmt(r.balance)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Amount (ZAR)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={payForm.amount}
                onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Method</label>
              <select
                className="input"
                value={payForm.method}
                onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}
              >
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Note</label>
            <input
              className="input"
              value={payForm.note}
              onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Optional proof ref"
            />
          </div>
          <button type="submit" className="btn-primary">
            Record payment
          </button>
        </form>
      )}

      {!loading && tab === 'deposits' && (
        <div className="space-y-3">
          <form
            className="card p-4 space-y-3 max-w-lg"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await api('/api/v1/money/deposits', {
                  method: 'POST',
                  body: {
                    client_id: depForm.client_id,
                    amount: Number(depForm.amount),
                    method: depForm.method,
                    note: depForm.note || null,
                  },
                })
                notify('Deposit recorded')
                setDepForm({ client_id: '', amount: '', method: 'EFT', note: '' })
                load()
              } catch (err) {
                notify(err.message, 'error')
              }
            }}
          >
            <h2 className="font-bold text-sm">Record client deposit / retainer</h2>
            <p className="text-xs text-slate-500">Hold funds against a client, then apply to an invoice later. Unapplied: {fmt(unapplied)}</p>
            <div>
              <label className="label">Client</label>
              <select className="input" required value={depForm.client_id} onChange={(e) => setDepForm((f) => ({ ...f, client_id: e.target.value }))}>
                <option value="">Select…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Amount</label>
                <input className="input" type="number" step="0.01" min="0.01" required value={depForm.amount} onChange={(e) => setDepForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">Method</label>
                <select className="input" value={depForm.method} onChange={(e) => setDepForm((f) => ({ ...f, method: e.target.value }))}>
                  {methods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <input className="input" placeholder="Note" value={depForm.note} onChange={(e) => setDepForm((f) => ({ ...f, note: e.target.value }))} />
            <button type="submit" className="btn-primary">Save deposit</button>
          </form>
          <div className="card overflow-hidden">
            {!deposits.length ? (
              <EmptyState title="No deposits" body="Record a retainer or upfront payment for a client." />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-slate-500 text-left bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-2 py-2">Client</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d) => (
                    <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-xs">{d.date}</td>
                      <td className="px-2 py-2">{d.client_name}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">{fmt(d.amount)}</td>
                      <td className="px-2 py-2 text-xs">
                        {d.applied_invoice_id ? `Applied → ${d.applied_invoice_number || d.applied_invoice_id.slice(0, 8)}` : 'Unapplied'}
                      </td>
                      <td className="px-2 py-2">
                        {!d.applied_invoice_id && (
                          <select
                            className="input !text-[10px] !py-0.5 !w-auto max-w-[140px]"
                            defaultValue=""
                            onChange={async (e) => {
                              const invoice_id = e.target.value
                              if (!invoice_id) return
                              try {
                                await api(`/api/v1/money/deposits/${d.id}/apply`, { method: 'POST', body: { invoice_id } })
                                notify('Deposit applied')
                                load()
                              } catch (err) {
                                notify(err.message, 'error')
                              }
                            }}
                          >
                            <option value="">Apply to…</option>
                            {open.filter((o) => o.client_id === d.client_id).map((o) => (
                              <option key={o.id} value={o.id}>{o.number} ({fmt(o.balance)})</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {!loading && tab === 'payfast' && (
        <div className="card p-4 space-y-3 max-w-lg">
          <h2 className="font-bold text-sm">PayFast settings</h2>
          <p className="text-xs text-slate-500">
            SA card / Instant EFT collection. Leave blank to use sandbox demo merchant for testing.
            Open balances also have a PayFast button per invoice.
          </p>
          <button
            type="button"
            className="btn-outline !text-xs"
            onClick={async () => {
              try {
                const r = await api('/api/v1/money/payfast/config')
                setPfConfig(r.data)
                setPfForm({
                  merchant_id: r.data.merchant_id || '',
                  merchant_key: '',
                  passphrase: '',
                  sandbox: !!r.data.sandbox,
                })
              } catch (e) {
                notify(e.message || 'Admin required for config', 'error')
              }
            }}
          >
            Load config (admin)
          </button>
          {pfConfig && (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  await api('/api/v1/money/payfast/config', {
                    method: 'PUT',
                    body: {
                      merchant_id: pfForm.merchant_id,
                      merchant_key: pfForm.merchant_key || undefined,
                      passphrase: pfForm.passphrase || undefined,
                      sandbox: pfForm.sandbox,
                    },
                  })
                  notify('PayFast settings saved')
                } catch (err) {
                  notify(err.message, 'error')
                }
              }}
            >
              <input className="input" placeholder="Merchant ID" value={pfForm.merchant_id} onChange={(e) => setPfForm((f) => ({ ...f, merchant_id: e.target.value }))} />
              <input className="input" placeholder="Merchant key" value={pfForm.merchant_key} onChange={(e) => setPfForm((f) => ({ ...f, merchant_key: e.target.value }))} />
              <input className="input" placeholder="Passphrase (optional)" value={pfForm.passphrase} onChange={(e) => setPfForm((f) => ({ ...f, passphrase: e.target.value }))} />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={pfForm.sandbox} onChange={(e) => setPfForm((f) => ({ ...f, sandbox: e.target.checked }))} />
                Sandbox mode
              </label>
              <button type="submit" className="btn-primary">Save PayFast</button>
            </form>
          )}
        </div>
      )}

    </div>
  )
}
