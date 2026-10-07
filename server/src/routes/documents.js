import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { htmlToPdf, fill } from '../services/pdf.js'

export const documentsRouter = Router()
documentsRouter.use(requireAuth)

documentsRouter.get('/templates', (req, res) => {
  const { category, business, q } = req.query
  let sql = `SELECT id, label, category, business_types, description, is_system, updated_at FROM document_templates WHERE 1=1`
  const params = []
  if (category) { sql += ' AND category = ?'; params.push(category) }
  if (business) {
    sql += ` AND (business_types = 'all' OR business_types LIKE ?)`
    params.push(`%${business}%`)
  }
  if (q) {
    sql += ' AND (label LIKE ? OR description LIKE ? OR id LIKE ?)'
    const like = `%${q}%`
    params.push(like, like, like)
  }
  sql += ' ORDER BY category, label'
  const rows = db.prepare(sql).all(...params)
  const categories = db.prepare(
    `SELECT category, COUNT(*) AS c FROM document_templates GROUP BY category ORDER BY category`
  ).all()
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
    const existing = db.prepare('SELECT id FROM document_templates WHERE id = ?').get(id)
    if (existing) return res.status(409).json({ error: true, message: 'Template id already exists' })
    db.prepare(
      `INSERT INTO document_templates (id, label, category, business_types, description, html, is_system, updated_at)
       VALUES (?,?,?,?,?,?,0,?)`
    ).run(id, body.label, body.category, body.business_types, body.description || null, body.html, now())
    res.status(201).json({ data: db.prepare('SELECT * FROM document_templates WHERE id=?').get(id) })
  } catch (e) {
    next(e)
  }
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
    db.prepare(
      `UPDATE document_templates SET label=?, category=?, business_types=?, description=?, html=?, updated_at=? WHERE id=?`
    ).run(
      body.label ?? t.label,
      body.category ?? t.category,
      body.business_types ?? t.business_types,
      body.description !== undefined ? body.description : t.description,
      body.html ?? t.html,
      now(),
      req.params.id
    )
    res.json({ data: db.prepare('SELECT * FROM document_templates WHERE id=?').get(req.params.id) })
  } catch (e) {
    next(e)
  }
})

documentsRouter.delete('/templates/:id', requireRole('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  if (t.is_system) return res.status(400).json({ error: true, message: 'Cannot delete system templates' })
  db.prepare('DELETE FROM document_templates WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

documentsRouter.post('/render', requireRole('staff'), async (req, res, next) => {
  try {
    const body = z.object({
      template_id: z.string().min(1),
      variables: z.record(z.any()).default({}),
      format: z.enum(['html', 'pdf']).default('pdf'),
    }).parse(req.body)
    const tpl = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(body.template_id)
    if (!tpl) return res.status(404).json({ error: true, message: 'Template not found' })
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
    const renderId = uid()
    db.prepare(
      `INSERT INTO document_renders (id, template_id, variables, created_by, created_at) VALUES (?,?,?,?,?)`
    ).run(renderId, body.template_id, JSON.stringify(vars), req.user.sub, now())
    if (body.format === 'html') {
      return res.json({ data: { id: renderId, html: fill(tpl.html, vars) } })
    }
    const pdf = await htmlToPdf(tpl.html, vars)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${body.template_id}.pdf"`)
    res.send(pdf)
  } catch (e) {
    next(e)
  }
})

documentsRouter.get('/categories', (_req, res) => {
  res.json({
    data: db.prepare(
      `SELECT category, COUNT(*) AS count FROM document_templates GROUP BY category ORDER BY category`
    ).all(),
  })
})
