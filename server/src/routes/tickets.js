import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { mountTicketTimers } from './ticketTimers.js'
import { htmlToPdf } from '../services/pdf.js'
import { buildJobCardHtml, buildJobCardWhatsApp, saPhoneToWa } from '../services/jobCard.js'

export const ticketsRouter = Router()
ticketsRouter.use(requireAuth)

function userBranchId(userId) {
  try {
    return db.prepare(`SELECT branch_id FROM users WHERE id = ?`).get(userId)?.branch_id || null
  } catch {
    return null
  }
}


const PartLine = z.object({
  name: z.string().min(1),
  qty: z.coerce.number().default(1),
  cost: z.coerce.number().default(0),
})

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
  warranty: z.coerce.number().int().min(0).max(1).optional(),
  sla_hours: z.coerce.number().int().positive().optional().nullable(),
  parts: z.array(PartLine).optional(),
  is_template: z.coerce.number().int().min(0).max(1).optional(),
})

function parseParts(row) {
  if (!row) return []
  try {
    const p = JSON.parse(row.parts_json || '[]')
    return Array.isArray(p) ? p : []
  } catch {
    return []
  }
}

function enrich(row) {
  if (!row) return null
  const parts = parseParts(row)
  let sla_status = null
  if (row.sla_due_at && !['resolved', 'closed'].includes(row.status)) {
    const due = new Date(row.sla_due_at).getTime()
    const left = due - Date.now()
    sla_status = left < 0 ? 'breached' : left < 3600000 ? 'warning' : 'ok'
  }
  return { ...row, parts, sla_status }
}

ticketsRouter.get('/', (req, res) => {
  const { status, priority, category, q, assignee_id, warranty, template, branch_id } = req.query
  let sql = `SELECT t.*, c.name AS client_name, u.name AS assignee_name
    FROM tickets t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.assignee_id WHERE 1=1`
  const params = []
  if (template === '1') sql += ' AND t.is_template = 1'
  else sql += ' AND COALESCE(t.is_template,0) = 0'
  if (status) { sql += ' AND t.status = ?'; params.push(status) }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority) }
  if (category) { sql += ' AND t.category = ?'; params.push(category) }
  if (assignee_id) { sql += ' AND t.assignee_id = ?'; params.push(assignee_id) }
  if (warranty === '1') sql += ' AND t.warranty = 1'
  if (branch_id) { sql += ' AND t.branch_id = ?'; params.push(branch_id) }
  if (q) {
    sql += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.notes LIKE ? OR t.tags LIKE ?)'
    const like = `%${q}%`
    params.push(like, like, like, like)
  }
  sql += ` ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC`
  res.json({ data: db.prepare(sql).all(...params).map(enrich) })
})

ticketsRouter.get('/staff', (_req, res) => {
  res.json({
    data: db.prepare(`SELECT id, name, email, role FROM users WHERE role IN ('owner','admin','staff') ORDER BY name`).all(),
  })
})

ticketsRouter.get('/metrics', (_req, res) => {
  const open = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE COALESCE(is_template,0)=0 AND status IN ('open','in_progress','waiting')").get().c
  const urgent = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE COALESCE(is_template,0)=0 AND priority='urgent' AND status NOT IN ('resolved','closed')").get().c
  const resolved = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE COALESCE(is_template,0)=0 AND status IN ('resolved','closed')").get().c
  const totalTime = db.prepare('SELECT COALESCE(SUM(time_spent_seconds),0) AS s FROM tickets WHERE COALESCE(is_template,0)=0').get().s
  const warrantyOpen = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE COALESCE(is_template,0)=0 AND warranty=1 AND status NOT IN ('resolved','closed')").get().c
  const slaBreached = db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE COALESCE(is_template,0)=0 AND sla_due_at IS NOT NULL AND status NOT IN ('resolved','closed') AND sla_due_at < ?`).get(now()).c
  const avgMs = db.prepare(`SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 86400000) AS ms FROM tickets WHERE resolved_at IS NOT NULL AND COALESCE(is_template,0)=0`).get().ms
  res.json({
    data: {
      open, urgent, resolved,
      warranty_open: warrantyOpen,
      sla_breached: slaBreached,
      total_time_hours: Math.round((totalTime / 3600) * 10) / 10,
      avg_resolution_hours: avgMs != null ? Math.round((avgMs / 3600000) * 10) / 10 : null,
      by_status: db.prepare(`SELECT status, COUNT(*) AS c FROM tickets WHERE COALESCE(is_template,0)=0 GROUP BY status`).all(),
      by_priority: db.prepare(`SELECT priority, COUNT(*) AS c FROM tickets WHERE COALESCE(is_template,0)=0 GROUP BY priority`).all(),
    },
  })
})

function loadJobTicket(id) {
  return db
    .prepare(
      `SELECT t.*, c.name AS client_name, c.phone AS client_phone, c.address AS client_address, c.email AS client_email,
    u.name AS assignee_name, co.name AS company_name, co.phone AS company_phone, co.address AS company_address,
    co.email AS company_email, co.logo_url
    FROM tickets t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN company co ON co.id = 'main' WHERE t.id = ?`
    )
    .get(id)
}

ticketsRouter.get('/:id/print', (req, res) => {
  const t = loadJobTicket(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  const parts = parseParts(t)
  const company = {
    name: t.company_name,
    phone: t.company_phone,
    address: t.company_address,
    email: t.company_email,
    logo_url: t.logo_url,
  }
  res.type('html').send(buildJobCardHtml(t, parts, { company }))
})

ticketsRouter.get('/:id/pdf', async (req, res, next) => {
  try {
    const t = loadJobTicket(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    const parts = parseParts(t)
    const company = {
      name: t.company_name,
      phone: t.company_phone,
      address: t.company_address,
      email: t.company_email,
      logo_url: t.logo_url,
    }
    const html = buildJobCardHtml(t, parts, { company })
    const pdf = await htmlToPdf(html)
    const ref = (t.id || '').slice(0, 8)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="jobcard-${ref}.pdf"`)
    res.send(pdf)
  } catch (e) {
    next(e)
  }
})

ticketsRouter.post('/:id/whatsapp-jobcard', (req, res) => {
  const t = loadJobTicket(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  const parts = parseParts(t)
  const company = {
    name: t.company_name,
    phone: t.company_phone,
    address: t.company_address,
    email: t.company_email,
  }
  const text = buildJobCardWhatsApp(t, parts, { company })
  const phone = saPhoneToWa(t.client_phone)
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`
  try {
    db.prepare(
      `INSERT INTO document_activity (id, document_type, document_id, user_id, action, detail, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(uid(), 'ticket', t.id, req.user?.sub || null, 'whatsapp_jobcard', t.status, now())
  } catch {}
  res.json({ data: { url, phone: phone || null, text, preview: text.slice(0, 280) } })
})

ticketsRouter.get('/:id', (req, res) => {
  const t = db.prepare(`SELECT t.*, c.name AS client_name, u.name AS assignee_name FROM tickets t
    LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?`).get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  const comments = db.prepare(`SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC`).all(req.params.id)
  const time_entries = db.prepare(`SELECT * FROM ticket_time_entries WHERE ticket_id = ? ORDER BY started_at DESC`).all(req.params.id)
  const invoices = db.prepare(`SELECT id, number, total, status, date FROM invoices WHERE notes LIKE ? OR notes LIKE ? ORDER BY created_at DESC LIMIT 10`)
    .all(`%${req.params.id.slice(0, 8)}%`, `%ticket ${req.params.id.slice(0, 8)}%`)
  res.json({ data: { ...enrich(t), comments, time_entries, linked_invoices: invoices } })
})

ticketsRouter.post('/', requireRole('staff'), (req, res, next) => {
  try {
    const body = TicketBody.parse(req.body)
    const id = uid()
    const ts = now()
    let sla_due_at = null
    if (body.sla_hours) sla_due_at = new Date(Date.now() + body.sla_hours * 3600000).toISOString()
    db.prepare(`INSERT INTO tickets (id, title, description, status, priority, category, tags, client_id, assignee_id, notes, due_date, estimated_minutes, created_by, created_at, updated_at, warranty, sla_hours, sla_due_at, parts_json, is_template)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, body.title, body.description || null, body.status, body.priority, body.category || null,
      body.tags || null, body.client_id || null, body.assignee_id || null, body.notes || null,
      body.due_date || null, body.estimated_minutes ?? null, req.user.sub, ts, ts,
      body.warranty ? 1 : 0, body.sla_hours ?? null, sla_due_at,
      body.parts ? JSON.stringify(body.parts) : null, body.is_template ? 1 : 0
    )
    const ub = userBranchId(req.user.sub)
    if (ub) {
      try { db.prepare(`UPDATE tickets SET branch_id=? WHERE id=? AND branch_id IS NULL`).run(ub, id) } catch {}
    }
    res.status(201).json({ data: enrich(db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)) })
  } catch (e) { next(e) }
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
    let sla_hours = body.sla_hours !== undefined ? body.sla_hours : existing.sla_hours
    let sla_due_at = existing.sla_due_at
    if (body.sla_hours !== undefined) {
      if (body.sla_hours) sla_due_at = new Date(new Date(existing.created_at).getTime() + body.sla_hours * 3600000).toISOString()
      else { sla_hours = null; sla_due_at = null }
    }
    const parts_json = body.parts !== undefined ? JSON.stringify(body.parts) : existing.parts_json
    db.prepare(`UPDATE tickets SET title=?, description=?, status=?, priority=?, category=?, tags=?, client_id=?, assignee_id=?, notes=?, due_date=?, estimated_minutes=?, updated_at=?, resolved_at=?, warranty=?, sla_hours=?, sla_due_at=?, parts_json=? WHERE id=?`).run(
      body.title ?? existing.title,
      body.description !== undefined ? body.description : existing.description,
      nextStatus, body.priority ?? existing.priority,
      body.category !== undefined ? body.category : existing.category,
      body.tags !== undefined ? body.tags : existing.tags,
      body.client_id !== undefined ? body.client_id : existing.client_id,
      body.assignee_id !== undefined ? body.assignee_id : existing.assignee_id,
      body.notes !== undefined ? body.notes : existing.notes,
      body.due_date !== undefined ? body.due_date : existing.due_date,
      body.estimated_minutes !== undefined ? body.estimated_minutes : existing.estimated_minutes,
      now(), resolved_at,
      body.warranty !== undefined ? (body.warranty ? 1 : 0) : (existing.warranty || 0),
      sla_hours, sla_due_at, parts_json, req.params.id
    )
    res.json({ data: enrich(db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) })
  } catch (e) { next(e) }
})

ticketsRouter.post('/:id/comments', requireRole('staff'), (req, res, next) => {
  try {
    const body = z.object({ text: z.string().min(1), internal: z.boolean().optional(), time_logged_seconds: z.number().int().optional() }).parse(req.body)
    if (!db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: true, message: 'Not found' })
    const id = uid()
    const logged = body.time_logged_seconds || 0
    db.prepare(`INSERT INTO ticket_comments (id, ticket_id, author_id, author_name, text, internal, time_logged_seconds, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, req.params.id, req.user.sub, req.user.name || req.user.email, body.text, body.internal ? 1 : 0, logged, now())
    if (logged > 0) db.prepare('UPDATE tickets SET time_spent_seconds = time_spent_seconds + ?, updated_at=? WHERE id=?').run(logged, now(), req.params.id)
    else db.prepare('UPDATE tickets SET updated_at=? WHERE id=?').run(now(), req.params.id)
    res.status(201).json({ data: db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(id) })
  } catch (e) { next(e) }
})

ticketsRouter.post('/:id/clone', requireRole('staff'), (req, res, next) => {
  try {
    const src = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
    if (!src) return res.status(404).json({ error: true, message: 'Not found' })
    const id = uid()
    const ts = now()
    let sla_due_at = src.sla_hours ? new Date(Date.now() + src.sla_hours * 3600000).toISOString() : null
    db.prepare(`INSERT INTO tickets (id, title, description, status, priority, category, tags, client_id, assignee_id, notes, due_date, estimated_minutes, created_by, created_at, updated_at, warranty, sla_hours, sla_due_at, parts_json, is_template)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
      id, src.title, src.description, 'open', src.priority, src.category, src.tags, src.client_id, src.assignee_id,
      src.notes, null, src.estimated_minutes, req.user.sub, ts, ts, src.warranty || 0, src.sla_hours, sla_due_at, src.parts_json
    )
    const ub = userBranchId(req.user.sub)
    if (ub) {
      try { db.prepare(`UPDATE tickets SET branch_id=? WHERE id=? AND branch_id IS NULL`).run(ub, id) } catch {}
    }
    res.status(201).json({ data: enrich(db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)) })
  } catch (e) { next(e) }
})

// EA-Q2: quick status change (Kanban drag target)
ticketsRouter.patch('/:id/status', requireRole('staff'), (req, res, next) => {
  try {
    const status = z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed', 'archived']).parse(req.body?.status)
    const notifyWa = !!req.body?.notify_whatsapp
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: true, message: 'Not found' })
    let resolved_at = existing.resolved_at
    if (['resolved', 'closed'].includes(status) && !resolved_at) resolved_at = now()
    if (!['resolved', 'closed'].includes(status)) resolved_at = null
    db.prepare(`UPDATE tickets SET status=?, resolved_at=?, updated_at=? WHERE id=?`).run(
      status,
      resolved_at,
      now(),
      req.params.id
    )
    try {
      db.prepare(
        `INSERT INTO document_activity (id, document_type, document_id, user_id, action, detail, created_at)
         VALUES (?,?,?,?,?,?,?)`
      ).run(uid(), 'ticket', req.params.id, req.user.sub, 'status_change', status, now())
    } catch {}
    const data = enrich(db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id))
    let whatsapp = null
    if (notifyWa || req.body?.include_whatsapp) {
      const t = loadJobTicket(req.params.id)
      if (t) {
        const parts = parseParts(t)
        const company = { name: t.company_name, phone: t.company_phone, address: t.company_address, email: t.company_email }
        const text = buildJobCardWhatsApp(t, parts, { company })
        const phone = saPhoneToWa(t.client_phone)
        whatsapp = {
          url: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`,
          phone: phone || null,
        }
      }
    }
    res.json({ data, whatsapp })
  } catch (e) {
    next(e)
  }
})

// EA-Q2: bulk status update
ticketsRouter.post('/bulk-status', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        ids: z.array(z.string()).min(1),
        status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed', 'archived']),
      })
      .parse(req.body)
    const ts = now()
    const resolved_at = ['resolved', 'closed'].includes(body.status) ? ts : null
    const stmt = db.prepare(`UPDATE tickets SET status=?, resolved_at=CASE WHEN ? IS NOT NULL THEN COALESCE(resolved_at, ?) ELSE NULL END, updated_at=? WHERE id=?`)
    let updated = 0
    for (const id of body.ids) {
      const r = stmt.run(body.status, resolved_at, resolved_at, ts, id)
      if (r.changes) updated++
    }
    res.json({ data: { updated, status: body.status } })
  } catch (e) {
    next(e)
  }
})

// EA-Q2: recurring ticket create-from-template (simple schedule stub)
ticketsRouter.post('/:id/schedule-recurring', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        interval_days: z.coerce.number().int().positive().default(30),
        next_due: z.string().optional(),
      })
      .parse(req.body || {})
    const src = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
    if (!src) return res.status(404).json({ error: true, message: 'Not found' })
    // Store schedule in settings-style JSON on ticket notes prefix (lightweight until full table)
    const meta = {
      recurring: true,
      interval_days: body.interval_days,
      next_due: body.next_due || new Date(Date.now() + body.interval_days * 86400000).toISOString().slice(0, 10),
      source_id: src.id,
    }
    const notes = `[RECURRING ${JSON.stringify(meta)}]\n${src.notes || ''}`
    db.prepare(`UPDATE tickets SET notes=?, is_template=1, updated_at=? WHERE id=?`).run(notes, now(), src.id)
    res.json({ data: { ok: true, meta, ticket_id: src.id } })
  } catch (e) {
    next(e)
  }
})

mountTicketTimers(ticketsRouter)
