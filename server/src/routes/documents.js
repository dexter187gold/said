import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { htmlToPdf, fill } from '../services/pdf.js'

export const documentsRouter = Router()
documentsRouter.use(requireAuth)

documentsRouter.get('/templates', (_req, res) => {
  res.json({ data: db.prepare('SELECT id, label FROM document_templates').all() })
})

documentsRouter.get('/templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: true, message: 'Not found' })
  res.json({ data: t })
})

documentsRouter.post('/render', requireRole('staff'), async (req, res, next) => {
  try {
    const body = z.object({
      template_id: z.string().min(1),
      variables: z.record(z.string()).default({}),
      format: z.enum(['html', 'pdf']).default('pdf'),
    }).parse(req.body)
    const tpl = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(body.template_id)
    if (!tpl) return res.status(404).json({ error: true, message: 'Template not found' })
    const renderId = uid()
    db.prepare(
      `INSERT INTO document_renders (id, template_id, variables, created_by, created_at) VALUES (?,?,?,?,?)`
    ).run(renderId, body.template_id, JSON.stringify(body.variables), req.user.sub, now())
    if (body.format === 'html') {
      return res.json({ data: { id: renderId, html: fill(tpl.html, body.variables) } })
    }
    const pdf = await htmlToPdf(tpl.html, body.variables)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${body.template_id}.pdf"`)
    res.send(pdf)
  } catch (e) {
    next(e)
  }
})
