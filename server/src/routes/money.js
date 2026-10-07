/**
 * Hermes-Metal — Flow & money
 * Payments ledger, EFT refs, dunning WhatsApp, CSV exports
 */
import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now, audit } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { sendAppEmail } from '../services/mail.js'

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

/* ─── Hermes-Metal slice 2: deposits, PayFast, Xero export ─── */

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS client_deposits (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT DEFAULT 'EFT',
  date TEXT NOT NULL,
  note TEXT,
  applied_invoice_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deposits_client ON client_deposits(client_id);
`)
} catch (e) {
  console.warn('client_deposits', e.message)
}

function getSetting(key, fallback = '') {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)
    return row?.value != null ? row.value : fallback
  } catch {
    return fallback
  }
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, String(value))
}

/** PayFast merchant settings */
moneyRouter.get('/payfast/config', requireRole('admin'), (_req, res) => {
  res.json({
    data: {
      merchant_id: getSetting('payfast_merchant_id', ''),
      merchant_key: getSetting('payfast_merchant_key', '') ? '••••••••' : '',
      passphrase_set: !!getSetting('payfast_passphrase', ''),
      sandbox: getSetting('payfast_sandbox', '1') === '1',
      return_url: getSetting('payfast_return_url', ''),
      cancel_url: getSetting('payfast_cancel_url', ''),
      notify_url: getSetting('payfast_notify_url', ''),
    },
  })
})

moneyRouter.put('/payfast/config', requireRole('admin'), (req, res, next) => {
  try {
    const body = z
      .object({
        merchant_id: z.string().optional(),
        merchant_key: z.string().optional(),
        passphrase: z.string().optional(),
        sandbox: z.boolean().optional(),
        return_url: z.string().optional(),
        cancel_url: z.string().optional(),
        notify_url: z.string().optional(),
      })
      .parse(req.body || {})
    if (body.merchant_id != null) setSetting('payfast_merchant_id', body.merchant_id)
    if (body.merchant_key != null && body.merchant_key !== '••••••••') setSetting('payfast_merchant_key', body.merchant_key)
    if (body.passphrase != null && body.passphrase !== '') setSetting('payfast_passphrase', body.passphrase)
    if (body.sandbox != null) setSetting('payfast_sandbox', body.sandbox ? '1' : '0')
    if (body.return_url != null) setSetting('payfast_return_url', body.return_url)
    if (body.cancel_url != null) setSetting('payfast_cancel_url', body.cancel_url)
    if (body.notify_url != null) setSetting('payfast_notify_url', body.notify_url)
    audit(req.user.sub, 'payfast.config', null, req.ip)
    res.json({ data: { ok: true } })
  } catch (e) {
    next(e)
  }
})

/**
 * Build PayFast checkout fields for an invoice (sandbox or live).
 * Client posts these as a form to PayFast — signature optional when passphrase set.
 */
moneyRouter.get('/payfast/link/:invoiceId', (req, res) => {
  const inv = db
    .prepare(
      `SELECT i.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
    )
    .get(req.params.invoiceId)
  if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
  const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))
  if (balance < 0.01) return res.status(400).json({ error: true, message: 'Invoice already paid' })

  const merchant_id = getSetting('payfast_merchant_id', '')
  const merchant_key = getSetting('payfast_merchant_key', '')
  const sandbox = getSetting('payfast_sandbox', '1') === '1'
  const host = sandbox ? 'https://sandbox.payfast.co.za/eng/process' : 'https://www.payfast.co.za/eng/process'

  const fields = {
    merchant_id: merchant_id || '10000100',
    merchant_key: merchant_key || '46f0cd694581a',
    return_url: getSetting('payfast_return_url', '') || '',
    cancel_url: getSetting('payfast_cancel_url', '') || '',
    notify_url: getSetting('payfast_notify_url', '') || '',
    name_first: (inv.client_name || 'Customer').split(/\s+/)[0],
    name_last: (inv.client_name || '').split(/\s+/).slice(1).join(' ') || 'Client',
    email_address: inv.client_email || '',
    m_payment_id: inv.number,
    amount: balance.toFixed(2),
    item_name: `Invoice ${inv.number}`,
    item_description: inv.devices || inv.service_type || `Payment for ${inv.number}`,
  }

  // Simple query-string link (signature skipped for sandbox demo; production should sign)
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) {
    if (v) params.set(k, v)
  }
  const url = `${host}?${params.toString()}`

  res.json({
    data: {
      url,
      host,
      fields,
      sandbox,
      balance,
      invoice_number: inv.number,
      configured: !!(merchant_id && merchant_key),
      note: merchant_id
        ? 'Open URL or POST fields to PayFast to collect payment'
        : 'Using PayFast sandbox demo merchant — set merchant_id/key in Money → PayFast',
    },
  })
})

/** List client deposits */
moneyRouter.get('/deposits', (req, res) => {
  const clientId = req.query.client_id
  let rows
  if (clientId) {
    rows = db
      .prepare(
        `SELECT d.*, c.name AS client_name, i.number AS applied_invoice_number
         FROM client_deposits d
         LEFT JOIN clients c ON c.id = d.client_id
         LEFT JOIN invoices i ON i.id = d.applied_invoice_id
         WHERE d.client_id = ?
         ORDER BY d.date DESC`
      )
      .all(clientId)
  } else {
    rows = db
      .prepare(
        `SELECT d.*, c.name AS client_name, i.number AS applied_invoice_number
         FROM client_deposits d
         LEFT JOIN clients c ON c.id = d.client_id
         LEFT JOIN invoices i ON i.id = d.applied_invoice_id
         ORDER BY d.date DESC LIMIT 100`
      )
      .all()
  }
  const unapplied = rows.filter((r) => !r.applied_invoice_id).reduce((s, r) => s + Number(r.amount || 0), 0)
  res.json({ data: rows, unapplied_total: unapplied })
})

moneyRouter.post('/deposits', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        client_id: z.string().min(1),
        amount: z.coerce.number().positive(),
        method: z.string().default('EFT'),
        date: z.string().optional(),
        note: z.string().optional().nullable(),
      })
      .parse(req.body)
    const client = db.prepare(`SELECT id, name FROM clients WHERE id = ?`).get(body.client_id)
    if (!client) return res.status(404).json({ error: true, message: 'Client not found' })
    const id = uid()
    const date = body.date || now().slice(0, 10)
    db.prepare(
      `INSERT INTO client_deposits (id, client_id, amount, method, date, note, applied_invoice_id, created_by, created_at)
       VALUES (?,?,?,?,?,?,NULL,?,?)`
    ).run(id, body.client_id, body.amount, body.method || 'EFT', date, body.note || null, req.user.sub, now())
    audit(req.user.sub, 'deposit.create', `${client.name}:${body.amount}`, req.ip)
    res.status(201).json({ data: db.prepare(`SELECT * FROM client_deposits WHERE id = ?`).get(id) })
  } catch (e) {
    next(e)
  }
})

/** Apply unapplied deposit to an invoice as a payment */
moneyRouter.post('/deposits/:id/apply', requireRole('staff'), (req, res, next) => {
  try {
    const invoiceId = z.string().min(1).parse(req.body?.invoice_id)
    const dep = db.prepare(`SELECT * FROM client_deposits WHERE id = ?`).get(req.params.id)
    if (!dep) return res.status(404).json({ error: true, message: 'Deposit not found' })
    if (dep.applied_invoice_id) return res.status(400).json({ error: true, message: 'Deposit already applied' })
    const inv = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId)
    if (!inv) return res.status(404).json({ error: true, message: 'Invoice not found' })
    if (inv.client_id !== dep.client_id) {
      return res.status(400).json({ error: true, message: 'Deposit client must match invoice client' })
    }
    const amount = Number(dep.amount)
    db.prepare(
      `INSERT INTO payments (id, invoice_id, amount, method, date, note, created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(uid(), invoiceId, amount, dep.method || 'Deposit', dep.date, `Applied deposit ${dep.id.slice(0, 8)}`, now())
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?`).get(invoiceId).s
    let status = 'unpaid'
    if (paid >= inv.total - 0.009) status = 'paid'
    else if (paid > 0) status = 'partial'
    db.prepare(`UPDATE invoices SET amount_paid=?, status=?, updated_at=? WHERE id=?`).run(paid, status, now(), invoiceId)
    db.prepare(`UPDATE client_deposits SET applied_invoice_id = ? WHERE id = ?`).run(invoiceId, dep.id)
    audit(req.user.sub, 'deposit.apply', `${dep.id}→${inv.number}`, req.ip)
    res.json({ data: { ok: true, amount_paid: paid, status, balance: Math.max(0, inv.total - paid) } })
  } catch (e) {
    next(e)
  }
})

/**
 * Xero-style invoice CSV (importable into many ledgers)
 * Columns align with common Xero invoice import mapping
 */
moneyRouter.get('/export/xero-invoices.csv', requireRole('staff'), (req, res) => {
  const type = req.query.type || 'invoice'
  const rows = db
    .prepare(
      `SELECT i.*, c.name AS client_name, c.email AS client_email, c.address AS client_address
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       WHERE COALESCE(i.doc_type,'invoice') = ?
       ORDER BY i.date DESC`
    )
    .all(type)
  const header =
    'ContactName,EmailAddress,InvoiceNumber,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType,Currency,Reference\n'
  const lines = []
  for (const inv of rows) {
    const items = db.prepare(`SELECT * FROM invoice_lines WHERE invoice_id = ?`).all(inv.id)
    const list = items.length
      ? items
      : [{ description: inv.notes || inv.number, qty: 1, price: inv.exclusive || inv.total }]
    for (const l of list) {
      lines.push(
        [
          csv(inv.client_name),
          csv(inv.client_email),
          inv.number,
          inv.date,
          inv.due_date || inv.date,
          csv(l.description),
          l.qty,
          Number(l.price || 0).toFixed(2),
          '200',
          'TAX001',
          'ZAR',
          csv(inv.po_number || inv.number),
        ].join(',')
      )
    }
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="said-xero-${type}s-${now().slice(0, 10)}.csv"`)
  res.send(header + lines.join('\n'))
})

/** SnapScan-style deep link stub (amount in cents, id as ref) */
moneyRouter.get('/snapscan/:invoiceId', (req, res) => {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(req.params.invoiceId)
  if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
  const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))
  const cents = Math.round(balance * 100)
  const id = getSetting('snapscan_id', '')
  const url = id
    ? `https://pos.snapscan.io/qr/${encodeURIComponent(id)}?id=${encodeURIComponent(inv.number)}&amount=${cents}`
    : null
  res.json({
    data: {
      url,
      amount_cents: cents,
      reference: inv.number,
      configured: !!id,
      note: id ? 'Open SnapScan QR link' : 'Set snapscan_id in settings to enable',
    },
  })
})

/* ─── Hermes-Metal slice 3: ITN, email dunning, retainers, SnapScan config ─── */


try {
  db.exec(`
CREATE TABLE IF NOT EXISTS retainer_schedules (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  amount REAL NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 30,
  next_run TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  last_invoice_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payfast_itn_log (
  id TEXT PRIMARY KEY,
  payload TEXT,
  m_payment_id TEXT,
  payment_status TEXT,
  amount_gross TEXT,
  processed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
`)
} catch (e) {
  console.warn('slice3 tables', e.message)
}

/** SnapScan merchant id setting */
moneyRouter.get('/snapscan/config', requireRole('admin'), (_req, res) => {
  res.json({ data: { snapscan_id: getSetting('snapscan_id', '') } })
})

moneyRouter.put('/snapscan/config', requireRole('admin'), (req, res, next) => {
  try {
    const id = z.string().parse(req.body?.snapscan_id ?? '')
    setSetting('snapscan_id', id)
    audit(req.user.sub, 'snapscan.config', null, req.ip)
    res.json({ data: { snapscan_id: id } })
  } catch (e) {
    next(e)
  }
})

/** Email dunning (uses SMTP if configured; otherwise stubs to logs) */
moneyRouter.post('/dunning/:invoiceId/email', requireRole('staff'), async (req, res, next) => {
  try {
    const stage = z.enum(['friendly', 'followup', 'final']).default('friendly').parse(req.body?.stage || 'friendly')
    const inv = db
      .prepare(
        `SELECT i.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
      )
      .get(req.params.invoiceId)
    if (!inv) return res.status(404).json({ error: true, message: 'Not found' })
    if (!inv.client_email) {
      return res.status(400).json({ error: true, message: 'Client has no email address' })
    }
    const co = db.prepare(`SELECT * FROM company WHERE id = 'main'`).get() || {}
    const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))
    const subjects = {
      friendly: `Reminder: invoice ${inv.number} — ${moneyFmt(balance)}`,
      followup: `Follow-up: invoice ${inv.number} outstanding`,
      final: `Final notice: invoice ${inv.number}`,
    }
    const bodies = {
      friendly:
        `Hi ${inv.client_name || 'there'},\n\n` +
        `This is a friendly reminder that invoice ${inv.number} has an open balance of ${moneyFmt(balance)}` +
        (inv.due_date ? ` (due ${inv.due_date})` : '') +
        `.\n\nBank: ${co.bank_name || '—'} · Acc ${co.account_number || '—'} · Branch ${co.branch_code || '—'} · Ref ${inv.number}\n\n` +
        `If you have already paid, please send proof of payment.\n\nThank you,\n${co.name || 'SAID'}`,
      followup:
        `Hi ${inv.client_name || 'there'},\n\n` +
        `We are following up on invoice ${inv.number}. Balance still outstanding: ${moneyFmt(balance)}.\n` +
        `Please settle at your earliest convenience.\n\nRef: ${inv.number}\n\n${co.name || 'SAID'}`,
      final:
        `Hi ${inv.client_name || 'there'},\n\n` +
        `Final notice regarding invoice ${inv.number} — ${moneyFmt(balance)} outstanding.\n` +
        `Please settle within 7 days to avoid further collection steps.\n\nRef: ${inv.number}\n\n${co.name || 'SAID'}`,
    }
    const mail = await sendAppEmail({
      to: inv.client_email,
      subject: subjects[stage],
      text: bodies[stage],
    })
    try {
      db.prepare(
        `INSERT INTO payment_reminders (id, invoice_id, channel, sent_at, note, created_by) VALUES (?,?,?,?,?,?)`
      ).run(uid(), inv.id, 'email', now(), stage, req.user.sub)
    } catch {}
    db.prepare(`UPDATE invoices SET reminder_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), inv.id)
    audit(req.user.sub, 'dunning.email', `${inv.number}:${stage}`, req.ip)
    res.json({ data: { ok: true, delivered: mail.delivered, stub: !!mail.stub, stage, to: inv.client_email } })
  } catch (e) {
    next(e)
  }
})

/** Bulk email dunning for open invoices past due */
moneyRouter.post('/dunning/bulk-email', requireRole('staff'), async (req, res, next) => {
  try {
    const stage = z.enum(['friendly', 'followup', 'final']).default('friendly').parse(req.body?.stage || 'friendly')
    const rows = db
      .prepare(
        `SELECT i.id FROM invoices i
         WHERE COALESCE(i.doc_type,'invoice')='invoice'
           AND i.status IN ('unpaid','partial','overdue')
           AND (i.total - i.amount_paid) > 0.009
           AND i.due_date IS NOT NULL AND i.due_date < date('now')
         LIMIT 30`
      )
      .all()
    let sent = 0
    const errors = []
    for (const r of rows) {
      try {
        // reuse by calling logic inline via fetch to self is heavy — duplicate minimal path
        const inv = db
          .prepare(
            `SELECT i.*, c.name AS client_name, c.email AS client_email
             FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
          )
          .get(r.id)
        if (!inv?.client_email) continue
        const co = db.prepare(`SELECT name, bank_name, account_number, branch_code FROM company WHERE id = 'main'`).get() || {}
        const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))
        await sendAppEmail({
          to: inv.client_email,
          subject: `Reminder: invoice ${inv.number} — ${moneyFmt(balance)}`,
          text:
            `Hi ${inv.client_name || 'there'},\n\nInvoice ${inv.number} balance ${moneyFmt(balance)}.\n` +
            `Ref ${inv.number}. Bank ${co.bank_name || ''} ${co.account_number || ''}.\n\n${co.name || 'SAID'}`,
        })
        try {
          db.prepare(
            `INSERT INTO payment_reminders (id, invoice_id, channel, sent_at, note, created_by) VALUES (?,?,?,?,?,?)`
          ).run(uid(), inv.id, 'email', now(), stage, req.user.sub)
        } catch {}
        sent++
      } catch (err) {
        errors.push(err.message)
      }
    }
    res.json({ data: { sent, candidates: rows.length, errors: errors.slice(0, 5) } })
  } catch (e) {
    next(e)
  }
})

/** Retainer schedules CRUD */
moneyRouter.get('/retainers', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS client_name
       FROM retainer_schedules r
       LEFT JOIN clients c ON c.id = r.client_id
       ORDER BY r.active DESC, r.next_run ASC`
    )
    .all()
  res.json({ data: rows })
})

moneyRouter.post('/retainers', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        client_id: z.string().min(1),
        amount: z.coerce.number().positive(),
        interval_days: z.coerce.number().int().positive().default(30),
        next_run: z.string().optional(),
        description: z.string().optional().nullable(),
      })
      .parse(req.body)
    const client = db.prepare(`SELECT id FROM clients WHERE id = ?`).get(body.client_id)
    if (!client) return res.status(404).json({ error: true, message: 'Client not found' })
    const id = uid()
    const nextRun = body.next_run || now().slice(0, 10)
    db.prepare(
      `INSERT INTO retainer_schedules (id, client_id, amount, interval_days, next_run, active, description, created_by, created_at)
       VALUES (?,?,?,?,?,1,?,?,?)`
    ).run(id, body.client_id, body.amount, body.interval_days, nextRun, body.description || 'Retainer', req.user.sub, now())
    res.status(201).json({ data: db.prepare(`SELECT * FROM retainer_schedules WHERE id = ?`).get(id) })
  } catch (e) {
    next(e)
  }
})

moneyRouter.patch('/retainers/:id', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        active: z.coerce.number().int().min(0).max(1).optional(),
        amount: z.coerce.number().positive().optional(),
        interval_days: z.coerce.number().int().positive().optional(),
        next_run: z.string().optional(),
        description: z.string().optional().nullable(),
      })
      .parse(req.body || {})
    const ex = db.prepare(`SELECT * FROM retainer_schedules WHERE id = ?`).get(req.params.id)
    if (!ex) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(
      `UPDATE retainer_schedules SET active=?, amount=?, interval_days=?, next_run=?, description=? WHERE id=?`
    ).run(
      body.active !== undefined ? body.active : ex.active,
      body.amount ?? ex.amount,
      body.interval_days ?? ex.interval_days,
      body.next_run ?? ex.next_run,
      body.description !== undefined ? body.description : ex.description,
      req.params.id
    )
    res.json({ data: db.prepare(`SELECT * FROM retainer_schedules WHERE id = ?`).get(req.params.id) })
  } catch (e) {
    next(e)
  }
})

/** Run due retainers → create invoices */
moneyRouter.post('/retainers/run', requireRole('staff'), (req, res, next) => {
  try {
    const today = now().slice(0, 10)
    const due = db
      .prepare(`SELECT * FROM retainer_schedules WHERE active = 1 AND next_run <= ?`)
      .all(today)
    const created = []
    for (const r of due) {
      const invId = uid()
      const y = new Date().getFullYear()
      const c = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE number LIKE ?`).get(`INV-${y}-%`).c
      const number = `INV-${y}-${String(c + 1).padStart(4, '0')}`
      const desc = r.description || 'Retainer'
      const exclusive = Number(r.amount)
      const vat = Math.round(exclusive * 0.15 * 100) / 100
      const total = Math.round((exclusive + vat) * 100) / 100
      const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      db.prepare(
        `INSERT INTO invoices (
          id, number, client_id, date, due_date, status, notes, exclusive, vat_amount, total, amount_paid,
          created_by, created_at, updated_at, doc_type, payment_note
        ) VALUES (?,?,?,?,?,'unpaid',?,?,?,?,0,?,?,?,'invoice',?)`
      ).run(
        invId,
        number,
        r.client_id,
        today,
        dueDate,
        `Auto retainer · schedule ${r.id.slice(0, 8)}`,
        exclusive,
        vat,
        total,
        req.user.sub,
        now(),
        now(),
        'Retainer payment due on completion terms.'
      )
      db.prepare(
        `INSERT INTO invoice_lines (id, invoice_id, description, qty, price, discount) VALUES (?,?,?,?,?,0)`
      ).run(uid(), invId, desc, 1, exclusive)
      const next = new Date(r.next_run)
      next.setDate(next.getDate() + Number(r.interval_days || 30))
      db.prepare(`UPDATE retainer_schedules SET next_run=?, last_invoice_id=? WHERE id=?`).run(
        next.toISOString().slice(0, 10),
        invId,
        r.id
      )
      created.push({ schedule_id: r.id, invoice_id: invId, number })
    }
    audit(req.user.sub, 'retainers.run', `created=${created.length}`, req.ip)
    res.json({ data: { created, count: created.length } })
  } catch (e) {
    next(e)
  }
})

/**
 * PayFast ITN (Instant Transaction Notification) — public handler
 * Validates payment_status COMPLETE and marks invoice paid by m_payment_id (invoice number)
 */
export async function handlePayfastItn(req, res) {
  try {
    const body = req.body || {}
    const logId = uid()
    db.prepare(
      `INSERT INTO payfast_itn_log (id, payload, m_payment_id, payment_status, amount_gross, processed, created_at)
       VALUES (?,?,?,?,?,0,?)`
    ).run(
      logId,
      JSON.stringify(body).slice(0, 8000),
      body.m_payment_id || null,
      body.payment_status || null,
      body.amount_gross || null,
      now()
    )

    const status = String(body.payment_status || '').toUpperCase()
    const mPaymentId = body.m_payment_id
    if (status !== 'COMPLETE' || !mPaymentId) {
      return res.status(200).send('OK')
    }

    const inv = db.prepare(`SELECT * FROM invoices WHERE number = ?`).get(mPaymentId)
    if (!inv) {
      console.warn('[PayFast ITN] unknown invoice', mPaymentId)
      return res.status(200).send('OK')
    }

    const amount = Number(body.amount_gross || 0)
    if (amount > 0) {
      // avoid double-apply same pf_payment_id
      const pfId = body.pf_payment_id || body.uuid || ''
      if (pfId) {
        const exists = db
          .prepare(`SELECT id FROM payments WHERE note LIKE ? LIMIT 1`)
          .get(`%pf:${pfId}%`)
        if (exists) return res.status(200).send('OK')
      }
      db.prepare(
        `INSERT INTO payments (id, invoice_id, amount, method, date, note, created_at) VALUES (?,?,?,?,?,?,?)`
      ).run(
        uid(),
        inv.id,
        amount,
        'PayFast',
        now().slice(0, 10),
        `PayFast ITN${pfId ? ` pf:${pfId}` : ''}`,
        now()
      )
      const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?`).get(inv.id).s
      let st = 'unpaid'
      if (paid >= inv.total - 0.009) st = 'paid'
      else if (paid > 0) st = 'partial'
      db.prepare(`UPDATE invoices SET amount_paid=?, status=?, updated_at=? WHERE id=?`).run(paid, st, now(), inv.id)
      db.prepare(`UPDATE payfast_itn_log SET processed = 1 WHERE id = ?`).run(logId)
    }
    res.status(200).send('OK')
  } catch (e) {
    console.error('[PayFast ITN]', e.message)
    res.status(200).send('OK') // always 200 so PayFast does not retry forever incorrectly
  }
}
