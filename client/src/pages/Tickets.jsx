import React, { useEffect, useState, useRef } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
const PRIOS = ['low', 'normal', 'high', 'urgent']
const CATS = ['support', 'repair', 'install', 'billing', 'sales', 'other']

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h > 0) return `${h}h ${m}m ${r}s`
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}

export default function Tickets() {
  const { notify, user } = useAuth()
  const [list, setList] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState({ title: '', priority: 'normal', category: 'support', description: '' })
  const [comment, setComment] = useState('')
  const [internal, setInternal] = useState(false)
  const [manualMin, setManualMin] = useState('')
  const [filter, setFilter] = useState({ status: '', q: '' })
  const [liveTimer, setLiveTimer] = useState(0)
  const tickRef = useRef(null)

  const loadList = () => {
    const params = new URLSearchParams()
    if (filter.status) params.set('status', filter.status)
    if (filter.q) params.set('q', filter.q)
    const qs = params.toString() ? `?${params}` : ''
    return api(`/api/v1/tickets${qs}`).then((r) => setList(r.data)).catch((e) => notify(e.message, 'error'))
  }

  useEffect(() => {
    loadList()
    api('/api/v1/tickets/metrics').then((r) => setMetrics(r.data)).catch(() => {})
  }, [filter.status])

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

  const create = async (e) => {
    e.preventDefault()
    try {
      const r = await api('/api/v1/tickets', { method: 'POST', body: { ...form, status: 'open' } })
      setForm({ title: '', priority: 'normal', category: 'support', description: '' })
      notify('Ticket created')
      await loadList()
      openTicket(r.data.id)
    } catch (err) { notify(err.message, 'error') }
  }

  const setStatus = async (status) => {
    try {
      await api(`/api/v1/tickets/${selected}`, { method: 'PATCH', body: { status } })
      notify('Updated')
      await loadList()
      openTicket(selected)
    } catch (e) { notify(e.message, 'error') }
  }

  const saveMeta = async (patch) => {
    try {
      await api(`/api/v1/tickets/${selected}`, { method: 'PATCH', body: patch })
      openTicket(selected)
      loadList()
    } catch (e) { notify(e.message, 'error') }
  }

  const postComment = async (e) => {
    e.preventDefault()
    try {
      await api(`/api/v1/tickets/${selected}/comments`, { method: 'POST', body: { text: comment, internal } })
      setComment('')
      openTicket(selected)
    } catch (err) { notify(err.message, 'error') }
  }

  const startTimer = async () => {
    try {
      await api(`/api/v1/tickets/${selected}/timer/start`, { method: 'POST' })
      notify('Timer started')
      openTicket(selected)
      loadList()
    } catch (e) { notify(e.message, 'error') }
  }

  const stopTimer = async () => {
    try {
      const r = await api(`/api/v1/tickets/${selected}/timer/stop`, { method: 'POST' })
      notify(`Logged ${fmtTime(r.data.seconds_added)}`)
      openTicket(selected)
      loadList()
    } catch (e) { notify(e.message, 'error') }
  }

  const logManual = async () => {
    const mins = parseFloat(manualMin)
    if (!mins || mins <= 0) return notify('Enter minutes', 'error')
    try {
      await api(`/api/v1/tickets/${selected}/time`, { method: 'POST', body: { seconds: Math.round(mins * 60), note: 'Manual log' } })
      setManualMin('')
      notify('Time logged')
      openTicket(selected)
      loadList()
    } catch (e) { notify(e.message, 'error') }
  }

  const prioClass = (p) =>
    p === 'urgent' ? 'bg-red-100 text-red-700' : p === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'

  return (
    <div>
      <h1 className="text-2xl font-extrabold">Tickets desk</h1>
      <p className="text-sm text-slate-500">Timer · descriptions · categories · time tracking</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Open', metrics?.open],
          ['Urgent', metrics?.urgent],
          ['Resolved', metrics?.resolved],
          ['Time logged', metrics?.total_time_hours != null ? `${metrics.total_time_hours}h` : '—'],
          ['Avg resolve', metrics?.avg_resolution_hours != null ? `${metrics.avg_resolution_hours}h` : '—'],
        ].map(([k, v]) => (
          <div key={k} className="card p-3">
            <div className="text-[11px] uppercase text-slate-500">{k}</div>
            <div className="text-xl font-extrabold text-brand">{v ?? '—'}</div>
          </div>
        ))}
      </div>

      <form className="card mt-4 space-y-2 p-3" onSubmit={create}>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-[200px] flex-1" placeholder="Ticket title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="input max-w-[120px]" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="input max-w-[130px]" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn-primary" type="submit">Create</button>
        </div>
        <textarea className="input" rows={2} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && loadList()} />
        {['', ...STATUSES].map((s) => (
          <button key={s || 'all'} type="button" className={`btn-outline !py-1 !text-xs capitalize ${filter.status === s ? '!border-brand !text-brand' : ''}`} onClick={() => setFilter({ ...filter, status: s })}>
            {s || 'all'}
          </button>
        ))}
      </div>

      <div className={`mt-4 grid gap-4 ${selected ? 'lg:grid-cols-[1fr_420px]' : ''}`}>
        <div className="space-y-2">
          {list.map((t) => (
            <button key={t.id} type="button" onClick={() => openTicket(t.id)}
              className={`card w-full p-3 text-left transition-all duration-200 hover:border-brand ${selected === t.id ? 'border-brand ring-2 ring-brand/20' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <strong className="text-sm">{t.title}</strong>
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${prioClass(t.priority)}`}>{t.priority}</span>
              </div>
              <div className="mt-1 text-xs capitalize text-slate-500">
                {t.status.replace('_', ' ')} · {t.category || '—'} · {t.client_name || 'No client'}
                {t.time_spent_seconds > 0 && ` · ${fmtTime(t.time_spent_seconds)}`}
                {t.timer_started_at && ' · ⏱ running'}
              </div>
              {t.description && <p className="mt-1 text-xs text-slate-600 line-clamp-2">{t.description}</p>}
            </button>
          ))}
          {!list.length && <p className="text-sm text-slate-500">No tickets yet.</p>}
        </div>

        {detail && (
          <div className="card flex max-h-[80vh] flex-col p-4">
            <h2 className="font-bold">{detail.title}</h2>
            <p className="text-xs text-slate-500">Opened {detail.created_at?.slice(0, 16)?.replace('T', ' ')}</p>

            <div className="mt-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase text-slate-500">Time tracked</div>
                  <div className="text-lg font-extrabold text-brand font-mono">
                    {fmtTime((detail.time_spent_seconds || 0) + (detail.timer_started_at ? liveTimer : 0))}
                    {detail.timer_started_at && <span className="ml-2 text-xs animate-pulse text-red-500">● LIVE</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  {!detail.timer_started_at ? (
                    <button type="button" className="btn-primary !py-1 !text-xs" onClick={startTimer}>Start</button>
                  ) : (
                    <button type="button" className="btn-outline !py-1 !text-xs !border-red-400 !text-red-600" onClick={stopTimer}>Stop</button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex gap-1">
                <input className="input !py-1 text-xs" type="number" min="0.1" step="0.1" placeholder="Mins" value={manualMin} onChange={(e) => setManualMin(e.target.value)} />
                <button type="button" className="btn-outline !py-1 !text-xs" onClick={logManual}>Log</button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button key={s} type="button" className={`btn-outline !px-2 !py-1 text-[11px] capitalize ${detail.status === s ? '!border-brand !text-brand' : ''}`} onClick={() => setStatus(s)}>
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="label">Category</label>
                <select className="input !py-1" value={detail.category || ''} onChange={(e) => saveMeta({ category: e.target.value })}>
                  <option value="">—</option>
                  {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Priority</label>
                <select className="input !py-1" value={detail.priority} onChange={(e) => saveMeta({ priority: e.target.value })}>
                  {PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Due date</label>
                <input type="date" className="input !py-1" value={detail.due_date?.slice(0, 10) || ''} onChange={(e) => saveMeta({ due_date: e.target.value || null })} />
              </div>
              <div className="col-span-2">
                <label className="label">Tags</label>
                <input className="input !py-1" value={detail.tags || ''} onBlur={(e) => saveMeta({ tags: e.target.value })} onChange={(e) => setDetail({ ...detail, tags: e.target.value })} />
              </div>
            </div>

            {detail.description && (
              <div className="mt-2">
                <div className="text-[11px] uppercase text-slate-500">Description</div>
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{detail.description}</p>
              </div>
            )}

            {detail.time_entries?.length > 0 && (
              <div className="mt-2 max-h-24 overflow-auto text-[11px] text-slate-500">
                {detail.time_entries.map((te) => (
                  <div key={te.id}>{te.user_name} · {fmtTime(te.seconds)} · {te.started_at?.slice(0, 16)?.replace('T', ' ')} {te.note ? `· ${te.note}` : ''}</div>
                ))}
              </div>
            )}

            <div className="ticket-thread mt-3 flex-1 space-y-2 overflow-auto">
              {(detail.comments || []).map((c) => (
                <div key={c.id} className={`rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-2 text-sm ${c.internal ? 'border-l-4 border-l-amber-500' : ''}`}>
                  <div className="text-[11px] text-slate-500">
                    {c.author_name || 'staff'} · {c.created_at?.slice(0, 16)?.replace('T', ' ')}
                    {c.internal ? ' · internal' : ''}
                    {c.time_logged_seconds > 0 ? ` · +${fmtTime(c.time_logged_seconds)}` : ''}
                  </div>
                  <div>{c.text}</div>
                </div>
              ))}
              {!detail.comments?.length && <p className="text-xs text-slate-500">No messages yet. Say hi as {user?.name}.</p>}
            </div>

            <form className="mt-3 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3" onSubmit={postComment}>
              <textarea className="input" rows={2} placeholder="Reply…" required value={comment} onChange={(e) => setComment(e.target.value)} />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                Internal note (not for client)
              </label>
              <button className="btn-primary w-full" type="submit">Send</button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
