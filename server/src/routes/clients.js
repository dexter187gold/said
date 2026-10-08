import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { resolveBranchScope } from '../services/branchScope.js'

export const clientsRouter = Router()
clientsRouter.use(requireAuth)

function enrich(c) {
  if (!c) return null
  let contacts = []
  try { contacts = JSON.parse(c.contacts_json || '[]') } catch { contacts = [] }
  const bal = db.prepare(`
    SELECT COALESCE(SUM(total - amount_paid),0) AS outstanding
    FROM invoices WHERE client_id=? AND doc_type='invoice' AND status NOT IN ('cancelled','paid')
  `).get(c.id)
  return {
    ...c,
    contacts: Array.isArray(contacts) ? contacts : [],
    outstanding: bal?.outstanding || 0,
    over_limit: c.credit_limit != null && (bal?.outstanding || 0) > Number(c.credit_limit),
  }
}

clientsRouter.get('/', (req, res) => {
  const { q, tag, branch_id } = req.query
  const scope = resolveBranchScope(req)
  const effectiveBranch = scope.scoped ? scope.branchId : (branch_id || null)
  let sql = 'SELECT * FROM clients WHERE 1=1'
  const params = []
  if (q) {
    sql += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR tags LIKE ?)'
    const like = `%${q}%`
    params.push(like, like, like, like)
  }
  if (tag) { sql += ' AND tags LIKE ?'; params.push(`%${tag}%`) }
  if (effectiveBranch) { sql += ' AND branch_id = ?'; params.push(effectiveBranch) }
  sql += ' ORDER BY name'
  res.json({ data: db.prepare(sql).all(...params).map(enrich) })
})

clientsRouter.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: true, message: 'Not found' })
  res.json({ data: enrich(c) })
})

clientsRouter.get('/:id/history', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: true, message: 'Not found' })
  const invoices = db.prepare(`SELECT id, number, doc_type, date, due_date, status, total, amount_paid, exclusive, vat_amount FROM invoices WHERE client_id=? ORDER BY date DESC LIMIT 50`).all(req.params.id)
  const tickets = db.prepare(`SELECT id, title, status, priority, category, time_spent_seconds, created_at, resolved_at FROM tickets WHERE client_id=? AND COALESCE(is_template,0)=0 ORDER BY created_at DESC LIMIT 30`).all(req.params.id)
  const payments = db.prepare(`SELECT p.*, i.number AS invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.client_id=? ORDER BY p.date DESC LIMIT 30`).all(req.params.id)
  res.json({ data: { client: enrich(c), invoices, tickets, payments } })
})

clientsRouter.get('/:id/statement', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: true, message: 'Not found' })
  const co = db.prepare("SELECT * FROM company WHERE id='main'").get() || {}
  const rows = db.prepare(`SELECT number, date, due_date, status, total, amount_paid, (total - amount_paid) AS balance, doc_type FROM invoices WHERE client_id=? AND doc_type='invoice' AND status != 'cancelled' ORDER BY date ASC`).all(req.params.id)
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0)
  const paid = rows.reduce((s, r) => s + Number(r.amount_paid || 0), 0)
  const bal = total - paid
  const lines = rows.map((r) => `<tr><td>${r.date?.slice(0, 10) || ''}</td><td>${r.number}</td><td>${r.status}</td><td style="text-align:right">R ${Number(r.total).toFixed(2)}</td><td style="text-align:right">R ${Number(r.amount_paid).toFixed(2)}</td><td style="text-align:right">R ${Number(r.balance).toFixed(2)}</td></tr>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement ${c.name}</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:24px auto;padding:16px;font-size:13px}h1{font-size:20px;margin:0}.muted{color:#64748b}.box{border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin:12px 0}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#64748b}.brand{color:#007A4D;font-weight:800;font-size:11px}@media print{button{display:none}}</style></head><body>
<div class="brand">STATEMENT OF ACCOUNT</div>
<h1>${co.name || 'Company'}</h1>
<p class="muted">${co.address || ''} · ${co.phone || ''} · ${co.email || ''}</p>
<div class="box"><strong>Client:</strong> ${c.name}<br>${c.address || ''}<br>${c.email || ''} · ${c.phone || ''}</div>
<p class="muted">As at ${new Date().toISOString().slice(0, 10)}</p>
<table><thead><tr><th>Date</th><th>Invoice</th><th>Status</th><th style="text-align:right">Total</th><th style="text-align:right">Paid</th><th style="text-align:right">Balance</th></tr></thead>
<tbody>${lines || '<tr><td colspan="6">No invoices</td></tr>'}</tbody>
<tfoot><tr><td colspan="3"><strong>Totals</strong></td><td style="text-align:right"><strong>R ${total.toFixed(2)}</strong></td><td style="text-align:right"><strong>R ${paid.toFixed(2)}</strong></td><td style="text-align:right"><strong>R ${bal.toFixed(2)}</strong></td></tr></tfoot></table>
<button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print</button></body></html>`
  res.type('html').send(html)
})

const ClientBody = z.object({
  name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  vat_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
  credit_limit: z.coerce.number().optional().nullable(),
  contacts: z.array(z.object({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), role: z.string().optional() })).optional(),
  contract_renewal: z.string().optional().nullable(),
})

clientsRouter.post('/', requireRole('staff'), (req, res, next) => {
  try {
    const body = ClientBody.parse(req.body)
    const id = uid()
    db.prepare(`INSERT INTO clients (id, name, email, phone, address, vat_number, notes, tags, credit_limit, contacts_json, contract_renewal, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, body.name, body.email || null, body.phone || null, body.address || null,
      body.vat_number || null, body.notes || null, body.tags || null, body.credit_limit ?? null,
      body.contacts ? JSON.stringify(body.contacts) : null, body.contract_renewal || null, now()
    )
    try {
      const ub = db.prepare(`SELECT branch_id FROM users WHERE id = ?`).get(req.user.sub)?.branch_id
      if (ub) db.prepare(`UPDATE clients SET branch_id=? WHERE id=? AND branch_id IS NULL`).run(ub, id)
    } catch {}
    res.status(201).json({ data: enrich(db.prepare('SELECT * FROM clients WHERE id = ?').get(id)) })
  } catch (e) { next(e) }
})

clientsRouter.put('/:id', requireRole('staff'), (req, res, next) => {
  try {
    const body = ClientBody.parse(req.body)
    if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(`UPDATE clients SET name=?, email=?, phone=?, address=?, vat_number=?, notes=?, tags=?, credit_limit=?, contacts_json=?, contract_renewal=? WHERE id=?`).run(
      body.name, body.email ?? null, body.phone ?? null, body.address ?? null,
      body.vat_number ?? null, body.notes ?? null, body.tags ?? null, body.credit_limit ?? null,
      body.contacts ? JSON.stringify(body.contacts) : null, body.contract_renewal ?? null, req.params.id
    )
    res.json({ data: enrich(db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id)) })
  } catch (e) { next(e) }
})

clientsRouter.post('/import', requireRole('staff'), (req, res, next) => {
  try {
    const body = z.object({ rows: z.array(z.object({
      name: z.string().min(1), email: z.string().optional().nullable(), phone: z.string().optional().nullable(),
      address: z.string().optional().nullable(), vat_number: z.string().optional().nullable(),
      tags: z.string().optional().nullable(), credit_limit: z.coerce.number().optional().nullable(),
    })).min(1) }).parse(req.body)
    const ins = db.prepare(`INSERT INTO clients (id, name, email, phone, address, vat_number, tags, credit_limit, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    let created = 0
    const tx = db.transaction(() => {
      for (const r of body.rows) {
        ins.run(uid(), r.name, r.email || null, r.phone || null, r.address || null, r.vat_number || null, r.tags || null, r.credit_limit ?? null, now())
        created++
      }
    })
    tx()
    res.status(201).json({ data: { created } })
  } catch (e) { next(e) }
})
