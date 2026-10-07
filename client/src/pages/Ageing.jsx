import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'

const BUCKETS = [
  ['current', 'Current'],
  ['days_1_30', '1–30 days'],
  ['days_31_60', '31–60 days'],
  ['days_61_90', '61–90 days'],
  ['days_90_plus', '90+ days'],
]

export default function Ageing() {
  const { notify } = useAuth()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    api('/api/v1/invoices/ageing')
      .then((r) => setData(r.data))
      .catch((e) => notify(e.message, 'error'))

  useEffect(() => { load() }, [])

  const markOverdue = async () => {
    setBusy(true)
    try {
      try {
        const r = await api('/api/v1/insight/mark-overdue', { method: 'POST' })
        notify(`Marked ${r.data.updated} invoices overdue`)
      } catch {
        const r = await api('/api/v1/invoices/mark-overdue', { method: 'POST' })
        notify(`Marked ${r.data.marked ?? r.data.updated} invoices overdue`)
      }
      load()
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const sendReminders = async () => {
    setBusy(true)
    try {
      const due = await api('/api/v1/insight/reminders/due?days=7')
      const ids = (due.data || []).map((x) => x.id)
      if (!ids.length) {
        notify('No invoices due for reminder')
        return
      }
      const r = await api('/api/v1/insight/reminders/bulk', {
        method: 'POST',
        body: { invoice_ids: ids, channel: 'email' },
      })
      notify(`Logged ${r.data.sent} reminder(s)`)
      load()
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const fmt = (n) => `R ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const grand = data ? Object.values(data.totals || {}).reduce((s, n) => s + Number(n), 0) : 0

  return (
    <div className="space-y-3">
      <PageHeader
        title="Debtors ageing"
        subtitle="Hermes-Metal · outstanding by age · Money desk · mark overdue"
        meta={[data?.as_of ? `As of ${data.as_of}` : '—', fmt(grand)]}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Link className="btn-outline !text-xs" to="/money">Money desk</Link>
            <button type="button" className="btn-outline !text-xs" disabled={busy} onClick={markOverdue}>
              Mark overdue
            </button>
            <button type="button" className="btn-outline !text-xs" disabled={busy} onClick={sendReminders}>
              Log reminders (7d)
            </button>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {BUCKETS.map(([key, label]) => (
          <div key={key} className="card p-3">
            <div className="text-[10px] uppercase text-slate-500">{label}</div>
            <div className="text-lg font-extrabold tabular-nums">{fmt(data?.totals?.[key])}</div>
            <div className="text-[10px] text-slate-500">{data?.buckets?.[key]?.length || 0} invoices</div>
          </div>
        ))}
      </div>
      {BUCKETS.map(([key, label]) => (
        <div key={key} className="card overflow-hidden">
          <div className="px-3 py-2 text-xs font-bold uppercase text-slate-500 border-b border-slate-100 dark:border-slate-800">
            {label} · {fmt(data?.totals?.[key])}
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-slate-500 text-left">
              <tr>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-2 py-2">Client</th>
                <th className="px-2 py-2">Due</th>
                <th className="px-2 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {(data?.buckets?.[key] || []).map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2"><Link className="font-semibold text-brand" to={`/invoices/${r.id}`}>{r.number}</Link></td>
                  <td className="px-2 py-2 text-xs">{r.client_name}</td>
                  <td className="px-2 py-2 text-xs">{r.due_date?.slice(0, 10)} {r.days_overdue > 0 ? `(${r.days_overdue}d)` : ''}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">{fmt(r.balance)}</td>
                </tr>
              ))}
              {!data?.buckets?.[key]?.length && (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500 text-xs">Empty</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
