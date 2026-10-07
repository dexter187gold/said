import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { db, uid, now, audit } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const platformRouter = Router()
platformRouter.use(requireAuth)

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  user_id TEXT,
  role TEXT NOT NULL DEFAULT 'staff',
  last_used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  address TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_jti TEXT,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS portal_tokens (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`)
  // Seed default feature flags
  const flags = [
    ['client_portal', 0, 'Client self-service portal'],
    ['api_keys', 1, 'API key authentication'],
    ['multi_branch', 0, 'Multi-branch / multi-company'],
    ['whatsapp_business', 0, 'WhatsApp Business API'],
    ['payfast', 0, 'PayFast payment links'],
    ['xero_export', 0, 'Xero export'],
    ['offline_drafts', 1, 'PWA offline drafts'],
    ['popia_strict', 1, 'POPIA strict mode flags'],
  ]
  const ins = db.prepare(
    `INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES (?,?,?,?)`
  )
  const ts = now()
  for (const [k, en, d] of flags) ins.run(k, en, d, ts)
} catch (e) {
  console.warn('platform tables', e.message)
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/** Audit log (admin) */
platformRouter.get('/audit', requireRole('admin'), (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100))
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT ?`
    )
    .all(limit)
  res.json({ data: rows })
})

/** Feature flags */
platformRouter.get('/flags', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM feature_flags ORDER BY key`).all()
  res.json({ data: rows })
})

platformRouter.put('/flags/:key', requireRole('admin'), (req, res) => {
  const enabled = req.body?.enabled ? 1 : 0
  const existing = db.prepare(`SELECT key FROM feature_flags WHERE key = ?`).get(req.params.key)
  if (!existing) return res.status(404).json({ error: true, message: 'Unknown flag' })
  db.prepare(`UPDATE feature_flags SET enabled=?, updated_at=? WHERE key=?`).run(enabled, now(), req.params.key)
  audit(req.user.sub, 'flag.update', `${req.params.key}=${enabled}`, req.ip)
  res.json({ data: db.prepare(`SELECT * FROM feature_flags WHERE key = ?`).get(req.params.key) })
})

/** API keys */
platformRouter.get('/api-keys', requireRole('admin'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, key_prefix, user_id, role, last_used_at, revoked, created_at FROM api_keys ORDER BY created_at DESC`
    )
    .all()
  res.json({ data: rows })
})

platformRouter.post('/api-keys', requireRole('admin'), (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        role: z.enum(['viewer', 'staff', 'admin']).default('staff'),
      })
      .parse(req.body)
    const raw = `said_${crypto.randomBytes(24).toString('hex')}`
    const id = uid()
    db.prepare(
      `INSERT INTO api_keys (id, name, key_hash, key_prefix, user_id, role, revoked, created_at)
       VALUES (?,?,?,?,?,?,0,?)`
    ).run(id, body.name, hashKey(raw), raw.slice(0, 12), req.user.sub, body.role, now())
    audit(req.user.sub, 'api_key.create', body.name, req.ip)
    // Return raw key ONCE
    res.status(201).json({
      data: {
        id,
        name: body.name,
        role: body.role,
        key: raw,
        warning: 'Store this key now — it will not be shown again',
      },
    })
  } catch (e) {
    next(e)
  }
})

platformRouter.post('/api-keys/:id/revoke', requireRole('admin'), (req, res) => {
  const r = db.prepare(`UPDATE api_keys SET revoked=1 WHERE id=?`).run(req.params.id)
  if (!r.changes) return res.status(404).json({ error: true, message: 'Not found' })
  audit(req.user.sub, 'api_key.revoke', req.params.id, req.ip)
  res.json({ data: { ok: true } })
})

/** Branches (multi-branch light) */
platformRouter.get('/branches', (_req, res) => {
  res.json({ data: db.prepare(`SELECT * FROM branches WHERE active=1 ORDER BY name`).all() })
})

platformRouter.post('/branches', requireRole('admin'), (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        code: z.string().optional().nullable(),
        address: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
      })
      .parse(req.body)
    const id = uid()
    db.prepare(
      `INSERT INTO branches (id, name, code, address, phone, active, created_at) VALUES (?,?,?,?,?,1,?)`
    ).run(id, body.name, body.code || null, body.address || null, body.phone || null, now())
    audit(req.user.sub, 'branch.create', body.name, req.ip)
    res.status(201).json({ data: db.prepare(`SELECT * FROM branches WHERE id = ?`).get(id) })
  } catch (e) {
    next(e)
  }
})

platformRouter.patch('/branches/:id', requireRole('admin'), (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().optional(),
        code: z.string().optional().nullable(),
        address: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        active: z.coerce.number().int().min(0).max(1).optional(),
      })
      .parse(req.body || {})
    const ex = db.prepare(`SELECT * FROM branches WHERE id = ?`).get(req.params.id)
    if (!ex) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(
      `UPDATE branches SET name=?, code=?, address=?, phone=?, active=? WHERE id=?`
    ).run(
      body.name ?? ex.name,
      body.code !== undefined ? body.code : ex.code,
      body.address !== undefined ? body.address : ex.address,
      body.phone !== undefined ? body.phone : ex.phone,
      body.active !== undefined ? body.active : ex.active,
      req.params.id
    )
    res.json({ data: db.prepare(`SELECT * FROM branches WHERE id = ?`).get(req.params.id) })
  } catch (e) {
    next(e)
  }
})

/** Sessions list (current user or admin all) */
platformRouter.get('/sessions', (req, res) => {
  const isAdmin = req.user.role === 'admin' || req.user.role === 'owner'
  const rows = isAdmin
    ? db
        .prepare(
          `SELECT s.*, u.email AS user_email FROM sessions s LEFT JOIN users u ON u.id=s.user_id
           ORDER BY s.created_at DESC LIMIT 100`
        )
        .all()
    : db
        .prepare(`SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 20`)
        .all(req.user.sub)
  res.json({ data: rows })
})

platformRouter.post('/sessions/revoke-all', (req, res) => {
  const ts = now()
  db.prepare(`UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`).run(ts, req.user.sub)
  audit(req.user.sub, 'sessions.revoke_all', null, req.ip)
  res.json({ data: { ok: true } })
})

/** Issue client portal token (staff) */
platformRouter.post('/portal-token', requireRole('staff'), (req, res, next) => {
  try {
    const body = z
      .object({
        client_id: z.string().min(1),
        days: z.coerce.number().int().positive().max(90).default(30),
      })
      .parse(req.body)
    const client = db.prepare(`SELECT id, name FROM clients WHERE id = ?`).get(body.client_id)
    if (!client) return res.status(404).json({ error: true, message: 'Client not found' })
    const raw = crypto.randomBytes(32).toString('hex')
    const id = uid()
    const expires = new Date(Date.now() + body.days * 86400000).toISOString()
    db.prepare(
      `INSERT INTO portal_tokens (id, client_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)`
    ).run(id, body.client_id, hashKey(raw), expires, now())
    audit(req.user.sub, 'portal_token.create', client.name, req.ip)
    res.status(201).json({
      data: {
        client_id: body.client_id,
        token: raw,
        expires_at: expires,
        portal_path: `/portal?token=${raw}`,
      },
    })
  } catch (e) {
    next(e)
  }
})

/** POPIA: list clients with consent/flags (uses notes/tags for light flags) */
platformRouter.get('/popia/summary', requireRole('admin'), (_req, res) => {
  const clients = db.prepare(`SELECT COUNT(*) AS c FROM clients`).get().c
  const users = db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c
  const auditCount = db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get().c
  res.json({
    data: {
      clients,
      users,
      audit_events: auditCount,
      popia_strict: db.prepare(`SELECT enabled FROM feature_flags WHERE key='popia_strict'`).get()?.enabled === 1,
      note: 'Use /api/v1/auth/me/export for subject access requests',
    },
  })
})
