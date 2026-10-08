/**
 * Hestia-Earth — webhooks with HMAC-SHA256 + timestamp
 * Headers:
 *   X-SAID-Event
 *   X-SAID-Delivery
 *   X-SAID-Timestamp  (ISO)
 *   X-SAID-Signature: sha256=<hex>  (HMAC of body when secret set)
 */
import crypto from 'crypto'
import { db, uid, now } from '../db.js'

function signBody(bodyStr, secret) {
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(bodyStr, 'utf8').digest('hex')
}

async function deliverOnce(h, event, bodyStr, deliveryId) {
  const headers = {
    'Content-Type': 'application/json',
    'X-SAID-Event': event,
    'X-SAID-Delivery': deliveryId,
    'X-SAID-Timestamp': now(),
  }
  if (h.secret) {
    headers['X-SAID-Signature'] = `sha256=${signBody(bodyStr, h.secret)}`
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
    ).run(deliveryId, h.id, event, status_code, ok, now())
  } catch {}
  return { webhook_id: h.id, ok: !!ok, status_code, delivery_id: deliveryId }
}

export async function emitWebhook(event, data = {}) {
  let hooks = []
  try {
    hooks = db.prepare(`SELECT * FROM webhooks WHERE active = 1`).all()
  } catch {
    return { sent: 0 }
  }
  const payload = { event, at: now(), data }
  const bodyStr = JSON.stringify(payload)
  const results = []
  for (const h of hooks) {
    const events = String(h.events || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!events.includes('*') && !events.includes(event)) continue
    results.push(await deliverOnce(h, event, bodyStr, uid()))
  }
  return { sent: results.length, results }
}

/** Retry a failed delivery by id (re-sends same event shape if we only have event name) */
export async function retryDelivery(deliveryId) {
  const d = db.prepare(`SELECT * FROM webhook_deliveries WHERE id = ?`).get(deliveryId)
  if (!d) return { error: 'not_found' }
  const h = db.prepare(`SELECT * FROM webhooks WHERE id = ?`).get(d.webhook_id)
  if (!h || !h.active) return { error: 'webhook_inactive' }
  const bodyStr = JSON.stringify({
    event: d.event,
    at: now(),
    data: { retry_of: deliveryId },
  })
  const result = await deliverOnce(h, d.event, bodyStr, uid())
  return { data: result }
}

export function verifyWebhookSignature(bodyStr, secret, headerValue) {
  if (!secret || !headerValue) return false
  const expected = `sha256=${signBody(bodyStr, secret)}`
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(headerValue)))
  } catch {
    return false
  }
}
