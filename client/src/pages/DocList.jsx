import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'

const LABELS = {
  invoice: { title: 'Invoices', sub: 'Tax invoices · payments · PDF', newTo: '/invoices/new', newLabel: 'New invoice', type: 'invoice', base: 'invoices' },
  quote: { title: 'Quotes', sub: 'Quotations · convert to invoice when accepted', newTo: '/quotes/new', newLabel: 'New quote', type: 'quote', base: 'quotes' },
  credit: { title: 'Credit notes', sub: 'Refunds and adjustments against invoices', newTo: '/credits/new', newLabel: 'New credit note', type: 'credit', base: 'credits' },
}

const STATUS_CLS = {
  unpaid: 'bg-amber-100 text-amber-800',
  partial: 'bg-sky-100 text-sky-800',
  paid: 'bg-emerald-100 text-emerald-800',
  overdue: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-500',
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-sky-100 text-sky-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
}

export default function DocList({ docType = 'invoice' }) {
  const cfg = LABELS[docType] || LABELS.invoice
  const { notify } = useAuth()
  const [list, setList] = useState([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ type: cfg.type })
    if (status) params.set('status', status)
    api(`/api/v1/invoices?${params}`)
      .then((r) => setList(r.data || []))
      .catch((e) => notify(e.message, 'error'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [status, docType])

  const total = list.reduce((s, i) => s + Number(i.total || 0), 0)
  const unpaid = list.filter((i) => ['unpaid', 'partial', 'overdue'].includes(i.status)).length

  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-brand">
        {cfg.type === 'quote' ? 'Quotes module' : cfg.type === 'credit' ? 'Credit notes module' : 'Invoices module'}
      </div>
      <PageHeader
        title={cfg.title}
        subtitle={cfg.sub}
        meta={[
          `${list.length} records`,
          `R ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total`,
          unpaid ? `${unpaid} open` : 'All clear',
        ]}
        actions={
          <Link className="btn-primary" to={cfg.newTo}>{cfg.newLabel}</Link>
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {['', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={`btn-outline !py-1 !px-2.5 !text-xs capitalize ${status === s ? '!border-brand !text-brand' : ''}`}
            onClick={() => setStatus(s)}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Number</th>
                <th className="px-3 py-2.5 font-semibold">Client</th>
                <th className="px-3 py-2.5 font-semibold hidden sm:table-cell">Date</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2.5">
                    <Link className="font-semibold text-brand hover:underline" to={`/${cfg.base}/${i.id}`}>{i.number}</Link>
                  </td>
                  <td className="px-3 py-2.5 truncate max-w-[140px] sm:max-w-none">{i.client_name}</td>
                  <td className="px-3 py-2.5 text-slate-500 hidden sm:table-cell">{i.date?.slice(0, 10)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_CLS[i.status] || 'bg-slate-100 text-slate-600'}`}>
                      {i.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">R {Number(i.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
        {!loading && !list.length && (
          <p className="p-6 text-sm text-slate-500 text-center">No {cfg.title.toLowerCase()} yet. Create one to get started.</p>
        )}
      </div>
    </div>
  )
}
