import { Router } from 'express'
import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const clientsRouter = Router()
clientsRouter.use(requireAuth)

clientsRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM clients ORDER BY name').all()
  res.json({ data: rows })
})

clientsRouter.post('/', requireRole('staff'), (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
    }).parse(req.body)
    const id = uid()
    db.prepare(
      `INSERT INTO clients (id, name, email, phone, address, created_at) VALUES (?,?,?,?,?,?)`
    ).run(id, body.name, body.email || null, body.phone || null, body.address || null, now())
    res.status(201).json({ data: db.prepare('SELECT * FROM clients WHERE id = ?').get(id) })
  } catch (e) {
    next(e)
  }
})

clientsRouter.put('/:id', requireRole('staff'), (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      email: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
    }).parse(req.body)
    db.prepare(
      `UPDATE clients SET name=?, email=?, phone=?, address=? WHERE id=?`
    ).run(body.name, body.email ?? null, body.phone ?? null, body.address ?? null, req.params.id)
    res.json({ data: db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) })
  } catch (e) {
    next(e)
  }
})
