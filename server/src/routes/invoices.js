import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { htmlToPdf } from '../services/pdf.js'
import { mountInvoiceExtras } from './invoiceExtras.js'
import {
  getDefaultTemplateId,
  invoiceInstanceVars,
  renderThreeWay,
  buildLinesHtml,
} from '../services/documentModel.js'

export const invoicesRouter = Router()
invoicesRouter.use(requireAuth)

const Line = z.object({
  description: z.string().min(1),
  qty: z.coerce.number().default(1),
  price: z.coerce.number().default(0),
  discount: z.coerce.number().default(0),
})

const InvoiceBody = z.object({
  client_id: z.string().min(1),
  doc_type: z.enum(['invoice', 'quote', 'credit']).default('invoice'),
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
  template_id: z.string().optional().nullable(),
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

function nextNumber(docType = 'invoice') {
  const y = new Date().getFullYear()
  const prefix = docType === 'quote' ? 'QT' : docType === 'credit' ? 'CN' : 'INV'
  const c = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE number LIKE ?`).get(`${prefix}-${y}-%`).c
  return `${prefix}-${y}-${String(c + 1).padStart(4, '0')}`
}

function money(n) { return `R ${Number(n || 0).toFixed(2)}` }
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function lineExclusive(lines) {
  return lines.reduce((s, l) => {
    const raw = Number(l.qty) * Number(l.price)
    const disc = Math.min(100, Math.max(0, Number(l.discount || 0))) / 100
    return s + raw * (1 - disc)
  }, 0)
}

invoicesRouter.get('/', (req, res) => {
  const { status, type } = req.query
  const clauses = []
  const params = []
  if (type) { clauses.push('i.doc_type = ?'); params.push(type) }
  else { clauses.push("i.doc_type = 'invoice'") }
  if (status) { clauses.push('i.status = ?'); params.push(status) }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  const sql = `SELECT i.*, c.name AS client_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ${where} ORDER BY i.date DESC`
  res.json({ data: db.prepare(sql).all(...params) })
})

mountInvoiceExtras(invoicesRouter, { loadInvoice, nextNumber })

invoicesRouter.get('/:id', (req, res) => {
  const inv = loadInvoice(req.params.id)
  if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
  res.json({ data: inv })
})

invoicesRouter.post('/', requireRole('staff'), (req, res, next) => {
  try {
    const body = InvoiceBody.parse(req.body)
    const exclusive = lineExclusive(body.lines)
    const vat_amount = Math.round(exclusive * body.vat_rate * 100) / 100
    const total = Math.round((exclusive + vat_amount) * 100) / 100
    const id = uid()
    const number = nextNumber(body.doc_type || 'invoice')
    const date = body.date || now().slice(0, 10)
    const tplId = body.template_id || getDefaultTemplateId(body.doc_type || 'invoice')
    db.prepare(`INSERT INTO invoices (
      id, number, client_id, date, due_date, status, notes, account_type, devices, service_type, po_number,
      payment_note, exclusive, vat_amount, total, amount_paid, reminder_at, created_by, created_at, updated_at, doc_type, template_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, number, body.client_id, date, body.due_date || date, body.status,
      body.notes || null, body.account_type || null, body.devices || null, body.service_type || null,
      body.po_number || null, body.payment_note || null, exclusive, vat_amount, total, 0,
      body.reminder_at || null, req.user.sub, now(), now(), body.doc_type || 'invoice', tplId
    )
    const insLine = db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price, discount) VALUES (?,?,?,?,?,?)`)
    for (const l of body.lines) insLine.run(uid(), id, l.description, l.qty, l.price, l.discount || 0)
    res.status(201).json({ data: loadInvoice(id) })
  } catch (e) { next(e) }
})

invoicesRouter.put('/:id', requireRole('staff'), (req, res, next) => {
  try {
    const body = InvoiceBody.parse(req.body)
    const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: true, message: 'Not found' })
    const exclusive = lineExclusive(body.lines)
    const vat_amount = Math.round(exclusive * body.vat_rate * 100) / 100
    const total = Math.round((exclusive + vat_amount) * 100) / 100
    db.prepare(`UPDATE invoices SET client_id=?, date=?, due_date=?, status=?, notes=?, account_type=?, devices=?, service_type=?,
      po_number=?, payment_note=?, exclusive=?, vat_amount=?, total=?, reminder_at=?, updated_at=?, template_id=? WHERE id=?`).run(
      body.client_id, body.date || existing.date, body.due_date || existing.due_date, body.status,
      body.notes || null, body.account_type || null, body.devices || null, body.service_type || null,
      body.po_number || null, body.payment_note || null, exclusive, vat_amount, total,
      body.reminder_at || null, now(),
      body.template_id !== undefined ? body.template_id : existing.template_id,
      req.params.id
    )
    db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(req.params.id)
    const insLine = db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price, discount) VALUES (?,?,?,?,?,?)`)
    for (const l of body.lines) insLine.run(uid(), req.params.id, l.description, l.qty, l.price, l.discount || 0)
    res.json({ data: loadInvoice(req.params.id) })
  } catch (e) { next(e) }
})

invoicesRouter.post('/:id/payments', requireRole('staff'), (req, res, next) => {
  try {
    const body = z.object({ amount: z.coerce.number().positive(), method: z.string().optional(), date: z.string().optional(), note: z.string().optional() }).parse(req.body)
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, method, date, note, created_at) VALUES (?,?,?,?,?,?,?)`).run(uid(), req.params.id, body.amount, body.method || 'EFT', body.date || now().slice(0, 10), body.note || null, now())
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?').get(req.params.id).s
    let status = inv.status
    if (paid >= inv.total) status = 'paid'
    else if (paid > 0) status = 'partial'
    db.prepare('UPDATE invoices SET amount_paid=?, status=?, updated_at=? WHERE id=?').run(paid, status, now(), req.params.id)
    res.status(201).json({ data: loadInvoice(req.params.id) })
  } catch (e) { next(e) }
})

invoicesRouter.get('/:id/pdf', async (req, res, next) => {
  try {
    const inv = loadInvoice(req.params.id)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    const docType = inv.doc_type || 'invoice'
    const templateId = inv.template_id || getDefaultTemplateId(docType)
    const instance = invoiceInstanceVars(inv)
    // Ensure table rows always present from live lines
    instance.lines_html = buildLinesHtml(inv.lines)
    instance.line_items_html = instance.lines_html
    instance.rate_card_html = instance.rate_card_html || instance.lines_html
    const fallbackHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:Segoe UI,system-ui,sans-serif;font-size:11px;padding:16px;color:#0f172a}
.header{display:flex;justify-content:space-between;border-bottom:3px solid #007A4D;padding-bottom:10px;margin-bottom:12px}
.brand{font-size:18px;font-weight:800;color:#007A4D}table{width:100%;border-collapse:collapse;margin:12px 0}
th{background:#1e3a5f;color:#fff;padding:7px 8px;text-align:left;font-size:9px;text-transform:uppercase}
td{padding:7px 8px;border-bottom:1px solid #e2e8f0}.right{text-align:right}.center{text-align:center}
.grand{font-weight:800;color:#007A4D;font-size:14px}
.box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin:8px 0}
.meta{color:#64748b;font-size:10px}
</style></head><body>
<div class="header"><div><div class="brand">{{company_name}}</div>
<div class="meta">{{company_address}} · {{company_phone}} · VAT {{company_vat}}</div></div>
<div class="right"><strong>{{number}}</strong><br/><span class="meta">{{date}} · {{status}}</span></div></div>
<div class="box"><strong>Bill to</strong><br/>{{client_name}}<br/>{{client_address}}<br/>{{client_phone}}</div>
<p class="meta">Devices: {{devices}} · Service: {{service_type}} · Account: {{account_type}}</p>
<table><thead><tr><th>Description</th><th class="center">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
<tbody>{{lines_html}}</tbody></table>
<p class="right">Exclusive {{exclusive}} · VAT {{vat_amount}} · <span class="grand">Total {{total}}</span></p>
<p class="right meta">Paid {{amount_paid}} · Balance {{balance}}</p>
<p class="meta">{{payment_note}}</p>
<p class="meta">Bank: {{company_bank}} · Acc {{company_account}} · Branch {{company_branch}}</p>
</body></html>`
    const { html, layers } = renderThreeWay({
      templateId,
      instanceVars: instance,
      fallbackHtml,
    })
    const pdf = await htmlToPdf(html, {})
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${inv.number}.pdf"`)
    res.setHeader('X-SAID-Layout', layers.layout || '')
    res.setHeader('X-SAID-Company', layers.company || '')
    res.send(pdf)
  } catch (e) {
    next(e)
  }
})

invoicesRouter.get('/:id/html', (req, res, next) => {
  try {
    const inv = loadInvoice(req.params.id)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    const docType = inv.doc_type || 'invoice'
    const templateId = inv.template_id || getDefaultTemplateId(docType)
    const instance = invoiceInstanceVars(inv)
    instance.lines_html = buildLinesHtml(inv.lines)
    instance.line_items_html = instance.lines_html
    const fallbackHtml = `<html><body><h1>{{company_name}}</h1><p>{{number}}</p><table>{{lines_html}}</table><p>{{total}}</p></body></html>`
    const { html } = renderThreeWay({ templateId, instanceVars: instance, fallbackHtml })
    res.type('html').send(html)
  } catch (e) {
    next(e)
  }
})

/** Preview 3-way merge without saving */
invoicesRouter.post('/preview-layout', requireRole('staff'), (req, res, next) => {
  try {
    const templateId = req.body?.template_id || getDefaultTemplateId('invoice')
    const instance = req.body?.instance || {
      number: 'PREVIEW',
      date: new Date().toISOString().slice(0, 10),
      status: 'unpaid',
      client_name: 'Sample Client',
      exclusive: 'R 0.00',
      vat_amount: 'R 0.00',
      total: 'R 0.00',
      amount_paid: 'R 0.00',
      balance: 'R 0.00',
      lines_html: '<tr><td>Sample line</td><td>1</td><td>R 0.00</td><td>R 0.00</td></tr>',
    }
    const fallbackHtml = `<html><body><h1>{{company_name}}</h1><p>{{number}} — {{client_name}}</p><table>{{lines_html}}</table><p>{{total}}</p></body></html>`
    const result = renderThreeWay({ templateId, instanceVars: instance, fallbackHtml })
    res.json({ data: result })
  } catch (e) {
    next(e)
  }
})
