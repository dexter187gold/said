import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const settingsRouter = Router()
settingsRouter.use(requireAuth)

settingsRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const map = {}
  for (const r of rows) {
    try { map[r.key] = JSON.parse(r.value) } catch { map[r.key] = r.value }
  }
  const company = db.prepare('SELECT * FROM company WHERE id=?').get('main')
  res.json({ data: { settings: map, company } })
})

settingsRouter.put('/', requireRole('admin'), (req, res, next) => {
  try {
    const body = z.object({
      settings: z.record(z.any()).optional(),
      company: z.record(z.any()).optional(),
    }).parse(req.body)

    if (body.settings) {
      const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      for (const [k, v] of Object.entries(body.settings)) {
        upsert.run(k, typeof v === 'string' ? v : JSON.stringify(v))
      }
    }

    if (body.company) {
      const c = body.company
      db.prepare(
        `UPDATE company SET
          name=COALESCE(?,name), email=COALESCE(?,email), phone=COALESCE(?,phone),
          vat_number=COALESCE(?,vat_number), address=COALESCE(?,address),
          bank_name=COALESCE(?,bank_name), account_number=COALESCE(?,account_number),
          branch_code=COALESCE(?,branch_code), logo_url=COALESCE(?,logo_url),
          website=COALESCE(?,website), invoice_prefix=COALESCE(?,invoice_prefix),
          default_vat_rate=COALESCE(?,default_vat_rate), currency=COALESCE(?,currency),
          business_type=COALESCE(?,business_type), invoice_template_id=COALESCE(?,invoice_template_id),
          footer_note=COALESCE(?,footer_note), terms_default=COALESCE(?,terms_default)
         WHERE id='main'`
      ).run(
        c.name ?? null, c.email ?? null, c.phone ?? null, c.vat_number ?? null, c.address ?? null,
        c.bank_name ?? null, c.account_number ?? null, c.branch_code ?? null, c.logo_url ?? null,
        c.website ?? null, c.invoice_prefix ?? null, c.default_vat_rate ?? null, c.currency ?? null,
        c.business_type ?? null, c.invoice_template_id ?? null, c.footer_note ?? null, c.terms_default ?? null
      )
    }

    const rows = db.prepare('SELECT key, value FROM settings').all()
    const map = {}
    for (const r of rows) {
      try { map[r.key] = JSON.parse(r.value) } catch { map[r.key] = r.value }
    }
    res.json({ data: { settings: map, company: db.prepare('SELECT * FROM company WHERE id=?').get('main') } })
  } catch (e) {
    next(e)
  }
})

settingsRouter.get('/dashboard', (_req, res) => {
  const invStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='unpaid' THEN 1 ELSE 0 END) AS unpaid,
      SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue,
      COALESCE(SUM(total),0) AS revenue,
      COALESCE(SUM(amount_paid),0) AS collected,
      COALESCE(SUM(total - amount_paid),0) AS outstanding
    FROM invoices
  `).get()

  const monthly = db.prepare(`
    SELECT substr(date,1,7) AS month, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
    FROM invoices GROUP BY substr(date,1,7) ORDER BY month DESC LIMIT 12
  `).all().reverse()

  const ticketStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('open','in_progress','waiting') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN priority='urgent' AND status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS urgent,
      COALESCE(SUM(time_spent_seconds),0) AS time_seconds
    FROM tickets
  `).get()

  const clients = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c
  const templates = db.prepare('SELECT COUNT(*) AS c FROM document_templates').get().c

  const recentInvoices = db.prepare(`
    SELECT i.id, i.number, i.status, i.total, i.date, c.name AS client_name
    FROM invoices i LEFT JOIN clients c ON c.id=i.client_id
    ORDER BY i.created_at DESC LIMIT 8
  `).all()

  const recentTickets = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.time_spent_seconds, c.name AS client_name
    FROM tickets t LEFT JOIN clients c ON c.id=t.client_id
    ORDER BY t.updated_at DESC LIMIT 8
  `).all()

  res.json({
    data: {
      invoices: invStats,
      monthly,
      tickets: ticketStats,
      clients,
      templates,
      recentInvoices,
      recentTickets,
    },
  })
})
