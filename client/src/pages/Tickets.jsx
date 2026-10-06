import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
const PRIOS = ['low', 'normal', 'high', 'urgent']

export default function Tickets() {
  const { notify, user } = useAuth()
  const [list, setList] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('normal')
  const [comment, setComment] = useState('')
  const [internal, setInternal] = useState(false)

  const loadList = () =>
    api('/api/v1/tickets').then((r) => setList(r.data)).catch((e) => notify(e.message, 'error'))

  useEffect(() => {
    loadList()
    api('/api/v1/tickets/metrics').then((r) => setMetrics(r.data)).catch(() => {})
  }, [])

  const openTicket = async (id) => {
    setSelected(id)
    try {
      const r = await api(`/api/v1/tickets/${id}`)
      setDetail(r.data)
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const create = async (e) => {
    e.preventDefault()
    try {
      const r = await api('/api/v1/tickets', {
        method: 'POST',
        body: { title, priority, status: 'open' },
      })
      setTitle('')
      notify('Ticket created')
      await loadList()
      openTicket(r.data.id)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const setStatus = async (status) => {
    try {
      await api(`/api/v1/tickets/${selected}`, { method: 'PATCH', body: { status } })
      notify('Updated')
      await loadList()
      openTicket(selected)
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const postComment = async (e) => {
    e.preventDefault()
    try {
      await api(`/api/v1/tickets/${selected}/comments`, {
        method: 'POST',
        body: { text: comment, internal },
      })
      setComment('')
      openTicket(selected)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold">Tickets desk</h1>
      <p className="text-sm text-slate-500">Two-column CRM · internal notes · metrics</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {[
          ['Open', metrics?.open],
          ['Urgent', metrics?.urgent],
          ['Resolved', metrics?.resolved],
          ['Avg h', metrics?.avg_resolution_hours],
        ].map(([k, v]) => (
          <div key={k} className="card p-3">
            <div className="text-[11px] uppercase text-slate-500">{k}</div>
            <div className="text-xl font-extrabold text-brand">{v ?? '—'}</div>
          </div>
        ))}
      </div>

      <form className="card mt-4 flex flex-wrap gap-2 p-3" onSubmit={create}>
        <input className="input min-w-[200px] flex-1" placeholder="New ticket title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="input max-w-[140px]" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn-primary" type="submit">Create</button>
      </form>

      <div className={`mt-4 grid gap-4 ${selected ? 'lg:grid-cols-[1fr_380px]' : ''}`}>
        <div className="space-y-2">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openTicket(t.id)}
              className={`card w-full p-3 text-left transition-all duration-200 hover:border-brand ${
                selected === t.id ? 'border-brand ring-2 ring-brand/20' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <strong className="text-sm">{t.title}</strong>
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  t.priority === 'urgent' ? 'bg-red-100 text-red-700' : t.priority === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                }`}>{t.priority}</span>
              </div>
              <div className="mt-1 text-xs capitalize text-slate-500">{t.status.replace('_', ' ')} · {t.client_name || 'No client'}</div>
            </button>
          ))}
          {!list.length && <p className="text-sm text-slate-500">No tickets yet.</p>}
        </div>

        {detail && (
          <div className="card flex max-h-[70vh] flex-col p-4">
            <h2 className="font-bold">{detail.title}</h2>
            <p className="text-xs text-slate-500">Opened {detail.created_at?.slice(0, 16)?.replace('T', ' ')}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button key={s} type="button" className={`btn-outline !px-2 !py-1 text-[11px] capitalize ${detail.status === s ? '!border-brand !text-brand' : ''}`} onClick={() => setStatus(s)}>
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
            {detail.notes && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{detail.notes}</p>}

            <div className="ticket-thread mt-3 flex-1 space-y-2 overflow-auto">
              {(detail.comments || []).map((c) => (
                <div key={c.id} className={`rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-2 text-sm ${c.internal ? 'border-l-4 border-l-amber-500' : ''}`}>
                  <div className="text-[11px] text-slate-500">
                    {c.author_name || 'staff'} · {c.created_at?.slice(0, 16)?.replace('T', ' ')}
                    {c.internal ? ' · internal' : ''}
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
