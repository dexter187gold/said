/**
 * Hestia-Earth — fire active webhooks with optional HMAC-SHA256 signatures
 * Header: X-SAID-Signature: sha256=<hex>
 * Signed payload = raw JSON body string
 */
import crypto from 'crypto'
import { db, uid, now } from '../db.js'

function signBody(bodyStr, secret) {
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(bodyStr, 'utf8').digest('hex')
}

export async function emitWebhook(event, data = {}) {
  let hooks = []
  try {
    hooks = db.prepare(`SELECT * FROM webhooks WHERE active = 1`).all()
  } catch {
    return { sent: 0 }
  }
  const results = []
  const payload = { event, at: now(), data }
  const bodyStr = JSON.stringify(payload)

  for (const h of hooks) {
    const events = String(h.events || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!events.includes('*') && !events.includes(event)) continue

    const headers = {
      'Content-Type': 'application/json',
      'X-SAID-Event': event,
      'X-SAID-Delivery': uid(),
    }
    if (h.secret) {
      const sig = signBody(bodyStr, h.secret)
      headers['X-SAID-Signature'] = `sha256=${sig}`
    }

    let ok = 0
    let status_code = 0
    try {
      const r = await fetch(h.url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(8000),
      })
      status_code = r.status
      ok = r.ok ? 1 : 0
    } catch {
      status_code = 0
      ok = 0
    }
    try {
      db.prepare(
        `INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, ok, created_at) VALUES (?,?,?,?,?,?)`
      ).run(uid(), h.id, event, status_code, ok, now())
    } catch {}
    results.push({ webhook_id: h.id, ok: !!ok, status_code })
  }
  return { sent: results.length, results }
}

/** Verify a received webhook signature (for docs / self-test) */
export function verifyWebhookSignature(bodyStr, secret, headerValue) {
  if (!secret || !headerValue) return false
  const expected = `sha256=${signBody(bodyStr, secret)}`
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(headerValue)))
  } catch {
    return false
  }
}
