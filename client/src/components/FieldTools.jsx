import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { enqueue } from '../lib/offlineQueue'

/**
 * Hephaestus-Fire field tools for a ticket:
 * GPS check-in, camera photo, signature pad, multi-tech
 */
async function compressImage(file, maxW = 1280, quality = 0.72) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxW / bitmap.width)
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(file)
    })
  }
}

export default function FieldTools({ ticketId, staff = [], notify, onChanged }) {
  const [checkins, setCheckins] = useState([])
  const [attachments, setAttachments] = useState([])
  const [signatures, setSignatures] = useState([])
  const [techs, setTechs] = useState([])
  const [signer, setSigner] = useState('')
  const [busy, setBusy] = useState(false)
  const [travel, setTravel] = useState(null)
  const [checklist, setChecklist] = useState(null)
  const [daySum, setDaySum] = useState(null)
  const [partName, setPartName] = useState('')
  const [partQty, setPartQty] = useState('1')
  const [noteText, setNoteText] = useState('')
  const [rating, setRating] = useState('')
  const [photoKind, setPhotoKind] = useState('photo')
  const [expAmount, setExpAmount] = useState('')
  const [expCat, setExpCat] = useState('fuel')
  const [recording, setRecording] = useState(false)
  const mediaRec = useRef(null)
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const fileRef = useRef(null)

  const load = async () => {
    if (!ticketId) return
    try {
      const [c, a, s, tech, cl] = await Promise.all([
        api(`/api/v1/field/tickets/${ticketId}/checkins`),
        api(`/api/v1/field/tickets/${ticketId}/attachments`),
        api(`/api/v1/field/tickets/${ticketId}/signatures`),
        api(`/api/v1/field/tickets/${ticketId}/techs`),
        api(`/api/v1/field/tickets/${ticketId}/close-checklist`),
      ])
      setCheckins(c.data || [])
      setAttachments(a.data || [])
      setSignatures(s.data || [])
      setTechs(tech.data || [])
      setChecklist(cl.data || null)
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
        await enqueue({ action: 'checkin', ticket_id: ticketId, body: { kind, ...geo } })
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
      const data_url = await compressImage(file, 1280, 0.72)
      const geo = await getPosition()
      await api(`/api/v1/field/tickets/${ticketId}/attachments`, {
        method: 'POST',
        body: {
          kind: photoKind || 'photo',
          name: file.name,
          mime: file.type || 'image/jpeg',
          data_url,
          ...geo,
        },
      })
      notify(`${photoKind || 'photo'} attached`)
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
        <select
          className="input !w-auto !text-[10px] !py-1"
          value={photoKind}
          onChange={(e) => setPhotoKind(e.target.value)}
          title="Photo type"
        >
          <option value="photo">Photo</option>
          <option value="before">Before</option>
          <option value="after">After</option>
        </select>
        <label className="btn-outline !text-xs cursor-pointer">
          Camera
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
        </label>
        <button
          type="button"
          className="btn-outline !text-xs"
          disabled={busy}
          onClick={async () => {
            try {
              const r = await api(`/api/v1/field/tickets/${ticketId}/travel`)
              setTravel(r.data)
              if (r.data.travel_minutes != null) {
                notify(`~${r.data.travel_minutes} min · ${r.data.distance_km} km`)
              } else if (r.data.reason) {
                notify(r.data.reason)
              }
            } catch (e) {
              notify(e.message, 'error')
            }
          }}
        >
          Travel ETA
        </button>
        <button
          type="button"
          className="btn-outline !text-xs"
          onClick={async () => {
            try {
              if (!('Notification' in window)) return notify('Notifications not supported', 'error')
              const perm = await Notification.requestPermission()
              if (perm !== 'granted') return notify('Permission denied', 'error')
              const reg = await navigator.serviceWorker?.ready
              const vapid = await api('/api/v1/field/push/vapid-public')
              let sub = null
              if (reg?.pushManager && vapid.data?.publicKey) {
                const key = urlBase64ToUint8Array(vapid.data.publicKey)
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
              } else if (reg?.pushManager) {
                // no VAPID — store a placeholder endpoint via local notification test
                new Notification('SAID Field', { body: 'Local notifications enabled for this device' })
                notify('Local notifications on (set VAPID for web push)')
                return
              }
              if (sub) {
                const json = sub.toJSON()
                await api('/api/v1/field/push/subscribe', {
                  method: 'POST',
                  body: { endpoint: json.endpoint, keys: json.keys },
                })
                notify('Push subscription saved')
              }
            } catch (e) {
              notify(e.message || 'Push setup failed', 'error')
            }
          }}
        >
          Enable alerts
        </button>
        <button
          type="button"
          className="btn-outline !text-xs"
          disabled={busy}
          onClick={async () => {
            try {
              const geo = await getPosition()
              const r = await api(`/api/v1/field/tickets/${ticketId}/whatsapp-pin`, {
                method: 'POST',
                body: geo,
              })
              window.open(r.data.url, '_blank', 'noopener')
              notify('WhatsApp location ready')
            } catch (e) {
              notify(e.message, 'error')
            }
          }}
        >
          WA location
        </button>
        <button
          type="button"
          className="btn-outline !text-xs"
          onClick={async () => {
            try {
              const r = await api(`/api/v1/field/tickets/${ticketId}/call`)
              if (r.data.tel_url) window.location.href = r.data.tel_url
              else notify('No client phone on this job', 'error')
            } catch (e) {
              notify(e.message, 'error')
            }
          }}
        >
          Call client
        </button>
        <button
          type="button"
          className="btn-outline !text-xs"
          onClick={async () => {
            try {
              const r = await api(`/api/v1/field/tickets/${ticketId}/job-pack`)
              window.open(r.data.whatsapp_url, '_blank', 'noopener')
              notify(`Job pack · ${r.data.counts.photos} photos · ${r.data.counts.checkins} check-ins`)
            } catch (e) {
              notify(e.message, 'error')
            }
          }}
        >
          Job pack WA
        </button>
        <button
          type="button"
          className={`btn-outline !text-xs ${recording ? '!border-red-500 !text-red-600' : ''}`}
          disabled={busy}
          onClick={async () => {
            try {
              if (recording && mediaRec.current) {
                mediaRec.current.stop()
                setRecording(false)
                return
              }
              if (!navigator.mediaDevices?.getUserMedia) {
                return notify('Mic not available', 'error')
              }
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
              const rec = new MediaRecorder(stream)
              const chunks = []
              rec.ondataavailable = (e) => chunks.push(e.data)
              rec.onstop = async () => {
                stream.getTracks().forEach((tr) => tr.stop())
                const blob = new Blob(chunks, { type: 'audio/webm' })
                const reader = new FileReader()
                reader.onload = async () => {
                  try {
                    await api(`/api/v1/field/tickets/${ticketId}/attachments`, {
                      method: 'POST',
                      body: {
                        kind: 'voice',
                        name: `voice-${Date.now()}.webm`,
                        mime: 'audio/webm',
                        data_url: reader.result,
                      },
                    })
                    notify('Voice note saved')
                    load()
                  } catch (err) {
                    notify(err.message, 'error')
                  }
                }
                reader.readAsDataURL(blob)
              }
              mediaRec.current = rec
              rec.start()
              setRecording(true)
              notify('Recording… tap again to stop')
            } catch (e) {
              notify(e.message || 'Mic permission denied', 'error')
              setRecording(false)
            }
          }}
        >
          {recording ? 'Stop voice' : 'Voice note'}
        </button>
        <button
          type="button"
          className="btn-outline !text-xs"
          onClick={async () => {
            try {
              const r = await api('/api/v1/field/day-summary')
              setDaySum(r.data)
              notify(
                `Today: ${r.data.arrives} arrives · ${r.data.photos} photos · ${r.data.travel_km} km · ${r.data.time_hours}h`
              )
            } catch (e) {
              notify(e.message, 'error')
            }
          }}
        >
          My day
        </button>
      </div>
      {travel?.available && (
        <div className="text-[10px] text-slate-500">
          {travel.travel_minutes != null ? (
            <>ETA ~{travel.travel_minutes} min · {travel.distance_km} km ·{' '}</>
          ) : null}
          {travel.maps_url && (
            <a className="text-brand underline" href={travel.maps_url} target="_blank" rel="noreferrer">
              Directions
            </a>
          )}
        </div>
      )}

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
        <div className="space-y-1">
          <div className="text-[10px] text-slate-500">{attachments.length} photo(s) on ticket</div>
          <div className="flex flex-wrap gap-1">
            {attachments.slice(0, 8).map((a) => (
              <button
                key={a.id}
                type="button"
                className="rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[9px] uppercase"
                onClick={async () => {
                  try {
                    const r = await api(`/api/v1/field/attachments/${a.id}`)
                    if (r.data?.data_url) {
                      const w = window.open('')
                      if (w) {
                        w.document.write(`<img src="${r.data.data_url}" style="max-width:100%"/>`)
                      }
                    }
                  } catch (e) {
                    notify(e.message, 'error')
                  }
                }}
              >
                {a.kind || 'photo'}
              </button>
            ))}
          </div>
        </div>
      )}


      

      <div className="flex flex-wrap gap-1 items-end">
        <div>
          <div className="text-[10px] font-semibold text-slate-500 mb-0.5">Expense</div>
          <select className="input !text-[10px] !py-1 !w-auto" value={expCat} onChange={(e) => setExpCat(e.target.value)}>
            <option value="fuel">Fuel</option>
            <option value="parking">Parking</option>
            <option value="toll">Toll</option>
            <option value="parts">Parts cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <input
          className="input !text-xs !w-24"
          type="number"
          step="0.01"
          placeholder="R amount"
          value={expAmount}
          onChange={(e) => setExpAmount(e.target.value)}
        />
        <button
          type="button"
          className="btn-outline !text-[10px]"
          disabled={busy || !expAmount}
          onClick={async () => {
            setBusy(true)
            try {
              await api('/api/v1/field/expenses', {
                method: 'POST',
                body: {
                  ticket_id: ticketId,
                  category: expCat,
                  amount: Number(expAmount),
                },
              })
              notify(`Expense R ${Number(expAmount).toFixed(2)} logged`)
              setExpAmount('')
            } catch (e) {
              notify(e.message, 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          Log expense
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold text-slate-500 mb-1">Field note</div>
          <div className="flex gap-1">
            <input
              className="input !text-xs flex-1"
              placeholder="Quick note…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button
              type="button"
              className="btn-outline !text-[10px]"
              disabled={busy || !noteText.trim()}
              onClick={async () => {
                setBusy(true)
                try {
                  if (!navigator.onLine) {
                    await enqueue({ action: 'comment', ticket_id: ticketId, body: { body: noteText } })
                    notify('Note queued offline')
                  } else {
                    await api(`/api/v1/field/tickets/${ticketId}/notes`, {
                      method: 'POST',
                      body: { body: noteText },
                    })
                    notify('Note saved')
                  }
                  setNoteText('')
                  onChanged?.()
                } catch (e) {
                  notify(e.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-500 mb-1">Add part</div>
          <div className="flex gap-1">
            <input
              className="input !text-xs flex-1"
              placeholder="Part name"
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
            />
            <input
              className="input !text-xs !w-12"
              type="number"
              min="1"
              value={partQty}
              onChange={(e) => setPartQty(e.target.value)}
            />
            <button
              type="button"
              className="btn-outline !text-[10px]"
              disabled={busy || !partName.trim()}
              onClick={async () => {
                setBusy(true)
                try {
                  await api(`/api/v1/field/tickets/${ticketId}/parts`, {
                    method: 'POST',
                    body: { name: partName, qty: Number(partQty) || 1, cost: 0 },
                  })
                  notify('Part added')
                  setPartName('')
                  onChanged?.()
                } catch (e) {
                  notify(e.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-semibold text-slate-500">Customer rating</span>
        <select className="input !w-auto !text-[10px] !py-0.5" value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">—</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}/5
            </option>
          ))}
        </select>
      </div>

{checklist && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Close checklist</div>
          <ul className="text-[10px] space-y-0.5">
            {checklist.items?.map((it) => (
              <li key={it.id} className={it.ok ? 'text-emerald-600' : 'text-slate-500'}>
                {it.ok ? '✓' : '○'} {it.label}
                {it.required && !it.ok ? ' *' : ''}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              className="btn-primary !text-[10px]"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await api(`/api/v1/field/tickets/${ticketId}/close`, {
                    method: 'POST',
                    body: {
                      status: 'resolved',
                      rating: rating ? Number(rating) : undefined,
                    },
                  })
                  notify('Job resolved')
                  load()
                  onChanged?.()
                } catch (e) {
                  if (e.code === 'FIELD_CHECKLIST' || e.message?.includes('Close blocked')) {
                    if (confirm(`${e.message}\n\nForce close anyway?`)) {
                      try {
                        await api(`/api/v1/field/tickets/${ticketId}/close`, {
                          method: 'POST',
                          body: { status: 'resolved', force: true },
                        })
                        notify('Force closed')
                        load()
                        onChanged?.()
                      } catch (err) {
                        notify(err.message, 'error')
                      }
                    }
                  } else notify(e.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Close job
            </button>
            <button
              type="button"
              className="btn-outline !text-[10px]"
              onClick={async () => {
                try {
                  const r = await api(`/api/v1/field/tickets/${ticketId}/travel-log`)
                  notify(
                    r.data.legs?.length
                      ? `Travel log: ${r.data.total_km} km · ${r.data.legs.length} leg(s)`
                      : 'No GPS legs yet'
                  )
                } catch (e) {
                  notify(e.message, 'error')
                }
              }}
            >
              Travel log
            </button>
          </div>
        </div>
      )}
      {daySum && (
        <div className="text-[10px] text-slate-500 rounded-lg bg-black/5 dark:bg-white/5 p-2 flex flex-wrap items-center gap-2">
          <span>
            <strong>{daySum.date}</strong> · {daySum.arrives} arrives · {daySum.photos} photos ·{' '}
            {daySum.closed_jobs} closed · {daySum.travel_km} km · {daySum.time_hours}h
          </span>
          <button
            type="button"
            className="btn-outline !text-[10px] !py-0.5"
            onClick={async () => {
              try {
                const r = await api('/api/v1/field/day-summary/whatsapp')
                window.open(r.data.url, '_blank', 'noopener')
              } catch (e) {
                notify(e.message, 'error')
              }
            }}
          >
            Share day WA
          </button>
        </div>
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
