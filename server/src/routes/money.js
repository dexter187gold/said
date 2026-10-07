/**
 * Hermes-Metal — Flow & money
 * Payments ledger, EFT refs, dunning WhatsApp, CSV exports
 */
import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now, audit } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const moneyRouter = Router()
moneyRouter.use(requireAuth)

function saPhone(phone) {
  if (!phone) return ''
  let p = String(phone).replace(/\D/g, '')
  if (p.startsWith('0')) p = '27' + p.slice(1)
  return p
}

function moneyFmt(n) {
  return `R ${Number(n || 0).toFixed(2)}`
}

/** Recent payments across all invoices */
moneyRouter.get('/payments', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const rows = db
    .prepare(
      `SELECT p.*, i.number AS invoice_number, i.doc_type, i.total AS invoice_total,
              i.amount_paid AS invoice_paid, c.name AS client_name, c.phone AS client_phone
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN clients c ON c.id = i.client_id
       ORDER BY p.date DESC, p.created_at DESC
       LIMIT ?`
    )
    .all(limit)
  const sum = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
  res.json({ data: rows, sum })
})

/** Open balances summary */
moneyRouter.get('/open-balances', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT i.id, i.number, i.date, i.due_date, i.status, i.total, i.amount_paid,
              (i.total - i.amount_paid) AS balance, c.name AS client_name, c.phone AS client_phone, c.id AS client_id
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       WHERE COALESCE(i.doc_type,'invoice') = 'invoice'
         AND i.status NOT IN ('paid','cancelled')
         AND (i.total - i.amount_paid) > 0.009
       ORDER BY i.due_date ASC`
    )
    .all()
  const total_open = rows.reduce((s, r) => s + Number(r.balance || 0), 0)
  res.json({ data: rows, total_open })
})

/**
 * EFT payment reference helper
 * SA practice: use invoice number as reference so bank statement matches
 */
moneyRouter.get('/eft-ref/:invoiceId', (req, res) => {
  const inv = db
    .prepare(
      `SELECT i.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
    )
    .get(req.params.invoiceId)
  if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
  const co = db.prepare(`SELECT * FROM company WHERE id = 'main'`).get() || {}
  const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))
  const ref = String(inv.number || '').replace(/\s+/g, '')
  const instructions =
    `EFT payment instructions\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Pay to: ${co.name || 'Company'}\n` +
    `Bank: ${co.bank_name || '—'}\n` +
    `Account: ${co.account_number || '—'}\n` +
    `Branch: ${co.branch_code || '—'}\n` +
    `Amount: ${moneyFmt(balance)}\n` +
    `Reference: ${ref}\n` +
    `\nPlease use the reference exactly so we can allocate your payment.\n` +
    `Thank you — ${co.name || 'SAID'}`

  res.json({
    data: {
      invoice_id: inv.id,
      number: inv.number,
      balance,
      reference: ref,
      bank_name: co.bank_name || '',
      account_number: co.account_number || '',
      branch_code: co.branch_code || '',
      company_name: co.name || '',
      instructions,
      whatsapp_url: inv.client_phone
        ? `https://wa.me/${saPhone(inv.client_phone)}?text=${encodeURIComponent(instructions)}`
        : `https://wa.me/?text=${encodeURIComponent(instructions)}`,
    },
  })
})

/** Dunning / reminder WhatsApp (friendly → firm by stage) */
moneyRouter.post('/dunning/:invoiceId', requireRole('staff'), (req, res, next) => {
  try {
    const stage = z.enum(['friendly', 'followup', 'final']).default('friendly').parse(req.body?.stage || 'friendly')
    const inv = db
      .prepare(
        `SELECT i.*, c.name AS client_name, c.phone AS client_phone
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
      )
      .get(req.params.invoiceId)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    const co = db.prepare(`SELECT name, phone, bank_name, account_number, branch_code FROM company WHERE id = 'main'`).get() || {}
    const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))
    const first = (inv.client_name || 'there').split(/\s+/)[0]
    const ref = inv.number
    const bankLine =
      co.bank_name && co.account_number
        ? `\nBank: ${co.bank_name} · Acc ${co.account_number} · Branch ${co.branch_code || '—'} · Ref *${ref}*`
        : `\nPlease use reference *${ref}* on your payment.`

    const scripts = {
      friendly:
        `Hi ${first} 👋\n\n` +
        `Friendly reminder from *${co.name || 'us'}*:\n` +
        `Invoice *${ref}* has an open balance of *${moneyFmt(balance)}*` +
        (inv.due_date ? ` (due ${inv.due_date})` : '') +
        `.\n` +
        bankLine +
        `\n\nIf you have already paid, please send proof and we will update your account.\n` +
        `Thank you!\n— ${co.name || 'SAID'}`,
      followup:
        `Hi ${first},\n\n` +
        `Following up on invoice *${ref}* — balance still *${moneyFmt(balance)}*.\n` +
        `We would appreciate payment at your earliest convenience so we can keep your account in good standing.` +
        bankLine +
        `\n\nReply here if you need a payment arrangement.\n— ${co.name || 'SAID'}`,
      final:
        `Hi ${first},\n\n` +
        `Final notice regarding invoice *${ref}* — outstanding *${moneyFmt(balance)}*.\n` +
        `Please settle within 7 days to avoid further collection steps.` +
        bankLine +
        `\n\nContact us on ${co.phone || 'our number'} if there is a problem we can help with.\n— ${co.name || 'SAID'}`,
    }
    const text = scripts[stage]
    const phone = saPhone(inv.client_phone)
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`

    try {
      db.prepare(
        `INSERT INTO payment_reminders (id, invoice_id, channel, sent_at, note, created_by) VALUES (?,?,?,?,?,?)`
      ).run(uid(), inv.id, 'whatsapp', now(), stage, req.user.sub)
    } catch {}
    db.prepare(`UPDATE invoices SET reminder_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), inv.id)
    audit(req.user.sub, 'dunning.whatsapp', `${inv.number}:${stage}`, req.ip)

    res.json({ data: { url, stage, balance, reference: ref, text } })
  } catch (e) {
    next(e)
  }
})

/** CSV export — invoices */
moneyRouter.get('/export/invoices.csv', requireRole('staff'), (req, res) => {
  const type = req.query.type || 'invoice'
  const rows = db
    .prepare(
      `SELECT i.number, i.doc_type, i.date, i.due_date, i.status, i.total, i.amount_paid,
              (i.total - i.amount_paid) AS balance, c.name AS client_name, c.email AS client_email
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       WHERE COALESCE(i.doc_type,'invoice') = ?
       ORDER BY i.date DESC`
    )
    .all(type)
  const header = 'number,doc_type,date,due_date,status,total,amount_paid,balance,client_name,client_email\n'
  const body = rows
    .map((r) =>
      [r.number, r.doc_type, r.date, r.due_date, r.status, r.total, r.amount_paid, r.balance, csv(r.client_name), csv(r.client_email)].join(',')
    )
    .join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="said-${type}s-${now().slice(0, 10)}.csv"`)
  res.send(header + body)
})

/** CSV export — payments ledger */
moneyRouter.get('/export/payments.csv', requireRole('staff'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.date, p.amount, p.method, p.note, i.number AS invoice_number, c.name AS client_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN clients c ON c.id = i.client_id
       ORDER BY p.date DESC`
    )
    .all()
  const header = 'date,amount,method,note,invoice_number,client_name\n'
  const body = rows
    .map((r) => [r.date, r.amount, r.method, csv(r.note), r.invoice_number, csv(r.client_name)].join(','))
    .join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="said-payments-${now().slice(0, 10)}.csv"`)
  res.send(header + body)
})

function csv(s) {
  const v = String(s ?? '')
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

/** Payment methods allowed (settings-backed) */
moneyRouter.get('/methods', (_req, res) => {
  let methods = ['EFT', 'Cash', 'Card', 'SnapScan', 'PayFast', 'Other']
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'payment_methods'`).get()
    if (row?.value) methods = JSON.parse(row.value)
  } catch {}
  res.json({ data: methods })
})

moneyRouter.put('/methods', requireRole('admin'), (req, res, next) => {
  try {
    const methods = z.array(z.string().min(1)).min(1).parse(req.body?.methods)
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('payment_methods', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(JSON.stringify(methods))
    res.json({ data: methods })
  } catch (e) {
    next(e)
  }
})

/** Record payment with method dropdown support (alias to invoice payments) */
moneyRouter.post('/invoices/:id/pay', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        amount: z.coerce.number().positive(),
        method: z.string().default('EFT'),
        date: z.string().optional(),
        note: z.string().optional().nullable(),
      })
      .parse(req.body)
    const inv = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(req.params.id)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(
      `INSERT INTO payments (id, invoice_id, amount, method, date, note, created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(uid(), req.params.id, body.amount, body.method || 'EFT', body.date || now().slice(0, 10), body.note || null, now())
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?`).get(req.params.id).s
    let status = 'unpaid'
    if (paid >= inv.total - 0.009) status = 'paid'
    else if (paid > 0) status = 'partial'
    db.prepare(`UPDATE invoices SET amount_paid=?, status=?, updated_at=? WHERE id=?`).run(paid, status, now(), req.params.id)
    audit(req.user.sub, 'payment.record', `${inv.number}:${body.amount}`, req.ip)
    res.status(201).json({
      data: {
        amount_paid: paid,
        status,
        balance: Math.max(0, inv.total - paid),
      },
    })
  } catch (e) {
    next(e)
  }
})
