import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now, audit } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const insightRouter = Router()
insightRouter.use(requireAuth)

// Ensure tables for Q3
try {
  db.exec(`
CREATE TABLE IF NOT EXISTS recurring_invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  template_invoice_id TEXT,
  interval_days INTEGER NOT NULL DEFAULT 30,
  next_run TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  lines_json TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_reminders (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  sent_at TEXT NOT NULL,
  note TEXT,
  created_by TEXT
);
`)
} catch (e) {
  console.warn('insight tables', e.message)
}

/** Mark past-due unpaid invoices as overdue */
insightRouter.post('/mark-overdue', requireRole('staff'), (req, res) => {
  const ts = now()
  const r = db
    .prepare(
      `UPDATE invoices SET status='overdue', updated_at=?
       WHERE COALESCE(doc_type,'invoice')='invoice'
       AND status IN ('unpaid','partial')
       AND due_date IS NOT NULL AND due_date < date('now')`
    )
    .run(ts)
  audit(req.user?.sub || req.user?.id, 'insight.mark_overdue', `updated=${r.changes}`, req.ip)
  res.json({ data: { updated: r.changes } })
})

/** List invoices needing reminders (unpaid/partial/overdue, due within N days or past) */
insightRouter.get('/reminders/due', (req, res) => {
  const days = Math.min(30, Math.max(0, Number(req.query.days) || 7))
  const rows = db
    .prepare(
      `SELECT i.id, i.number, i.total, i.amount_paid, i.due_date, i.status, i.reminder_at,
        c.name AS client_name, c.email AS client_email, c.phone AS client_phone
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       WHERE COALESCE(i.doc_type,'invoice')='invoice'
       AND i.status IN ('unpaid','partial','overdue')
       AND (i.total - COALESCE(i.amount_paid,0)) > 0
       AND (
         i.due_date IS NULL
         OR i.due_date <= date('now', '+' || ? || ' days')
       )
       ORDER BY i.due_date ASC NULLS LAST
       LIMIT 100`
    )
    .all(days)
  res.json({ data: rows })
})

/** Record a payment reminder (email/WhatsApp stub — logs + sets reminder_at) */
insightRouter.post('/reminders/:invoiceId', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        channel: z.enum(['email', 'whatsapp', 'sms', 'note']).default('email'),
        note: z.string().optional().nullable(),
      })
      .parse(req.body || {})
    const inv = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(req.params.invoiceId)
    if (!inv) return res.status(404).json({ error: true, message: 'Invoice not found' })
    const id = uid()
    const ts = now()
    db.prepare(
      `INSERT INTO payment_reminders (id, invoice_id, channel, sent_at, note, created_by) VALUES (?,?,?,?,?,?)`
    ).run(id, inv.id, body.channel, ts, body.note || null, req.user?.sub || req.user?.id || null)
    db.prepare(`UPDATE invoices SET reminder_at=?, updated_at=? WHERE id=?`).run(ts, ts, inv.id)
    try {
      db.prepare(
        `INSERT INTO document_activity (id, document_type, document_id, user_id, action, detail, created_at)
         VALUES (?,?,?,?,?,?,?)`
      ).run(uid(), 'invoice', inv.id, req.user?.sub || req.user?.id, 'reminder', body.channel, ts)
    } catch {}
    audit(req.user?.sub || req.user?.id, 'insight.reminder', `${inv.number}:${body.channel}`, req.ip)
    res.status(201).json({ data: { id, invoice_id: inv.id, channel: body.channel, sent_at: ts } })
  } catch (e) {
    next(e)
  }
})

/** Bulk send reminders (log only — actual email uses mail service if configured) */
insightRouter.post('/reminders/bulk', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        invoice_ids: z.array(z.string()).min(1),
        channel: z.enum(['email', 'whatsapp', 'sms', 'note']).default('email'),
      })
      .parse(req.body)
    const ts = now()
    let sent = 0
    const insert = db.prepare(
      `INSERT INTO payment_reminders (id, invoice_id, channel, sent_at, note, created_by) VALUES (?,?,?,?,?,?)`
    )
    const upd = db.prepare(`UPDATE invoices SET reminder_at=?, updated_at=? WHERE id=?`)
    for (const invId of body.invoice_ids) {
      const inv = db.prepare(`SELECT id FROM invoices WHERE id = ?`).get(invId)
      if (!inv) continue
      insert.run(uid(), invId, body.channel, ts, 'bulk', req.user?.sub || req.user?.id || null)
      upd.run(ts, ts, invId)
      sent++
    }
    res.json({ data: { sent, channel: body.channel } })
  } catch (e) {
    next(e)
  }
})

/** Recurring invoices CRUD */
insightRouter.get('/recurring', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS client_name
       FROM recurring_invoices r
       LEFT JOIN clients c ON c.id = r.client_id
       ORDER BY r.next_run ASC`
    )
    .all()
  res.json({
    data: rows.map((r) => {
      let lines = []
      try {
        lines = JSON.parse(r.lines_json || '[]')
      } catch {}
      return { ...r, lines }
    }),
  })
})

insightRouter.post('/recurring', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        client_id: z.string().min(1),
        interval_days: z.coerce.number().int().positive().default(30),
        next_run: z.string().optional(),
        lines: z
          .array(
            z.object({
              description: z.string(),
              qty: z.coerce.number().default(1),
              price: z.coerce.number().default(0),
            })
          )
          .default([]),
        notes: z.string().optional().nullable(),
        template_invoice_id: z.string().optional().nullable(),
      })
      .parse(req.body)
    const id = uid()
    const ts = now()
    const nextRun = body.next_run || new Date(Date.now() + body.interval_days * 86400000).toISOString().slice(0, 10)
    db.prepare(
      `INSERT INTO recurring_invoices (id, client_id, template_invoice_id, interval_days, next_run, active, lines_json, notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,1,?,?,?,?,?)`
    ).run(
      id,
      body.client_id,
      body.template_invoice_id || null,
      body.interval_days,
      nextRun,
      JSON.stringify(body.lines),
      body.notes || null,
      req.user?.sub || req.user?.id || null,
      ts,
      ts
    )
    res.status(201).json({ data: db.prepare(`SELECT * FROM recurring_invoices WHERE id = ?`).get(id) })
  } catch (e) {
    next(e)
  }
})

/** Run due recurring invoices (creates draft invoices) */
insightRouter.post('/recurring/run', requireRole('staff'), (req, res) => {
  const due = db
    .prepare(`SELECT * FROM recurring_invoices WHERE active=1 AND next_run <= date('now')`)
    .all()
  const co = db.prepare(`SELECT * FROM company WHERE id='main'`).get() || {}
  const vatRate = Number(co.default_vat_rate ?? 15) / 100
  const prefix = (co.invoice_prefix || 'INV').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'INV'
  const y = new Date().getFullYear()
  let created = 0
  for (const r of due) {
    let lines = []
    try {
      lines = JSON.parse(r.lines_json || '[]')
    } catch {
      lines = []
    }
    if (!lines.length && r.template_invoice_id) {
      lines = db
        .prepare(`SELECT description, qty, price FROM invoice_lines WHERE invoice_id = ?`)
        .all(r.template_invoice_id)
    }
    if (!lines.length) continue
    const exclusive = Math.round(lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0) * 100) / 100
    const vat_amount = Math.round(exclusive * vatRate * 100) / 100
    const total = Math.round((exclusive + vat_amount) * 100) / 100
    const c = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE number LIKE ?`).get(`${prefix}-${y}-%`).c
    const number = `${prefix}-${y}-${String(c + 1).padStart(4, '0')}`
    const invId = uid()
    const date = now().slice(0, 10)
    db.prepare(
      `INSERT INTO invoices (
        id, number, client_id, date, due_date, status, notes, exclusive, vat_amount, total,
        amount_paid, created_by, created_at, updated_at, doc_type
      ) VALUES (?,?,?,?,?,'unpaid',?,?,?,?,0,?,?,?,'invoice')`
    ).run(
      invId,
      number,
      r.client_id,
      date,
      date,
      r.notes || `Recurring invoice · schedule ${r.id.slice(0, 8)}`,
      exclusive,
      vat_amount,
      total,
      req.user?.sub || req.user?.id || null,
      now(),
      now()
    )
    const ins = db.prepare(
      `INSERT INTO invoice_lines (id, invoice_id, description, qty, price) VALUES (?,?,?,?,?)`
    )
    for (const l of lines) {
      ins.run(uid(), invId, l.description || 'Item', Number(l.qty) || 1, Number(l.price) || 0)
    }
    const next = new Date(r.next_run)
    next.setDate(next.getDate() + Number(r.interval_days || 30))
    db.prepare(`UPDATE recurring_invoices SET next_run=?, updated_at=? WHERE id=?`).run(
      next.toISOString().slice(0, 10),
      now(),
      r.id
    )
    created++
  }
  res.json({ data: { created, scanned: due.length } })
})

insightRouter.patch('/recurring/:id', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        active: z.coerce.number().int().min(0).max(1).optional(),
        interval_days: z.coerce.number().int().positive().optional(),
        next_run: z.string().optional(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body || {})
    const existing = db.prepare(`SELECT * FROM recurring_invoices WHERE id = ?`).get(req.params.id)
    if (!existing) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(
      `UPDATE recurring_invoices SET active=?, interval_days=?, next_run=?, notes=?, updated_at=? WHERE id=?`
    ).run(
      body.active !== undefined ? body.active : existing.active,
      body.interval_days ?? existing.interval_days,
      body.next_run ?? existing.next_run,
      body.notes !== undefined ? body.notes : existing.notes,
      now(),
      req.params.id
    )
    res.json({ data: db.prepare(`SELECT * FROM recurring_invoices WHERE id = ?`).get(req.params.id) })
  } catch (e) {
    next(e)
  }
})

/** Simple report: revenue / ageing / tech summary */
insightRouter.get('/reports/:kind', (req, res) => {
  const kind = req.params.kind
  if (kind === 'revenue') {
    const byMonth = db
      .prepare(
        `SELECT substr(date,1,7) AS month,
          COALESCE(SUM(CASE WHEN COALESCE(doc_type,'invoice')='invoice' THEN total ELSE 0 END),0) AS invoiced,
          COALESCE(SUM(CASE WHEN COALESCE(doc_type,'invoice')='invoice' THEN amount_paid ELSE 0 END),0) AS collected
         FROM invoices GROUP BY substr(date,1,7) ORDER BY month DESC LIMIT 24`
      )
      .all()
    return res.json({ data: { kind, byMonth } })
  }
  if (kind === 'ageing') {
    const buckets = db
      .prepare(
        `SELECT
          SUM(CASE WHEN julianday('now') - julianday(COALESCE(due_date,date)) <= 30 THEN total - amount_paid ELSE 0 END) AS b0_30,
          SUM(CASE WHEN julianday('now') - julianday(COALESCE(due_date,date)) > 30 AND julianday('now') - julianday(COALESCE(due_date,date)) <= 60 THEN total - amount_paid ELSE 0 END) AS b31_60,
          SUM(CASE WHEN julianday('now') - julianday(COALESCE(due_date,date)) > 60 AND julianday('now') - julianday(COALESCE(due_date,date)) <= 90 THEN total - amount_paid ELSE 0 END) AS b61_90,
          SUM(CASE WHEN julianday('now') - julianday(COALESCE(due_date,date)) > 90 THEN total - amount_paid ELSE 0 END) AS b90_plus
         FROM invoices
         WHERE COALESCE(doc_type,'invoice')='invoice' AND status IN ('unpaid','partial','overdue')`
      )
      .get()
    return res.json({ data: { kind, buckets } })
  }
  if (kind === 'tech') {
    const rows = db
      .prepare(
        `SELECT COALESCE(u.name,'Unassigned') AS name, COUNT(t.id) AS jobs,
          COALESCE(SUM(t.time_spent_seconds),0) AS seconds
         FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id
         WHERE COALESCE(t.is_template,0)=0
         GROUP BY t.assignee_id ORDER BY seconds DESC`
      )
      .all()
    return res.json({ data: { kind, rows } })
  }
  res.status(400).json({ error: true, message: 'Unknown report. Use revenue|ageing|tech' })
})
