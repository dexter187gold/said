import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { mountTicketTimers } from './ticketTimers.js'

export const ticketsRouter = Router()
ticketsRouter.use(requireAuth)

const TicketBody = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).default('open'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  category: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
  client_id: z.string().optional().nullable(),
  assignee_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  estimated_minutes: z.number().int().optional().nullable(),
})

ticketsRouter.get('/', (req, res) => {
  const { status, priority, category, q } = req.query
  let sql = `SELECT t.*, c.name AS client_name, u.name AS assignee_name
    FROM tickets t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.assignee_id WHERE 1=1`
  const params = []
  if (status) { sql += ' AND t.status = ?'; params.push(status) }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority) }
  if (category) { sql += ' AND t.category = ?'; params.push(category) }
  if (q) {
    sql += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.notes LIKE ? OR t.tags LIKE ?)'
    const like = `%${q}%`
    params.push(like, like, like, like)
  }
  sql += ` ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC`
  res.json({ data: db.prepare(sql).all(...params) })
})

ticketsRouter.get('/metrics', (_req, res) => {
  const open = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('open','in_progress','waiting')").get().c
  const urgent = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE priority='urgent' AND status NOT IN ('resolved','closed')").get().c
  const resolved = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('resolved','closed')").get().c
  const totalTime = db.prepare('SELECT COALESCE(SUM(time_spent_seconds),0) AS s FROM tickets').get().s
  const avgMs = db.prepare(`
    SELECT AVG(
      (julianday(resolved_at) - julianday(created_at)) * 86400000
    ) AS ms FROM tickets WHERE resolved_at IS NOT NULL
  `).get().ms
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS c FROM tickets GROUP BY status`).all()
  const byPriority = db.prepare(`SELECT priority, COUNT(*) AS c FROM tickets GROUP BY priority`).all()
  const byCategory = db.prepare(`SELECT COALESCE(category,'(none)') AS category, COUNT(*) AS c FROM tickets GROUP BY category ORDER BY c DESC LIMIT 10`).all()
  res.json({
    data: {
      open, urgent, resolved,
      total_time_hours: Math.round((totalTime / 3600) * 10) / 10,
      avg_resolution_hours: avgMs != null ? Math.round((avgMs / 3600000) * 10) / 10 : null,
      by_status: byStatus, by_priority: byPriority, by_category: byCategory,
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
  const comments = db.prepare(`SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC`).all(req.params.id)
  const time_entries = db.prepare(`SELECT * FROM ticket_time_entries WHERE ticket_id = ? ORDER BY started_at DESC`).all(req.params.id)
  res.json({ data: { ...t, comments, time_entries } })
})

ticketsRouter.post('/', requireRole('staff'), (req, res, next) => {
  try {
    const body = TicketBody.parse(req.body)
    const id = uid()
    const ts = now()
    db.prepare(
      `INSERT INTO tickets (id, title, description, status, priority, category, tags, client_id, assignee_id, notes, due_date, estimated_minutes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, body.title, body.description || null, body.status, body.priority, body.category || null,
      body.tags || null, body.client_id || null, body.assignee_id || null, body.notes || null,
      body.due_date || null, body.estimated_minutes ?? null,
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
      `UPDATE tickets SET title=?, description=?, status=?, priority=?, category=?, tags=?, client_id=?, assignee_id=?, notes=?, due_date=?, estimated_minutes=?, updated_at=?, resolved_at=?
       WHERE id=?`
    ).run(
      body.title ?? existing.title,
      body.description !== undefined ? body.description : existing.description,
      nextStatus,
      body.priority ?? existing.priority,
      body.category !== undefined ? body.category : existing.category,
      body.tags !== undefined ? body.tags : existing.tags,
      body.client_id !== undefined ? body.client_id : existing.client_id,
      body.assignee_id !== undefined ? body.assignee_id : existing.assignee_id,
      body.notes !== undefined ? body.notes : existing.notes,
      body.due_date !== undefined ? body.due_date : existing.due_date,
      body.estimated_minutes !== undefined ? body.estimated_minutes : existing.estimated_minutes,
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
      time_logged_seconds: z.number().int().optional(),
    }).parse(req.body)
    const t = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    const id = uid()
    const logged = body.time_logged_seconds || 0
    db.prepare(
      `INSERT INTO ticket_comments (id, ticket_id, author_id, author_name, text, internal, time_logged_seconds, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, req.params.id, req.user.sub, req.user.name || req.user.email, body.text, body.internal ? 1 : 0, logged, now())
    if (logged > 0) {
      db.prepare('UPDATE tickets SET time_spent_seconds = time_spent_seconds + ?, updated_at=? WHERE id=?')
        .run(logged, now(), req.params.id)
    } else {
      db.prepare('UPDATE tickets SET updated_at=? WHERE id=?').run(now(), req.params.id)
    }
    res.status(201).json({ data: db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(id) })
  } catch (e) {
    next(e)
  }
})

mountTicketTimers(ticketsRouter)
