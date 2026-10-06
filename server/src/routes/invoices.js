import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { htmlToPdf } from '../services/pdf.js'

export const invoicesRouter = Router()
invoicesRouter.use(requireAuth)

const Line = z.object({
  description: z.string().min(1),
  qty: z.coerce.number().default(1),
  price: z.coerce.number().default(0),
})

const InvoiceBody = z.object({
  client_id: z.string().min(1),
  date: z.string().optional(),
  due_date: z.string().optional().nullable(),
  status: z.enum(['unpaid', 'partial', 'paid', 'overdue', 'cancelled']).default('unpaid'),
  notes: z.string().optional().nullable(),
  account_type: z.string().optional().nullable(),
  devices: z.string().optional().nullable(),
  service_type: z.string().optional().nullable(),
  po_number: z.string().optional().nullable(),
  payment_note: z.string().optional().nullable(),
  reminder_at: z.string().optional().nullable(),
  vat_rate: z.coerce.number().default(0.15),
  lines: z.array(Line).min(1),
})

function loadInvoice(id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!inv) return null
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').all(id)
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY date').all(id)
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(inv.client_id)
  return { ...inv, lines, payments, client }
}

function nextNumber() {
  const y = new Date().getFullYear()
  const c = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE number LIKE ?`).get(`INV-${y}-%`).c
  return `INV-${y}-${String(c + 1).padStart(4, '0')}`
}

function money(n) {
  return `R ${Number(n || 0).toFixed(2)}`
}
function esc(s) {
  return String(s || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"')
}

invoicesRouter.get('/', (req, res) => {
  const status = req.query.status
  const sql = status
    ? `SELECT i.*, c.name AS client_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.status = ? ORDER BY i.date DESC`
    : `SELECT i.*, c.name AS client_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.date DESC`
  res.json({ data: status ? db.prepare(sql).all(status) : db.prepare(sql).all() })
})

invoicesRouter.get('/:id', (req, res) => {
  const inv = loadInvoice(req.params.id)
  if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
  res.json({ data: inv })
})

invoicesRouter.post('/', requireRole('staff'), (req, res, next) => {
  try {
    const body = InvoiceBody.parse(req.body)
    const exclusive = body.lines.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0)
    const vat_amount = Math.round(exclusive * body.vat_rate * 100) / 100
    const total = Math.round((exclusive + vat_amount) * 100) / 100
    const id = uid()
    const number = nextNumber()
    const date = body.date || now().slice(0, 10)
    db.prepare(
      `INSERT INTO invoices (
        id, number, client_id, date, due_date, status, notes, account_type, devices, service_type, po_number,
        payment_note, exclusive, vat_amount, total, amount_paid, reminder_at, created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, number, body.client_id, date, body.due_date || date, body.status,
      body.notes || null, body.account_type || null, body.devices || null, body.service_type || null,
      body.po_number || null, body.payment_note || null, exclusive, vat_amount, total, 0,
      body.reminder_at || null, req.user.sub, now(), now()
    )
    const insLine = db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price) VALUES (?,?,?,?,?)`)
    for (const l of body.lines) insLine.run(uid(), id, l.description, l.qty, l.price)
    res.status(201).json({ data: loadInvoice(id) })
  } catch (e) {
    next(e)
  }
})

invoicesRouter.put('/:id', requireRole('staff'), (req, res, next) => {
  try {
    const body = InvoiceBody.parse(req.body)
    const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: true, message: 'Not found' })
    const exclusive = body.lines.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0)
    const vat_amount = Math.round(exclusive * body.vat_rate * 100) / 100
    const total = Math.round((exclusive + vat_amount) * 100) / 100
    db.prepare(
      `UPDATE invoices SET client_id=?, date=?, due_date=?, status=?, notes=?, account_type=?, devices=?, service_type=?,
       po_number=?, payment_note=?, exclusive=?, vat_amount=?, total=?, reminder_at=?, updated_at=? WHERE id=?`
    ).run(
      body.client_id, body.date || existing.date, body.due_date || existing.due_date, body.status,
      body.notes || null, body.account_type || null, body.devices || null, body.service_type || null,
      body.po_number || null, body.payment_note || null, exclusive, vat_amount, total,
      body.reminder_at || null, now(), req.params.id
    )
    db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(req.params.id)
    const insLine = db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price) VALUES (?,?,?,?,?)`)
    for (const l of body.lines) insLine.run(uid(), req.params.id, l.description, l.qty, l.price)
    res.json({ data: loadInvoice(req.params.id) })
  } catch (e) {
    next(e)
  }
})

invoicesRouter.post('/:id/payments', requireRole('staff'), (req, res, next) => {
  try {
    const body = z.object({
      amount: z.coerce.number().positive(),
      method: z.string().optional(),
      date: z.string().optional(),
      note: z.string().optional(),
    }).parse(req.body)
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(
      `INSERT INTO payments (id, invoice_id, amount, method, date, note, created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(uid(), req.params.id, body.amount, body.method || 'EFT', body.date || now().slice(0, 10), body.note || null, now())
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?').get(req.params.id).s
    let status = inv.status
    if (paid >= inv.total) status = 'paid'
    else if (paid > 0) status = 'partial'
    db.prepare('UPDATE invoices SET amount_paid=?, status=?, updated_at=? WHERE id=?').run(paid, status, now(), req.params.id)
    res.status(201).json({ data: loadInvoice(req.params.id) })
  } catch (e) {
    next(e)
  }
})

invoicesRouter.get('/:id/pdf', async (req, res, next) => {
  try {
    const inv = loadInvoice(req.params.id)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    const company = db.prepare('SELECT * FROM company WHERE id = ?').get('main') || {}
    const linesHtml = inv.lines
      .map((l) => `<tr><td>${esc(l.description)}</td><td>${l.qty}</td><td>${money(l.price)}</td><td>${money(l.qty * l.price)}</td></tr>`)
      .join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:system-ui,sans-serif;color:#0f172a;font-size:12px;padding:12px}
      .brand{font-size:18px;font-weight:800;color:#007A4D}
      table{width:100%;border-collapse:collapse;margin:16px 0}
      th,td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}
      .grand{font-weight:800;color:#007A4D}
    </style></head><body>
      <div class="brand">SA INVOICE DESK</div>
      <p>${esc(company.name)} · ${esc(inv.number)} · ${esc(inv.date)} · ${esc(inv.status)}</p>
      <p><strong>Bill to:</strong> ${esc(inv.client?.name)}</p>
      <table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
      <tbody>${linesHtml}</tbody></table>
      <p>Exclusive ${money(inv.exclusive)} · VAT ${money(inv.vat_amount)} · <span class="grand">Total ${money(inv.total)}</span></p>
      <p>Paid ${money(inv.amount_paid)} · Balance ${money(Math.max(0, inv.total - inv.amount_paid))}</p>
      <p>${esc(inv.payment_note || '')}</p>
    </body></html>`
    const pdf = await htmlToPdf(html, {})
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${inv.number}.pdf"`)
    res.send(pdf)
  } catch (e) {
    next(e)
  }
})
