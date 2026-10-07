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
      db.prepare(`UPDATE company SET
          name=COALESCE(?,name), email=COALESCE(?,email), phone=COALESCE(?,phone),
          vat_number=COALESCE(?,vat_number), address=COALESCE(?,address),
          bank_name=COALESCE(?,bank_name), account_number=COALESCE(?,account_number),
          branch_code=COALESCE(?,branch_code), logo_url=COALESCE(?,logo_url),
          website=COALESCE(?,website), invoice_prefix=COALESCE(?,invoice_prefix),
          default_vat_rate=COALESCE(?,default_vat_rate), currency=COALESCE(?,currency),
          business_type=COALESCE(?,business_type), invoice_template_id=COALESCE(?,invoice_template_id),
          footer_note=COALESCE(?,footer_note), terms_default=COALESCE(?,terms_default)
         WHERE id='main'`).run(
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
  } catch (e) { next(e) }
})

settingsRouter.get('/dashboard', (_req, res) => {
  const invStats = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(doc_type,'invoice')='invoice' THEN 1 ELSE 0 END) AS invoices,
      SUM(CASE WHEN doc_type='quote' THEN 1 ELSE 0 END) AS quotes,
      SUM(CASE WHEN doc_type='credit' THEN 1 ELSE 0 END) AS credits,
      SUM(CASE WHEN status='unpaid' AND COALESCE(doc_type,'invoice')='invoice' THEN 1 ELSE 0 END) AS unpaid,
      SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue,
      COALESCE(SUM(CASE WHEN COALESCE(doc_type,'invoice')='invoice' THEN total ELSE 0 END),0) AS revenue,
      COALESCE(SUM(CASE WHEN COALESCE(doc_type,'invoice')='invoice' THEN amount_paid ELSE 0 END),0) AS collected,
      COALESCE(SUM(CASE WHEN COALESCE(doc_type,'invoice')='invoice' THEN total - amount_paid ELSE 0 END),0) AS outstanding
    FROM invoices`).get()
  const monthly = db.prepare(`
    SELECT substr(date,1,7) AS month, COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN COALESCE(doc_type,'invoice')='invoice' THEN total ELSE 0 END),0) AS total,
      COALESCE(SUM(CASE WHEN COALESCE(doc_type,'invoice')='invoice' THEN amount_paid ELSE 0 END),0) AS collected
    FROM invoices GROUP BY substr(date,1,7) ORDER BY month DESC LIMIT 12`).all().reverse()
  const cashflow = db.prepare(`
    SELECT substr(p.date,1,7) AS month, COALESCE(SUM(p.amount),0) AS inflow
    FROM payments p GROUP BY substr(p.date,1,7) ORDER BY month DESC LIMIT 12`).all().reverse()
  const ticketStats = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status IN ('open','in_progress','waiting') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN priority='urgent' AND status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS urgent,
      COALESCE(SUM(time_spent_seconds),0) AS time_seconds,
      SUM(CASE WHEN warranty=1 AND status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS warranty_open,
      SUM(CASE WHEN sla_due_at IS NOT NULL AND sla_due_at < datetime('now') AND status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS sla_breached
    FROM tickets WHERE COALESCE(is_template,0)=0`).get()
  const techUtil = db.prepare(`
    SELECT COALESCE(u.name, 'Unassigned') AS name, u.id, COUNT(t.id) AS jobs, COALESCE(SUM(t.time_spent_seconds),0) AS seconds
    FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE COALESCE(t.is_template,0)=0 GROUP BY t.assignee_id ORDER BY seconds DESC LIMIT 10`).all()
  const revenueByCategory = db.prepare(`
    SELECT COALESCE(NULLIF(service_type,''), COALESCE(NULLIF(account_type,''), '(none)')) AS category,
      COUNT(*) AS count, COALESCE(SUM(total),0) AS total
    FROM invoices WHERE COALESCE(doc_type,'invoice')='invoice'
    GROUP BY category ORDER BY total DESC LIMIT 8`).all()
  const profitByJob = db.prepare(`
    SELECT t.id, t.title, t.time_spent_seconds, t.status, c.name AS client_name,
      COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.notes LIKE '%' || substr(t.id,1,8) || '%'), 0) AS billed
    FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
    WHERE COALESCE(t.is_template,0)=0 AND t.time_spent_seconds > 0
    ORDER BY t.updated_at DESC LIMIT 12`).all()
  const clients = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c
  const templates = db.prepare('SELECT COUNT(*) AS c FROM document_templates').get().c
  const recentInvoices = db.prepare(`
    SELECT i.id, i.number, i.status, i.total, i.date, i.doc_type, c.name AS client_name
    FROM invoices i LEFT JOIN clients c ON c.id=i.client_id ORDER BY i.created_at DESC LIMIT 8`).all()
  const recentTickets = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.time_spent_seconds, c.name AS client_name
    FROM tickets t LEFT JOIN clients c ON c.id=t.client_id WHERE COALESCE(t.is_template,0)=0
    ORDER BY t.updated_at DESC LIMIT 8`).all()

  // EA-Q3: smart suggestions
  const suggestions = []
  const readyToBill = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tickets
       WHERE COALESCE(is_template,0)=0 AND status IN ('resolved','closed')
       AND time_spent_seconds >= 60
       AND client_id IS NOT NULL
       AND id NOT IN (SELECT COALESCE(converted_from_id,'') FROM invoices WHERE converted_from_id IS NOT NULL)`
    )
    .get().c
  if (readyToBill > 0) {
    suggestions.push({
      id: 'bill_tickets',
      severity: 'info',
      title: `${readyToBill} ticket(s) ready to invoice`,
      detail: 'Resolved/closed with logged time and a client — bill from Tickets.',
      href: '/tickets',
    })
  }
  const overdueCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM invoices
       WHERE COALESCE(doc_type,'invoice')='invoice' AND status IN ('unpaid','partial','overdue')
       AND due_date IS NOT NULL AND due_date < date('now')`
    )
    .get().c
  if (overdueCount > 0) {
    suggestions.push({
      id: 'overdue',
      severity: 'warn',
      title: `${overdueCount} overdue invoice(s)`,
      detail: 'Past due date and still unpaid — send reminders or mark overdue.',
      href: '/ageing',
    })
  }
  const slaBreach = Number(ticketStats.sla_breached || 0)
  if (slaBreach > 0) {
    suggestions.push({
      id: 'sla',
      severity: 'warn',
      title: `${slaBreach} SLA breach(es)`,
      detail: 'Open tickets past SLA due — prioritise or extend SLA.',
      href: '/tickets',
    })
  }
  const creditWarn = db
    .prepare(
      `SELECT COUNT(*) AS c FROM clients c
       WHERE c.credit_limit IS NOT NULL AND c.credit_limit > 0
       AND (
         SELECT COALESCE(SUM(i.total - i.amount_paid),0) FROM invoices i
         WHERE i.client_id = c.id AND COALESCE(i.doc_type,'invoice')='invoice'
         AND i.status IN ('unpaid','partial','overdue')
       ) > c.credit_limit`
    )
    .get().c
  if (creditWarn > 0) {
    suggestions.push({
      id: 'credit_limit',
      severity: 'warn',
      title: `${creditWarn} client(s) over credit limit`,
      detail: 'Outstanding balance exceeds credit limit.',
      href: '/clients',
    })
  }
  const noClientTickets = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tickets
       WHERE COALESCE(is_template,0)=0 AND status NOT IN ('resolved','closed','archived')
       AND (client_id IS NULL OR client_id = '')`
    )
    .get().c
  if (noClientTickets > 0) {
    suggestions.push({
      id: 'no_client',
      severity: 'info',
      title: `${noClientTickets} open ticket(s) without client`,
      detail: 'Assign a client before billing.',
      href: '/tickets',
    })
  }

  const avgCollected =
    monthly.length > 0
      ? monthly.reduce((s, m) => s + Number(m.collected || 0), 0) / monthly.length
      : 0
  const forecast = {
    next_month_collected_est: Math.round(avgCollected * 100) / 100,
    outstanding: Number(invStats.outstanding || 0),
    method: 'avg_monthly_collected',
  }

  res.json({
    data: {
      invoices: invStats,
      monthly,
      cashflow,
      tickets: ticketStats,
      tech_util: techUtil,
      revenue_by_category: revenueByCategory,
      profit_by_job: profitByJob,
      clients,
      templates,
      recentInvoices,
      recentTickets,
      suggestions,
      forecast,
    },
  })
})

settingsRouter.get('/export/:module', (req, res) => {
  const mod = req.params.module
  let rows = [], headers = []
  if (mod === 'invoices') {
    rows = db.prepare(`SELECT i.number, i.doc_type, i.date, i.due_date, i.status, i.total, i.amount_paid,
      (i.total - i.amount_paid) AS balance, c.name AS client_name, c.email AS client_email
      FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.date DESC`).all()
    headers = ['number','doc_type','date','due_date','status','total','amount_paid','balance','client_name','client_email']
  } else if (mod === 'clients') {
    rows = db.prepare(`SELECT name, email, phone, address, vat_number, tags, credit_limit, notes, created_at FROM clients ORDER BY name`).all()
    headers = ['name','email','phone','address','vat_number','tags','credit_limit','notes','created_at']
  } else if (mod === 'tickets') {
    rows = db.prepare(`SELECT t.title, t.status, t.priority, t.category, t.time_spent_seconds, t.warranty, t.sla_hours,
      c.name AS client_name, u.name AS assignee_name, t.created_at, t.resolved_at
      FROM tickets t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE COALESCE(t.is_template,0)=0 ORDER BY t.created_at DESC`).all()
    headers = ['title','status','priority','category','time_spent_seconds','warranty','sla_hours','client_name','assignee_name','created_at','resolved_at']
  } else if (mod === 'payments') {
    rows = db.prepare(`SELECT p.date, p.amount, p.method, p.note, i.number AS invoice_number, c.name AS client_name
      FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN clients c ON c.id = i.client_id ORDER BY p.date DESC`).all()
    headers = ['date','amount','method','note','invoice_number','client_name']
  } else {
    return res.status(400).json({ error: true, message: 'Unknown module. Use invoices|clients|tickets|payments' })
  }
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const lines = [headers.join(',')]
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','))
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="said-${mod}-${new Date().toISOString().slice(0,10)}.csv"`)
  res.send(lines.join('\n'))
})
