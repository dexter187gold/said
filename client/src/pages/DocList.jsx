import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import { EmptyState, SkeletonRows } from '../components/EmptyState'

const LABELS = {
  invoice: {
    title: 'Invoices',
    sub: 'Tax invoices · payments · PDF',
    newTo: '/invoices/new',
    newLabel: 'New invoice',
    type: 'invoice',
    base: 'invoices',
    emptyTitle: 'No invoices yet',
    emptyBody: 'Create your first tax invoice. Layout templates and company details fill in automatically.',
  },
  quote: {
    title: 'Quotes',
    sub: 'Hourly · Flat rate · Ad-hoc COD layouts',
    newTo: '/quotes/new',
    newLabel: 'New quote',
    type: 'quote',
    base: 'quotes',
    emptyTitle: 'No quotes yet',
    emptyBody: 'Start with Hourly, Flat rate, or Ad-hoc layout templates — same structure as your PC REPAIR DEX quotes.',
  },
  credit: {
    title: 'Credit notes',
    sub: 'Refunds and adjustments against invoices',
    newTo: '/credits/new',
    newLabel: 'New credit note',
    type: 'credit',
    base: 'credits',
    emptyTitle: 'No credit notes',
    emptyBody: 'Issue a credit note against an invoice when you need a refund or adjustment.',
  },
}

const STATUS_CLS = {
  unpaid: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  partial: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  cancelled: 'bg-slate-100 text-slate-500',
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-sky-100 text-sky-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
}

const INVOICE_STATUSES = ['', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled']
const QUOTE_STATUSES = ['', 'unpaid', 'paid', 'cancelled']

export default function DocList({ docType = 'invoice' }) {
  const cfg = LABELS[docType] || LABELS.invoice
  const { notify } = useAuth()
  const [list, setList] = useState([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('date_desc')
  const [loading, setLoading] = useState(true)
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState([])

  const statusOpts = docType === 'quote' ? QUOTE_STATUSES : INVOICE_STATUSES

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ type: cfg.type })
    if (status) params.set('status', status)
    if (branchId) params.set('branch_id', branchId)
    api(`/api/v1/invoices?${params}`)
      .then((r) => setList(r.data || []))
      .catch((e) => notify(e.message, 'error'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    api('/api/v1/platform/branches').then((r) => setBranches(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [status, docType, branchId])

  const filtered = useMemo(() => {
    let rows = [...list]
    if (q.trim()) {
      const n = q.trim().toLowerCase()
      rows = rows.filter(
        (i) =>
          (i.number || '').toLowerCase().includes(n) ||
          (i.client_name || '').toLowerCase().includes(n) ||
          (i.devices || '').toLowerCase().includes(n)
      )
    }
    rows.sort((a, b) => {
      if (sort === 'total_desc') return Number(b.total) - Number(a.total)
      if (sort === 'total_asc') return Number(a.total) - Number(b.total)
      if (sort === 'date_asc') return String(a.date).localeCompare(String(b.date))
      return String(b.date).localeCompare(String(a.date))
    })
    return rows
  }, [list, q, sort])

  const total = filtered.reduce((s, i) => s + Number(i.total || 0), 0)
  const unpaid = filtered.filter((i) => ['unpaid', 'partial', 'overdue'].includes(i.status)).length

  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-brand">
        {cfg.type === 'quote' ? 'Quotes module' : cfg.type === 'credit' ? 'Credit notes module' : 'Invoices module'}
      </div>
      <PageHeader
        title={cfg.title}
        subtitle={cfg.sub}
        meta={[
          `${filtered.length} shown`,
          `R ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          unpaid ? `${unpaid} open` : 'All clear',
        ]}
        actions={
          <Link className="btn-primary" to={cfg.newTo}>
            {cfg.newLabel}
          </Link>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="doc-status">
          Status filter
        </label>
        <select
          id="doc-status"
          className="input !w-auto !py-1.5 !text-xs capitalize"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          {statusOpts.map((s) => (
            <option key={s || 'all'} value={s}>
              {s || 'All statuses'}
            </option>
          ))}
        </select>
        {branches.length > 0 && (
          <select
            className="input !w-auto !py-1.5 !text-xs"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            aria-label="Filter by branch"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="input !w-auto !py-1.5 !text-xs"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort order"
        >
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="total_desc">Highest total</option>
          <option value="total_asc">Lowest total</option>
        </select>
        <input
          className="input !max-w-xs !py-1.5 !text-xs"
          placeholder="Search number, client, devices…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search documents"
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} cols={4} />
        ) : !filtered.length ? (
          <EmptyState
            title={q || status ? 'No matches' : cfg.emptyTitle}
            body={q || status ? 'Try clearing filters or search.' : cfg.emptyBody}
            actionLabel={cfg.newLabel}
            actionTo={!q && !status ? cfg.newTo : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold" scope="col">
                    Number
                  </th>
                  <th className="px-3 py-2.5 font-semibold" scope="col">
                    Client
                  </th>
                  <th className="px-3 py-2.5 font-semibold hidden sm:table-cell" scope="col">
                    Date
                  </th>
                  <th className="px-3 py-2.5 font-semibold" scope="col">
                    Status
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-right" scope="col">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr
                    key={i.id}
                    className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-3 py-2.5">
                      <Link className="font-semibold text-brand hover:underline" to={`/${cfg.base}/${i.id}`}>
                        {i.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 truncate max-w-[140px] sm:max-w-none">{i.client_name}</td>
                    <td className="px-3 py-2.5 text-slate-500 hidden sm:table-cell">{i.date?.slice(0, 10)}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_CLS[i.status] || 'bg-slate-100 text-slate-600'}`}
                      >
                        {i.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                      R {Number(i.total).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
