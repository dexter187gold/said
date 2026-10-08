/**
 * Hestia-Earth — fire active webhooks for domain events
 */
import { db, uid, now } from '../db.js'

export async function emitWebhook(event, data = {}) {
  let hooks = []
  try {
    hooks = db.prepare(`SELECT * FROM webhooks WHERE active = 1`).all()
  } catch {
    return { sent: 0 }
  }
  const results = []
  for (const h of hooks) {
    const events = String(h.events || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!events.includes('*') && !events.includes(event)) continue
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
        body: JSON.stringify({ event, at: now(), data }),
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
