import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import AppLogo from '../components/AppLogo'

/** Client self-service portal — no staff login; uses ?token= */
export default function Portal() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [me, setMe] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [tickets, setTickets] = useState([])
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('invoices')

  useEffect(() => {
    if (!token) {
      setErr('Missing portal token. Ask your service provider for a link.')
      return
    }
    const q = `?token=${encodeURIComponent(token)}`
    Promise.all([
      api(`/api/v1/portal/me${q}`),
      api(`/api/v1/portal/invoices${q}`),
      api(`/api/v1/portal/tickets${q}`),
    ])
      .then(([m, inv, tix]) => {
        setMe(m.data)
        setInvoices(inv.data || [])
        setTickets(tix.data || [])
      })
      .catch((e) => setErr(e.message || 'Portal unavailable'))
  }, [token])

  const fmt = (n) => `R ${Number(n || 0).toFixed(2)}`

  if (err) {
    return (
      <div className="min-h-dvh grid place-items-center p-6">
        <div className="card max-w-md p-6 text-center space-y-3">
          <AppLogo size={48} />
          <h1 className="font-bold">Client portal</h1>
          <p className="text-sm text-red-600">{err}</p>
        </div>
      </div>
    )
  }

  if (!me) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <p className="text-sm text-slate-500">Loading portal…</p>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur px-4 py-3 flex items-center gap-3">
        <AppLogo size={36} />
        <div>
          <div className="font-bold text-sm">SAID Client Portal</div>
          <div className="text-xs text-slate-500">{me.name}</div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="flex gap-2">
          <button type="button" className={`btn-outline !text-xs ${tab === 'invoices' ? '!border-accent text-accent' : ''}`} onClick={() => setTab('invoices')}>
            Invoices
          </button>
          <button type="button" className={`btn-outline !text-xs ${tab === 'tickets' ? '!border-accent text-accent' : ''}`} onClick={() => setTab('tickets')}>
            Tickets
          </button>
        </div>
        {tab === 'invoices' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2">Number</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-medium">{i.number}</td>
                    <td className="px-2 py-2 text-xs">{i.date}</td>
                    <td className="px-2 py-2 text-xs capitalize">{i.status}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(i.total)}</td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500 text-xs">
                      No invoices
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'tickets' && (
          <div className="card overflow-hidden">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {tickets.map((t) => (
                <li key={t.id} className="px-3 py-2.5 flex justify-between gap-2 text-sm">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-xs text-slate-500 capitalize shrink-0">{t.status?.replace('_', ' ')}</span>
                </li>
              ))}
              {!tickets.length && <li className="px-3 py-6 text-center text-slate-500 text-xs">No tickets</li>}
            </ul>
          </div>
        )}
        <p className="text-[10px] text-slate-400 text-center">Read-only portal · token expires {me.expires_at?.slice(0, 10)}</p>
      </main>
    </div>
  )
}
