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
          vat_enabled: z.boolean().optional().default(false),
          note: z.string().optional().nullable(),
          mark_resolved: z.boolean().optional().default(true),
          include_parts: z.boolean().optional().default(true),
          service_ids: z.array(z.string()).optional().default([]),
          service_type: z.string().optional().nullable(),
          pricing_model: z.enum(['hourly', 'flatrate', 'adhoc']).optional().nullable(),
        })
        .parse(req.body || {})

      let hourly = body.hourly_rate
      let increment = 15
      try {
        const row = db.prepare("SELECT value FROM settings WHERE key='hourly_rate'").get()
        if (row && hourly == null) {
          try { hourly = Number(JSON.parse(row.value)) } catch { hourly = Number(row.value) }
        }
      } catch {}
      try {
        const row = db.prepare("SELECT value FROM settings WHERE key='billable_increment_minutes'").get()
        if (row) {
          try { increment = Number(JSON.parse(row.value)) || 15 } catch { increment = Number(row.value) || 15 }
        }
      } catch {}
      if (!hourly || hourly <= 0) hourly = 450

      const co = db.prepare('SELECT * FROM company WHERE id=?').get('main') || {}
      let vatRate = 0
      if (body.vat_enabled || (body.vat_rate != null && body.vat_rate > 0)) {
        vatRate = body.vat_rate != null ? body.vat_rate : Number(co.default_vat_rate || 0) / 100
        if (vatRate > 1) vatRate = vatRate / 100
      }

      // Service catalogue lines (Remote / On-site / etc.)
      const serviceLines = []
      for (const sid of body.service_ids || []) {
        const svc = db.prepare(`SELECT * FROM service_catalog WHERE id = ? AND active = 1`).get(sid)
        if (svc) {
          serviceLines.push({
            description: svc.description || svc.name,
            qty: 1,
            price: Number(svc.default_price) || 0,
            name: svc.name,
          })
        }
      }
      // Auto-pick remote/onsite from ticket category if no services passed
      if (!serviceLines.length && t.category) {
        const cat = String(t.category).toLowerCase()
        let code = null
        if (cat === 'remote') code = 'svc_remote'
        else if (cat === 'onsite') code = 'svc_onsite'
        if (code) {
          const svc = db.prepare(`SELECT * FROM service_catalog WHERE id = ?`).get(code)
          if (svc) {
            serviceLines.push({
              description: svc.description || svc.name,
              qty: 1,
              price: Number(svc.default_price) || hourly,
              name: svc.name,
            })
          }
        }
      }
      const servicesTotal = serviceLines.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0)

      // EA-Q2: bill labour + parts + services
      let parts = []
      try {
        parts = JSON.parse(t.parts_json || '[]')
        if (!Array.isArray(parts)) parts = []
      } catch {
        parts = []
      }
      const includeParts = body.include_parts !== false
      const partsTotal = includeParts
        ? parts.reduce((s, p) => s + Number(p.qty || 0) * Number(p.cost || 0), 0)
        : 0

      const secs = Number(t.time_spent_seconds || 0)
      const minutes = Math.ceil(secs / 60)
      const roundedMin = minutes > 0 ? Math.ceil(minutes / increment) * increment : 0
      const hours = roundedMin / 60
      const labourExclusive = Math.round(hours * hourly * 100) / 100
      // If service lines are support hours and no labour time, services alone OK
      const exclusive = Math.round((labourExclusive + partsTotal + servicesTotal) * 100) / 100
      const vat_amount = Math.round(exclusive * vatRate * 100) / 100
      const total = Math.round((exclusive + vat_amount) * 100) / 100

      if (exclusive <= 0) {
        return res.status(400).json({
          error: true,
          message: 'Need logged time, parts, or a service (Remote / On-site) to bill',
        })
      }

      const y = new Date().getFullYear()
      const prefix = (co.invoice_prefix || 'INV').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'INV'
      const c = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE number LIKE ?`).get(`${prefix}-${y}-%`).c
      const number = `${prefix}-${y}-${String(c + 1).padStart(4, '0')}`
      const invId = uid()
      const date = now().slice(0, 10)
      const notes =
        body.note ||
        `Billed from ticket ${t.id.slice(0, 8)} · ${t.category || 'support'}${t.title ? ' · ' + t.title : ''}`

      db.prepare(
        `INSERT INTO invoices (
          id, number, client_id, date, due_date, status, notes, service_type, exclusive, vat_amount, total,
          amount_paid, created_by, created_at, updated_at, doc_type, converted_from_id
        ) VALUES (?,?,?,?,?, 'unpaid', ?, ?, ?, ?, ?, 0, ?, ?, ?, 'invoice', ?)`
      ).run(
        invId,
        number,
        t.client_id,
        date,
        date,
        notes,
        body.service_type || t.category || 'support',
        exclusive,
        vat_amount,
        total,
        req.user.sub,
        now(),
        now(),
        t.id
      )

      if (hours > 0) {
        const desc = `Labour — ${t.title} (${roundedMin} min @ R${hourly}/hr)`
        db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price) VALUES (?,?,?,?,?)`).run(
          uid(),
          invId,
          desc,
          hours,
          hourly
        )
      }
      if (includeParts) {
        for (const p of parts) {
          const qty = Number(p.qty) || 1
          const price = Number(p.cost) || 0
          if (price <= 0 && qty <= 0) continue
          db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price) VALUES (?,?,?,?,?)`).run(
            uid(),
            invId,
            `Part — ${p.name || 'Item'}`,
            qty,
            price
          )
        }
      }
      for (const sl of serviceLines) {
        db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price) VALUES (?,?,?,?,?)`).run(
          uid(),
          invId,
          sl.description,
          sl.qty,
          sl.price
        )
      }
      const svcType =
        body.service_type ||
        serviceLines[0]?.name ||
        t.category ||
        'support'
      try {
        db.prepare(`UPDATE invoices SET service_type=?, pricing_model=?, template_id=? WHERE id=?`).run(
          svcType,
          body.pricing_model || (hours > 0 || serviceLines.some((s) => /remote|on-site|onsite|support/i.test(s.name || '')) ? 'hourly' : 'flatrate'),
          body.pricing_model === 'flatrate' ? 'invoice_flatrate_cod' : 'invoice_hourly_cod',
          invId
        )
      } catch {}

      // Activity log
      try {
        db.prepare(
          `INSERT INTO document_activity (id, document_type, document_id, user_id, action, detail, created_at)
           VALUES (?,?,?,?,?,?,?)`
        ).run(uid(), 'ticket', t.id, req.user.sub, 'billed', `invoice ${number}`, now())
        db.prepare(
          `INSERT INTO document_activity (id, document_type, document_id, user_id, action, detail, created_at)
           VALUES (?,?,?,?,?,?,?)`
        ).run(uid(), 'invoice', invId, req.user.sub, 'created_from_ticket', t.id, now())
      } catch {}

      if (body.mark_resolved !== false) {
        db.prepare(`UPDATE tickets SET status='resolved', resolved_at=?, updated_at=? WHERE id=?`).run(
          now(),
          now(),
          t.id
        )
      }

      res.status(201).json({
        data: {
          invoice_id: invId,
          number,
          hours,
          minutes: roundedMin,
          hourly_rate: hourly,
          parts_count: includeParts ? parts.length : 0,
          parts_total: partsTotal,
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
