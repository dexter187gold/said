import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { db, uid, now, audit } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getRateLimitStats, resetRateLimitStats } from '../middleware/rateLimit.js'
import { verifyWebhookSignature, retryDelivery } from '../services/webhooks.js'

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
    ['branch_required', 0, 'Require branch on staff accounts'],
    ['webhook_hmac', 1, 'Sign webhooks with HMAC-SHA256 when secret set'],
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
  const action = req.query.action
  const q = req.query.q
  let sql = `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id WHERE 1=1`
  const params = []
  if (action) {
    sql += ` AND a.action LIKE ?`
    params.push(`%${action}%`)
  }
  if (q) {
    sql += ` AND (a.detail LIKE ? OR a.action LIKE ? OR u.email LIKE ?)`
    const like = `%${q}%`
    params.push(like, like, like)
  }
  sql += ` ORDER BY a.created_at DESC LIMIT ?`
  params.push(limit)
  const rows = db.prepare(sql).all(...params)
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

/* ─── Hestia-Earth: retention, backups, webhooks, session revoke, monitoring ─── */

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event TEXT NOT NULL,
  status_code INTEGER,
  ok INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS retention_policies (
  key TEXT PRIMARY KEY,
  days INTEGER NOT NULL,
  description TEXT,
  updated_at TEXT
);
`)
  const policies = [
    ['audit_log', 365, 'Audit log retention days'],
    ['otp_codes', 7, 'OTP codes retention'],
    ['payfast_itn_log', 90, 'PayFast ITN log retention'],
    ['offline_queue_log', 30, 'Offline sync log retention'],
    ['document_renders', 180, 'Document render history'],
  ]
  const pins = db.prepare(
    `INSERT OR IGNORE INTO retention_policies (key, days, description, updated_at) VALUES (?,?,?,?)`
  )
  const ts = now()
  for (const [k, d, desc] of policies) pins.run(k, d, desc, ts)
} catch (e) {
  console.warn('hestia tables', e.message)
}

/** Revoke one session */
platformRouter.post('/sessions/:id/revoke', (req, res) => {
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: true, message: 'Not found' })
  if (req.user.role !== 'admin' && row.user_id !== req.user.sub) {
    return res.status(403).json({ error: true, message: 'Forbidden' })
  }
  db.prepare(`UPDATE sessions SET revoked_at=? WHERE id=?`).run(now(), req.params.id)
  audit(req.user.sub, 'session.revoke', req.params.id, req.ip)
  res.json({ data: { ok: true } })
})

/** Retention policies */
platformRouter.get('/retention', requireRole('admin'), (_req, res) => {
  res.json({ data: db.prepare(`SELECT * FROM retention_policies ORDER BY key`).all() })
})

platformRouter.put('/retention/:key', requireRole('admin'), (req, res, next) => {
  try {
    const days = z.coerce.number().int().min(1).max(3650).parse(req.body?.days)
    const ex = db.prepare(`SELECT * FROM retention_policies WHERE key = ?`).get(req.params.key)
    if (!ex) return res.status(404).json({ error: true, message: 'Unknown policy' })
    db.prepare(`UPDATE retention_policies SET days=?, updated_at=? WHERE key=?`).run(days, now(), req.params.key)
    audit(req.user.sub, 'retention.update', `${req.params.key}:${days}`, req.ip)
    res.json({ data: db.prepare(`SELECT * FROM retention_policies WHERE key = ?`).get(req.params.key) })
  } catch (e) {
    next(e)
  }
})

/** Run retention purge (admin) */
platformRouter.post('/retention/purge', requireRole('admin'), (req, res) => {
  const policies = db.prepare(`SELECT * FROM retention_policies`).all()
  const results = {}
  for (const p of policies) {
    const cutoff = new Date(Date.now() - p.days * 86400000).toISOString()
    try {
      if (p.key === 'audit_log') {
        results.audit_log = db.prepare(`DELETE FROM audit_log WHERE created_at < ?`).run(cutoff).changes
      } else if (p.key === 'otp_codes') {
        try {
          results.otp_codes = db.prepare(`DELETE FROM otp_codes WHERE created_at < ?`).run(cutoff).changes
        } catch {
          results.otp_codes = 0
        }
      } else if (p.key === 'payfast_itn_log') {
        try {
          results.payfast_itn_log = db.prepare(`DELETE FROM payfast_itn_log WHERE created_at < ?`).run(cutoff).changes
        } catch {
          results.payfast_itn_log = 0
        }
      } else if (p.key === 'offline_queue_log') {
        try {
          results.offline_queue_log = db.prepare(`DELETE FROM offline_queue_log WHERE created_at < ?`).run(cutoff).changes
        } catch {
          results.offline_queue_log = 0
        }
      } else if (p.key === 'document_renders') {
        try {
          results.document_renders = db.prepare(`DELETE FROM document_renders WHERE created_at < ?`).run(cutoff).changes
        } catch {
          results.document_renders = 0
        }
      }
    } catch (e) {
      results[p.key] = `error: ${e.message}`
    }
  }
  audit(req.user.sub, 'retention.purge', JSON.stringify(results).slice(0, 200), req.ip)
  res.json({ data: { purged: results, at: now() } })
})

/** Backup snapshot — JSON export of core tables (admin) */
platformRouter.get('/backup', requireRole('admin'), (_req, res) => {
  const tables = [
    'company',
    'users',
    'clients',
    'invoices',
    'invoice_lines',
    'payments',
    'tickets',
    'ticket_comments',
    'settings',
    'document_templates',
    'branches',
    'feature_flags',
  ]
  const snapshot = { exported_at: now(), version: 'hestia', tables: {} }
  for (const table of tables) {
    try {
      snapshot.tables[table] = db.prepare(`SELECT * FROM ${table}`).all()
    } catch {
      snapshot.tables[table] = []
    }
  }
  // strip password hashes from users export for safety note — still include for restore
  audit(_req.user?.sub || 'admin', 'backup.export', `tables=${tables.length}`, _req.ip)
  try {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(now())
  } catch {}
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="said-backup-${now().slice(0, 10)}.json"`)
  res.send(JSON.stringify(snapshot, null, 2))
})

/** Backup metadata only (counts) */
platformRouter.get('/backup/status', requireRole('admin'), (_req, res) => {
  const counts = {}
  for (const t of ['clients', 'invoices', 'tickets', 'payments', 'users', 'audit_log']) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c
    } catch {
      counts[t] = 0
    }
  }
  let last_backup_at = null
  try {
    last_backup_at = db.prepare(`SELECT value FROM settings WHERE key='last_backup_at'`).get()?.value || null
  } catch {}
  res.json({ data: { counts, at: now(), last_backup_at } })
})

/** Webhooks CRUD */
platformRouter.get('/webhooks', requireRole('admin'), (_req, res) => {
  res.json({
    data: db.prepare(`SELECT id, url, events, active, created_at FROM webhooks ORDER BY created_at DESC`).all(),
  })
})

platformRouter.post('/webhooks', requireRole('admin'), (req, res, next) => {
  try {
    const body = z
      .object({
        url: z.string().url(),
        events: z.string().min(1), // comma-separated: invoice.paid,ticket.closed
        secret: z.string().optional().nullable(),
      })
      .parse(req.body)
    const id = uid()
    const secret = body.secret || crypto.randomBytes(24).toString('hex')
    db.prepare(
      `INSERT INTO webhooks (id, url, events, secret, active, created_at) VALUES (?,?,?,?,1,?)`
    ).run(id, body.url, body.events, secret, now())
    audit(req.user.sub, 'webhook.create', body.url, req.ip)
    res.status(201).json({
      data: {
        id,
        url: body.url,
        events: body.events,
        secret,
        warning: 'Store the secret now — used for X-SAID-Signature: sha256=…',
      },
    })
  } catch (e) {
    next(e)
  }
})

platformRouter.delete('/webhooks/:id', requireRole('admin'), (req, res) => {
  db.prepare(`DELETE FROM webhooks WHERE id = ?`).run(req.params.id)
  audit(req.user.sub, 'webhook.delete', req.params.id, req.ip)
  res.json({ data: { ok: true } })
})

/** Dispatch webhook event (internal + test) */
platformRouter.post('/webhooks/test', requireRole('admin'), async (req, res) => {
  const event = req.body?.event || 'test.ping'
  const hooks = db.prepare(`SELECT * FROM webhooks WHERE active=1`).all()
  const results = []
  for (const h of hooks) {
    const events = String(h.events || '').split(',').map((s) => s.trim())
    if (!events.includes('*') && !events.includes(event) && event !== 'test.ping') {
      continue
    }
    let ok = 0
    let status_code = 0
    try {
      const r = await fetch(h.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SAID-Event': event,
          'X-SAID-Signature': h.secret || '',
        },
        body: JSON.stringify({
          event,
          at: now(),
          data: req.body?.data || { ping: true },
        }),
        signal: AbortSignal.timeout(8000),
      })
      status_code = r.status
      ok = r.ok ? 1 : 0
    } catch (e) {
      status_code = 0
      ok = 0
    }
    db.prepare(
      `INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, ok, created_at) VALUES (?,?,?,?,?,?)`
    ).run(uid(), h.id, event, status_code, ok, now())
    results.push({ webhook_id: h.id, url: h.url, status_code, ok: !!ok })
  }
  res.json({ data: { event, results } })
})


/** POPIA: anonymise / delete client personal data (admin) */
platformRouter.post('/popia/forget-client/:id', requireRole('admin'), (req, res) => {
  const c = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id)
  if (!c) return res.status(404).json({ error: true, message: 'Not found' })
  db.prepare(
    `UPDATE clients SET name=?, email=NULL, phone=NULL, address=NULL, notes=NULL, vat_number=NULL WHERE id=?`
  ).run(`Redacted ${req.params.id.slice(0, 8)}`, req.params.id)
  audit(req.user.sub, 'popia.forget_client', req.params.id, req.ip)
  res.json({ data: { ok: true, client_id: req.params.id } })
})

/** Monitoring snapshot */
platformRouter.get('/health-detail', requireRole('admin'), (_req, res) => {
  const detail = {
    at: now(),
    users: db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c,
    open_tickets: db
      .prepare(`SELECT COUNT(*) AS c FROM tickets WHERE status IN ('open','in_progress','waiting')`)
      .get().c,
    unpaid_invoices: db
      .prepare(
        `SELECT COUNT(*) AS c FROM invoices WHERE COALESCE(doc_type,'invoice')='invoice' AND status IN ('unpaid','partial','overdue')`
      )
      .get().c,
    audit_24h: db
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE created_at > ?`)
      .get(new Date(Date.now() - 86400000).toISOString()).c,
    api_keys_active: db.prepare(`SELECT COUNT(*) AS c FROM api_keys WHERE revoked=0`).get().c,
    webhooks_active: db.prepare(`SELECT COUNT(*) AS c FROM webhooks WHERE active=1`).get().c,
    sessions_active: db
      .prepare(`SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL`)
      .get().c,
  }
  res.json({ data: detail })
})

/* ─── Hestia-Earth slice 2: restore, branch scope, rate-limit stats ─── */


try {
  db.exec(`ALTER TABLE users ADD COLUMN branch_id TEXT`)
} catch {}
try {
  db.exec(`ALTER TABLE clients ADD COLUMN branch_id TEXT`)
} catch {}
try {
  db.exec(`ALTER TABLE tickets ADD COLUMN branch_id TEXT`)
} catch {}
try {
  db.exec(`ALTER TABLE invoices ADD COLUMN branch_id TEXT`)
} catch {}

platformRouter.get('/rate-limits', requireRole('admin'), (_req, res) => {
  res.json({ data: getRateLimitStats() })
})

platformRouter.post('/rate-limits/reset-stats', requireRole('admin'), (req, res) => {
  resetRateLimitStats()
  audit(req.user.sub, 'ratelimit.stats_reset', null, req.ip)
  res.json({ data: { ok: true } })
})

/**
 * Restore from backup JSON
 * mode: merge (default) — upsert company/settings/clients by id
 * mode: replace_settings — only settings + company
 * Destructive full replace is not supported (safety)
 */
platformRouter.post('/backup/restore', requireRole('admin'), (req, res, next) => {
  try {
    const body = z
      .object({
        snapshot: z.object({
          tables: z.record(z.array(z.any())),
          exported_at: z.string().optional(),
        }),
        mode: z.enum(['merge', 'replace_settings']).default('merge'),
      })
      .parse(req.body)

    const tables = body.snapshot.tables || {}
    const report = { restored: {}, skipped: [] }

    // Always allow company + settings
    if (tables.company?.length) {
      const co = tables.company.find((c) => c.id === 'main') || tables.company[0]
      if (co) {
        db.prepare(
          `UPDATE company SET name=?, email=?, phone=?, vat_number=?, address=?, bank_name=?, account_number=?, branch_code=? WHERE id='main'`
        ).run(
          co.name || null,
          co.email || null,
          co.phone || null,
          co.vat_number || null,
          co.address || null,
          co.bank_name || null,
          co.account_number || null,
          co.branch_code || null
        )
        report.restored.company = 1
      }
    }
    if (tables.settings?.length) {
      const upsert = db.prepare(
        `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      )
      let n = 0
      for (const row of tables.settings) {
        if (row.key != null) {
          upsert.run(row.key, String(row.value ?? ''))
          n++
        }
      }
      report.restored.settings = n
    }

    if (body.mode === 'merge') {
      if (tables.clients?.length) {
        const ins = db.prepare(
          `INSERT INTO clients (id, name, email, phone, address, notes, vat_number, created_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email, phone=excluded.phone,
             address=excluded.address, notes=excluded.notes, vat_number=excluded.vat_number`
        )
        let n = 0
        for (const c of tables.clients) {
          try {
            ins.run(
              c.id,
              c.name || 'Client',
              c.email || null,
              c.phone || null,
              c.address || null,
              c.notes || null,
              c.vat_number || null,
              c.created_at || now()
            )
            n++
          } catch {
            /* skip bad row */
          }
        }
        report.restored.clients = n
      }
      if (tables.branches?.length) {
        const ins = db.prepare(
          `INSERT INTO branches (id, name, code, address, phone, active, created_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, address=excluded.address,
             phone=excluded.phone, active=excluded.active`
        )
        let n = 0
        for (const b of tables.branches) {
          try {
            ins.run(b.id, b.name, b.code || null, b.address || null, b.phone || null, b.active ?? 1, b.created_at || now())
            n++
          } catch {}
        }
        report.restored.branches = n
      }
      if (tables.feature_flags?.length) {
        const ins = db.prepare(
          `INSERT INTO feature_flags (key, enabled, description, updated_at) VALUES (?,?,?,?)
           ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled, description=excluded.description`
        )
        let n = 0
        for (const f of tables.feature_flags) {
          try {
            ins.run(f.key, f.enabled ? 1 : 0, f.description || null, now())
            n++
          } catch {}
        }
        report.restored.feature_flags = n
      }
    } else {
      report.skipped.push('clients', 'branches', 'invoices', 'tickets')
    }

    audit(req.user.sub, 'backup.restore', body.mode, req.ip)
    res.json({ data: report })
  } catch (e) {
    next(e)
  }
})

/** Assign user to branch */
platformRouter.patch('/users/:id/branch', requireRole('admin'), (req, res, next) => {
  try {
    const branch_id = z.string().nullable().optional().parse(req.body?.branch_id ?? null)
    const u = db.prepare(`SELECT id FROM users WHERE id = ?`).get(req.params.id)
    if (!u) return res.status(404).json({ error: true, message: 'User not found' })
    if (branch_id) {
      const b = db.prepare(`SELECT id FROM branches WHERE id = ?`).get(branch_id)
      if (!b) return res.status(400).json({ error: true, message: 'Branch not found' })
    }
    db.prepare(`UPDATE users SET branch_id=? WHERE id=?`).run(branch_id, req.params.id)
    audit(req.user.sub, 'user.branch', `${req.params.id}:${branch_id || 'none'}`, req.ip)
    res.json({ data: { user_id: req.params.id, branch_id } })
  } catch (e) {
    next(e)
  }
})

/** List users with branch (admin) */
platformRouter.get('/users-branches', requireRole('admin'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.branch_id, b.name AS branch_name
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
       ORDER BY u.name`
    )
    .all()
  res.json({ data: rows })
})

/** Branch-scoped counts */
platformRouter.get('/branches/:id/stats', requireRole('staff'), (req, res) => {
  const id = req.params.id
  const clients = db.prepare(`SELECT COUNT(*) AS c FROM clients WHERE branch_id = ?`).get(id).c
  const tickets = db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE branch_id = ?`).get(id).c
  const invoices = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE branch_id = ?`).get(id).c
  const staff = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE branch_id = ?`).get(id).c
  res.json({ data: { branch_id: id, clients, tickets, invoices, staff } })
})

/** Set branch on a client */
platformRouter.patch('/clients/:id/branch', requireRole('staff'), (req, res, next) => {
  try {
    const branch_id = z.string().nullable().optional().parse(req.body?.branch_id ?? null)
    const r = db.prepare(`UPDATE clients SET branch_id=? WHERE id=?`).run(branch_id, req.params.id)
    if (!r.changes) return res.status(404).json({ error: true, message: 'Not found' })
    res.json({ data: { ok: true, branch_id } })
  } catch (e) {
    next(e)
  }
})


/** Test HMAC verification helper for integrators */
platformRouter.post('/webhooks/verify-signature', requireRole('admin'), (req, res) => {
  const body = req.body?.body
  const secret = req.body?.secret || ''
  const signature = req.body?.signature || ''
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  res.json({ data: { valid: verifyWebhookSignature(bodyStr, secret, signature) } })
})

/* ─── Hestia-Earth slice 6: audit CSV, delivery retry, last backup ─── */

platformRouter.get('/audit.csv', requireRole('admin'), (req, res) => {
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 1000))
  const rows = db
    .prepare(
      `SELECT a.created_at, a.action, a.detail, a.ip, u.email AS user_email, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT ?`
    )
    .all(limit)
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = ['created_at,action,detail,ip,user_email,user_name']
  for (const r of rows) {
    lines.push([r.created_at, r.action, r.detail, r.ip, r.user_email, r.user_name].map(esc).join(','))
  }
  audit(req.user.sub, 'audit.export_csv', `rows=${rows.length}`, req.ip)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="said-audit-${now().slice(0, 10)}.csv"`)
  res.send(lines.join('\n'))
})

platformRouter.post('/webhooks/deliveries/:id/retry', requireRole('admin'), async (req, res) => {
  const result = await retryDelivery(req.params.id)
  if (result.error === 'not_found') return res.status(404).json({ error: true, message: 'Delivery not found' })
  if (result.error === 'webhook_inactive') return res.status(400).json({ error: true, message: 'Webhook inactive or missing' })
  audit(req.user.sub, 'webhook.retry', req.params.id, req.ip)
  res.json(result)
})

platformRouter.get('/webhooks/deliveries', requireRole('admin'), (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 40)
  const failed = req.query.failed === '1'
  let sql = `SELECT d.*, w.url AS webhook_url FROM webhook_deliveries d
             LEFT JOIN webhooks w ON w.id = d.webhook_id`
  if (failed) sql += ` WHERE d.ok = 0`
  sql += ` ORDER BY d.created_at DESC LIMIT ?`
  res.json({ data: db.prepare(sql).all(limit) })
})


/* ─── Hestia-Earth next: security scorecard + delivery purge ─── */
platformRouter.get('/security-score', requireRole('admin'), (_req, res) => {
  const checks = []
  const flags = Object.fromEntries(
    db.prepare(`SELECT key, enabled FROM feature_flags`).all().map((r) => [r.key, r.enabled])
  )
  const activeKeys = db.prepare(`SELECT COUNT(*) AS c FROM api_keys WHERE revoked=0`).get().c
  const hooks = db.prepare(`SELECT COUNT(*) AS c FROM webhooks WHERE active=1`).get().c
  const hooksWithSecret = db.prepare(`SELECT COUNT(*) AS c FROM webhooks WHERE active=1 AND secret IS NOT NULL AND secret != ''`).get().c
  const staffNoBranch = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role='staff' AND (branch_id IS NULL OR branch_id='')`).get().c
  const lastBackup = db.prepare(`SELECT value FROM settings WHERE key='last_backup_at'`).get()?.value
  const sessions = db.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL`).get().c

  const add = (id, ok, label, hint) => checks.push({ id, ok: !!ok, label, hint })
  add('popia', flags.popia_strict === 1, 'POPIA strict flag on', 'Enable popia_strict in Feature flags')
  add('backup', !!lastBackup, 'Backup taken', 'Download a JSON backup from Platform → Backup')
  add('webhook_secrets', hooks === 0 || hooksWithSecret === hooks, 'Webhook secrets set', 'Re-create hooks so secrets auto-generate')
  add('branch_policy', flags.branch_required !== 1 || staffNoBranch === 0, 'Branch policy healthy', 'Assign branches or disable branch_required')
  add('api_keys', true, `Active API keys: ${activeKeys}`, null)
  add('sessions', sessions < 50, 'Session count reasonable', 'Revoke stale sessions')
  let svcCount = 0
  try { svcCount = db.prepare(`SELECT COUNT(*) AS c FROM service_catalog WHERE active=1`).get().c } catch {}
  add('services', svcCount >= 2, `Service catalogue (${svcCount})`, 'Open Templates to seed Remote/On-site services')
  let fail24 = 0
  try {
    fail24 = db.prepare(
      `SELECT COUNT(*) AS c FROM audit_log WHERE created_at >= ? AND (
         action LIKE '%login%fail%' OR action = 'auth.failed' OR detail LIKE '%failed login%'
       )`
    ).get(new Date(Date.now() - 86400000).toISOString()).c
  } catch {}
  add('failed_logins', fail24 < 20, `Failed logins (24h): ${fail24}`, 'Review Platform → Security if high')

  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100)
  res.json({ data: { score, checks, last_backup_at: lastBackup || null, at: now() } })
})

platformRouter.post('/webhooks/deliveries/purge', requireRole('admin'), (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.body?.days) || 30))
  const cutoff = new Date(Date.now() - days * 86400000).toISOString()
  const r = db.prepare(`DELETE FROM webhook_deliveries WHERE created_at < ?`).run(cutoff)
  audit(req.user.sub, 'webhook.deliveries_purge', `days=${days}:deleted=${r.changes}`, req.ip)
  res.json({ data: { deleted: r.changes, older_than_days: days } })
})


platformRouter.get('/login-history', requireRole('admin'), (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 40)
  const rows = db
    .prepare(
      `SELECT a.*, u.email AS user_email, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action LIKE 'login%'
       ORDER BY a.created_at DESC LIMIT ?`
    )
    .all(limit)
  res.json({ data: rows })
})


platformRouter.get('/failed-logins', requireRole('admin'), (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 40)
  const rows = db
    .prepare(
      `SELECT a.*, u.email AS user_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action LIKE '%login%fail%' OR a.action LIKE 'login.fail%' OR a.action = 'auth.failed'
          OR a.detail LIKE '%failed login%' OR a.detail LIKE '%invalid password%'
       ORDER BY a.created_at DESC LIMIT ?`
    )
    .all(limit)
  const last24 = db
    .prepare(
      `SELECT COUNT(*) AS c FROM audit_log
       WHERE created_at >= ? AND (
         action LIKE '%login%fail%' OR action LIKE 'login.fail%' OR action = 'auth.failed'
         OR detail LIKE '%failed login%'
       )`
    )
    .get(new Date(Date.now() - 86400000).toISOString())
  res.json({ data: { events: rows, failed_last_24h: last24.c } })
})


platformRouter.post('/sessions/revoke-others', requireRole('staff'), (req, res) => {
  const current = req.headers.authorization?.replace(/^Bearer\s+/i, '') || ''
  // revoke all sessions for this user except we only store session rows
  const r = db
    .prepare(
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`
    )
    .run(now(), req.user.sub)
  audit(req.user.sub, 'session.revoke_others', `count=${r.changes}`, req.ip)
  res.json({ data: { revoked: r.changes, note: 'All listed sessions revoked — sign in again on other devices' } })
})

platformRouter.post('/sessions/revoke-all-staff', requireRole('admin'), (req, res) => {
  const r = db.prepare(`UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL`).run(now())
  audit(req.user.sub, 'session.revoke_all', `count=${r.changes}`, req.ip)
  res.json({ data: { revoked: r.changes } })
})


platformRouter.get('/ops-health', requireRole('admin'), (_req, res) => {
  const tables = ['clients', 'invoices', 'tickets', 'payments', 'users', 'sessions']
  const counts = {}
  for (const table of tables) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c
    } catch {
      counts[table] = null
    }
  }
  let appointments = 0
  try {
    appointments = db.prepare(`SELECT COUNT(*) AS c FROM appointments`).get().c
  } catch {}
  res.json({
    data: {
      ok: true,
      at: now(),
      counts,
      appointments,
      version: '2.8.0-mythos6',
    },
  })
})
