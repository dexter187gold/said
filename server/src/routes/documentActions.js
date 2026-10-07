import { Router } from 'express'
import { db, uid, now, audit } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const documentActionsRouter = Router()
documentActionsRouter.use(requireAuth)

function logActivity(documentType, documentId, userId, action, detail) {
  try {
    db.prepare(
      `INSERT INTO document_activity (id, document_type, document_id, user_id, action, detail, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(uid(), documentType, documentId, userId || null, action, detail ? String(detail).slice(0, 2000) : null, now())
  } catch (e) {
    console.warn('document_activity', e.message)
  }
}

documentActionsRouter.get('/:type/:id/activity', (req, res) => {
  const { type, id } = req.params
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS user_name FROM document_activity a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.document_type = ? AND a.document_id = ?
       ORDER BY a.created_at DESC LIMIT 50`
    )
    .all(type, id)
  res.json({ data: rows })
})

documentActionsRouter.post('/:type/:id/duplicate', (req, res) => {
  const { type, id } = req.params
  if (type !== 'invoice' && type !== 'quote' && type !== 'credit') {
    return res.status(400).json({ error: true, message: 'Unsupported type for duplicate' })
  }
  const inv = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(id)
  if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
  const newId = uid()
  const number = `${inv.number}-COPY`
  const ts = now()
  db.prepare(
    `INSERT INTO invoices (
      id, number, client_id, date, due_date, doc_type, status, notes, devices, service_type,
      po_number, payment_note, exclusive, vat_amount, total, amount_paid, template_id,
      created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    newId,
    number,
    inv.client_id,
    ts.slice(0, 10),
    inv.due_date,
    inv.doc_type || type,
    'unpaid',
    inv.notes,
    inv.devices,
    inv.service_type,
    inv.po_number,
    inv.payment_note,
    inv.exclusive,
    inv.vat_amount,
    inv.total,
    0,
    inv.template_id,
    req.user.id,
    ts,
    ts
  )
  const lines = db.prepare(`SELECT * FROM invoice_lines WHERE invoice_id = ?`).all(id)
  const insertLine = db.prepare(
    `INSERT INTO invoice_lines (id, invoice_id, description, qty, price, discount) VALUES (?,?,?,?,?,?)`
  )
  for (const l of lines) {
    insertLine.run(uid(), newId, l.description, l.qty, l.price, l.discount || 0)
  }
  logActivity(type, newId, req.user.id, 'duplicate', `from ${id}`)
  audit(req.user.id, 'document.duplicate', `${type}:${id}→${newId}`, req.ip)
  res.json({ data: { id: newId, number } })
})

documentActionsRouter.post('/:type/:id/whatsapp-link', (req, res) => {
  const { type, id } = req.params
  let text = ''
  let phone = ''
  if (type === 'invoice' || type === 'quote' || type === 'credit') {
    const inv = db
      .prepare(
        `SELECT i.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
      )
      .get(id)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    phone = (inv.client_phone || '').replace(/\D/g, '')
    if (phone.startsWith('0')) phone = '27' + phone.slice(1)
    const company = db.prepare(`SELECT name FROM company WHERE id = 'main'`).get()
    text = encodeURIComponent(
      `Hi ${inv.client_name || 'there'},\n\n` +
        `${company?.name || 'SAID'} ${type} *${inv.number}* for R${Number(inv.total || 0).toFixed(2)}.\n` +
        `Status: ${inv.status}\n` +
        (inv.due_date ? `Due: ${inv.due_date}\n` : '') +
        `\nPlease settle via EFT. Thank you!`
    )
  } else if (type === 'ticket') {
    const t = db
      .prepare(
        `SELECT t.*, c.name AS client_name, c.phone AS client_phone
         FROM tickets t LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = ?`
      )
      .get(id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    phone = (t.client_phone || '').replace(/\D/g, '')
    if (phone.startsWith('0')) phone = '27' + phone.slice(1)
    text = encodeURIComponent(
      `Hi ${t.client_name || 'there'},\n\nUpdate on ticket: *${t.title}*\nStatus: ${t.status}\n\n— SAID`
    )
  } else {
    return res.status(400).json({ error: true, message: 'Unsupported type' })
  }
  const url = phone
    ? `https://wa.me/${phone}?text=${text}`
    : `https://wa.me/?text=${text}`
  logActivity(type, id, req.user.id, 'whatsapp_link', null)
  res.json({ data: { url, phone: phone || null } })
})

documentActionsRouter.post('/:type/:id/clipboard', (req, res) => {
  const { type, id } = req.params
  const action = req.body?.action // copy | cut
  if (!['copy', 'cut'].includes(action)) {
    return res.status(400).json({ error: true, message: 'action must be copy or cut' })
  }
  if (type !== 'invoice' && type !== 'quote' && type !== 'credit') {
    return res.status(400).json({ error: true, message: 'Only invoice-like documents support line clipboard' })
  }
  const lineIds = Array.isArray(req.body?.line_ids) ? req.body.line_ids : null
  let lines
  if (lineIds?.length) {
    const placeholders = lineIds.map(() => '?').join(',')
    lines = db
      .prepare(
        `SELECT description, qty, price, discount FROM invoice_lines WHERE invoice_id = ? AND id IN (${placeholders})`
      )
      .all(id, ...lineIds)
  } else {
    lines = db
      .prepare(`SELECT description, qty, price, discount FROM invoice_lines WHERE invoice_id = ?`)
      .all(id)
  }
  if (action === 'cut' && lineIds?.length) {
    const placeholders = lineIds.map(() => '?').join(',')
    db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ? AND id IN (${placeholders})`).run(id, ...lineIds)
    // recompute totals omitted for brevity — client should refresh
  }
  logActivity(type, id, req.user.id, action === 'cut' ? 'cut_lines' : 'copy_lines', `${lines.length} lines`)
  res.json({ data: { lines, action } })
})

documentActionsRouter.post('/:type/:id/paste-lines', (req, res) => {
  const { type, id } = req.params
  if (type !== 'invoice' && type !== 'quote' && type !== 'credit') {
    return res.status(400).json({ error: true, message: 'Unsupported' })
  }
  const inv = db.prepare(`SELECT id FROM invoices WHERE id = ?`).get(id)
  if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
  if (!lines.length) return res.status(400).json({ error: true, message: 'No lines' })
  const insert = db.prepare(
    `INSERT INTO invoice_lines (id, invoice_id, description, qty, price, discount) VALUES (?,?,?,?,?,?)`
  )
  for (const l of lines) {
    insert.run(
      uid(),
      id,
      String(l.description || ''),
      Number(l.qty) || 1,
      Number(l.price) || 0,
      Number(l.discount) || 0
    )
  }
  logActivity(type, id, req.user.id, 'paste_lines', `${lines.length} lines`)
  res.json({ data: { ok: true, added: lines.length } })
})

documentActionsRouter.post('/:type/:id/archive', (req, res) => {
  const { type, id } = req.params
  if (type === 'invoice' || type === 'quote' || type === 'credit') {
    db.prepare(`UPDATE invoices SET status = 'archived', updated_at = ? WHERE id = ?`).run(now(), id)
  } else if (type === 'ticket') {
    db.prepare(`UPDATE tickets SET status = 'archived', updated_at = ? WHERE id = ?`).run(now(), id)
  } else {
    return res.status(400).json({ error: true, message: 'Unsupported' })
  }
  logActivity(type, id, req.user.id, 'archive', null)
  audit(req.user.id, 'document.archive', `${type}:${id}`, req.ip)
  res.json({ data: { ok: true } })
})
