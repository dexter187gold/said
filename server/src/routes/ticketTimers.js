import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireRole } from '../middleware/auth.js'

/** Attach timer + manual time-log + bill routes to the tickets router */
export function mountTicketTimers(ticketsRouter) {
  ticketsRouter.post('/:id/timer/start', requireRole('staff'), (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    if (t.timer_started_at) return res.status(400).json({ error: true, message: 'Timer already running' })
    const ts = now()
    db.prepare(
      `UPDATE tickets SET timer_started_at=?, status=CASE WHEN status=? THEN ? ELSE status END, updated_at=? WHERE id=?`
    ).run(ts, 'open', 'in_progress', ts, req.params.id)
    const entryId = uid()
    db.prepare(
      `INSERT INTO ticket_time_entries (id, ticket_id, user_id, user_name, started_at, seconds, created_at)
       VALUES (?,?,?,?,?,0,?)`
    ).run(entryId, req.params.id, req.user.sub, req.user.name || req.user.email, ts, ts)
    res.json({ data: { timer_started_at: ts, entry_id: entryId } })
  })

  ticketsRouter.post('/:id/timer/stop', requireRole('staff'), (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    if (!t.timer_started_at) return res.status(400).json({ error: true, message: 'No timer running' })
    const end = now()
    const startMs = new Date(t.timer_started_at).getTime()
    const seconds = Math.max(0, Math.round((Date.now() - startMs) / 1000))
    db.prepare(
      `UPDATE tickets SET time_spent_seconds = time_spent_seconds + ?, timer_started_at=NULL, updated_at=? WHERE id=?`
    ).run(seconds, end, req.params.id)
    const openEntry = db.prepare(
      `SELECT id FROM ticket_time_entries WHERE ticket_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
    ).get(req.params.id)
    if (openEntry) {
      db.prepare(`UPDATE ticket_time_entries SET ended_at=?, seconds=? WHERE id=?`).run(end, seconds, openEntry.id)
    }
    res.json({
      data: {
        seconds_added: seconds,
        time_spent_seconds: db.prepare('SELECT time_spent_seconds FROM tickets WHERE id=?').get(req.params.id)
          .time_spent_seconds,
      },
    })
  })

  ticketsRouter.post('/:id/time', requireRole('staff'), (req, res, next) => {
    try {
      const body = z
        .object({
          seconds: z.number().int().positive(),
          note: z.string().optional().nullable(),
        })
        .parse(req.body)
      const t = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.id)
      if (!t) return res.status(404).json({ error: true, message: 'Not found' })
      const id = uid()
      const ts = now()
      db.prepare(
        `INSERT INTO ticket_time_entries (id, ticket_id, user_id, user_name, started_at, ended_at, seconds, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(id, req.params.id, req.user.sub, req.user.name || req.user.email, ts, ts, body.seconds, body.note || null, ts)
      db.prepare('UPDATE tickets SET time_spent_seconds = time_spent_seconds + ?, updated_at=? WHERE id=?').run(
        body.seconds,
        ts,
        req.params.id
      )
      res.status(201).json({ data: db.prepare('SELECT * FROM ticket_time_entries WHERE id=?').get(id) })
    } catch (e) {
      next(e)
    }
  })

  ticketsRouter.post('/:id/bill', requireRole('staff'), (req, res, next) => {
    try {
      let t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
      if (!t) return res.status(404).json({ error: true, message: 'Not found' })
      if (!t.client_id) return res.status(400).json({ error: true, message: 'Assign a client before billing' })

      if (t.timer_started_at) {
        const end = now()
        const seconds = Math.max(0, Math.round((Date.now() - new Date(t.timer_started_at).getTime()) / 1000))
        db.prepare(
          `UPDATE tickets SET time_spent_seconds = time_spent_seconds + ?, timer_started_at=NULL, updated_at=? WHERE id=?`
        ).run(seconds, end, t.id)
        const openEntry = db
          .prepare(
            `SELECT id FROM ticket_time_entries WHERE ticket_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
          )
          .get(t.id)
        if (openEntry) {
          db.prepare(`UPDATE ticket_time_entries SET ended_at=?, seconds=? WHERE id=?`).run(end, seconds, openEntry.id)
        }
        t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
      }

      const body = z
        .object({
          hourly_rate: z.coerce.number().positive().optional(),
          vat_rate: z.coerce.number().min(0).max(1).optional(),
          note: z.string().optional().nullable(),
          mark_resolved: z.boolean().optional().default(true),
        })
        .parse(req.body || {})

      let hourly = body.hourly_rate
      let increment = 15
      try {
        const row = db.prepare("SELECT value FROM settings WHERE key='hourly_rate'").get()
        if (row && hourly == null) hourly = Number(JSON.parse(row.value))
      } catch {}
      try {
        const row = db.prepare("SELECT value FROM settings WHERE key='billable_increment_minutes'").get()
        if (row) increment = Number(JSON.parse(row.value)) || 15
      } catch {}
      if (!hourly || hourly <= 0) hourly = 450

      const co = db.prepare('SELECT * FROM company WHERE id=?').get('main') || {}
      const vatRate = body.vat_rate != null ? body.vat_rate : Number(co.default_vat_rate ?? 15) / 100

      const secs = Number(t.time_spent_seconds || 0)
      if (secs < 60) {
        return res.status(400).json({ error: true, message: 'Need at least 1 minute of logged time to bill' })
      }

      const minutes = Math.ceil(secs / 60)
      const roundedMin = Math.ceil(minutes / increment) * increment
      const hours = roundedMin / 60
      const exclusive = Math.round(hours * hourly * 100) / 100
      const vat_amount = Math.round(exclusive * vatRate * 100) / 100
      const total = Math.round((exclusive + vat_amount) * 100) / 100

      const y = new Date().getFullYear()
      const prefix = (co.invoice_prefix || 'INV').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'INV'
      const c = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE number LIKE ?`).get(`${prefix}-${y}-%`).c
      const number = `${prefix}-${y}-${String(c + 1).padStart(4, '0')}`
      const invId = uid()
      const date = now().slice(0, 10)
      const desc = `Labour — ${t.title} (${roundedMin} min @ R${hourly}/hr)`
      const notes = body.note || `Billed from ticket ${t.id.slice(0, 8)} · ${t.category || 'support'}`

      db.prepare(
        `INSERT INTO invoices (
          id, number, client_id, date, due_date, status, notes, service_type, exclusive, vat_amount, total,
          amount_paid, created_by, created_at, updated_at, doc_type
        ) VALUES (?,?,?,?,?, 'unpaid', ?, ?, ?, ?, ?, 0, ?, ?, ?, 'invoice')`
      ).run(
        invId, number, t.client_id, date, date, notes, t.category || 'support',
        exclusive, vat_amount, total, req.user.sub, now(), now()
      )

      db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price) VALUES (?,?,?,?,?)`).run(
        uid(), invId, desc, hours, hourly
      )

      if (body.mark_resolved !== false) {
        db.prepare(`UPDATE tickets SET status='resolved', resolved_at=?, updated_at=? WHERE id=?`).run(now(), now(), t.id)
      }

      res.status(201).json({
        data: {
          invoice_id: invId,
          number,
          hours,
          minutes: roundedMin,
          hourly_rate: hourly,
          exclusive,
          vat_amount,
          total,
          ticket_id: t.id,
        },
      })
    } catch (e) {
      next(e)
    }
  })
}
