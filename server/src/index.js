import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedIfEmpty } from './db.js'
import { authRouter } from './routes/auth.js'
import { clientsRouter } from './routes/clients.js'
import { invoicesRouter } from './routes/invoices.js'
import { ticketsRouter } from './routes/tickets.js'
import { documentsRouter } from './routes/documents.js'
import { errorHandler, notFound } from './middleware/error.js'
import { requireAuth } from './middleware/auth.js'
import { db } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
seedIfEmpty()

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '4mb' }))

app.get('/api/v1/health', (_req, res) => {
  res.json({ ok: true, service: 'said', version: '1.0.0' })
})

app.get('/api/v1/company', requireAuth, (_req, res) => {
  res.json({ data: db.prepare('SELECT * FROM company WHERE id = ?').get('main') })
})

app.put('/api/v1/company', requireAuth, (req, res) => {
  const c = req.body || {}
  db.prepare(
    `UPDATE company SET name=?, email=?, phone=?, vat_number=?, address=?, bank_name=?, account_number=?, branch_code=? WHERE id='main'`
  ).run(c.name || null, c.email || null, c.phone || null, c.vat_number || null, c.address || null, c.bank_name || null, c.account_number || null, c.branch_code || null)
  res.json({ data: db.prepare('SELECT * FROM company WHERE id = ?').get('main') })
})

app.use('/api/v1/auth', authRouter)
app.use('/api/v1/clients', clientsRouter)
app.use('/api/v1/invoices', invoicesRouter)
app.use('/api/v1/tickets', ticketsRouter)
app.use('/api/v1/documents', documentsRouter)

const clientDist = path.join(__dirname, '../../client/dist')
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.use(notFound)
app.use(errorHandler)

const port = process.env.PORT || 8787
app.listen(port, () => {
  console.log(`SAID API http://localhost:${port}`)
  console.log('Default login: admin@said.local / admin123')
})
