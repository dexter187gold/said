import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { signToken, requireAuth } from '../middleware/auth.js'

export const authRouter = Router()

const Register = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(['owner', 'admin', 'staff', 'viewer']).optional(),
})

const Login = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

authRouter.post('/register', (req, res, next) => {
  try {
    const body = Register.parse(req.body)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email.toLowerCase())
    if (existing) {
      const e = new Error('Email already registered')
      e.status = 409
      throw e
    }
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
    const role = count === 0 ? 'owner' : body.role || 'staff'
    const id = uid()
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?)`
    ).run(id, body.email.toLowerCase(), body.name, bcrypt.hashSync(body.password, 10), role, now())
    const user = { id, email: body.email.toLowerCase(), name: body.name, role }
    res.status(201).json({ data: { user, token: signToken(user) } })
  } catch (e) {
    next(e)
  }
})

authRouter.post('/login', (req, res, next) => {
  try {
    const body = Login.parse(req.body)
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email.toLowerCase())
    if (!row || !bcrypt.compareSync(body.password, row.password_hash)) {
      const e = new Error('Invalid email or password')
      e.status = 401
      throw e
    }
    const user = { id: row.id, email: row.email, name: row.name, role: row.role }
    res.json({ data: { user, token: signToken(user) } })
  } catch (e) {
    next(e)
  }
})

authRouter.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(req.user.sub)
  if (!row) {
    return res.status(404).json({ error: true, message: 'User not found' })
  }
  res.json({ data: row })
})
