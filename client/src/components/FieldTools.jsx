import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { enqueue } from '../lib/offlineQueue'

/**
 * Hephaestus-Fire field tools for a ticket:
 * GPS check-in, camera photo, signature pad, multi-tech
 */
export default function FieldTools({ ticketId, staff = [], notify, onChanged }) {
  const [checkins, setCheckins] = useState([])
  const [attachments, setAttachments] = useState([])
  const [signatures, setSignatures] = useState([])
  const [techs, setTechs] = useState([])
  const [signer, setSigner] = useState('')
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const fileRef = useRef(null)

  const load = async () => {
    if (!ticketId) return
    try {
      const [c, a, s, t] = await Promise.all([
        api(`/api/v1/field/tickets/${ticketId}/checkins`),
        api(`/api/v1/field/tickets/${ticketId}/attachments`),
        api(`/api/v1/field/tickets/${ticketId}/signatures`),
        api(`/api/v1/field/tickets/${ticketId}/techs`),
      ])
      setCheckins(c.data || [])
      setAttachments(a.data || [])
      setSignatures(s.data || [])
      setTechs(t.data || [])
    } catch (e) {
      /* optional panel */
    }
  }

  useEffect(() => {
    load()
  }, [ticketId])

  const getPosition = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({})
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 8000 }
      )
    })

  const checkin = async (kind) => {
    setBusy(true)
    try {
      const geo = await getPosition()
      if (!navigator.onLine) {
        enqueue({ action: 'checkin', ticket_id: ticketId, body: { kind, ...geo } })
        notify('Check-in queued offline')
        return
      }
      const r = await api(`/api/v1/field/tickets/${ticketId}/checkin`, {
        method: 'POST',
        body: { kind, ...geo },
      })
      notify(kind === 'arrive' ? 'Arrived on site' : kind === 'depart' ? 'Departed' : 'Note logged')
      if (r.data.maps_url) {
        /* keep silent */
      }
      load()
      onChanged?.()
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onPhoto = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const data_url = await readFileAsDataUrl(file, 1280)
      const geo = await getPosition()
      await api(`/api/v1/field/tickets/${ticketId}/attachments`, {
        method: 'POST',
        body: {
          kind: 'photo',
          name: file.name,
          mime: file.type || 'image/jpeg',
          data_url,
          ...geo,
        },
      })
      notify('Photo attached')
      load()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Signature canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    const pos = (ev) => {
      const r = canvas.getBoundingClientRect()
      const t = ev.touches?.[0]
      const x = (t ? t.clientX : ev.clientX) - r.left
      const y = (t ? t.clientY : ev.clientY) - r.top
      return { x, y }
    }
    const start = (ev) => {
      drawing.current = true
      const p = pos(ev)
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ev.preventDefault()
    }
    const move = (ev) => {
      if (!drawing.current) return
      const p = pos(ev)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      ev.preventDefault()
    }
    const end = () => {
      drawing.current = false
    }
    canvas.addEventListener('mousedown', start)
    canvas.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
    canvas.addEventListener('touchstart', start, { passive: false })
    canvas.addEventListener('touchmove', move, { passive: false })
    canvas.addEventListener('touchend', end)
    return () => {
      canvas.removeEventListener('mousedown', start)
      canvas.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', end)
      canvas.removeEventListener('touchstart', start)
      canvas.removeEventListener('touchmove', move)
      canvas.removeEventListener('touchend', end)
    }
  }, [ticketId])

  const clearSig = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  const saveSig = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    setBusy(true)
    try {
      const data_url = canvas.toDataURL('image/png')
      await api(`/api/v1/field/tickets/${ticketId}/signature`, {
        method: 'POST',
        body: { signer_name: signer || null, data_url },
      })
      notify('Signature saved')
      clearSig()
      load()
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleTech = async (userId) => {
    const exists = techs.find((t) => t.user_id === userId)
    let next
    if (exists) next = techs.filter((t) => t.user_id !== userId)
    else next = [...techs, { user_id: userId, role: techs.length ? 'assist' : 'lead' }]
    try {
      await api(`/api/v1/field/tickets/${ticketId}/techs`, {
        method: 'PUT',
        body: { techs: next.map((t) => ({ user_id: t.user_id, role: t.role || 'assist' })) },
      })
      setTechs(next)
      onChanged?.()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  return (
    <div className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-3 mt-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Field tools</h3>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-primary !text-xs" disabled={busy} onClick={() => checkin('arrive')}>
          GPS arrive
        </button>
        <button type="button" className="btn-outline !text-xs" disabled={busy} onClick={() => checkin('depart')}>
          Depart
        </button>
        <label className="btn-outline !text-xs cursor-pointer">
          Camera
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
        </label>
      </div>

      {!!checkins.length && (
        <ul className="text-[10px] text-slate-500 space-y-0.5 max-h-20 overflow-auto">
          {checkins.slice(0, 5).map((c) => (
            <li key={c.id}>
              {c.kind} · {c.user_name || 'tech'} · {(c.created_at || '').slice(0, 16)}
              {c.lat != null && (
                <>
                  {' '}
                  ·{' '}
                  <a
                    className="text-brand underline"
                    href={`https://maps.google.com/?q=${c.lat},${c.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    map
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!!attachments.length && (
        <div className="text-[10px] text-slate-500">{attachments.length} photo(s) on ticket</div>
      )}

      <div>
        <div className="text-[10px] font-semibold text-slate-500 mb-1">Customer signature</div>
        <input
          className="input !text-xs mb-1"
          placeholder="Signer name"
          value={signer}
          onChange={(e) => setSigner(e.target.value)}
        />
        <canvas
          ref={canvasRef}
          width={320}
          height={120}
          className="w-full max-w-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white touch-none"
        />
        <div className="flex gap-1.5 mt-1">
          <button type="button" className="btn-outline !text-[10px]" onClick={clearSig}>
            Clear
          </button>
          <button type="button" className="btn-primary !text-[10px]" disabled={busy} onClick={saveSig}>
            Save signature
          </button>
        </div>
        {!!signatures.length && (
          <div className="text-[10px] text-slate-500 mt-1">{signatures.length} signature(s) stored</div>
        )}
      </div>

      {!!staff.length && (
        <div>
          <div className="text-[10px] font-semibold text-slate-500 mb-1">Technicians on job</div>
          <div className="flex flex-wrap gap-1">
            {staff.map((u) => {
              const on = techs.some((t) => t.user_id === u.id)
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`!text-[10px] !py-0.5 px-2 rounded-full border ${
                    on
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600'
                  }`}
                  onClick={() => toggleTech(u.id)}
                >
                  {u.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function readFileAsDataUrl(file, maxEdge = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let { width, height } = img
      if (width > maxEdge || height > maxEdge) {
        const scale = maxEdge / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    }
    img.src = url
  })
}
