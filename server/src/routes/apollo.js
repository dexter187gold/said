/** Apollo — insight / reports / KPIs */
import { Router } from 'express'
import { db, now } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const apolloRouter = Router()
apolloRouter.use(requireAuth)

apolloRouter.get('/kpis', requireRole('staff'), (req, res) => {
  const day = (req.query.date || now().slice(0, 10)).slice(0, 10)
  const month = day.slice(0, 7)
  const openTickets = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tickets WHERE status IN ('open','in_progress','waiting') AND COALESCE(is_template,0)=0`
    )
    .get().c
  const closedMonth = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tickets WHERE status IN ('resolved','closed') AND updated_at LIKE ?`
    )
    .get(`${month}%`).c
  const invoicedMonth = db
    .prepare(
      `SELECT COALESCE(SUM(total),0) AS t, COUNT(*) AS n FROM invoices
       WHERE doc_type='invoice' AND date LIKE ? AND status != 'cancelled'`
    )
    .get(`${month}%`)
  const collectedMonth = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS n FROM payments WHERE date LIKE ?`
    )
    .get(`${month}%`)
  const openBal = db
    .prepare(
      `SELECT COALESCE(SUM(total - amount_paid),0) AS t FROM invoices
       WHERE doc_type='invoice' AND status NOT IN ('paid','cancelled')`
    )
    .get().t
  let remoteOpen = 0
  let onsiteOpen = 0
  try {
    remoteOpen = db
      .prepare(
        `SELECT COUNT(*) AS c FROM tickets WHERE status IN ('open','in_progress','waiting')
           AND (category='remote' OR preferred_service='remote')`
      )
      .get().c
    onsiteOpen = db
      .prepare(
        `SELECT COUNT(*) AS c FROM tickets WHERE status IN ('open','in_progress','waiting')
           AND (category='onsite' OR preferred_service='onsite')`
      )
      .get().c
  } catch {}
  res.json({
    data: {
      as_of: day,
      tickets: { open: openTickets, closed_this_month: closedMonth, remote_open: remoteOpen, onsite_open: onsiteOpen },
      money: {
        invoiced_month: invoicedMonth.t,
        invoices_month: invoicedMonth.n,
        collected_month: collectedMonth.t,
        payments_month: collectedMonth.n,
        open_balance: openBal,
      },
    },
  })
})

apolloRouter.get('/revenue-by-day', requireRole('staff'), (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30))
  const rows = db
    .prepare(
      `SELECT date, COALESCE(SUM(amount),0) AS total, COUNT(*) AS n
       FROM payments WHERE date >= date('now', ?)
       GROUP BY date ORDER BY date ASC`
    )
    .all(`-${days} days`)
  res.json({ data: { days, series: rows } })
})

apolloRouter.get('/top-clients', requireRole('staff'), (req, res) => {
  const limit = Math.min(50, Number(req.query.limit) || 10)
  const rows = db
    .prepare(
      `SELECT c.id, c.name, COALESCE(SUM(i.total),0) AS invoiced,
              COALESCE(SUM(i.amount_paid),0) AS paid, COUNT(i.id) AS invoices
       FROM clients c
       JOIN invoices i ON i.client_id = c.id AND i.doc_type='invoice' AND i.status != 'cancelled'
       GROUP BY c.id ORDER BY invoiced DESC LIMIT ?`
    )
    .all(limit)
  res.json({ data: rows })
})
