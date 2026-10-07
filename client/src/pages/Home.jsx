import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

function BarChart({ data, valueKey = 'total', labelKey = 'month' }) {
  if (!data?.length) return <p className="text-sm text-slate-500">No data yet</p>
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1)
  return (
    <div className="flex items-end gap-1.5 h-36">
      {data.map((d) => {
        const v = Number(d[valueKey]) || 0
        const h = Math.max(4, Math.round((v / max) * 100))
        return (
          <div key={d[labelKey]} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t-md bg-brand/80 hover:bg-brand transition-all" style={{ height: `${h}%` }} title={`R ${v.toFixed(0)}`} />
            <span className="text-[9px] text-slate-500 truncate w-full text-center">{String(d[labelKey]).slice(5) || d[labelKey]}</span>
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-brand">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function Home() {
  const [d, setD] = useState(null)

  useEffect(() => {
    api('/api/v1/settings/dashboard').then((r) => setD(r.data)).catch(() => {})
  }, [])

  const inv = d?.invoices || {}
  const tix = d?.tickets || {}

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500">SA Invoice Desk — invoices, tickets, documents</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-primary" to="/invoices/new">New invoice</Link>
          <Link className="btn-outline" to="/tickets">Tickets</Link>
          <Link className="btn-outline" to="/documents">Documents</Link>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue (invoiced)" value={`R ${Number(inv.revenue || 0).toLocaleString()}`} sub={`${inv.total || 0} invoices`} />
        <Stat label="Outstanding" value={`R ${Number(inv.outstanding || 0).toLocaleString()}`} sub={`${(inv.unpaid || 0) + (inv.partial || 0)} open`} />
        <Stat label="Open tickets" value={tix.open ?? '—'} sub={`${tix.urgent || 0} urgent`} />
        <Stat label="Time logged" value={`${Math.round((tix.time_seconds || 0) / 3600 * 10) / 10}h`} sub={`${d?.templates || 0} document templates`} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-3 font-bold text-sm">Invoice revenue by month</h2>
          <BarChart data={d?.monthly || []} />
        </div>
        <div className="card p-4">
          <h2 className="mb-3 font-bold text-sm">Invoice status</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Paid', inv.paid, 'bg-emerald-100 text-emerald-800'],
              ['Unpaid', inv.unpaid, 'bg-amber-100 text-amber-800'],
              ['Partial', inv.partial, 'bg-sky-100 text-sky-800'],
              ['Overdue', inv.overdue, 'bg-red-100 text-red-800'],
            ].map(([k, v, cls]) => (
              <div key={k} className={`rounded-xl p-3 text-center ${cls}`}>
                <div className="text-xl font-extrabold">{v ?? 0}</div>
                <div className="text-[11px] font-semibold uppercase">{k}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs text-slate-500">
            Clients: <strong>{d?.clients ?? 0}</strong> · Templates: <strong>{d?.templates ?? 0}</strong>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-sm">Recent invoices</h2>
            <Link to="/invoices" className="text-xs text-brand hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase text-slate-500">
                <tr><th className="pb-2">#</th><th className="pb-2">Client</th><th className="pb-2">Status</th><th className="pb-2 text-right">Total</th></tr>
              </thead>
              <tbody>
                {(d?.recentInvoices || []).map((i) => (
                  <tr key={i.id} className="border-t border-slate-50 dark:border-slate-800">
                    <td className="py-2"><Link className="font-semibold text-brand hover:underline" to={`/invoices/${i.id}`}>{i.number}</Link></td>
                    <td className="py-2">{i.client_name}</td>
                    <td className="py-2 capitalize">{i.status}</td>
                    <td className="py-2 text-right font-semibold">R {Number(i.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d?.recentInvoices?.length && <p className="text-sm text-slate-500 py-4">No invoices yet.</p>}
          </div>
        </div>
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-sm">Recent tickets</h2>
            <Link to="/tickets" className="text-xs text-brand hover:underline">View all</Link>
          </div>
          <ul className="space-y-2">
            {(d?.recentTickets || []).map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 text-sm border-b border-slate-50 dark:border-slate-800 pb-2">
                <div>
                  <div className="font-semibold">{t.title}</div>
                  <div className="text-xs text-slate-500 capitalize">{t.status.replace('_', ' ')} · {t.client_name || 'No client'}</div>
                </div>
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase shrink-0 ${
                  t.priority === 'urgent' ? 'bg-red-100 text-red-700' : t.priority === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                }`}>{t.priority}</span>
              </li>
            ))}
            {!d?.recentTickets?.length && <p className="text-sm text-slate-500">No tickets yet.</p>}
          </ul>
        </div>
      </div>
    </div>
  )
}
