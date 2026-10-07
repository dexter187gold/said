import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { db, now } from '../db.js'

const SECRET = process.env.JWT_SECRET || 'said-dev-secret-change-me'

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    SECRET,
    { expiresIn: '7d' }
  )
}

function tryApiKey(token) {
  if (!token || !token.startsWith('said_')) return null
  try {
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const row = db.prepare(`SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0`).get(hash)
    if (!row) return null
    db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(now(), row.id)
    return {
      sub: row.user_id || row.id,
      email: `apikey:${row.key_prefix}`,
      role: row.role || 'staff',
      name: row.name,
      api_key: true,
    }
  } catch {
    return null
  }
}

export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || ''
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null
  if (!token) {
    const e = new Error('Unauthorized')
    e.status = 401
    return next(e)
  }
  const asKey = tryApiKey(token)
  if (asKey) {
    req.user = asKey
    return next()
  }
  try {
    req.user = jwt.verify(token, SECRET)
    next()
  } catch {
    const e = new Error('Invalid token')
    e.status = 401
    next(e)
  }
}

const RANK = { viewer: 1, staff: 2, admin: 3, owner: 4 }

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      const e = new Error('Unauthorized')
      e.status = 401
      return next(e)
    }
    const need = Math.min(...roles.map((r) => RANK[r] || 99))
    if ((RANK[req.user.role] || 0) < need) {
      const e = new Error('Forbidden')
      e.status = 403
      return next(e)
    }
    next()
  }
}
