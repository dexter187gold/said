import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export default function Home() {
  const [metrics, setMetrics] = useState(null)
  const [invoices, setInvoices] = useState([])

  useEffect(() => {
    api('/api/v1/tickets/metrics').then((r) => setMetrics(r.data)).catch(() => {})
    api('/api/v1/invoices').then((r) => setInvoices(r.data.slice(0, 5))).catch(() => {})
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Workspace</h1>
      <p className="text-sm text-slate-500">SA Invoice Desk — full-stack SAID</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Open tickets', value: metrics?.open ?? '—' },
          { label: 'Urgent', value: metrics?.urgent ?? '—' },
          { label: 'Resolved', value: metrics?.resolved ?? '—' },
          { label: 'Avg resolve (h)', value: metrics?.avg_resolution_hours ?? '—' },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className="mt-1 text-2xl font-extrabold text-brand">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link className="btn-primary" to="/invoices/new">New invoice</Link>
        <Link className="btn-outline" to="/tickets">Tickets desk</Link>
        <Link className="btn-outline" to="/documents">Documents</Link>
      </div>

      <div className="card mt-6 p-4">
        <h2 className="mb-3 font-bold">Recent invoices</h2>
        {!invoices.length && <p className="text-sm text-slate-500">No invoices yet.</p>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {invoices.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-2 text-sm">
              <Link className="font-semibold text-brand hover:underline" to={`/invoices/${i.id}`}>
                {i.number}
              </Link>
              <span className="text-slate-500">{i.client_name}</span>
              <span className="capitalize">{i.status}</span>
              <span className="font-semibold">R {Number(i.total).toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
