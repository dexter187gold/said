import PageHeader from '../components/PageHeader'
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

function BarChart({ data, valueKey = 'total', labelKey = 'month', color = 'bg-brand/80' }) {
  if (!data?.length) return <p className="text-sm text-slate-500">No data yet</p>
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1)
  return (
    <div className="flex items-end gap-1.5 h-36">
      {data.map((d, i) => {
        const v = Number(d[valueKey]) || 0
        const h = Math.max(4, Math.round((v / max) * 100))
        const lab = String(d[labelKey] || '')
        return (
          <div key={lab + i} className="flex flex-1 flex-col items-center gap-1 min-w-0">
            <div className={`w-full rounded-t-md ${color} hover:opacity-90 transition-all`} style={{ height: `${h}%` }} title={`R ${v.toFixed(0)}`} />
            <span className="text-[9px] text-slate-500 truncate w-full text-center">{lab.length > 7 ? lab.slice(5) : lab}</span>
          </div>
        )
      })}
    </div>
  )
}

function DualBar({ data }) {
  if (!data?.length) return <p className="text-sm text-slate-500">No cashflow yet</p>
  const max = Math.max(...data.map((d) => Math.max(Number(d.total) || 0, Number(d.collected) || 0, Number(d.inflow) || 0)), 1)
  return (
    <div className="flex items-end gap-1.5 h-36">
      {data.map((d, i) => {
        const a = Number(d.total || d.inflow || 0)
        const b = Number(d.collected || 0)
        return (
          <div key={(d.month || i) + ''} className="flex flex-1 flex-col items-center gap-0.5 min-w-0">
            <div className="flex items-end gap-0.5 w-full h-28">
              <div className="flex-1 rounded-t bg-brand/70" style={{ height: `${Math.max(4, (a / max) * 100)}%` }} title={`Invoiced R ${a.toFixed(0)}`} />
              {b > 0 && <div className="flex-1 rounded-t bg-emerald-500/80" style={{ height: `${Math.max(4, (b / max) * 100)}%` }} title={`Collected R ${b.toFixed(0)}`} />}
            </div>
            <span className="text-[9px] text-slate-500 truncate w-full text-center">{String(d.month || '').slice(5)}</span>
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value, sub, to }) {
  const inner = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-brand tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </>
  )
  return to ? <Link to={to} className="card p-4 block hover:ring-1 hover:ring-accent/40 transition">{inner}</Link> : <div className="card p-4">{inner}</div>
}

function fmt(n) {
  return `R ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
function fmtH(sec) {
  return `${Math.round((Number(sec) || 0) / 3600 * 10) / 10}h`
}

export default function Home() {
  const { notify } = useAuth()
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = () => api('/api/v1/settings/dashboard').then((r) => setD(r.data)).catch(() => {})

  useEffect(() => {
    load()
  }, [])

  const inv = d?.invoices || {}
  const tix = d?.tickets || {}
  const rate = 450
  const suggestions = d?.suggestions || []
  const forecast = d?.forecast || {}

  const exportCsv = async (mod) => {
    try {
      const res = await api(`/api/v1/settings/export/${mod}`, { raw: true })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `said-${mod}.csv`
      a.click()
      URL.revokeObjectURL(url)
      notify(`Exported ${mod}`)
    } catch (e) { notify(e.message, 'error') }
  }

  const markOverdue = async () => {
    setBusy('overdue')
    try {
      const r = await api('/api/v1/insight/mark-overdue', { method: 'POST' })
      notify(`Marked ${r.data.updated} invoice(s) overdue`)
      load()
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const runRecurring = async () => {
    setBusy('recurring')
    try {
      const r = await api('/api/v1/insight/recurring/run', { method: 'POST' })
      notify(`Created ${r.data.created} recurring invoice(s)`)
      load()
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle="EA-Q3 · suggestions · forecast · cashflow · reminders · recurring"
        meta={[`${fmt(inv.revenue)} revenue`, `${fmt(inv.outstanding)} outstanding`, `${tix.open || 0} open tickets`]}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {['invoices', 'clients', 'tickets', 'payments'].map((m) => (
              <button key={m} type="button" className="btn-outline !text-[10px] !py-1 capitalize" onClick={() => exportCsv(m)}>CSV {m}</button>
            ))}
            <button type="button" className="btn-outline !text-[10px] !py-1" disabled={!!busy} onClick={markOverdue}>
              {busy === 'overdue' ? '…' : 'Mark overdue'}
            </button>
            <button type="button" className="btn-outline !text-[10px] !py-1" disabled={!!busy} onClick={runRecurring}>
              {busy === 'recurring' ? '…' : 'Run recurring'}
            </button>
          </div>
        }
      />

      {suggestions.length > 0 && (
        <div className="card p-3 space-y-2">
          <h2 className="text-sm font-bold">Smart suggestions</h2>
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className={`flex flex-wrap items-start justify-between gap-2 rounded-lg px-3 py-2 text-xs ${
                  s.severity === 'warn'
                    ? 'bg-amber-500/10 border border-amber-500/20'
                    : 'bg-accent/5 border border-accent/15'
                }`}
              >
                <div>
                  <div className="font-semibold">{s.title}</div>
                  <div className="text-slate-500">{s.detail}</div>
                </div>
                {s.href && (
                  <Link to={s.href} className="btn-outline !text-[10px] !py-0.5 shrink-0">
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Revenue" value={fmt(inv.revenue)} sub={`${inv.invoices || inv.total || 0} invoices`} to="/invoices" />
        <Stat label="Collected" value={fmt(inv.collected)} sub={`${inv.paid || 0} paid`} />
        <Stat label="Outstanding" value={fmt(inv.outstanding)} sub={`${(inv.unpaid || 0) + (inv.overdue || 0)} open`} to="/ageing" />
        <Stat
          label="Forecast (next mo)"
          value={fmt(forecast.next_month_collected_est)}
          sub="avg collected"
        />
        <Stat label="Open tickets" value={tix.open || 0} sub={tix.sla_breached ? `${tix.sla_breached} SLA` : 'SLA ok'} to="/tickets" />
        <Stat label="Hours logged" value={fmtH(tix.time_seconds)} sub={`${tix.urgent || 0} urgent`} to="/tickets" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-sm font-bold">Monthly invoiced vs collected</h2>
            <span className="text-[10px] text-slate-500">brand = invoiced · green = paid</span>
          </div>
          <DualBar data={d?.monthly} />
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-2">Payment cashflow (inflows)</h2>
          <BarChart data={d?.cashflow} valueKey="inflow" labelKey="month" color="bg-emerald-500/80" />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-2">Revenue by category</h2>
          {(d?.revenue_by_category || []).length ? (
            <ul className="space-y-1.5">
              {d.revenue_by_category.map((r) => {
                const max = Number(d.revenue_by_category[0]?.total) || 1
                const pct = Math.round((Number(r.total) / max) * 100)
                return (
                  <li key={r.category} className="text-xs">
                    <div className="flex justify-between mb-0.5"><span className="truncate">{r.category}</span><span className="tabular-nums font-semibold">{fmt(r.total)}</span></div>
                    <div className="h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden"><div className="h-full bg-brand/70 rounded-full" style={{ width: `${pct}%` }} /></div>
                  </li>
                )
              })}
            </ul>
          ) : <p className="text-sm text-slate-500">No invoice categories yet</p>}
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-2">Tech utilisation</h2>
          {(d?.tech_util || []).length ? (
            <ul className="space-y-1.5 text-xs">
              {d.tech_util.map((t) => (
                <li key={t.id || t.name} className="flex justify-between gap-2">
                  <span className="truncate font-medium">{t.name}</span>
                  <span className="tabular-nums text-slate-500">{t.jobs} jobs · {fmtH(t.seconds)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Assign techs on tickets to see utilisation</p>}
        </div>
      </div>

      <div className="card p-4 overflow-x-auto">
        <h2 className="text-sm font-bold mb-2">Profit by job (billed vs labour @ R{rate}/hr)</h2>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase text-slate-500 text-left">
            <tr>
              <th className="py-1 pr-2">Job</th>
              <th className="py-1 pr-2">Client</th>
              <th className="py-1 pr-2 text-right">Hours</th>
              <th className="py-1 pr-2 text-right">Labour cost</th>
              <th className="py-1 pr-2 text-right">Billed</th>
              <th className="py-1 text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            {(d?.profit_by_job || []).map((j) => {
              const hours = (j.time_spent_seconds || 0) / 3600
              const labour = hours * rate
              const billed = Number(j.billed || 0)
              const margin = billed - labour
              return (
                <tr key={j.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-2"><Link className="font-medium text-brand hover:underline" to="/tickets">{j.title}</Link></td>
                  <td className="py-1.5 pr-2 text-xs text-slate-500">{j.client_name || '—'}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{hours.toFixed(1)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(labour)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(billed)}</td>
                  <td className={`py-1.5 text-right tabular-nums font-semibold ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(margin)}</td>
                </tr>
              )
            })}
            {!d?.profit_by_job?.length && (
              <tr><td colSpan={6} className="py-4 text-center text-slate-500 text-xs">Log time on tickets and bill to see margins</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <div className="flex justify-between mb-2"><h2 className="text-sm font-bold">Recent documents</h2><Link to="/invoices" className="text-xs text-brand">All</Link></div>
          <ul className="space-y-1 text-xs">
            {(d?.recentInvoices || []).map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <Link to={`/${i.doc_type === 'quote' ? 'quotes' : i.doc_type === 'credit' ? 'credits' : 'invoices'}/${i.id}`} className="font-medium text-brand truncate">{i.number}</Link>
                <span className="tabular-nums shrink-0">{fmt(i.total)} · {i.status}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-4">
          <div className="flex justify-between mb-2"><h2 className="text-sm font-bold">Recent tickets</h2><Link to="/tickets" className="text-xs text-brand">All</Link></div>
          <ul className="space-y-1 text-xs">
            {(d?.recentTickets || []).map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="truncate font-medium">{t.title}</span>
                <span className="shrink-0 text-slate-500 capitalize">{t.status?.replace('_', ' ')} · {fmtH(t.time_spent_seconds)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
