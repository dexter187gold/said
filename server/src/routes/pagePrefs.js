import { Router } from 'express'
import { db, uid, now, audit } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const pagePrefsRouter = Router()
pagePrefsRouter.use(requireAuth)

const DEFAULTS = {
  invoice: {
    show_devices: true,
    show_technician: true,
    show_po: true,
    default_payment_terms: 'Payment due as stated. EFT / cash / card.',
    default_vat_rate: 15,
    reminder_days: [7, 3, 0],
    auto_number: true,
    template_id: null,
  },
  ticket: {
    default_priority: 'normal',
    default_category: 'support',
    auto_timer: false,
    billable_increment_minutes: 15,
    sla_hours: 24,
    require_photo: false,
    require_signature: false,
  },
  client: {
    show_map: false,
    default_tags: [],
    credit_limit_warn: true,
  },
  quote: {
    validity_days: 14,
    convert_defaults: { status: 'unpaid' },
    watermark: true,
  },
  credit: {
    auto_apply: false,
  },
  documents: {
    default_category: 'general',
    logo_size: 'medium',
    show_qr: false,
  },
  ageing: {
    buckets: [30, 60, 90, 120],
    include_credits: true,
  },
}

pagePrefsRouter.get('/:pageKey', (req, res) => {
  const pageKey = String(req.params.pageKey || '').toLowerCase()
  if (!DEFAULTS[pageKey]) {
    return res.status(400).json({ error: true, message: 'Unknown page key' })
  }
  const row = db.prepare(
    `SELECT prefs FROM page_preferences WHERE user_id = ? AND page_key = ?`
  ).get(req.user.id, pageKey)
  let userPrefs = {}
  try {
    userPrefs = row ? JSON.parse(row.prefs) : {}
  } catch {
    userPrefs = {}
  }
  const merged = { ...DEFAULTS[pageKey], ...userPrefs }
  res.json({ data: { page_key: pageKey, prefs: merged, defaults: DEFAULTS[pageKey] } })
})

pagePrefsRouter.put('/:pageKey', (req, res) => {
  const pageKey = String(req.params.pageKey || '').toLowerCase()
  if (!DEFAULTS[pageKey]) {
    return res.status(400).json({ error: true, message: 'Unknown page key' })
  }
  const incoming = req.body?.prefs || req.body || {}
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: true, message: 'prefs must be an object' })
  }
  const existing = db.prepare(
    `SELECT id, prefs FROM page_preferences WHERE user_id = ? AND page_key = ?`
  ).get(req.user.id, pageKey)
  let current = {}
  try {
    current = existing ? JSON.parse(existing.prefs) : {}
  } catch {
    current = {}
  }
  const next = { ...current, ...incoming }
  const ts = now()
  if (existing) {
    db.prepare(`UPDATE page_preferences SET prefs = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(next),
      ts,
      existing.id
    )
  } else {
    db.prepare(
      `INSERT INTO page_preferences (id, user_id, page_key, prefs, updated_at) VALUES (?,?,?,?,?)`
    ).run(uid(), req.user.id, pageKey, JSON.stringify(next), ts)
  }
  audit(req.user.id, 'page_prefs.update', `${pageKey}`, req.ip)
  const merged = { ...DEFAULTS[pageKey], ...next }
  res.json({ data: { page_key: pageKey, prefs: merged } })
})

pagePrefsRouter.delete('/:pageKey', (req, res) => {
  const pageKey = String(req.params.pageKey || '').toLowerCase()
  db.prepare(`DELETE FROM page_preferences WHERE user_id = ? AND page_key = ?`).run(
    req.user.id,
    pageKey
  )
  audit(req.user.id, 'page_prefs.reset', pageKey, req.ip)
  res.json({ data: { page_key: pageKey, prefs: DEFAULTS[pageKey] || {} } })
})
