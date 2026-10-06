import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'said-dev-secret-change-me'

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    SECRET,
    { expiresIn: '7d' }
  )
}

export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || ''
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null
  if (!token) {
    const e = new Error('Unauthorized')
    e.status = 401
    return next(e)
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
