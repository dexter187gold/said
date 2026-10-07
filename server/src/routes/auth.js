import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db, uid, now, audit, getDbPath, getBootstrapPath, saveBootstrapSnapshot } from '../db.js'
import { signToken, requireAuth } from '../middleware/auth.js'
import { sendOtpEmail } from '../services/mail.js'

export const authRouter = Router()

const emailSchema = z.string().email().max(180).transform((s) => s.trim().toLowerCase())
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password needs a letter')
  .regex(/[0-9]/, 'Password needs a number')
const nameSchema = z.string().min(2, 'Name is required').max(80).transform((s) => s.trim())

function publicUser(row) {
  if (!row) return null
  return {
    id: row.id, email: row.email, name: row.name, role: row.role,
    email_verified: !!row.email_verified, oauth_provider: row.oauth_provider || null,
    two_fa_enabled: !!row.two_fa_enabled, locale: row.locale || 'en',
    last_login_at: row.last_login_at || null, created_at: row.created_at,
  }
}

function companySetupStatus() {
  const co = db.prepare('SELECT * FROM company WHERE id = ?').get('main')
  if (!co) return { setup_complete: false, company: null }
  return { setup_complete: Number(co.setup_complete) === 1, company: co }
}

function issueOtp(email, purpose) {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const id = uid()
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  db.prepare('DELETE FROM otp_codes WHERE email = ? AND purpose = ?').run(email, purpose)
  db.prepare(`INSERT INTO otp_codes (id, email, code, purpose, attempts, expires_at, created_at) VALUES (?,?,?,?,0,?,?)`)
    .run(id, email, code, purpose, expires, now())
  return { code, expires }
}

async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw Object.assign(new Error('Google OAuth is not configured (GOOGLE_CLIENT_ID)'), { status: 503 })
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
  if (!res.ok) throw Object.assign(new Error('Invalid Google token'), { status: 401 })
  const payload = await res.json()
  if (payload.aud !== clientId) throw Object.assign(new Error('Google token audience mismatch'), { status: 401 })
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    throw Object.assign(new Error('Google email not verified'), { status: 401 })
  }
  return { email: String(payload.email).toLowerCase(), name: payload.name || payload.email, sub: payload.sub }
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const body = z.object({ email: emailSchema, password: passwordSchema, name: nameSchema, phone: z.string().max(30).optional().nullable() }).parse(req.body)
    const exists = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(body.email)
    if (exists?.email_verified) return res.status(409).json({ error: true, message: 'An account with this email already exists. Sign in instead.' })
    const hash = bcrypt.hashSync(body.password, 10)
    if (exists) db.prepare('UPDATE users SET password_hash=?, name=?, phone=? WHERE id=?').run(hash, body.name, body.phone || null, exists.id)
    else db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, email_verified, phone) VALUES (?,?,?,?, 'owner', ?, 0, ?)`).run(uid(), body.email, body.name, hash, now(), body.phone || null)
    const { code } = issueOtp(body.email, 'register')
    const mail = await sendOtpEmail(body.email, code, 'register')
    res.status(201).json({ data: { email: body.email, otp_sent: true, delivered: mail.delivered, ...(mail.devCode ? { dev_otp: mail.devCode } : {}), message: 'Check your email for a 6-digit verification code.' } })
  } catch (e) { next(e) }
})

authRouter.post('/otp/send', async (req, res, next) => {
  try {
    const body = z.object({ email: emailSchema, purpose: z.enum(['register', 'login', 'reset']).default('register') }).parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    if (!user && body.purpose !== 'register') return res.status(404).json({ error: true, message: 'No account found for this email' })
    const { code } = issueOtp(body.email, body.purpose)
    const mail = await sendOtpEmail(body.email, code, body.purpose)
    res.json({ data: { email: body.email, otp_sent: true, delivered: mail.delivered, ...(mail.devCode ? { dev_otp: mail.devCode } : {}) } })
  } catch (e) { next(e) }
})

authRouter.post('/otp/verify', async (req, res, next) => {
  try {
    const body = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'), purpose: z.enum(['register', 'login', 'reset']).default('register') }).parse(req.body)
    const row = db.prepare('SELECT * FROM otp_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1').get(body.email, body.purpose)
    if (!row) return res.status(400).json({ error: true, message: 'No code found. Request a new one.' })
    if (row.attempts >= 5) return res.status(429).json({ error: true, message: 'Too many attempts. Request a new code.' })
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: true, message: 'Code expired. Request a new one.' })
    if (row.code !== body.code) {
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
      return res.status(400).json({ error: true, message: 'Incorrect code' })
    }
    db.prepare('DELETE FROM otp_codes WHERE email = ?').run(body.email)
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    if (!user) return res.status(404).json({ error: true, message: 'Account not found' })
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id)
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    res.json({ data: { token: signToken(user), user: publicUser(user), setup_complete: companySetupStatus().setup_complete } })
  } catch (e) { next(e) }
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = z.object({ email: emailSchema, password: z.string().min(1) }).parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    if (!user || !user.password_hash) return res.status(401).json({ error: true, message: 'Invalid email or password' })
    if (!bcrypt.compareSync(body.password, user.password_hash)) return res.status(401).json({ error: true, message: 'Invalid email or password' })
    if (!user.email_verified && !user.oauth_provider) {
      const { code } = issueOtp(user.email, 'register')
      const mail = await sendOtpEmail(user.email, code, 'register')
      return res.status(403).json({ error: true, code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email with the OTP we just sent.', data: { email: user.email, otp_sent: true, ...(mail.devCode ? { dev_otp: mail.devCode } : {}) } })
    }
    if (Number(user.two_fa_enabled) === 1) {
      const { code } = issueOtp(user.email, 'login_2fa')
      const mail = await sendOtpEmail(user.email, code, 'login_2fa')
      return res.status(200).json({ data: { requires_2fa: true, email: user.email, otp_sent: true, ...(mail.devCode ? { dev_otp: mail.devCode } : {}) } })
    }
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id)
    audit(user.id, 'login', 'password', req.ip)
    res.json({ data: { token: signToken(user), user: publicUser(user), setup_complete: companySetupStatus().setup_complete } })
  } catch (e) { next(e) }
})

authRouter.post('/login/2fa', async (req, res, next) => {
  try {
    const body = z.object({ email: emailSchema, code: z.string().min(4).max(8) }).parse(req.body)
    const row = db.prepare(`SELECT * FROM otp_codes WHERE email = ? AND purpose = 'login_2fa' ORDER BY created_at DESC LIMIT 1`).get(body.email)
    if (!row) return res.status(400).json({ error: true, message: 'No 2FA code requested' })
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: true, message: 'Code expired' })
    if (row.attempts >= 5) return res.status(429).json({ error: true, message: 'Too many attempts' })
    if (row.code !== body.code.trim()) {
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
      return res.status(400).json({ error: true, message: 'Invalid code' })
    }
    db.prepare('DELETE FROM otp_codes WHERE email = ? AND purpose = ?').run(body.email, 'login_2fa')
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    if (!user) return res.status(401).json({ error: true, message: 'User not found' })
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id)
    audit(user.id, 'login', '2fa', req.ip)
    res.json({ data: { token: signToken(user), user: publicUser(user), setup_complete: companySetupStatus().setup_complete } })
  } catch (e) { next(e) }
})

authRouter.post('/oauth/google', async (req, res, next) => {
  try {
    const body = z.object({ id_token: z.string().min(20) }).parse(req.body)
    const g = await verifyGoogleIdToken(body.id_token)
    let user = db.prepare('SELECT * FROM users WHERE email = ? OR (oauth_provider = ? AND oauth_id = ?)').get(g.email, 'google', g.sub)
    if (!user) {
      const id = uid()
      db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, email_verified, oauth_provider, oauth_id) VALUES (?,?,?,?,'owner',?,1,'google',?)`).run(id, g.email, g.name, bcrypt.hashSync(uid() + uid(), 8), now(), g.sub)
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    } else {
      db.prepare(`UPDATE users SET email_verified=1, oauth_provider=COALESCE(oauth_provider,'google'), oauth_id=COALESCE(oauth_id,?), name=COALESCE(name,?) WHERE id=?`).run(g.sub, g.name, user.id)
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    }
    res.json({ data: { token: signToken(user), user: publicUser(user), setup_complete: companySetupStatus().setup_complete } })
  } catch (e) { next(e) }
})

authRouter.get('/oauth/config', (_req, res) => {
  res.json({ data: { google_client_id: process.env.GOOGLE_CLIENT_ID || null, google_enabled: !!process.env.GOOGLE_CLIENT_ID, smtp_configured: !!process.env.SMTP_HOST } })
})

authRouter.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
  if (!row) return res.status(404).json({ error: true, message: 'User not found' })
  res.json({ data: { ...publicUser(row), setup_complete: companySetupStatus().setup_complete } })
})

authRouter.post('/setup/company', requireAuth, (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(2).max(120), email: z.string().email().optional().nullable(),
      phone: z.string().max(40).optional().nullable(), vat_number: z.string().max(40).optional().nullable(),
      address: z.string().max(300).optional().nullable(), business_type: z.string().max(40).optional().nullable(),
      bank_name: z.string().max(80).optional().nullable(), account_number: z.string().max(40).optional().nullable(),
      branch_code: z.string().max(20).optional().nullable(),
    }).parse(req.body)
    if (!db.prepare('SELECT id FROM company WHERE id = ?').get('main')) db.prepare(`INSERT INTO company (id, name) VALUES ('main', ?)`).run(body.name)
    db.prepare(`UPDATE company SET name=?, email=?, phone=?, vat_number=?, address=?, business_type=?,
       bank_name=?, account_number=?, branch_code=?, setup_complete=1 WHERE id='main'`).run(
      body.name, body.email || null, body.phone || null, body.vat_number || null, body.address || null,
      body.business_type || 'general', body.bank_name || null, body.account_number || null, body.branch_code || null)
    res.json({ data: db.prepare('SELECT * FROM company WHERE id=?').get('main') })
  } catch (e) { next(e) }
})

authRouter.post('/2fa/enable', requireAuth, async (req, res, next) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
    if (!user) return res.status(404).json({ error: true, message: 'Not found' })
    const { code } = issueOtp(user.email, 'enable_2fa')
    const mail = await sendOtpEmail(user.email, code, 'enable_2fa')
    res.json({ data: { otp_sent: true, email: user.email, ...(mail.devCode ? { dev_otp: mail.devCode } : {}) } })
  } catch (e) { next(e) }
})

authRouter.post('/2fa/confirm', requireAuth, (req, res, next) => {
  try {
    const body = z.object({ code: z.string().min(4).max(8), enable: z.boolean() }).parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
    if (!user) return res.status(404).json({ error: true, message: 'Not found' })
    if (body.enable) {
      const row = db.prepare(`SELECT * FROM otp_codes WHERE email = ? AND purpose = 'enable_2fa' ORDER BY created_at DESC LIMIT 1`).get(user.email)
      if (!row || new Date(row.expires_at) < new Date()) return res.status(400).json({ error: true, message: 'Request a code first or code expired' })
      if (row.code !== body.code.trim()) {
        db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
        return res.status(400).json({ error: true, message: 'Invalid code' })
      }
      db.prepare('DELETE FROM otp_codes WHERE email = ? AND purpose = ?').run(user.email, 'enable_2fa')
      db.prepare('UPDATE users SET two_fa_enabled = 1 WHERE id = ?').run(user.id)
      audit(user.id, '2fa_enable', null, req.ip)
    } else {
      db.prepare('UPDATE users SET two_fa_enabled = 0 WHERE id = ?').run(user.id)
      audit(user.id, '2fa_disable', null, req.ip)
    }
    res.json({ data: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) })
  } catch (e) { next(e) }
})

authRouter.post('/password', requireAuth, (req, res, next) => {
  try {
    const body = z.object({ current: z.string().min(1), next: passwordSchema }).parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
    if (!user || !user.password_hash) return res.status(400).json({ error: true, message: 'Password login not available for this account' })
    if (!bcrypt.compareSync(body.current, user.password_hash)) return res.status(401).json({ error: true, message: 'Current password incorrect' })
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.next, 10), user.id)
    audit(user.id, 'password_change', null, req.ip)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

authRouter.patch('/me', requireAuth, (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(2).max(80).optional(), locale: z.enum(['en', 'af', 'zu']).optional(), phone: z.string().max(40).optional().nullable() }).parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
    if (!user) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(`UPDATE users SET name = COALESCE(?, name), locale = COALESCE(?, locale), phone = COALESCE(?, phone) WHERE id = ?`).run(body.name ?? null, body.locale ?? null, body.phone !== undefined ? body.phone : null, user.id)
    res.json({ data: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) })
  } catch (e) { next(e) }
})

authRouter.get('/me/export', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
  if (!user) return res.status(404).json({ error: true, message: 'Not found' })
  const comments = db.prepare('SELECT * FROM ticket_comments WHERE user_id = ?').all(user.id)
  const times = db.prepare('SELECT * FROM ticket_time_entries WHERE user_id = ?').all(user.id)
  const tickets = db.prepare('SELECT id, title, status, created_at FROM tickets WHERE assignee_id = ?').all(user.id)
  const renders = db.prepare('SELECT id, template_id, created_at FROM document_renders WHERE created_by = ?').all(user.id)
  let auditRows = []
  try { auditRows = db.prepare('SELECT action, detail, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(user.id) } catch {}
  audit(user.id, 'popia_export', null, req.ip)
  res.setHeader('Content-Disposition', `attachment; filename="said-popia-${user.id.slice(0, 8)}.json"`)
  res.json({ exported_at: now(), purpose: 'POPIA data subject access request', user: publicUser(user), ticket_comments: comments, time_entries: times, assigned_tickets: tickets, document_renders: renders, recent_audit: auditRows })
})

authRouter.get('/backup', requireAuth, async (req, res, next) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) return res.status(403).json({ error: true, message: 'Admin only' })
    const fs = await import('fs')
    const path = getDbPath()
    if (!fs.existsSync(path)) return res.status(404).json({ error: true, message: 'Database file not found' })
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
    audit(user.id, 'backup_download', path, req.ip)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="said-backup-${new Date().toISOString().slice(0, 10)}.db"`)
    fs.createReadStream(path).pipe(res)
  } catch (e) { next(e) }
})

authRouter.post('/bootstrap-snapshot', requireAuth, (req, res, next) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) return res.status(403).json({ error: true, message: 'Admin only' })
    const result = saveBootstrapSnapshot()
    audit(user.id, 'bootstrap_snapshot', result.to, req.ip)
    res.json({ ok: true, data: { ...result, hint: 'Download GET /api/v1/auth/backup, save as server/data/said.bootstrap.db, git commit + push so Render free redeploys restore this state.' } })
  } catch (e) { next(e) }
})

authRouter.get('/bootstrap-status', requireAuth, async (req, res, next) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) return res.status(403).json({ error: true, message: 'Admin only' })
    const fs = await import('fs')
    const info = (p) => {
      try {
        if (!fs.existsSync(p)) return { exists: false, path: p }
        const st = fs.statSync(p)
        return { exists: true, path: p, size: st.size, mtime: st.mtime.toISOString() }
      } catch (e) { return { exists: false, path: p, error: e.message } }
    }
    res.json({ data: { live: info(getDbPath()), bootstrap: info(getBootstrapPath()) } })
  } catch (e) { next(e) }
})
