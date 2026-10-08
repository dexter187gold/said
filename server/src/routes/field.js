/**
 * Hephaestus-Fire — Field power
 * Attachments, signatures, GPS check-in, tech utilisation, offline sync intake
 */
import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now, audit } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

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
        kind: z.enum(['photo', 'file', 'signature_photo']).default('photo'),
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
              `INSERT INTO ticket_comments (id, ticket_id, author_id, body, created_at) VALUES (?,?,?,?,?)`
            ).run(uid(), item.ticket_id, req.user.sub, text, now())
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
