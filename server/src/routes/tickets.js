import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const ticketsRouter = Router()
ticketsRouter.use(requireAuth)

const TicketBody = z.object({
  title: z.string().min(1),
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).default('open'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  category: z.string().optional().nullable(),
  client_id: z.string().optional().nullable(),
  assignee_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

ticketsRouter.get('/', (req, res) => {
  const { status, priority } = req.query
  let sql = `SELECT t.*, c.name AS client_name, u.name AS assignee_name
    FROM tickets t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.assignee_id WHERE 1=1`
  const params = []
  if (status) { sql += ' AND t.status = ?'; params.push(status) }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority) }
  sql += " ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC"
  res.json({ data: db.prepare(sql).all(...params) })
})

ticketsRouter.get('/metrics', (_req, res) => {
  const open = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('open','in_progress','waiting')").get().c
  const urgent = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE priority='urgent' AND status NOT IN ('resolved','closed')").get().c
  const resolved = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('resolved','closed')").get().c
  const avgMs = db.prepare(`
    SELECT AVG(
      (julianday(resolved_at) - julianday(created_at)) * 86400000
    ) AS ms FROM tickets WHERE resolved_at IS NOT NULL
  `).get().ms
  res.json({
    data: {
      open,
      urgent,
      resolved,
      avg_resolution_hours: avgMs != null ? Math.round((avgMs / 3600000) * 10) / 10 : null,
    },
  })
})

ticketsRouter.get('/:id', (req, res) => {
  const t = db.prepare(
    `SELECT t.*, c.name AS client_name, u.name AS assignee_name
     FROM tickets t
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?`
  ).get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  const comments = db.prepare(
    `SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC`
  ).all(req.params.id)
  res.json({ data: { ...t, comments } })
})

ticketsRouter.post('/', requireRole('staff'), (req, res, next) => {
  try {
    const body = TicketBody.parse(req.body)
    const id = uid()
    const ts = now()
    db.prepare(
      `INSERT INTO tickets (id, title, status, priority, category, client_id, assignee_id, notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, body.title, body.status, body.priority, body.category || null,
      body.client_id || null, body.assignee_id || null, body.notes || null,
      req.user.sub, ts, ts
    )
    res.status(201).json({ data: db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) })
  } catch (e) {
    next(e)
  }
})

ticketsRouter.patch('/:id', requireRole('staff'), (req, res, next) => {
  try {
    const body = TicketBody.partial().parse(req.body)
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: true, message: 'Not found' })
    const nextStatus = body.status ?? existing.status
    let resolved_at = existing.resolved_at
    if (['resolved', 'closed'].includes(nextStatus) && !resolved_at) resolved_at = now()
    if (!['resolved', 'closed'].includes(nextStatus)) resolved_at = null
    db.prepare(
      `UPDATE tickets SET title=?, status=?, priority=?, category=?, client_id=?, assignee_id=?, notes=?, updated_at=?, resolved_at=?
       WHERE id=?`
    ).run(
      body.title ?? existing.title,
      nextStatus,
      body.priority ?? existing.priority,
      body.category !== undefined ? body.category : existing.category,
      body.client_id !== undefined ? body.client_id : existing.client_id,
      body.assignee_id !== undefined ? body.assignee_id : existing.assignee_id,
      body.notes !== undefined ? body.notes : existing.notes,
      now(),
      resolved_at,
      req.params.id
    )
    res.json({ data: db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) })
  } catch (e) {
    next(e)
  }
})

ticketsRouter.post('/:id/comments', requireRole('staff'), (req, res, next) => {
  try {
    const body = z.object({
      text: z.string().min(1),
      internal: z.boolean().optional(),
    }).parse(req.body)
    const t = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    const id = uid()
    db.prepare(
      `INSERT INTO ticket_comments (id, ticket_id, author_id, author_name, text, internal, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(id, req.params.id, req.user.sub, req.user.name || req.user.email, body.text, body.internal ? 1 : 0, now())
    db.prepare('UPDATE tickets SET updated_at=? WHERE id=?').run(now(), req.params.id)
    res.status(201).json({ data: db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(id) })
  } catch (e) {
    next(e)
  }
})
