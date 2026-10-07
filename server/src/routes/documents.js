import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { htmlToPdf, fill } from '../services/pdf.js'
import { TEMPLATE_SEED } from '../seedTemplates.js'

export const documentsRouter = Router()
documentsRouter.use(requireAuth)

documentsRouter.get('/templates', (req, res) => {
  const { category, business, q } = req.query
  let sql = `SELECT id, label, category, business_types, description, is_system, updated_at FROM document_templates WHERE 1=1`
  const params = []
  if (category) { sql += ' AND category = ?'; params.push(category) }
  if (business) { sql += ` AND (business_types = 'all' OR business_types LIKE ?)`; params.push(`%${business}%`) }
  if (q) {
    sql += ' AND (label LIKE ? OR description LIKE ? OR id LIKE ?)'
    const like = `%${q}%`
    params.push(like, like, like)
  }
  sql += ' ORDER BY category, label'
  const rows = db.prepare(sql).all(...params)
  const categories = db.prepare(`SELECT category, COUNT(*) AS c FROM document_templates GROUP BY category ORDER BY category`).all()
  res.json({ data: rows, categories, total: rows.length })
})

documentsRouter.get('/templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  res.json({ data: t })
})

documentsRouter.post('/templates', requireRole('admin'), (req, res, next) => {
  try {
    const body = z.object({
      id: z.string().min(1).regex(/^[a-z0-9_]+$/).optional(),
      label: z.string().min(1),
      category: z.string().default('Custom'),
      business_types: z.string().default('all'),
      description: z.string().optional().nullable(),
      html: z.string().min(10),
    }).parse(req.body)
    const id = body.id || `custom_${uid().slice(0, 8)}`
    if (db.prepare('SELECT id FROM document_templates WHERE id = ?').get(id))
      return res.status(409).json({ error: true, message: 'Template id already exists' })
    db.prepare(`INSERT INTO document_templates (id, label, category, business_types, description, html, is_system, updated_at) VALUES (?,?,?,?,?,?,0,?)`)
      .run(id, body.label, body.category, body.business_types, body.description || null, body.html, now())
    res.status(201).json({ data: db.prepare('SELECT * FROM document_templates WHERE id=?').get(id) })
  } catch (e) { next(e) }
})

documentsRouter.put('/templates/:id', requireRole('admin'), (req, res, next) => {
  try {
    const body = z.object({
      label: z.string().min(1).optional(),
      category: z.string().optional(),
      business_types: z.string().optional(),
      description: z.string().optional().nullable(),
      html: z.string().min(10).optional(),
    }).parse(req.body)
    const t = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    db.prepare(`UPDATE document_templates SET label=?, category=?, business_types=?, description=?, html=?, updated_at=? WHERE id=?`).run(
      body.label ?? t.label, body.category ?? t.category, body.business_types ?? t.business_types,
      body.description !== undefined ? body.description : t.description, body.html ?? t.html, now(), req.params.id
    )
    res.json({ data: db.prepare('SELECT * FROM document_templates WHERE id=?').get(req.params.id) })
  } catch (e) { next(e) }
})

documentsRouter.delete('/templates/:id', requireRole('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  if (t.is_system) return res.status(400).json({ error: true, message: 'Cannot delete system templates' })
  db.prepare('DELETE FROM document_templates WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

documentsRouter.post('/render', async (req, res, next) => {
  try {
    const body = z.object({
      template_id: z.string().min(1),
      variables: z.record(z.any()).default({}),
      format: z.enum(['html', 'pdf']).default('pdf'),
      watermark: z.boolean().optional(),
      include_qr: z.boolean().optional(),
    }).parse(req.body)
    const tpl = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(body.template_id)
    if (!tpl) return res.status(404).json({ error: true, message: 'Template not found' })
    if (!tpl.html || tpl.html.length < 10) return res.status(400).json({ error: true, message: 'Template has no HTML content' })
    const vars = {}
    for (const [k, v] of Object.entries(body.variables)) vars[k] = v == null ? '' : String(v)
    const co = db.prepare('SELECT * FROM company WHERE id=?').get('main') || {}
    if (!vars.company_name) vars.company_name = co.name || ''
    if (!vars.company_address) vars.company_address = co.address || ''
    if (!vars.company_phone) vars.company_phone = co.phone || ''
    if (!vars.vat_number) vars.vat_number = co.vat_number || ''
    if (!vars.bank_name) vars.bank_name = co.bank_name || ''
    if (!vars.account_number) vars.account_number = co.account_number || ''
    if (!vars.branch_code) vars.branch_code = co.branch_code || ''
    if (!vars.logo_url && co.logo_url) vars.logo_url = co.logo_url
    if (!vars.logo && co.logo_url) {
      vars.logo = (co.logo_url.startsWith('data:') || co.logo_url.startsWith('http'))
        ? `<img src="${co.logo_url}" alt="Logo" style="max-height:64px;max-width:180px" />` : ''
    }
    const payRef = vars.invoice_number || vars.number || vars.reference || 'PAY'
    const payAmount = vars.total || vars.amount || ''
    const payPayload = encodeURIComponent(
      `Pay ${co.name || 'SAID'}|Ref:${payRef}|Amt:${payAmount}|Acc:${co.account_number || ''}|Branch:${co.branch_code || ''}`
    )
    if (body.include_qr || vars.include_qr === '1') {
      vars.qr_pay = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${payPayload}" alt="Pay QR" width="120" height="120" />`
      vars.qr_pay_url = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${payPayload}`
    } else {
      if (!vars.qr_pay) vars.qr_pay = ''
      if (!vars.qr_pay_url) vars.qr_pay_url = ''
    }
    let htmlOut = fill(tpl.html, vars)
    if (body.watermark) {
      const mark = `<div style="position:fixed;top:40%;left:10%;font-size:72px;color:rgba(0,0,0,.08);transform:rotate(-30deg);pointer-events:none;z-index:999;font-weight:800;letter-spacing:.1em">DRAFT</div>`
      htmlOut = htmlOut.includes('</body>') ? htmlOut.replace('</body>', mark + '</body>') : mark + htmlOut
    }
    const renderId = uid()
    db.prepare(`INSERT INTO document_renders (id, template_id, variables, created_by, created_at) VALUES (?,?,?,?,?)`)
      .run(renderId, body.template_id, JSON.stringify(vars), req.user.sub, now())
    if (body.format === 'html') {
      return res.json({ data: { id: renderId, html: htmlOut, qr_pay_url: vars.qr_pay_url || null } })
    }
    try {
      const pdf = await htmlToPdf(htmlOut, {})
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${body.template_id}.pdf"`)
      return res.send(pdf)
    } catch (pdfErr) {
      console.error('PDF render error:', pdfErr)
      const err = new Error(pdfErr.message || 'PDF generation failed')
      err.status = 503
      throw err
    }
  } catch (e) { next(e) }
})

documentsRouter.post('/reseed', requireRole('admin'), (req, res, next) => {
  try {
    const ins = db.prepare(`INSERT OR REPLACE INTO document_templates (id, label, category, business_types, description, html, is_system, updated_at) VALUES (?,?,?,?,?,?,1,?)`)
    const ts = now()
    const tx = db.transaction(() => { for (const t of TEMPLATE_SEED) ins.run(t.id, t.label, t.category, t.business_types, t.description || null, t.html, ts) })
    tx()
    res.json({ ok: true, count: db.prepare('SELECT COUNT(*) AS c FROM document_templates').get().c })
  } catch (e) { next(e) }
})

documentsRouter.get('/categories', (_req, res) => {
  res.json({ data: db.prepare(`SELECT category, COUNT(*) AS count FROM document_templates GROUP BY category ORDER BY category`).all() })
})
