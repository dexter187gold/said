/** Simple in-memory rate limiter (per IP + optional key). Hestia-Earth stats */

const buckets = new Map()
const hits = { total: 0, limited: 0, byPath: new Map() }

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
    hits.total++
    const pathKey = req.path || '/'
    hits.byPath.set(pathKey, (hits.byPath.get(pathKey) || 0) + 1)
    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - b.count)))
    if (b.count > max) {
      hits.limited++
      const e = new Error('Too many requests')
      e.status = 429
      return next(e)
    }
    next()
  }
}

export function getRateLimitStats() {
  const topPaths = [...hits.byPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([path, count]) => ({ path, count }))
  return {
    total_requests: hits.total,
    limited: hits.limited,
    active_buckets: buckets.size,
    top_paths: topPaths,
  }
}

export function resetRateLimitStats() {
  hits.total = 0
  hits.limited = 0
  hits.byPath.clear()
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (now - b.start > 120_000) buckets.delete(k)
  }
}, 60_000).unref?.()
