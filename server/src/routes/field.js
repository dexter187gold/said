/**
 * Hephaestus-Fire — Field power
 * Attachments, signatures, GPS check-in, tech utilisation, offline sync intake
 */
import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now, audit } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { emitWebhook } from '../services/webhooks.js'

export const fieldRouter = Router()
fieldRouter.use(requireAuth)

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  kind TEXT DEFAULT 'photo',
  name TEXT,
  mime TEXT,
  data_url TEXT,
  lat REAL,
  lng REAL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attach_ticket ON ticket_attachments(ticket_id);

CREATE TABLE IF NOT EXISTS ticket_checkins (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT DEFAULT 'arrive',
  lat REAL,
  lng REAL,
  accuracy REAL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkin_ticket ON ticket_checkins(ticket_id);

CREATE TABLE IF NOT EXISTS ticket_signatures (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  signer_name TEXT,
  data_url TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offline_queue_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT,
  payload TEXT,
  status TEXT DEFAULT 'received',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_techs (
  ticket_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'assist',
  PRIMARY KEY (ticket_id, user_id)
);
`)
} catch (e) {
  console.warn('field tables', e.message)
}

/** List attachments for ticket */
fieldRouter.get('/tickets/:id/attachments', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, ticket_id, kind, name, mime, lat, lng, created_by, created_at,
              CASE WHEN length(data_url) > 80 THEN substr(data_url, 1, 40) || '…' ELSE data_url END AS data_preview,
              length(data_url) AS bytes
       FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at DESC`
    )
    .all(req.params.id)
  res.json({ data: rows })
})

/** Get one attachment full data_url */
fieldRouter.get('/attachments/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM ticket_attachments WHERE id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: true, message: 'Not found' })
  res.json({ data: row })
})

/**
 * Upload photo / file as data URL (mobile camera → canvas → base64)
 * Cap ~2.5MB text to keep SQLite sane
 */
fieldRouter.post('/tickets/:id/attachments', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        kind: z.enum(['photo', 'file', 'signature_photo', 'before', 'after', 'voice']).default('photo'),
        name: z.string().optional().nullable(),
        mime: z.string().default('image/jpeg'),
        data_url: z.string().min(20),
        lat: z.coerce.number().optional().nullable(),
        lng: z.coerce.number().optional().nullable(),
      })
      .parse(req.body)
    if (body.data_url.length > 3_500_000) {
      return res.status(400).json({ error: true, message: 'Attachment too large (max ~2.5MB)' })
    }
    const ticket = db.prepare(`SELECT id FROM tickets WHERE id = ?`).get(req.params.id)
    if (!ticket) return res.status(404).json({ error: true, message: 'Ticket not found' })
    const id = uid()
    db.prepare(
      `INSERT INTO ticket_attachments (id, ticket_id, kind, name, mime, data_url, lat, lng, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      req.params.id,
      body.kind,
      body.name || `${body.kind}-${id.slice(0, 6)}`,
      body.mime,
      body.data_url,
      body.lat ?? null,
      body.lng ?? null,
      req.user.sub,
      now()
    )
    audit(req.user.sub, 'field.attachment', req.params.id, req.ip)
    res.status(201).json({ data: { id, kind: body.kind, name: body.name } })
  } catch (e) {
    next(e)
  }
})

fieldRouter.delete('/attachments/:id', requireRole('staff'), (req, res) => {
  const r = db.prepare(`DELETE FROM ticket_attachments WHERE id = ?`).run(req.params.id)
  if (!r.changes) return res.status(404).json({ error: true, message: 'Not found' })
  res.json({ data: { ok: true } })
})

/** GPS check-in / check-out */
fieldRouter.post('/tickets/:id/checkin', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        kind: z.enum(['arrive', 'depart', 'note']).default('arrive'),
        lat: z.coerce.number().optional().nullable(),
        lng: z.coerce.number().optional().nullable(),
        accuracy: z.coerce.number().optional().nullable(),
        note: z.string().optional().nullable(),
      })
      .parse(req.body || {})
    const ticket = db.prepare(`SELECT id, status FROM tickets WHERE id = ?`).get(req.params.id)
    if (!ticket) return res.status(404).json({ error: true, message: 'Ticket not found' })
    const id = uid()
    db.prepare(
      `INSERT INTO ticket_checkins (id, ticket_id, user_id, kind, lat, lng, accuracy, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(id, req.params.id, req.user.sub, body.kind, body.lat ?? null, body.lng ?? null, body.accuracy ?? null, body.note || null, now())
    // Arrive → in_progress if open
    if (body.kind === 'arrive' && ticket.status === 'open') {
      db.prepare(`UPDATE tickets SET status='in_progress', updated_at=? WHERE id=?`).run(now(), req.params.id)
    }
    audit(req.user.sub, 'field.checkin', `${req.params.id}:${body.kind}`, req.ip)
    res.status(201).json({
      data: {
        id,
        kind: body.kind,
        lat: body.lat,
        lng: body.lng,
        maps_url:
          body.lat != null && body.lng != null
            ? `https://maps.google.com/?q=${body.lat},${body.lng}`
            : null,
      },
    })
  } catch (e) {
    next(e)
  }
})

fieldRouter.get('/tickets/:id/checkins', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, u.name AS user_name FROM ticket_checkins c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.ticket_id = ? ORDER BY c.created_at DESC`
    )
    .all(req.params.id)
  res.json({ data: rows })
})

/** Customer signature capture (data URL from canvas) */
fieldRouter.post('/tickets/:id/signature', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        signer_name: z.string().optional().nullable(),
        data_url: z.string().min(30),
      })
      .parse(req.body)
    if (body.data_url.length > 2_000_000) {
      return res.status(400).json({ error: true, message: 'Signature too large' })
    }
    const ticket = db.prepare(`SELECT id FROM tickets WHERE id = ?`).get(req.params.id)
    if (!ticket) return res.status(404).json({ error: true, message: 'Ticket not found' })
    const id = uid()
    db.prepare(
      `INSERT INTO ticket_signatures (id, ticket_id, signer_name, data_url, created_by, created_at)
       VALUES (?,?,?,?,?,?)`
    ).run(id, req.params.id, body.signer_name || null, body.data_url, req.user.sub, now())
    audit(req.user.sub, 'field.signature', req.params.id, req.ip)
    res.status(201).json({ data: { id, signer_name: body.signer_name } })
  } catch (e) {
    next(e)
  }
})

fieldRouter.get('/tickets/:id/signatures', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, ticket_id, signer_name, created_by, created_at, length(data_url) AS bytes
       FROM ticket_signatures WHERE ticket_id = ? ORDER BY created_at DESC`
    )
    .all(req.params.id)
  res.json({ data: rows })
})

fieldRouter.get('/signatures/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM ticket_signatures WHERE id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: true, message: 'Not found' })
  res.json({ data: row })
})

/** Multi-tech assignment */
fieldRouter.get('/tickets/:id/techs', (req, res) => {
  const rows = db
    .prepare(
      `SELECT tt.*, u.name, u.email FROM ticket_techs tt
       JOIN users u ON u.id = tt.user_id WHERE tt.ticket_id = ?`
    )
    .all(req.params.id)
  res.json({ data: rows })
})

fieldRouter.put('/tickets/:id/techs', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        techs: z.array(
          z.object({
            user_id: z.string().min(1),
            role: z.enum(['lead', 'assist']).default('assist'),
          })
        ),
      })
      .parse(req.body)
    db.prepare(`DELETE FROM ticket_techs WHERE ticket_id = ?`).run(req.params.id)
    const ins = db.prepare(`INSERT INTO ticket_techs (ticket_id, user_id, role) VALUES (?,?,?)`)
    for (const t of body.techs) ins.run(req.params.id, t.user_id, t.role)
    // Optional: set primary assignee from lead
    const lead = body.techs.find((x) => x.role === 'lead')
    if (lead) {
      db.prepare(`UPDATE tickets SET assignee_id=?, updated_at=? WHERE id=?`).run(lead.user_id, now(), req.params.id)
    }
    res.json({ data: body.techs })
  } catch (e) {
    next(e)
  }
})

/** Tech utilisation — open jobs + time this period */
fieldRouter.get('/utilisation', requireRole('staff'), (_req, res) => {
  const staff = db
    .prepare(`SELECT id, name, email, role FROM users WHERE role IN ('admin','staff') ORDER BY name`)
    .all()
  const data = staff.map((u) => {
    const open = db
      .prepare(
        `SELECT COUNT(*) AS c FROM tickets
         WHERE assignee_id = ? AND status IN ('open','in_progress','waiting') AND COALESCE(is_template,0)=0`
      )
      .get(u.id).c
    const assist = db
      .prepare(
        `SELECT COUNT(*) AS c FROM ticket_techs tt
         JOIN tickets t ON t.id = tt.ticket_id
         WHERE tt.user_id = ? AND t.status IN ('open','in_progress','waiting')`
      )
      .get(u.id).c
    const seconds = db
      .prepare(
        `SELECT COALESCE(SUM(seconds),0) AS s FROM ticket_time_entries WHERE user_id = ?`
      )
      .get(u.id).s
    return {
      user_id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      open_assigned: open,
      open_assist: assist,
      time_seconds: seconds,
      time_hours: Math.round((seconds / 3600) * 10) / 10,
    }
  })
  res.json({ data })
})

/**
 * Offline sync intake — client flushes queued actions when back online
 * Each item: { action, ticket_id?, body }
 */
fieldRouter.post('/sync', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        items: z
          .array(
            z.object({
              action: z.string(),
              ticket_id: z.string().optional().nullable(),
              body: z.any().optional(),
              client_id: z.string().optional(),
            })
          )
          .max(50),
      })
      .parse(req.body)
    const results = []
    for (const item of body.items) {
      const logId = uid()
      db.prepare(
        `INSERT INTO offline_queue_log (id, user_id, action, payload, status, created_at) VALUES (?,?,?,?,?,?)`
      ).run(logId, req.user.sub, item.action, JSON.stringify(item).slice(0, 4000), 'received', now())
      try {
        if (item.action === 'checkin' && item.ticket_id) {
          const b = item.body || {}
          db.prepare(
            `INSERT INTO ticket_checkins (id, ticket_id, user_id, kind, lat, lng, accuracy, note, created_at)
             VALUES (?,?,?,?,?,?,?,?,?)`
          ).run(
            uid(),
            item.ticket_id,
            req.user.sub,
            b.kind || 'arrive',
            b.lat ?? null,
            b.lng ?? null,
            b.accuracy ?? null,
            b.note || 'offline sync',
            now()
          )
          db.prepare(`UPDATE offline_queue_log SET status='applied' WHERE id=?`).run(logId)
          results.push({ client_id: item.client_id, ok: true })
        } else if (item.action === 'comment' && item.ticket_id) {
          const text = item.body?.body || item.body?.text || ''
          if (text) {
            db.prepare(
              `INSERT INTO ticket_comments (id, ticket_id, author_id, author_name, text, internal, time_logged_seconds, created_at) VALUES (?,?,?,?,?,0,0,?)`
            ).run(uid(), item.ticket_id, req.user.sub, null, text, now())
          }
          db.prepare(`UPDATE offline_queue_log SET status='applied' WHERE id=?`).run(logId)
          results.push({ client_id: item.client_id, ok: true })
        } else if (item.action === 'status' && item.ticket_id && item.body?.status) {
          db.prepare(`UPDATE tickets SET status=?, updated_at=? WHERE id=?`).run(item.body.status, now(), item.ticket_id)
          db.prepare(`UPDATE offline_queue_log SET status='applied' WHERE id=?`).run(logId)
          results.push({ client_id: item.client_id, ok: true })
        } else {
          db.prepare(`UPDATE offline_queue_log SET status='skipped' WHERE id=?`).run(logId)
          results.push({ client_id: item.client_id, ok: false, reason: 'unknown_action' })
        }
      } catch (err) {
        db.prepare(`UPDATE offline_queue_log SET status='error' WHERE id=?`).run(logId)
        results.push({ client_id: item.client_id, ok: false, reason: err.message })
      }
    }
    res.json({ data: { results, processed: results.length } })
  } catch (e) {
    next(e)
  }
})

/* ─── Hephaestus-Fire slice 2: push hooks, travel estimates ─── */

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT,
  auth TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
`)
} catch (e) {
  console.warn('push_subscriptions', e.message)
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Rough SA urban travel: avg 35 km/h + 5 min buffer */
function estimateTravelMinutes(km) {
  if (km == null || Number.isNaN(km)) return null
  return Math.max(5, Math.round((km / 35) * 60 + 5))
}

/** Travel estimate from last check-in of current user to ticket last known coords */
fieldRouter.get('/tickets/:id/travel', (req, res) => {
  const ticketId = req.params.id
  const lastOnTicket = db
    .prepare(
      `SELECT lat, lng, created_at FROM ticket_checkins
       WHERE ticket_id = ? AND lat IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    )
    .get(ticketId)
  const lastMine = db
    .prepare(
      `SELECT lat, lng, ticket_id, created_at FROM ticket_checkins
       WHERE user_id = ? AND lat IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    )
    .get(req.user.sub)

  let from = lastMine
  let to = lastOnTicket
  // if user has no history, use company null
  if (!to) {
    return res.json({
      data: {
        available: false,
        reason: 'No GPS check-in on this ticket yet — arrive once to seed coordinates',
      },
    })
  }
  if (!from || from.ticket_id === ticketId) {
    // use ticket's first arrive as destination only
    return res.json({
      data: {
        available: true,
        destination: { lat: to.lat, lng: to.lng },
        distance_km: null,
        travel_minutes: null,
        maps_url: `https://maps.google.com/?q=${to.lat},${to.lng}`,
        note: 'Destination known; travel from your last site unavailable',
      },
    })
  }
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng)
  const mins = estimateTravelMinutes(km)
  res.json({
    data: {
      available: true,
      from: { lat: from.lat, lng: from.lng, at: from.created_at },
      destination: { lat: to.lat, lng: to.lng, at: to.created_at },
      distance_km: Math.round(km * 10) / 10,
      travel_minutes: mins,
      maps_url: `https://www.google.com/maps/dir/${from.lat},${from.lng}/${to.lat},${to.lng}`,
    },
  })
})

/** Route plan: ordered open tickets with last check-in coords for assignee */
fieldRouter.get('/route-plan', requireRole('staff'), (req, res) => {
  const assignee = req.query.assignee_id || req.user.sub
  const tickets = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.priority, c.name AS client_name
       FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.assignee_id = ? AND t.status IN ('open','in_progress','waiting')
         AND COALESCE(t.is_template,0)=0
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at`
    )
    .all(assignee)
  const stops = tickets.map((t) => {
    const geo = db
      .prepare(
        `SELECT lat, lng FROM ticket_checkins WHERE ticket_id = ? AND lat IS NOT NULL ORDER BY created_at DESC LIMIT 1`
      )
      .get(t.id)
    return { ...t, lat: geo?.lat ?? null, lng: geo?.lng ?? null }
  })
  let totalKm = 0
  let totalMin = 0
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (a.lat != null && b.lat != null) {
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng)
      totalKm += km
      totalMin += estimateTravelMinutes(km) || 0
      stops[i].from_prev_km = Math.round(km * 10) / 10
      stops[i].from_prev_min = estimateTravelMinutes(km)
    }
  }
  res.json({
    data: {
      assignee_id: assignee,
      stops,
      total_km: Math.round(totalKm * 10) / 10,
      total_travel_minutes: totalMin,
    },
  })
})

/** Save Web Push subscription */
fieldRouter.post('/push/subscribe', (req, res, next) => {
  try {
    const body = z
      .object({
        endpoint: z.string().url(),
        keys: z
          .object({
            p256dh: z.string().optional(),
            auth: z.string().optional(),
          })
          .optional(),
      })
      .parse(req.body)
    const existing = db.prepare(`SELECT id FROM push_subscriptions WHERE endpoint = ?`).get(body.endpoint)
    if (existing) {
      db.prepare(`UPDATE push_subscriptions SET user_id=?, p256dh=?, auth=? WHERE id=?`).run(
        req.user.sub,
        body.keys?.p256dh || null,
        body.keys?.auth || null,
        existing.id
      )
      return res.json({ data: { id: existing.id, updated: true } })
    }
    const id = uid()
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)`
    ).run(id, req.user.sub, body.endpoint, body.keys?.p256dh || null, body.keys?.auth || null, now())
    audit(req.user.sub, 'push.subscribe', null, req.ip)
    res.status(201).json({ data: { id } })
  } catch (e) {
    next(e)
  }
})

fieldRouter.delete('/push/subscribe', (req, res, next) => {
  try {
    const endpoint = z.string().parse(req.body?.endpoint || req.query?.endpoint)
    db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`).run(endpoint, req.user.sub)
    res.json({ data: { ok: true } })
  } catch (e) {
    next(e)
  }
})

fieldRouter.get('/push/subscriptions', requireRole('admin'), (_req, res) => {
  const rows = db
    .prepare(`SELECT id, user_id, endpoint, created_at FROM push_subscriptions ORDER BY created_at DESC LIMIT 100`)
    .all()
  res.json({ data: rows })
})

/**
 * Queue a notification intent (actual web-push send needs VAPID keys in env)
 * Stores audit + returns payload for client-side showNotification fallback
 */
fieldRouter.post('/push/notify', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        user_id: z.string().optional(),
        title: z.string().min(1),
        body: z.string().optional(),
        url: z.string().optional(),
        ticket_id: z.string().optional(),
      })
      .parse(req.body)
    const targetUser = body.user_id || req.user.sub
    const subs = db
      .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ?`)
      .all(targetUser)
    const payload = {
      title: body.title,
      body: body.body || '',
      url: body.url || (body.ticket_id ? `/tickets` : '/'),
      ticket_id: body.ticket_id || null,
    }
    // Stub: real send would use web-push library + VAPID
    audit(req.user.sub, 'push.notify', `${targetUser}:${body.title}`, req.ip)
    res.json({
      data: {
        subscribers: subs.length,
        payload,
        note:
          subs.length === 0
            ? 'No push subscriptions for user — client can still show local notification'
            : 'Subscription stored; configure VAPID (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) for server push',
      },
    })
  } catch (e) {
    next(e)
  }
})

fieldRouter.get('/push/vapid-public', (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || ''
  res.json({ data: { publicKey: key, configured: !!key } })
})

/* ─── Hephaestus-Fire slice 3: close checklist, day summary, travel log, WA pin ─── */

/** Field completeness for closing a job */
fieldRouter.get('/tickets/:id/close-checklist', (req, res) => {
  const t = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  const photos = db.prepare(`SELECT COUNT(*) AS c FROM ticket_attachments WHERE ticket_id = ?`).get(req.params.id).c
  const sigs = db.prepare(`SELECT COUNT(*) AS c FROM ticket_signatures WHERE ticket_id = ?`).get(req.params.id).c
  const checkins = db
    .prepare(`SELECT kind, COUNT(*) AS c FROM ticket_checkins WHERE ticket_id = ? GROUP BY kind`)
    .all(req.params.id)
  const byKind = Object.fromEntries(checkins.map((r) => [r.kind, r.c]))
  const timeSec = Number(t.time_spent_seconds || 0)
  const items = [
    { id: 'arrive', label: 'GPS arrive on site', ok: (byKind.arrive || 0) > 0, required: true },
    { id: 'photo', label: 'At least one site photo', ok: photos > 0, required: true },
    { id: 'signature', label: 'Customer signature', ok: sigs > 0, required: false },
    { id: 'time', label: 'Time logged (any)', ok: timeSec > 0 || !!t.timer_started_at, required: false },
    { id: 'depart', label: 'GPS depart (optional)', ok: (byKind.depart || 0) > 0, required: false },
  ]
  const requiredOk = items.filter((i) => i.required).every((i) => i.ok)
  res.json({
    data: {
      items,
      required_ok: requiredOk,
      can_close: requiredOk,
      counts: { photos, signatures: sigs, arrive: byKind.arrive || 0, depart: byKind.depart || 0 },
    },
  })
})

/**
 * Close / resolve with field validation
 * body: { status: 'resolved'|'closed', force?: boolean, note?: string }
 */
fieldRouter.post('/tickets/:id/close', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        status: z.enum(['resolved', 'closed']).default('resolved'),
        force: z.boolean().optional().default(false),
        note: z.string().optional().nullable(),
        rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
      })
      .parse(req.body || {})
    const t = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })

    const photos = db.prepare(`SELECT COUNT(*) AS c FROM ticket_attachments WHERE ticket_id = ?`).get(req.params.id).c
    const arrives = db
      .prepare(`SELECT COUNT(*) AS c FROM ticket_checkins WHERE ticket_id = ? AND kind = 'arrive'`)
      .get(req.params.id).c
    if (!body.force && (photos < 1 || arrives < 1)) {
      return res.status(400).json({
        error: true,
        code: 'FIELD_CHECKLIST',
        message: 'Close blocked: need GPS arrive + at least one photo (or use force)',
        data: { photos, arrives },
      })
    }

    const resolvedAt = now()
    db.prepare(`UPDATE tickets SET status=?, resolved_at=COALESCE(resolved_at, ?), updated_at=? WHERE id=?`).run(
      body.status,
      resolvedAt,
      now(),
      req.params.id
    )
    if (body.note) {
      try {
        db.prepare(
          `INSERT INTO ticket_comments (id, ticket_id, author_id, author_name, text, internal, time_logged_seconds, created_at) VALUES (?,?,?,?,?,0,0,?)`
        ).run(uid(), req.params.id, req.user.sub, null, `Closed: ${body.note}`, now())
      } catch {}
    }
    // auto depart check-in if never departed
    const dep = db
      .prepare(`SELECT COUNT(*) AS c FROM ticket_checkins WHERE ticket_id = ? AND kind = 'depart'`)
      .get(req.params.id).c
    if (!dep) {
      db.prepare(
        `INSERT INTO ticket_checkins (id, ticket_id, user_id, kind, lat, lng, accuracy, note, created_at)
         VALUES (?,?,?,'depart',NULL,NULL,NULL,'auto on close',?)`
      ).run(uid(), req.params.id, req.user.sub, now())
    }
    if (body.rating) {
      try {
        db.prepare(
          `INSERT INTO ticket_comments (id, ticket_id, author_id, author_name, text, internal, time_logged_seconds, created_at) VALUES (?,?,?,?,?,0,0,?)`
        ).run(uid(), req.params.id, req.user.sub, null, `Customer rating: ${body.rating}/5`, now())
      } catch {}
    }
    audit(req.user.sub, 'field.close', `${req.params.id}:${body.status}`, req.ip)
    const row = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(req.params.id)
    emitWebhook('ticket.closed', {
      ticket_id: req.params.id,
      title: row?.title,
      status: body.status,
    }).catch(() => {})
    res.json({ data: row })
  } catch (e) {
    next(e)
  }
})

/** Travel log for a ticket (legs between check-ins with coords) */
fieldRouter.get('/tickets/:id/travel-log', (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM ticket_checkins WHERE ticket_id = ? AND lat IS NOT NULL ORDER BY created_at ASC`
    )
    .all(req.params.id)
  const legs = []
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng)
    legs.push({
      from_kind: a.kind,
      to_kind: b.kind,
      from_at: a.created_at,
      to_at: b.created_at,
      distance_km: Math.round(km * 100) / 100,
      travel_minutes: estimateTravelMinutes(km),
    })
  }
  const total_km = legs.reduce((s, l) => s + l.distance_km, 0)
  res.json({ data: { legs, total_km: Math.round(total_km * 100) / 100, points: rows.length } })
})

/** Tech day summary */
fieldRouter.get('/day-summary', requireRole('staff'), (req, res) => {
  const day = (req.query.date || now().slice(0, 10)).slice(0, 10)
  const userId = req.query.user_id || req.user.sub
  const checkins = db
    .prepare(
      `SELECT c.*, t.title AS ticket_title FROM ticket_checkins c
       LEFT JOIN tickets t ON t.id = c.ticket_id
       WHERE c.user_id = ? AND c.created_at LIKE ?
       ORDER BY c.created_at`
    )
    .all(userId, `${day}%`)
  const photos = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ticket_attachments a
       WHERE a.created_by = ? AND a.created_at LIKE ?`
    )
    .get(userId, `${day}%`).c
  const timeSec = db
    .prepare(
      `SELECT COALESCE(SUM(seconds),0) AS s FROM ticket_time_entries
       WHERE user_id = ? AND started_at LIKE ?`
    )
    .get(userId, `${day}%`).s
  const closed = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tickets
       WHERE assignee_id = ? AND status IN ('resolved','closed') AND updated_at LIKE ?`
    )
    .get(userId, `${day}%`).c
  // travel between consecutive check-ins that day
  const withGeo = checkins.filter((c) => c.lat != null)
  let travel_km = 0
  for (let i = 1; i < withGeo.length; i++) {
    travel_km += haversineKm(withGeo[i - 1].lat, withGeo[i - 1].lng, withGeo[i].lat, withGeo[i].lng)
  }
  const user = db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId)
  res.json({
    data: {
      date: day,
      user_id: userId,
      user_name: user?.name || '',
      checkins: checkins.length,
      arrives: checkins.filter((c) => c.kind === 'arrive').length,
      photos,
      closed_jobs: closed,
      time_seconds: timeSec,
      time_hours: Math.round((timeSec / 3600) * 10) / 10,
      travel_km: Math.round(travel_km * 10) / 10,
      travel_minutes: estimateTravelMinutes(travel_km) || 0,
      timeline: checkins.slice(0, 40),
    },
  })
})

/** WhatsApp share pin for ticket last GPS or live coords from body */
fieldRouter.post('/tickets/:id/whatsapp-pin', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        lat: z.coerce.number().optional().nullable(),
        lng: z.coerce.number().optional().nullable(),
      })
      .parse(req.body || {})
    const t = db
      .prepare(
        `SELECT t.*, c.name AS client_name, c.phone AS client_phone
         FROM tickets t LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = ?`
      )
      .get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    let lat = body.lat
    let lng = body.lng
    if (lat == null || lng == null) {
      const geo = db
        .prepare(
          `SELECT lat, lng FROM ticket_checkins WHERE ticket_id = ? AND lat IS NOT NULL ORDER BY created_at DESC LIMIT 1`
        )
        .get(req.params.id)
      lat = geo?.lat
      lng = geo?.lng
    }
    if (lat == null || lng == null) {
      return res.status(400).json({ error: true, message: 'No GPS coordinates — arrive on site first or pass lat/lng' })
    }
    const maps = `https://maps.google.com/?q=${lat},${lng}`
    const text =
      `📍 *SAID Field location*\n` +
      `Job: ${t.title}\n` +
      (t.client_name ? `Client: ${t.client_name}\n` : '') +
      `Map: ${maps}\n` +
      `Coords: ${lat.toFixed?.(5) ?? lat}, ${lng.toFixed?.(5) ?? lng}`
    let phone = ''
    if (t.client_phone) {
      phone = String(t.client_phone).replace(/\D/g, '')
      if (phone.startsWith('0')) phone = '27' + phone.slice(1)
    }
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`
    res.json({ data: { url, text, lat, lng, maps } })
  } catch (e) {
    next(e)
  }
})


/* ─── Hephaestus-Fire slice 4: ratings, field parts, offline notes, gallery, day WA ─── */

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS field_notes (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  user_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_field_notes_ticket ON field_notes(ticket_id);
`)
} catch (e) {
  console.warn('field_notes', e.message)
}

/** Quick field note (works with offline sync action "comment") */
fieldRouter.post('/tickets/:id/notes', requireRole('staff'), (req, res, next) => {
  try {
    const body = z.object({ body: z.string().min(1).max(4000) }).parse(req.body)
    const ticket = db.prepare(`SELECT id FROM tickets WHERE id = ?`).get(req.params.id)
    if (!ticket) return res.status(404).json({ error: true, message: 'Not found' })
    const id = uid()
    db.prepare(`INSERT INTO field_notes (id, ticket_id, user_id, body, created_at) VALUES (?,?,?,?,?)`).run(
      id, req.params.id, req.user.sub, body.body, now()
    )
    try {
      db.prepare(
        `INSERT INTO ticket_comments (id, ticket_id, author_id, author_name, text, internal, time_logged_seconds, created_at) VALUES (?,?,?,?,?,1,0,?)`
      ).run(uid(), req.params.id, req.user.sub, null, body.body, now())
    } catch {}
    res.status(201).json({ data: { id, body: body.body } })
  } catch (e) {
    next(e)
  }
})

fieldRouter.get('/tickets/:id/notes', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM field_notes WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(req.params.id)
  res.json({ data: rows })
})

/** Add part from field and merge into ticket parts_json */
fieldRouter.post('/tickets/:id/parts', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        qty: z.coerce.number().default(1),
        cost: z.coerce.number().default(0),
      })
      .parse(req.body)
    const t = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    let parts = []
    try {
      parts = JSON.parse(t.parts_json || '[]')
      if (!Array.isArray(parts)) parts = []
    } catch {
      parts = []
    }
    parts.push({ name: body.name, qty: body.qty, cost: body.cost })
    db.prepare(`UPDATE tickets SET parts_json=?, updated_at=? WHERE id=?`).run(JSON.stringify(parts), now(), req.params.id)
    audit(req.user.sub, 'field.part', `${req.params.id}:${body.name}`, req.ip)
    res.status(201).json({ data: { parts } })
  } catch (e) {
    next(e)
  }
})

/** Attachment gallery with optional kind filter */
fieldRouter.get('/tickets/:id/gallery', (req, res) => {
  const kind = req.query.kind
  let sql = `SELECT id, ticket_id, kind, name, mime, lat, lng, created_at, data_url FROM ticket_attachments WHERE ticket_id = ?`
  const params = [req.params.id]
  if (kind) {
    sql += ` AND kind = ?`
    params.push(kind)
  }
  sql += ` ORDER BY created_at DESC LIMIT 40`
  const rows = db.prepare(sql).all(...params)
  // trim data for list? keep full for mobile gallery thumbs — client can use data_url
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      mime: r.mime,
      created_at: r.created_at,
      thumb: r.data_url && r.data_url.length < 500_000 ? r.data_url : null,
      has_full: true,
    })),
  })
})

/** Day summary as WhatsApp text */
fieldRouter.get('/day-summary/whatsapp', requireRole('staff'), (req, res) => {
  const day = (req.query.date || now().slice(0, 10)).slice(0, 10)
  const userId = req.query.user_id || req.user.sub
  const checkins = db
    .prepare(
      `SELECT c.*, t.title AS ticket_title FROM ticket_checkins c
       LEFT JOIN tickets t ON t.id = c.ticket_id
       WHERE c.user_id = ? AND c.created_at LIKE ? ORDER BY c.created_at`
    )
    .all(userId, `${day}%`)
  const photos = db
    .prepare(`SELECT COUNT(*) AS c FROM ticket_attachments WHERE created_by = ? AND created_at LIKE ?`)
    .get(userId, `${day}%`).c
  const timeSec = db
    .prepare(`SELECT COALESCE(SUM(seconds),0) AS s FROM ticket_time_entries WHERE user_id = ? AND started_at LIKE ?`)
    .get(userId, `${day}%`).s
  const closed = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tickets WHERE assignee_id = ? AND status IN ('resolved','closed') AND updated_at LIKE ?`
    )
    .get(userId, `${day}%`).c
  const withGeo = checkins.filter((c) => c.lat != null)
  let travel_km = 0
  for (let i = 1; i < withGeo.length; i++) {
    travel_km += haversineKm(withGeo[i - 1].lat, withGeo[i - 1].lng, withGeo[i].lat, withGeo[i].lng)
  }
  const user = db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId)
  const lines = [
    `*SAID Field — Day summary*`,
    `Date: ${day}`,
    `Tech: ${user?.name || ''}`,
    `Site arrives: ${checkins.filter((c) => c.kind === 'arrive').length}`,
    `Photos: ${photos}`,
    `Jobs closed: ${closed}`,
    `Time logged: ${Math.round((timeSec / 3600) * 10) / 10}h`,
    `Travel ~${Math.round(travel_km * 10) / 10} km`,
    '',
    'Timeline:',
  ]
  for (const c of checkins.slice(0, 15)) {
    lines.push(`• ${(c.created_at || '').slice(11, 16)} ${c.kind} — ${c.ticket_title || c.ticket_id.slice(0, 8)}`)
  }
  const text = lines.join('\n')
  res.json({
    data: {
      text,
      url: `https://wa.me/?text=${encodeURIComponent(text)}`,
    },
  })
})

/** Offline note sync support already maps comment action — document draft status updates */
fieldRouter.post('/tickets/:id/offline-status', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({ status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']) })
      .parse(req.body)
    db.prepare(`UPDATE tickets SET status=?, updated_at=? WHERE id=?`).run(body.status, now(), req.params.id)
    res.json({ data: { status: body.status } })
  } catch (e) {
    next(e)
  }
})

/* ─── Hephaestus-Fire slice 5: expenses, job pack, today board, voice, call meta ─── */

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS field_expenses (
  id TEXT PRIMARY KEY,
  ticket_id TEXT,
  user_id TEXT NOT NULL,
  category TEXT DEFAULT 'other',
  amount REAL NOT NULL,
  note TEXT,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_field_exp_user ON field_expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_field_exp_ticket ON field_expenses(ticket_id);
`)
} catch (e) {
  console.warn('field_expenses', e.message)
}

/** Log field expense (fuel, parking, parts cash, other) */
fieldRouter.post('/expenses', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        ticket_id: z.string().optional().nullable(),
        category: z.enum(['fuel', 'parking', 'toll', 'parts', 'other']).default('other'),
        amount: z.coerce.number().positive(),
        note: z.string().optional().nullable(),
        date: z.string().optional(),
      })
      .parse(req.body)
    const id = uid()
    const date = body.date || now().slice(0, 10)
    db.prepare(
      `INSERT INTO field_expenses (id, ticket_id, user_id, category, amount, note, date, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, body.ticket_id || null, req.user.sub, body.category, body.amount, body.note || null, date, now())
    audit(req.user.sub, 'field.expense', `${body.category}:${body.amount}`, req.ip)
    res.status(201).json({ data: { id, ...body, date } })
  } catch (e) {
    next(e)
  }
})

fieldRouter.get('/expenses', requireRole('staff'), (req, res) => {
  const day = req.query.date
  const userId = req.query.user_id || req.user.sub
  let sql = `SELECT e.*, t.title AS ticket_title FROM field_expenses e
             LEFT JOIN tickets t ON t.id = e.ticket_id WHERE e.user_id = ?`
  const params = [userId]
  if (day) {
    sql += ` AND e.date = ?`
    params.push(day.slice(0, 10))
  }
  sql += ` ORDER BY e.date DESC, e.created_at DESC LIMIT 100`
  const rows = db.prepare(sql).all(...params)
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
  res.json({ data: rows, total })
})

/** Job pack — text summary of field activity for a ticket */
fieldRouter.get('/tickets/:id/job-pack', (req, res) => {
  const t = db
    .prepare(
      `SELECT t.*, c.name AS client_name, c.phone AS client_phone, u.name AS assignee_name
       FROM tickets t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = ?`
    )
    .get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  const checkins = db
    .prepare(`SELECT * FROM ticket_checkins WHERE ticket_id = ? ORDER BY created_at`)
    .all(req.params.id)
  const photos = db
    .prepare(`SELECT id, kind, name, created_at FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at`)
    .all(req.params.id)
  const sigs = db
    .prepare(`SELECT signer_name, created_at FROM ticket_signatures WHERE ticket_id = ?`)
    .all(req.params.id)
  const notes = db
    .prepare(`SELECT body, created_at FROM field_notes WHERE ticket_id = ? ORDER BY created_at`)
    .all(req.params.id)
  const expenses = db
    .prepare(`SELECT category, amount, note, date FROM field_expenses WHERE ticket_id = ?`)
    .all(req.params.id)
  let parts = []
  try {
    parts = JSON.parse(t.parts_json || '[]')
  } catch {}
  const lines = [
    `*SAID Job pack*`,
    `Job: ${t.title}`,
    `Status: ${t.status}`,
    t.client_name ? `Client: ${t.client_name}` : null,
    t.assignee_name ? `Tech: ${t.assignee_name}` : null,
    t.time_spent_seconds ? `Time: ${Math.round(t.time_spent_seconds / 60)} min` : null,
    '',
    'Check-ins:',
    ...(checkins.length
      ? checkins.map((c) => `• ${(c.created_at || '').slice(0, 16)} ${c.kind}${c.lat != null ? ` @ ${c.lat.toFixed?.(4)},${c.lng.toFixed?.(4)}` : ''}`)
      : ['• none']),
    '',
    `Photos: ${photos.length} (${photos.map((p) => p.kind).join(', ') || '—'})`,
    `Signatures: ${sigs.length}${sigs[0]?.signer_name ? ` (${sigs[0].signer_name})` : ''}`,
    parts.length ? `Parts: ${parts.map((p) => `${p.name}×${p.qty}`).join(', ')}` : null,
    notes.length ? `Notes:\n${notes.map((n) => `• ${n.body}`).join('\n')}` : null,
    expenses.length
      ? `Expenses: R ${expenses.reduce((s, e) => s + Number(e.amount), 0).toFixed(2)}`
      : null,
  ].filter((x) => x != null)
  const text = lines.join('\n')
  res.json({
    data: {
      text,
      whatsapp_url: `https://wa.me/?text=${encodeURIComponent(text)}`,
      counts: {
        checkins: checkins.length,
        photos: photos.length,
        signatures: sigs.length,
        notes: notes.length,
        expenses: expenses.length,
      },
    },
  })
})

/** Today's board for a tech */
fieldRouter.get('/today', requireRole('staff'), (req, res) => {
  const day = (req.query.date || now().slice(0, 10)).slice(0, 10)
  const userId = req.query.user_id || req.user.sub
  const assigned = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, c.name AS client_name, c.phone AS client_phone
       FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.assignee_id = ? AND COALESCE(t.is_template,0)=0
         AND t.status IN ('open','in_progress','waiting')
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.due_date`
    )
    .all(userId)
  const doneToday = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tickets
       WHERE assignee_id = ? AND status IN ('resolved','closed') AND updated_at LIKE ?`
    )
    .get(userId, `${day}%`).c
  const expenses = db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM field_expenses WHERE user_id = ? AND date = ?`)
    .get(userId, day).s
  res.json({
    data: {
      date: day,
      open_jobs: assigned,
      closed_today: doneToday,
      expenses_today: expenses,
    },
  })
})

/** Client call meta for ticket */
fieldRouter.get('/tickets/:id/call', (req, res) => {
  const t = db
    .prepare(
      `SELECT t.id, t.title, c.name AS client_name, c.phone AS client_phone
       FROM tickets t LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = ?`
    )
    .get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  let tel = null
  if (t.client_phone) {
    const p = String(t.client_phone).replace(/\D/g, '')
    tel = p ? `tel:+${p.startsWith('0') ? '27' + p.slice(1) : p}` : null
  }
  res.json({
    data: {
      client_name: t.client_name,
      phone: t.client_phone,
      tel_url: tel,
      title: t.title,
    },
  })
})
