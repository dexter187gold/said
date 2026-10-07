import { Router } from 'express'
import crypto from 'crypto'
import { db } from '../db.js'
import { rateLimit } from '../middleware/rateLimit.js'

export const portalRouter = Router()

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function resolveClient(token) {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT pt.*, c.name, c.email, c.phone, c.address
       FROM portal_tokens pt
       JOIN clients c ON c.id = pt.client_id
       WHERE pt.token_hash = ? AND pt.expires_at > datetime('now')`
    )
    .get(hashKey(token))
  return row || null
}

portalRouter.use(rateLimit({ windowMs: 60_000, max: 60 }))

/** GET /api/v1/portal/me?token= */
portalRouter.get('/me', (req, res) => {
  const t = resolveClient(req.query.token || req.headers['x-portal-token'])
  if (!t) return res.status(401).json({ error: true, message: 'Invalid or expired portal token' })
  res.json({
    data: {
      client_id: t.client_id,
      name: t.name,
      email: t.email,
      phone: t.phone,
      expires_at: t.expires_at,
    },
  })
})

portalRouter.get('/invoices', (req, res) => {
  const t = resolveClient(req.query.token || req.headers['x-portal-token'])
  if (!t) return res.status(401).json({ error: true, message: 'Invalid or expired portal token' })
  const rows = db
    .prepare(
      `SELECT id, number, date, due_date, status, total, amount_paid, doc_type
       FROM invoices WHERE client_id = ? AND COALESCE(doc_type,'invoice') IN ('invoice','quote')
       ORDER BY date DESC LIMIT 50`
    )
    .all(t.client_id)
  res.json({ data: rows })
})

portalRouter.get('/tickets', (req, res) => {
  const t = resolveClient(req.query.token || req.headers['x-portal-token'])
  if (!t) return res.status(401).json({ error: true, message: 'Invalid or expired portal token' })
  const rows = db
    .prepare(
      `SELECT id, title, status, priority, category, created_at, updated_at, resolved_at
       FROM tickets WHERE client_id = ? AND COALESCE(is_template,0)=0
       ORDER BY updated_at DESC LIMIT 30`
    )
    .all(t.client_id)
  res.json({ data: rows })
})
