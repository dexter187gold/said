import React, { useEffect, useState, useRef, useMemo } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import DocumentActionBar from '../components/DocumentActionBar'

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
const PRIOS = ['low', 'normal', 'high', 'urgent']
const CATS = ['support', 'repair', 'install', 'onsite', 'remote', 'billing', 'sales', 'jobcard', 'other']
const FILTER_KEY = 'said_ticket_filters'

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(r).padStart(2, '0')}s`
}
function fmtMoney(n) { return `R ${Number(n || 0).toFixed(2)}` }
function slaLabel(iso) {
  if (!iso) return null
  const left = new Date(iso).getTime() - Date.now()
  if (left < 0) return { text: 'SLA breached', cls: 'text-red-600' }
  const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000)
  return { text: `SLA ${h}h ${m}m`, cls: left < 3600000 ? 'text-amber-600' : 'text-emerald-600' }
}

const emptyJob = {
  title: '', description: '', priority: 'normal', category: 'repair', status: 'open',
  client_id: '', assignee_id: '', tags: '', due_date: '', estimated_minutes: '',
  warranty: 0, sla_hours: '', site_address: '', device_info: '', serial_numbers: '',
  reported_by: '', fault_reported: '', parts: [],
}

export default function Tickets() {
  const { notify } = useAuth()
  const [list, setList] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [clients, setClients] = useState([])
  const [staff, setStaff] = useState([])
  const [hourlyRate, setHourlyRate] = useState(450)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showJobcard, setShowJobcard] = useState(false)
  const [job, setJob] = useState(emptyJob)
  const [comment, setComment] = useState('')
  const [internal, setInternal] = useState(false)
  const [manualMin, setManualMin] = useState('')
  const [view, setView] = useState('table')
  const [filter, setFilter] = useState(() => {
    try { return { status: '', priority: '', category: '', q: '', assignee_id: '', warranty: '', ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') } }
    catch { return { status: '', priority: '', category: '', q: '', assignee_id: '', warranty: '' } }
  })
  const [liveTimer, setLiveTimer] = useState(0)
  const [busy, setBusy] = useState(false)
  const [partDraft, setPartDraft] = useState({ name: '', qty: 1, cost: 0 })
  const [selectedIds, setSelectedIds] = useState([])
  const tickRef = useRef(null)

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const bulkStatus = async (status) => {
    if (!selectedIds.length) return notify('Select tickets first', 'error')
    try {
      const r = await api('/api/v1/tickets/bulk-status', { method: 'POST', body: { ids: selectedIds, status } })
      notify(`Updated ${r.data.updated} ticket(s) → ${status.replace('_', ' ')}`)
      setSelectedIds([])
      loadList()
      loadMetrics()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const loadList = () => {
    const params = new URLSearchParams()
    if (filter.status) params.set('status', filter.status)
    if (filter.priority) params.set('priority', filter.priority)
    if (filter.category) params.set('category', filter.category)
    if (filter.assignee_id) params.set('assignee_id', filter.assignee_id)
    if (filter.warranty === '1') params.set('warranty', '1')
    if (filter.q) params.set('q', filter.q)
    const qs = params.toString() ? `?${params}` : ''
    return api(`/api/v1/tickets${qs}`).then((r) => setList(r.data || [])).catch((e) => notify(e.message, 'error'))
  }
  const loadMetrics = () => api('/api/v1/tickets/metrics').then((r) => setMetrics(r.data)).catch(() => {})

  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)) } catch {}
    loadList(); loadMetrics()
  }, [filter.status, filter.priority, filter.category, filter.assignee_id, filter.warranty])

  useEffect(() => {
    api('/api/v1/clients').then((r) => setClients(r.data || [])).catch(() => {})
    api('/api/v1/tickets/staff').then((r) => setStaff(r.data || [])).catch(() => {})
    api('/api/v1/settings').then((r) => { const hr = r.data?.settings?.hourly_rate; if (hr != null) setHourlyRate(Number(hr) || 450) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (detail?.timer_started_at) {
      const start = new Date(detail.timer_started_at).getTime()
      const tick = () => setLiveTimer(Math.floor((Date.now() - start) / 1000))
      tick(); tickRef.current = setInterval(tick, 1000)
      return () => clearInterval(tickRef.current)
    }
    setLiveTimer(0)
    return () => clearInterval(tickRef.current)
  }, [detail?.timer_started_at])

  const openTicket = async (id) => {
    setSelected(id)
    try { setDetail((await api(`/api/v1/tickets/${id}`)).data) }
    catch (e) { notify(e.message, 'error') }
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
      ].filter(Boolean).join('\n')
      const r = await api('/api/v1/tickets', { method: 'POST', body: {
        title: job.title.trim(), description: description || null, priority: job.priority, category: job.category,
        status: 'open', client_id: job.client_id || null, assignee_id: job.assignee_id || null, tags: job.tags || null,
        due_date: job.due_date || null, estimated_minutes: job.estimated_minutes ? Number(job.estimated_minutes) : null,
        warranty: job.warranty ? 1 : 0, sla_hours: job.sla_hours ? Number(job.sla_hours) : null, parts: job.parts || [],
      }})
      notify('Job card created'); setShowJobcard(false); setJob(emptyJob)
      await loadList(); loadMetrics(); openTicket(r.data.id)
    } catch (err) { notify(err.message, 'error') }
    finally { setBusy(false) }
  }

  const patch = async (body) => {
    if (!selected) return
    try { await api(`/api/v1/tickets/${selected}`, { method: 'PATCH', body }); openTicket(selected); loadList(); loadMetrics() }
    catch (e) { notify(e.message, 'error') }
  }
  const kanbanMove = async (id, status) => {
    try {
      await api(`/api/v1/tickets/${id}/status`, { method: 'PATCH', body: { status } })
      loadList()
      loadMetrics()
      if (selected === id) openTicket(id)
      notify(`Moved to ${status.replace('_', ' ')}`)
    } catch (e) {
      notify(e.message, 'error')
    }
  }
  const timerStart = async () => { try { await api(`/api/v1/tickets/${selected}/timer/start`, { method: 'POST' }); openTicket(selected); loadList(); notify('Timer started') } catch (e) { notify(e.message, 'error') } }
  const timerStop = async () => { try { const r = await api(`/api/v1/tickets/${selected}/timer/stop`, { method: 'POST' }); notify(`Logged ${fmtTime(r.data.seconds_added)}`); openTicket(selected); loadList(); loadMetrics() } catch (e) { notify(e.message, 'error') } }
  const addManual = async () => {
    const mins = Number(manualMin)
    if (!mins || mins <= 0) return notify('Enter minutes', 'error')
    try { await api(`/api/v1/tickets/${selected}/time`, { method: 'POST', body: { seconds: Math.round(mins * 60), note: 'Manual log' } }); setManualMin(''); openTicket(selected); loadList(); notify('Time logged') }
    catch (e) { notify(e.message, 'error') }
  }
  const addComment = async () => {
    if (!comment.trim()) return
    try { await api(`/api/v1/tickets/${selected}/comments`, { method: 'POST', body: { text: comment, internal } }); setComment(''); openTicket(selected) }
    catch (e) { notify(e.message, 'error') }
  }
  const displaySeconds = useMemo(() => detail ? (detail.time_spent_seconds || 0) + (detail.timer_started_at ? liveTimer : 0) : 0, [detail, liveTimer])
  const billablePreview = useMemo(() => (displaySeconds / 3600) * hourlyRate, [displaySeconds, hourlyRate])
  const billInvoice = async () => {
    if (!detail?.client_id) return notify('Assign a client first', 'error')
    const partsCount = (detail.parts || []).length
    const msg = `Bill ${fmtTime(displaySeconds)} labour @ R${hourlyRate}/hr${partsCount ? ` + ${partsCount} part(s)` : ''} → invoice?`
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      const r = await api(`/api/v1/tickets/${selected}/bill`, {
        method: 'POST',
        body: { hourly_rate: hourlyRate, mark_resolved: true, include_parts: true },
      })
      notify(
        `Invoice ${r.data.number} · ${fmtMoney(r.data.total)}${r.data.parts_count ? ` (${r.data.parts_count} parts)` : ''}`,
        'success'
      )
      openTicket(selected)
      loadList()
      loadMetrics()
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const printJob = async () => {
    if (!selected) return
    try {
      const res = await api(`/api/v1/tickets/${selected}/print`, { raw: true })
      if (!res.ok) throw new Error('Print failed')
      const html = await res.text()
      const w = window.open('', '_blank')
      if (w) { w.document.write(html); w.document.close() }
    } catch (e) { notify(e.message, 'error') }
  }
  const whatsappStatus = async () => {
    if (!detail) return
    try {
      const r = await api(`/api/v1/doc-actions/ticket/${detail.id}/whatsapp-link`, { method: 'POST' })
      window.open(r.data.url, '_blank', 'noopener')
    } catch {
      const text = `SAID Job Update\n${detail.title}\nStatus: ${detail.status}\nTime: ${fmtTime(displaySeconds)}\n${detail.client_name || ''}`
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    }
  }
  const addPartToJob = () => {
    if (!partDraft.name.trim()) return
    setJob((j) => ({ ...j, parts: [...(j.parts || []), { ...partDraft, qty: Number(partDraft.qty) || 1, cost: Number(partDraft.cost) || 0 }] }))
    setPartDraft({ name: '', qty: 1, cost: 0 })
  }
  const saveParts = async () => {
    if (!detail) return
    const parts = [...(detail.parts || [])]
    if (partDraft.name.trim()) parts.push({ name: partDraft.name.trim(), qty: Number(partDraft.qty) || 1, cost: Number(partDraft.cost) || 0 })
    await patch({ parts }); setPartDraft({ name: '', qty: 1, cost: 0 })
  }
  const prioColor = (p) => ({ urgent: 'text-red-600', high: 'text-orange-600', normal: 'text-slate-600', low: 'text-slate-400' }[p] || '')

  return (
    <div className="space-y-3">
      <PageHeader title="Tickets & job cards" subtitle="EA-Q2 · kanban drag · bill labour+parts · SLA · WhatsApp · actions"
        meta={[metrics ? `${metrics.open} open` : '—', metrics?.sla_breached ? `${metrics.sla_breached} SLA` : 'SLA ok', metrics?.warranty_open != null ? `${metrics.warranty_open} warranty` : '', `R${hourlyRate}/hr`]}
        actions={<div className="flex flex-wrap gap-2">
          <button type="button" className={`btn-outline !text-xs ${view === 'table' ? '!border-accent text-accent' : ''}`} onClick={() => setView('table')}>Table</button>
          <button type="button" className={`btn-outline !text-xs ${view === 'kanban' ? '!border-accent text-accent' : ''}`} onClick={() => setView('kanban')}>Kanban</button>
          <button type="button" className="btn-primary" onClick={() => setShowJobcard(true)}>+ New job card</button>
        </div>} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[['Open', metrics?.open], ['Urgent', metrics?.urgent], ['SLA breach', metrics?.sla_breached], ['Warranty', metrics?.warranty_open], ['Hours', metrics?.total_time_hours], ['Resolved', metrics?.resolved]].map(([label, val]) => (
          <div key={label} className="card p-3"><div className="text-[10px] uppercase text-slate-500">{label}</div><div className="text-lg font-extrabold tabular-nums">{val ?? '—'}</div></div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search…" value={filter.q || ''} onChange={(e) => setFilter({ ...filter, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && loadList()} />
        <select className="input max-w-[130px]" value={filter.status || ''} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="input max-w-[110px]" value={filter.priority || ''} onChange={(e) => setFilter({ ...filter, priority: e.target.value })}><option value="">Priority</option>{PRIOS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="input max-w-[120px]" value={filter.category || ''} onChange={(e) => setFilter({ ...filter, category: e.target.value })}><option value="">Category</option>{CATS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="input max-w-[140px]" value={filter.assignee_id || ''} onChange={(e) => setFilter({ ...filter, assignee_id: e.target.value })}><option value="">All techs</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="input max-w-[110px]" value={filter.warranty || ''} onChange={(e) => setFilter({ ...filter, warranty: e.target.value })}><option value="">Warranty</option><option value="1">Warranty only</option></select>
        <button type="button" className="btn-outline" onClick={loadList}>Refresh</button>
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-slate-500">{selectedIds.length} selected</span>
            {STATUSES.map((s) => (
              <button key={s} type="button" className="btn-outline !text-[10px] !py-0.5" onClick={() => bulkStatus(s)}>
                → {s.replace('_', ' ')}
              </button>
            ))}
            <button type="button" className="btn-ghost !text-[10px]" onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        )}
      </div>

      {view === 'kanban' ? (
        <div className="flex gap-2 overflow-x-auto pb-2 min-h-[50vh]">
          {STATUSES.map((col) => (
            <div
              key={col}
              className="card min-w-[220px] w-[240px] flex-shrink-0 p-2 flex flex-col max-h-[70vh]"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-accent/40') }}
              onDragLeave={(e) => e.currentTarget.classList.remove('ring-2', 'ring-accent/40')}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('ring-2', 'ring-accent/40')
                const id = e.dataTransfer.getData('text/ticket-id')
                if (id) kanbanMove(id, col)
              }}
            >
              <div className="text-[10px] uppercase font-bold text-slate-500 px-1 py-1 capitalize">{col.replace('_', ' ')} <span className="opacity-60">({list.filter((t) => t.status === col).length})</span></div>
              <div className="overflow-y-auto flex-1 space-y-1.5">
                {list.filter((t) => t.status === col).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/ticket-id', t.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => openTicket(t.id)}
                    className={`w-full text-left rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 p-2 text-xs hover:border-accent cursor-grab active:cursor-grabbing ${selected === t.id ? 'ring-1 ring-accent' : ''}`}
                  >
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-[10px] text-slate-500">{t.client_name || '—'} · {t.assignee_name || 'Unassigned'}</div>
                    <div className="flex gap-1 mt-1"><span className={`font-semibold capitalize ${prioColor(t.priority)}`}>{t.priority}</span>{t.warranty ? <span className="text-amber-600">W</span> : null}{t.timer_started_at ? <span className="text-accent animate-pulse">●</span> : null}{t.sla_status === 'breached' ? <span className="text-red-600">SLA!</span> : t.sla_status === 'warning' ? <span className="text-amber-500">SLA</span> : null}</div>
                    <div className="mt-1.5 flex flex-wrap gap-0.5">{STATUSES.filter((s) => s !== col).slice(0, 3).map((s) => (
                      <span key={s} role="button" className="rounded px-1 py-0.5 bg-black/5 dark:bg-white/10 text-[9px] capitalize" onClick={(e) => { e.stopPropagation(); kanbanMove(t.id, s) }}>{s.replace('_', ' ')}</span>
                    ))}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_minmax(300px,400px)]">
          <div className="card overflow-hidden"><div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur text-left text-[10px] uppercase text-slate-500"><tr>
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={list.length > 0 && selectedIds.length === list.length}
                    onChange={(e) => setSelectedIds(e.target.checked ? list.map((t) => t.id) : [])}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2">Job</th><th className="px-2 py-2">Client</th><th className="px-2 py-2">Tech</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">SLA</th><th className="px-2 py-2">Time</th>
              </tr></thead>
              <tbody>
                {list.map((t) => { const sla = slaLabel(t.sla_due_at); return (
                  <tr key={t.id} onClick={() => openTicket(t.id)} className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 hover:bg-accent/5 ${selected === t.id ? 'bg-accent/10' : ''}`}>
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleSelect(t.id)} aria-label={`Select ${t.title}`} />
                    </td>
                    <td className="px-3 py-2.5"><div className="font-semibold">{t.title}{t.warranty ? ' 🛡' : ''}</div><div className="text-[10px] text-slate-500">{t.category}{t.timer_started_at && <span className="ml-1 text-accent animate-pulse">● live</span>}</div></td>
                    <td className="px-2 py-2 text-xs">{t.client_name || '—'}</td>
                    <td className="px-2 py-2 text-xs">{t.assignee_name || '—'}</td>
                    <td className="px-2 py-2 text-xs capitalize">{t.status?.replace('_', ' ')}</td>
                    <td className={`px-2 py-2 text-[10px] font-medium ${sla?.cls || ''}`}>{sla?.text || '—'}</td>
                    <td className="px-2 py-2 text-xs tabular-nums">{fmtTime(t.time_spent_seconds)}</td>
                  </tr>
                )})}
                {!list.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No tickets</td></tr>}
              </tbody>
            </table>
          </div></div>

          <div className="card p-3 space-y-3 max-h-[70vh] overflow-y-auto">
            {!detail ? <p className="text-sm text-slate-500 p-4">Select a ticket</p> : (
              <>
                <div><h2 className="font-bold">{detail.title}</h2><p className="text-[11px] text-slate-500">{detail.client_name || 'No client'} · {detail.assignee_name || 'Unassigned'}</p></div>
                <DocumentActionBar
                  type="ticket"
                  id={detail.id}
                  number={detail.title}
                  status={detail.status}
                  onRefresh={() => openTicket(detail.id)}
                  className="!static rounded-lg border border-slate-200 dark:border-slate-700 !bg-transparent"
                />
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  {detail.warranty ? <span className="rounded-full bg-amber-500/15 text-amber-700 px-2 py-0.5">Warranty</span> : null}
                  {(() => { const s = slaLabel(detail.sla_due_at); return s ? <span className={`rounded-full bg-black/5 px-2 py-0.5 ${s.cls}`}>{s.text}</span> : null })()}
                </div>
                <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 space-y-2">
                  <div className="text-2xl font-extrabold tabular-nums">{fmtTime(displaySeconds)}</div>
                  <div className="text-[11px] text-slate-500">≈ {fmtMoney(billablePreview)} @ {fmtMoney(hourlyRate)}/hr</div>
                  <div className="flex flex-wrap gap-2">
                    {!detail.timer_started_at ? <button type="button" className="btn-primary !text-xs" onClick={timerStart}>Start</button> : <button type="button" className="btn-outline !text-xs !border-red-400 !text-red-600" onClick={timerStop}>Stop</button>}
                    <input className="input !py-1 !w-14 text-xs" type="number" placeholder="min" value={manualMin} onChange={(e) => setManualMin(e.target.value)} />
                    <button type="button" className="btn-outline !text-xs" onClick={addManual}>Log</button>
                  </div>
                  <button type="button" className="btn-primary w-full !text-xs" disabled={busy} onClick={billInvoice}>Bill → invoice</button>
                  <div className="flex gap-2">
                    <button type="button" className="btn-outline flex-1 !text-xs" onClick={printJob}>Print job card</button>
                    <button type="button" className="btn-share flex-1 bg-[#25D366] !text-xs" onClick={whatsappStatus}>WhatsApp</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Status</label><select className="input" value={detail.status} onChange={(e) => patch({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
                  <div><label className="label">Assignee</label><select className="input" value={detail.assignee_id || ''} onChange={(e) => patch({ assignee_id: e.target.value || null })}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                  <div><label className="label">Warranty</label><select className="input" value={detail.warranty ? 1 : 0} onChange={(e) => patch({ warranty: Number(e.target.value) })}><option value={0}>No</option><option value={1}>Yes</option></select></div>
                  <div><label className="label">SLA hours</label><input className="input" type="number" min="1" placeholder="24" defaultValue={detail.sla_hours || ''} onBlur={(e) => patch({ sla_hours: e.target.value ? Number(e.target.value) : null })} /></div>
                </div>
                {detail.description && <pre className="whitespace-pre-wrap text-xs bg-black/5 dark:bg-white/5 rounded-lg p-2">{detail.description}</pre>}
                <div>
                  <div className="label">Parts</div>
                  <ul className="text-xs space-y-1 mb-2">{(detail.parts || []).map((p, i) => <li key={i} className="flex justify-between"><span>{p.name} × {p.qty}</span><span>{fmtMoney(p.qty * p.cost)}</span></li>)}{!detail.parts?.length && <li className="text-slate-500">No parts</li>}</ul>
                  <div className="flex flex-wrap gap-1">
                    <input className="input !py-1 text-xs flex-1 min-w-[80px]" placeholder="Part" value={partDraft.name} onChange={(e) => setPartDraft({ ...partDraft, name: e.target.value })} />
                    <input className="input !py-1 !w-12 text-xs" type="number" value={partDraft.qty} onChange={(e) => setPartDraft({ ...partDraft, qty: e.target.value })} />
                    <input className="input !py-1 !w-14 text-xs" type="number" value={partDraft.cost} onChange={(e) => setPartDraft({ ...partDraft, cost: e.target.value })} />
                    <button type="button" className="btn-outline !text-xs" onClick={saveParts}>Add</button>
                  </div>
                </div>
                {detail.linked_invoices?.length > 0 && <div><div className="label">Linked invoices</div><ul className="text-xs">{detail.linked_invoices.map((inv) => <li key={inv.id}>{inv.number} · {fmtMoney(inv.total)} · {inv.status}</li>)}</ul></div>}
                <div>
                  <div className="label">Comments</div>
                  <div className="space-y-1 max-h-24 overflow-y-auto mb-2">{(detail.comments || []).map((c) => <div key={c.id} className="text-xs rounded-lg bg-black/5 p-2"><div className="font-semibold">{c.author_name}</div><div>{c.text}</div></div>)}</div>
                  <textarea className="input text-xs" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Update…" />
                  <div className="mt-1 flex gap-2"><label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal</label><button type="button" className="btn-outline !text-xs ml-auto" onClick={addComment}>Post</button></div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showJobcard && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-3">
          <form onSubmit={createJobcard} className="card glass-panel w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-extrabold">New job card</h2><button type="button" className="btn-ghost !px-2" onClick={() => setShowJobcard(false)}>✕</button></div>
            <div><label className="label">Job title *</label><input className="input" required value={job.title} onChange={(e) => setJ('title', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Client</label><select className="input" value={job.client_id} onChange={(e) => setJ('client_id', e.target.value)}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label">Assignee</label><select className="input" value={job.assignee_id} onChange={(e) => setJ('assignee_id', e.target.value)}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="label">Category</label><select className="input" value={job.category} onChange={(e) => setJ('category', e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className="label">Priority</label><select className="input" value={job.priority} onChange={(e) => setJ('priority', e.target.value)}>{PRIOS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className="label">SLA hours</label><input className="input" type="number" min="1" value={job.sla_hours} onChange={(e) => setJ('sla_hours', e.target.value)} placeholder="24" /></div>
              <div><label className="label">Warranty</label><select className="input" value={job.warranty} onChange={(e) => setJ('warranty', Number(e.target.value))}><option value={0}>No</option><option value={1}>Yes</option></select></div>
            </div>
            <div><label className="label">Fault</label><input className="input" value={job.fault_reported} onChange={(e) => setJ('fault_reported', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Device</label><input className="input" value={job.device_info} onChange={(e) => setJ('device_info', e.target.value)} /></div>
              <div><label className="label">Serials</label><input className="input" value={job.serial_numbers} onChange={(e) => setJ('serial_numbers', e.target.value)} /></div>
            </div>
            <div><label className="label">Parts</label>
              <div className="flex flex-wrap gap-1 mb-1">{(job.parts || []).map((p, i) => <span key={i} className="rounded-full bg-black/5 px-2 py-0.5 text-[10px]">{p.name} ×{p.qty}</span>)}</div>
              <div className="flex gap-1"><input className="input !py-1 text-xs flex-1" placeholder="Part" value={partDraft.name} onChange={(e) => setPartDraft({ ...partDraft, name: e.target.value })} /><button type="button" className="btn-outline !text-xs" onClick={addPartToJob}>Add</button></div>
            </div>
            <div><label className="label">Description</label><textarea className="input" rows={2} value={job.description} onChange={(e) => setJ('description', e.target.value)} /></div>
            <div className="flex gap-2"><button type="button" className="btn-outline flex-1" onClick={() => setShowJobcard(false)}>Cancel</button><button type="submit" className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : 'Create'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
