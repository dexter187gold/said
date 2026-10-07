/** Simple in-memory rate limiter (per IP + optional key). EA-Q4 */

const buckets = new Map()

export function rateLimit({ windowMs = 60_000, max = 120, keyFn } = {}) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : `${req.ip || 'unknown'}:${req.path}`
    const now = Date.now()
    let b = buckets.get(key)
    if (!b || now - b.start > windowMs) {
      b = { start: now, count: 0 }
      buckets.set(key, b)
    }
    b.count++
    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - b.count)))
    if (b.count > max) {
      const e = new Error('Too many requests')
      e.status = 429
      return next(e)
    }
    next()
  }
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (now - b.start > 120_000) buckets.delete(k)
  }
}, 60_000).unref?.()
