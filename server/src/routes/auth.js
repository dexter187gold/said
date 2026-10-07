import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
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
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    email_verified: !!row.email_verified,
    oauth_provider: row.oauth_provider || null,
    created_at: row.created_at,
  }
}

function companySetupStatus() {
  const co = db.prepare('SELECT * FROM company WHERE id = ?').get('main')
  if (!co) return { setup_complete: false, company: null }
  return {
    setup_complete: Number(co.setup_complete) === 1,
    company: co,
  }
}

function issueOtp(email, purpose) {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const id = uid()
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  db.prepare('DELETE FROM otp_codes WHERE email = ? AND purpose = ?').run(email, purpose)
  db.prepare(
    `INSERT INTO otp_codes (id, email, code, purpose, attempts, expires_at, created_at) VALUES (?,?,?,?,0,?,?)`
  ).run(id, email, code, purpose, expires, now())
  return { code, expires }
}

async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw Object.assign(new Error('Google OAuth is not configured (GOOGLE_CLIENT_ID)'), { status: 503 })
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  const res = await fetch(url)
  if (!res.ok) throw Object.assign(new Error('Invalid Google token'), { status: 401 })
  const payload = await res.json()
  if (payload.aud !== clientId) throw Object.assign(new Error('Google token audience mismatch'), { status: 401 })
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    throw Object.assign(new Error('Google email not verified'), { status: 401 })
  }
  return {
    email: String(payload.email).toLowerCase(),
    name: payload.name || payload.email,
    sub: payload.sub,
  }
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const body = z
      .object({
        email: emailSchema,
        password: passwordSchema,
        name: nameSchema,
        phone: z.string().max(30).optional().nullable(),
      })
      .parse(req.body)

    const exists = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(body.email)
    if (exists?.email_verified) {
      return res.status(409).json({ error: true, message: 'An account with this email already exists. Sign in instead.' })
    }

    const hash = bcrypt.hashSync(body.password, 10)
    if (exists) {
      db.prepare('UPDATE users SET password_hash=?, name=?, phone=? WHERE id=?').run(
        hash, body.name, body.phone || null, exists.id
      )
    } else {
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, created_at, email_verified, phone)
         VALUES (?,?,?,?, 'owner', ?, 0, ?)`
      ).run(uid(), body.email, body.name, hash, now(), body.phone || null)
    }

    const { code } = issueOtp(body.email, 'register')
    const mail = await sendOtpEmail(body.email, code, 'register')
    res.status(201).json({
      data: {
        email: body.email,
        otp_sent: true,
        delivered: mail.delivered,
        ...(mail.devCode ? { dev_otp: mail.devCode } : {}),
        message: 'Check your email for a 6-digit verification code.',
      },
    })
  } catch (e) {
    next(e)
  }
})

authRouter.post('/otp/send', async (req, res, next) => {
  try {
    const body = z
      .object({ email: emailSchema, purpose: z.enum(['register', 'login', 'reset']).default('register') })
      .parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    if (!user && body.purpose !== 'register') {
      return res.status(404).json({ error: true, message: 'No account found for this email' })
    }
    const { code } = issueOtp(body.email, body.purpose)
    const mail = await sendOtpEmail(body.email, code, body.purpose)
    res.json({
      data: {
        email: body.email,
        otp_sent: true,
        delivered: mail.delivered,
        ...(mail.devCode ? { dev_otp: mail.devCode } : {}),
      },
    })
  } catch (e) {
    next(e)
  }
})

authRouter.post('/otp/verify', async (req, res, next) => {
  try {
    const body = z
      .object({
        email: emailSchema,
        code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
        purpose: z.enum(['register', 'login', 'reset']).default('register'),
      })
      .parse(req.body)

    const row = db
      .prepare('SELECT * FROM otp_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1')
      .get(body.email, body.purpose)
    if (!row) return res.status(400).json({ error: true, message: 'No code found. Request a new one.' })
    if (row.attempts >= 5) return res.status(429).json({ error: true, message: 'Too many attempts. Request a new code.' })
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: true, message: 'Code expired. Request a new one.' })
    }
    if (row.code !== body.code) {
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
      return res.status(400).json({ error: true, message: 'Incorrect code' })
    }

    db.prepare('DELETE FROM otp_codes WHERE email = ?').run(body.email)
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    if (!user) return res.status(404).json({ error: true, message: 'Account not found' })

    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id)
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    const token = signToken(user)
    const setup = companySetupStatus()
    res.json({
      data: {
        token,
        user: publicUser(user),
        setup_complete: setup.setup_complete,
      },
    })
  } catch (e) {
    next(e)
  }
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = z.object({ email: emailSchema, password: z.string().min(1) }).parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: true, message: 'Invalid email or password' })
    }
    if (!bcrypt.compareSync(body.password, user.password_hash)) {
      return res.status(401).json({ error: true, message: 'Invalid email or password' })
    }
    if (!user.email_verified && !user.oauth_provider) {
      const { code } = issueOtp(user.email, 'register')
      const mail = await sendOtpEmail(user.email, code, 'register')
      return res.status(403).json({
        error: true,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email with the OTP we just sent.',
        data: {
          email: user.email,
          otp_sent: true,
          ...(mail.devCode ? { dev_otp: mail.devCode } : {}),
        },
      })
    }
    const token = signToken(user)
    const setup = companySetupStatus()
    res.json({ data: { token, user: publicUser(user), setup_complete: setup.setup_complete } })
  } catch (e) {
    next(e)
  }
})

authRouter.post('/oauth/google', async (req, res, next) => {
  try {
    const body = z.object({ id_token: z.string().min(20) }).parse(req.body)
    const g = await verifyGoogleIdToken(body.id_token)
    let user = db.prepare('SELECT * FROM users WHERE email = ? OR (oauth_provider = ? AND oauth_id = ?)').get(
      g.email, 'google', g.sub
    )
    if (!user) {
      const id = uid()
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, created_at, email_verified, oauth_provider, oauth_id)
         VALUES (?,?,?,?,'owner',?,1,'google',?)`
      ).run(id, g.email, g.name, bcrypt.hashSync(uid() + uid(), 8), now(), g.sub)
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    } else {
      db.prepare(
        `UPDATE users SET email_verified=1, oauth_provider=COALESCE(oauth_provider,'google'), oauth_id=COALESCE(oauth_id,?), name=COALESCE(name,?) WHERE id=?`
      ).run(g.sub, g.name, user.id)
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    }
    const token = signToken(user)
    const setup = companySetupStatus()
    res.json({ data: { token, user: publicUser(user), setup_complete: setup.setup_complete } })
  } catch (e) {
    next(e)
  }
})

authRouter.get('/oauth/config', (_req, res) => {
  res.json({
    data: {
      google_client_id: process.env.GOOGLE_CLIENT_ID || null,
      google_enabled: !!process.env.GOOGLE_CLIENT_ID,
      smtp_configured: !!process.env.SMTP_HOST,
    },
  })
})

authRouter.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
  if (!row) return res.status(404).json({ error: true, message: 'User not found' })
  const setup = companySetupStatus()
  res.json({ data: { ...publicUser(row), setup_complete: setup.setup_complete } })
})

authRouter.post('/setup/company', requireAuth, (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(2).max(120),
        email: z.string().email().optional().nullable(),
        phone: z.string().max(40).optional().nullable(),
        vat_number: z.string().max(40).optional().nullable(),
        address: z.string().max(300).optional().nullable(),
        business_type: z.string().max(40).optional().nullable(),
        bank_name: z.string().max(80).optional().nullable(),
        account_number: z.string().max(40).optional().nullable(),
        branch_code: z.string().max(20).optional().nullable(),
      })
      .parse(req.body)

    const existing = db.prepare('SELECT id FROM company WHERE id = ?').get('main')
    if (!existing) {
      db.prepare(`INSERT INTO company (id, name) VALUES ('main', ?)`).run(body.name)
    }
    db.prepare(
      `UPDATE company SET name=?, email=?, phone=?, vat_number=?, address=?, business_type=?,
       bank_name=?, account_number=?, branch_code=?, setup_complete=1 WHERE id='main'`
    ).run(
      body.name,
      body.email || null,
      body.phone || null,
      body.vat_number || null,
      body.address || null,
      body.business_type || 'general',
      body.bank_name || null,
      body.account_number || null,
      body.branch_code || null
    )
    res.json({ data: db.prepare('SELECT * FROM company WHERE id=?').get('main') })
  } catch (e) {
    next(e)
  }
})
