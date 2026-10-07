import React, { useEffect, useState, useRef, useMemo } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
const PRIOS = ['low', 'normal', 'high', 'urgent']
const CATS = ['support', 'repair', 'install', 'onsite', 'remote', 'billing', 'sales', 'jobcard', 'other']

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(r).padStart(2, '0')}s`
  return `${m}m ${String(r).padStart(2, '0')}s`
}
function fmtMoney(n) {
  return `R ${Number(n || 0).toFixed(2)}`
}

const emptyJob = {
  title: '', description: '', priority: 'normal', category: 'repair', status: 'open',
  client_id: '', tags: '', due_date: '', estimated_minutes: '', notes: '',
  site_address: '', device_info: '', serial_numbers: '', reported_by: '',
  fault_reported: '', work_done: '',
}

export default function Tickets() {
  const { notify } = useAuth()
  const [list, setList] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [clients, setClients] = useState([])
  const [hourlyRate, setHourlyRate] = useState(450)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showJobcard, setShowJobcard] = useState(false)
  const [job, setJob] = useState(emptyJob)
  const [comment, setComment] = useState('')
  const [internal, setInternal] = useState(false)
  const [manualMin, setManualMin] = useState('')
  const [filter, setFilter] = useState({ status: '', priority: '', category: '', q: '' })
  const [liveTimer, setLiveTimer] = useState(0)
  const [busy, setBusy] = useState(false)
  const tickRef = useRef(null)

  const loadList = () => {
    const params = new URLSearchParams()
    if (filter.status) params.set('status', filter.status)
    if (filter.priority) params.set('priority', filter.priority)
    if (filter.category) params.set('category', filter.category)
    if (filter.q) params.set('q', filter.q)
    const qs = params.toString() ? `?${params}` : ''
    return api(`/api/v1/tickets${qs}`).then((r) => setList(r.data || [])).catch((e) => notify(e.message, 'error'))
  }
  const loadMetrics = () => api('/api/v1/tickets/metrics').then((r) => setMetrics(r.data)).catch(() => {})

  useEffect(() => {
    loadList()
    loadMetrics()
    api('/api/v1/clients').then((r) => setClients(r.data || [])).catch(() => {})
    api('/api/v1/settings').then((r) => {
      const hr = r.data?.settings?.hourly_rate
      if (hr != null) setHourlyRate(Number(hr) || 450)
    }).catch(() => {})
  }, [filter.status, filter.priority, filter.category])

  useEffect(() => {
    if (detail?.timer_started_at) {
      const start = new Date(detail.timer_started_at).getTime()
      const tick = () => setLiveTimer(Math.floor((Date.now() - start) / 1000))
      tick()
      tickRef.current = setInterval(tick, 1000)
      return () => clearInterval(tickRef.current)
    }
    setLiveTimer(0)
    return () => clearInterval(tickRef.current)
  }, [detail?.timer_started_at])

  const openTicket = async (id) => {
    setSelected(id)
    try {
      const r = await api(`/api/v1/tickets/${id}`)
      setDetail(r.data)
    } catch (e) { notify(e.message, 'error') }
  }

  const setJ = (k, v) => setJob((j) => ({ ...j, [k]: v }))

  const createJobcard = async (e) => {
    e.preventDefault()
    if (!job.title.trim()) return notify('Job title required', 'error')
    setBusy(true)
    try {
      const description = [
        job.fault_reported && `Fault reported: ${job.fault_reported}`,
        job.device_info && `Device: ${job.device_info}`,
        job.serial_numbers && `Serials: ${job.serial_numbers}`,
        job.site_address && `Site: ${job.site_address}`,
        job.reported_by && `Reported by: ${job.reported_by}`,
        job.description,
        job.work_done && `Work done: ${job.work_done}`,
      ].filter(Boolean).join('\n')
      const r = await api('/api/v1/tickets', {
        method: 'POST',
        body: {
          title: job.title.trim(),
          description: description || null,
          priority: job.priority,
          category: job.category,
          status: job.status,
          client_id: job.client_id || null,
          tags: job.tags || null,
          due_date: job.due_date || null,
          estimated_minutes: job.estimated_minutes ? Number(job.estimated_minutes) : null,
          notes: job.notes || null,
        },
      })
      notify('Job card created')
      setShowJobcard(false)
      setJob(emptyJob)
      await loadList()
      loadMetrics()
      openTicket(r.data.id)
    } catch (err) { notify(err.message, 'error') }
    finally { setBusy(false) }
  }

  const patchStatus = async (status) => {
    if (!selected) return
    try {
      await api(`/api/v1/tickets/${selected}`, { method: 'PATCH', body: { status } })
      openTicket(selected); loadList(); loadMetrics()
    } catch (e) { notify(e.message, 'error') }
  }

  const timerStart = async () => {
    try {
      await api(`/api/v1/tickets/${selected}/timer/start`, { method: 'POST' })
      openTicket(selected); loadList(); notify('Timer started')
    } catch (e) { notify(e.message, 'error') }
  }
  const timerStop = async () => {
    try {
      const r = await api(`/api/v1/tickets/${selected}/timer/stop`, { method: 'POST' })
      notify(`Logged ${fmtTime(r.data.seconds_added)}`)
      openTicket(selected); loadList(); loadMetrics()
    } catch (e) { notify(e.message, 'error') }
  }
  const addManual = async () => {
    const mins = Number(manualMin)
    if (!mins || mins <= 0) return notify('Enter minutes', 'error')
    try {
      await api(`/api/v1/tickets/${selected}/time`, { method: 'POST', body: { seconds: Math.round(mins * 60), note: 'Manual log' } })
      setManualMin(''); openTicket(selected); loadList(); notify('Time logged')
    } catch (e) { notify(e.message, 'error') }
  }
  const addComment = async () => {
    if (!comment.trim()) return
    try {
      await api(`/api/v1/tickets/${selected}/comments`, { method: 'POST', body: { text: comment, internal } })
      setComment(''); openTicket(selected)
    } catch (e) { notify(e.message, 'error') }
  }

  const displaySeconds = useMemo(() => {
    if (!detail) return 0
    return (detail.time_spent_seconds || 0) + (detail.timer_started_at ? liveTimer : 0)
  }, [detail, liveTimer])
  const billablePreview = useMemo(() => (displaySeconds / 3600) * hourlyRate, [displaySeconds, hourlyRate])

  const billInvoice = async () => {
    if (!detail?.client_id) return notify('Assign a client on this ticket first', 'error')
    if (!window.confirm(`Bill ${fmtTime(displaySeconds)} at R${hourlyRate}/hr to invoice?`)) return
    setBusy(true)
    try {
      const r = await api(`/api/v1/tickets/${selected}/bill`, { method: 'POST', body: { hourly_rate: hourlyRate, mark_resolved: true } })
      notify(`Invoice ${r.data.number} · ${fmtMoney(r.data.total)}`)
      openTicket(selected); loadList(); loadMetrics()
    } catch (e) { notify(e.message, 'error') }
    finally { setBusy(false) }
  }

  const prioColor = (p) => ({ urgent: 'text-red-600', high: 'text-orange-600', normal: 'text-slate-600', low: 'text-slate-400' }[p] || '')

  return (
    <div className="space-y-3">
      <PageHeader
        title="Tickets & job cards"
        subtitle="Live board · timers · bill labour to invoice"
        meta={[metrics ? `${metrics.open} open` : '—', metrics ? `${metrics.urgent} urgent` : '—', metrics ? `${metrics.total_time_hours}h logged` : '—', `R${hourlyRate}/hr`]}
        actions={<button type="button" className="btn-primary" onClick={() => setShowJobcard(true)}>+ New job card</button>}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[['Open', metrics?.open], ['Urgent', metrics?.urgent], ['Resolved', metrics?.resolved],
          ['Hours', metrics?.total_time_hours], ['Avg resolve h', metrics?.avg_resolution_hours ?? '—'], ['Rate', `R${hourlyRate}`]
        ].map(([label, val]) => (
          <div key={label} className="card p-3">
            <div className="text-[10px] uppercase text-slate-500">{label}</div>
            <div className="text-lg font-extrabold tabular-nums">{val ?? '—'}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && loadList()} />
        <select className="input max-w-[140px]" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-[120px]" value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value })}>
          <option value="">All priority</option>
          {PRIOS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-[120px]" value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
          <option value="">All categories</option>
          {CATS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="btn-outline" onClick={loadList}>Refresh</button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_minmax(300px,400px)]">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur text-left text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-2 py-2">Client</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Prio</th>
                  <th className="px-2 py-2">Time</th>
                  <th className="px-2 py-2">Due</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} onClick={() => openTicket(t.id)}
                    className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 hover:bg-accent/5 ${selected === t.id ? 'bg-accent/10' : ''}`}>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold">{t.title}</div>
                      <div className="text-[10px] text-slate-500">{t.category || '—'}{t.timer_started_at && <span className="ml-1 text-accent animate-pulse">● live</span>}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">{t.client_name || '—'}</td>
                    <td className="px-2 py-2 text-xs capitalize">{t.status?.replace('_', ' ')}</td>
                    <td className={`px-2 py-2 text-xs font-semibold capitalize ${prioColor(t.priority)}`}>{t.priority}</td>
                    <td className="px-2 py-2 text-xs tabular-nums">{fmtTime(t.time_spent_seconds)}</td>
                    <td className="px-2 py-2 text-xs">{t.due_date || '—'}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No tickets. Create a job card.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-3 space-y-3 max-h-[70vh] overflow-y-auto">
          {!detail ? (
            <p className="text-sm text-slate-500 p-4">Select a ticket for timer, comments & billing.</p>
          ) : (
            <>
              <div>
                <h2 className="font-bold">{detail.title}</h2>
                <p className="text-[11px] text-slate-500">{detail.client_name || 'No client'} · {detail.category}</p>
              </div>
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 space-y-2">
                <div className="flex justify-between text-[10px] uppercase text-slate-500">
                  <span>Timer</span>
                  {detail.timer_started_at && <span className="text-accent animate-pulse">● Running</span>}
                </div>
                <div className="text-2xl font-extrabold tabular-nums">{fmtTime(displaySeconds)}</div>
                <div className="text-[11px] text-slate-500">Billable ≈ {fmtMoney(billablePreview)} @ {fmtMoney(hourlyRate)}/hr</div>
                <div className="flex flex-wrap gap-2">
                  {!detail.timer_started_at ? (
                    <button type="button" className="btn-primary !text-xs" onClick={timerStart}>Start timer</button>
                  ) : (
                    <button type="button" className="btn-outline !text-xs !border-red-400 !text-red-600" onClick={timerStop}>Stop & log</button>
                  )}
                  <input className="input !py-1 !w-16 text-xs" type="number" min="1" placeholder="min" value={manualMin} onChange={(e) => setManualMin(e.target.value)} />
                  <button type="button" className="btn-outline !text-xs" onClick={addManual}>+ Log</button>
                </div>
                <button type="button" className="btn-primary w-full !text-xs" disabled={busy} onClick={billInvoice}>Bill hours → invoice</button>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={detail.status} onChange={(e) => patchStatus(e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              {detail.description && (
                <pre className="whitespace-pre-wrap text-xs bg-black/5 dark:bg-white/5 rounded-lg p-2">{detail.description}</pre>
              )}
              {detail.time_entries?.length > 0 && (
                <ul className="text-xs space-y-1 max-h-24 overflow-y-auto">
                  {detail.time_entries.map((e) => (
                    <li key={e.id} className="flex justify-between"><span>{e.user_name}</span><span className="tabular-nums">{fmtTime(e.seconds)}</span></li>
                  ))}
                </ul>
              )}
              <div>
                <div className="label">Comments</div>
                <div className="space-y-1 max-h-28 overflow-y-auto mb-2">
                  {(detail.comments || []).map((c) => (
                    <div key={c.id} className="text-xs rounded-lg bg-black/5 dark:bg-white/5 p-2">
                      <div className="font-semibold">{c.author_name}{c.internal ? ' · internal' : ''}</div>
                      <div>{c.text}</div>
                    </div>
                  ))}
                </div>
                <textarea className="input text-xs" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add update…" />
                <div className="mt-1 flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal</label>
                  <button type="button" className="btn-outline !text-xs ml-auto" onClick={addComment}>Post</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showJobcard && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-3">
          <form onSubmit={createJobcard} className="card glass-panel w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-extrabold">New job card</h2>
              <button type="button" className="btn-ghost !px-2" onClick={() => setShowJobcard(false)}>✕</button>
            </div>
            <div>
              <label className="label">Job title *</label>
              <input className="input" required value={job.title} onChange={(e) => setJ('title', e.target.value)} placeholder="Laptop screen replacement" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Client</label>
                <select className="input" value={job.client_id} onChange={(e) => setJ('client_id', e.target.value)}>
                  <option value="">— Select —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={job.category} onChange={(e) => setJ('category', e.target.value)}>
                  {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Priority</label>
                <select className="input" value={job.priority} onChange={(e) => setJ('priority', e.target.value)}>
                  {PRIOS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Due date</label>
                <input className="input" type="date" value={job.due_date} onChange={(e) => setJ('due_date', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Fault reported</label>
              <input className="input" value={job.fault_reported} onChange={(e) => setJ('fault_reported', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Device</label>
                <input className="input" value={job.device_info} onChange={(e) => setJ('device_info', e.target.value)} />
              </div>
              <div>
                <label className="label">Serials</label>
                <input className="input" value={job.serial_numbers} onChange={(e) => setJ('serial_numbers', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Site address</label>
              <input className="input" value={job.site_address} onChange={(e) => setJ('site_address', e.target.value)} />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={2} value={job.description} onChange={(e) => setJ('description', e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setShowJobcard(false)}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : 'Create job card'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
