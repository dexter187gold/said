/** Artemis — scheduling / appointments */
import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const artemisRouter = Router()
artemisRouter.use(requireAuth)

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  client_id TEXT,
  ticket_id TEXT,
  assignee_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  mode TEXT DEFAULT 'onsite',
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appt_starts ON appointments(starts_at);
`)
} catch (e) {
  console.warn('appointments', e.message)
}

artemisRouter.get('/appointments', requireRole('staff'), (req, res) => {
  const from = req.query.from || now().slice(0, 10)
  const to = req.query.to || from
  const rows = db
    .prepare(
      `SELECT a.*, c.name AS client_name, u.name AS assignee_name, t.title AS ticket_title
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN users u ON u.id = a.assignee_id
       LEFT JOIN tickets t ON t.id = a.ticket_id
       WHERE date(a.starts_at) >= date(?) AND date(a.starts_at) <= date(?)
       ORDER BY a.starts_at ASC LIMIT 200`
    )
    .all(from, to)
  res.json({ data: rows })
})

artemisRouter.post('/appointments', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        title: z.string().min(1),
        client_id: z.string().optional().nullable(),
        ticket_id: z.string().optional().nullable(),
        assignee_id: z.string().optional().nullable(),
        starts_at: z.string().min(8),
        ends_at: z.string().optional().nullable(),
        mode: z.enum(['remote', 'onsite', 'workshop']).default('onsite'),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body)
    const id = uid()
    db.prepare(
      `INSERT INTO appointments (id, title, client_id, ticket_id, assignee_id, starts_at, ends_at, mode, status, notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'scheduled', ?,?,?,?)`
    ).run(
      id, body.title, body.client_id || null, body.ticket_id || null,
      body.assignee_id || req.user.sub, body.starts_at, body.ends_at || null,
      body.mode, body.notes || null, req.user.sub, now(), now()
    )
    res.status(201).json({ data: db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(id) })
  } catch (e) {
    next(e)
  }
})

artemisRouter.patch('/appointments/:id', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        status: z.enum(['scheduled', 'confirmed', 'done', 'cancelled']).optional(),
        starts_at: z.string().optional(),
        ends_at: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        mode: z.enum(['remote', 'onsite', 'workshop']).optional(),
        assignee_id: z.string().optional().nullable(),
      })
      .parse(req.body || {})
    const ex = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(req.params.id)
    if (!ex) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(
      `UPDATE appointments SET status=?, starts_at=?, ends_at=?, notes=?, mode=?, assignee_id=?, updated_at=? WHERE id=?`
    ).run(
      body.status ?? ex.status,
      body.starts_at ?? ex.starts_at,
      body.ends_at !== undefined ? body.ends_at : ex.ends_at,
      body.notes !== undefined ? body.notes : ex.notes,
      body.mode ?? ex.mode,
      body.assignee_id !== undefined ? body.assignee_id : ex.assignee_id,
      now(),
      req.params.id
    )
    res.json({ data: db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(req.params.id) })
  } catch (e) {
    next(e)
  }
})

artemisRouter.get('/today', requireRole('staff'), (req, res) => {
  const day = (req.query.date || now().slice(0, 10)).slice(0, 10)
  const rows = db
    .prepare(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone
       FROM appointments a LEFT JOIN clients c ON c.id = a.client_id
       WHERE date(a.starts_at) = date(?) AND a.status NOT IN ('cancelled')
       ORDER BY a.starts_at ASC`
    )
    .all(day)
  res.json({
    data: {
      date: day,
      count: rows.length,
      remote: rows.filter((r) => r.mode === 'remote').length,
      onsite: rows.filter((r) => r.mode === 'onsite').length,
      appointments: rows,
    },
  })
})


artemisRouter.get('/appointments/:id/whatsapp', requireRole('staff'), (req, res) => {
  const a = db
    .prepare(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone
       FROM appointments a LEFT JOIN clients c ON c.id = a.client_id WHERE a.id = ?`
    )
    .get(req.params.id)
  if (!a) return res.status(404).json({ error: true, message: 'Not found' })
  const co = db.prepare(`SELECT * FROM company WHERE id='main'`).get() || {}
  const when = (a.starts_at || '').replace('T', ' ').slice(0, 16)
  const text = [
    `*Appointment reminder* — ${co.name || 'PC REPAIR DEX'}`,
    a.client_name ? `Hi ${a.client_name},` : null,
    '',
    `We are scheduled for: *${a.title}*`,
    `When: ${when}`,
    `Mode: ${a.mode || 'onsite'}`,
    a.notes ? `Note: ${a.notes}` : null,
    '',
    'Reply if you need to reschedule. Thank you.',
    co.phone ? `Tel: ${co.phone}` : null,
  ]
    .filter((x) => x != null)
    .join('\n')
  let phone = ''
  if (a.client_phone) {
    phone = String(a.client_phone).replace(/\D/g, '')
    if (phone.startsWith('0')) phone = '27' + phone.slice(1)
  }
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`
  res.json({ data: { text, url } })
})
