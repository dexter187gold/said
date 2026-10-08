import { emitWebhook } from '../services/webhooks.js'
import { db, uid, now } from '../db.js'
import { requireRole } from '../middleware/auth.js'

/** Extra Q2 routes: ageing, mark-overdue, quote→invoice convert */
export function mountInvoiceExtras(invoicesRouter, { loadInvoice, nextNumber }) {
  invoicesRouter.get('/ageing', (_req, res) => {
    const today = now().slice(0, 10)
    const rows = db.prepare(`
      SELECT i.id, i.number, i.date, i.due_date, i.status, i.total, i.amount_paid,
        (i.total - i.amount_paid) AS balance, c.name AS client_name, c.id AS client_id
      FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.doc_type = 'invoice' AND i.status NOT IN ('paid', 'cancelled')
        AND (i.total - i.amount_paid) > 0.009 ORDER BY i.due_date ASC`).all()
    const buckets = { current: [], days_1_30: [], days_31_60: [], days_61_90: [], days_90_plus: [] }
    const totals = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 }
    const t0 = new Date(today).getTime()
    for (const r of rows) {
      const due = new Date(r.due_date || r.date).getTime()
      const days = Math.floor((t0 - due) / 86400000)
      const bal = Number(r.balance)
      const item = { ...r, days_overdue: Math.max(0, days) }
      if (days <= 0) { buckets.current.push(item); totals.current += bal }
      else if (days <= 30) { buckets.days_1_30.push(item); totals.days_1_30 += bal }
      else if (days <= 60) { buckets.days_31_60.push(item); totals.days_31_60 += bal }
      else if (days <= 90) { buckets.days_61_90.push(item); totals.days_61_90 += bal }
      else { buckets.days_90_plus.push(item); totals.days_90_plus += bal }
    }
    res.json({ data: { buckets, totals, as_of: today } })
  })

  invoicesRouter.post('/mark-overdue', requireRole('staff'), (_req, res) => {
    const today = now().slice(0, 10)
    const r = db.prepare(`UPDATE invoices SET status='overdue', updated_at=?
      WHERE doc_type='invoice' AND status IN ('unpaid','partial')
        AND due_date IS NOT NULL AND due_date < ? AND (total - amount_paid) > 0.009`).run(now(), today)
    res.json({ data: { marked: r.changes } })
  })

  invoicesRouter.post('/:id/convert', requireRole('staff'), (req, res, next) => {
    try {
      const src = loadInvoice(req.params.id)
      if (!src) return res.status(404).json({ error: true, message: 'Not found' })
      if (src.doc_type !== 'quote') return res.status(400).json({ error: true, message: 'Only quotes can be converted to invoices' })
      const id = uid()
      const number = nextNumber('invoice')
      const date = now().slice(0, 10)
      const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      db.prepare(`INSERT INTO invoices (
        id, number, client_id, date, due_date, status, notes, account_type, devices, service_type, po_number,
        payment_note, exclusive, vat_amount, total, amount_paid, reminder_at, created_by, created_at, updated_at, doc_type, converted_from_id
      ) VALUES (?,?,?,?,?, 'unpaid', ?,?,?,?,?,?,?,?,?,0,?,?,?,?, 'invoice', ?)`).run(
        id, number, src.client_id, date, due,
        (src.notes || '') + (src.notes ? '\n' : '') + `Converted from quote ${src.number}`,
        src.account_type, src.devices, src.service_type, src.po_number, src.payment_note,
        src.exclusive, src.vat_amount, src.total, src.reminder_at, req.user.sub, now(), now(), src.id
      )
      const insLine = db.prepare(`INSERT INTO invoice_lines (id, invoice_id, description, qty, price, discount) VALUES (?,?,?,?,?,?)`)
      for (const l of src.lines || []) insLine.run(uid(), id, l.description, l.qty, l.price, l.discount || 0)
      db.prepare(`UPDATE invoices SET status='accepted', updated_at=? WHERE id=?`).run(now(), src.id)
      emitWebhook('quote.converted', {
        quote_id: src.id,
        quote_number: src.number,
        invoice_id: id,
        number,
      }).catch(() => {})
      emitWebhook('invoice.created', { invoice_id: id, number, from_quote: src.number }).catch(() => {})
      res.status(201).json({ data: loadInvoice(id) })
    } catch (e) { next(e) }
  })
}
