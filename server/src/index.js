import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedIfEmpty, db } from './db.js'
import { applyQ2Migrations } from './migrations_q2.js'
import { authRouter } from './routes/auth.js'
import { clientsRouter } from './routes/clients.js'
import { invoicesRouter } from './routes/invoices.js'
import { ticketsRouter } from './routes/tickets.js'
import { documentsRouter } from './routes/documents.js'
import { settingsRouter } from './routes/settings.js'
import { pagePrefsRouter } from './routes/pagePrefs.js'
import { documentActionsRouter } from './routes/documentActions.js'
import { insightRouter } from './routes/insight.js'
import { platformRouter } from './routes/platform.js'
import { apolloRouter } from './routes/apollo.js'
import { artemisRouter } from './routes/artemis.js'
import { portalRouter } from './routes/portal.js'
import { moneyRouter, handlePayfastItn, runDueRetainers } from './routes/money.js'
import { fieldRouter } from './routes/field.js'
import { errorHandler, notFound } from './middleware/error.js'
import { requireAuth } from './middleware/auth.js'
import { rateLimit } from './middleware/rateLimit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
seedIfEmpty()
try { applyQ2Migrations(db) } catch (e) { console.warn('Q2 migrations', e.message) }

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '8mb' }))
app.use(express.urlencoded({ extended: true }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }
  next()
})
// EA-Q4: global soft rate limit
app.use('/api/', rateLimit({ windowMs: 60_000, max: 300 }))
app.use('/api/v1/auth/login', rateLimit({ windowMs: 60_000, max: 20, keyFn: (r) => `login:${r.ip}` }))

app.get('/api/v1/health', (_req, res) => {
  const tplCount = db.prepare('SELECT COUNT(*) AS c FROM document_templates').get().c
  res.json({
    ok: true,
    service: 'said',
    version: '2.7.0-apollo-artemis',
    templates: tplCount,
    time: new Date().toISOString(),
  })
})

app.get('/api/v1/ready', (_req, res) => {
  try {
    db.prepare('SELECT 1').get()
    res.json({ ready: true })
  } catch (e) {
    res.status(503).json({ ready: false, error: e.message })
  }
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
app.use('/api/v1/settings', settingsRouter)
app.use('/api/v1/page-prefs', pagePrefsRouter)
app.use('/api/v1/doc-actions', documentActionsRouter)
app.use('/api/v1/insight', insightRouter)
app.use('/api/v1/apollo', apolloRouter)
app.use('/api/v1/artemis', artemisRouter)
app.use('/api/v1/platform', platformRouter)
app.use('/api/v1/portal', portalRouter)
app.post('/api/v1/money/payfast/itn', handlePayfastItn)
app.post('/api/v1/cron/retainers', (req, res) => {
  const cronKey = process.env.SAID_CRON_KEY || ''
  const provided = req.headers['x-said-cron'] || req.body?.cron_key || ''
  if (!cronKey || provided !== cronKey) {
    return res.status(401).json({ error: true, message: 'Invalid cron key' })
  }
  try {
    const created = runDueRetainers('cron')
    res.json({ data: { created, count: created.length } })
  } catch (e) {
    res.status(500).json({ error: true, message: e.message })
  }
})
app.use('/api/v1/money', moneyRouter)
app.use('/api/v1/field', fieldRouter)

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
