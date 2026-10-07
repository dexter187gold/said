import { z } from 'zod'
import { db, uid, now } from '../db.js'
import { requireRole } from '../middleware/auth.js'

/** Attach timer + manual time-log routes to the tickets router */
export function mountTicketTimers(ticketsRouter) {
  // Timer start
  ticketsRouter.post('/:id/timer/start', requireRole('staff'), (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    if (t.timer_started_at) return res.status(400).json({ error: true, message: 'Timer already running' })
    const ts = now()
    db.prepare('UPDATE tickets SET timer_started_at=?, status=CASE WHEN status=? THEN ? ELSE status END, updated_at=? WHERE id=?')
      .run(ts, 'open', 'in_progress', ts, req.params.id)
    const entryId = uid()
    db.prepare(
      `INSERT INTO ticket_time_entries (id, ticket_id, user_id, user_name, started_at, seconds, created_at)
       VALUES (?,?,?,?,?,0,?)`
    ).run(entryId, req.params.id, req.user.sub, req.user.name || req.user.email, ts, ts)
    res.json({ data: { timer_started_at: ts, entry_id: entryId } })
  })

  // Timer stop
  ticketsRouter.post('/:id/timer/stop', requireRole('staff'), (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: true, message: 'Not found' })
    if (!t.timer_started_at) return res.status(400).json({ error: true, message: 'No timer running' })
    const end = now()
    const startMs = new Date(t.timer_started_at).getTime()
    const seconds = Math.max(0, Math.round((Date.now() - startMs) / 1000))
    db.prepare(
      `UPDATE tickets SET time_spent_seconds = time_spent_seconds + ?, timer_started_at=NULL, updated_at=? WHERE id=?`
    ).run(seconds, end, req.params.id)
    const openEntry = db.prepare(
      `SELECT id FROM ticket_time_entries WHERE ticket_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
    ).get(req.params.id)
    if (openEntry) {
      db.prepare(`UPDATE ticket_time_entries SET ended_at=?, seconds=? WHERE id=?`)
        .run(end, seconds, openEntry.id)
    }
    res.json({
      data: {
        seconds_added: seconds,
        time_spent_seconds: db.prepare('SELECT time_spent_seconds FROM tickets WHERE id=?').get(req.params.id).time_spent_seconds,
      },
    })
  })

  // Manual time log
  ticketsRouter.post('/:id/time', requireRole('staff'), (req, res, next) => {
    try {
      const body = z.object({
        seconds: z.number().int().positive(),
        note: z.string().optional().nullable(),
      }).parse(req.body)
      const t = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.id)
      if (!t) return res.status(404).json({ error: true, message: 'Not found' })
      const id = uid()
      const ts = now()
      db.prepare(
        `INSERT INTO ticket_time_entries (id, ticket_id, user_id, user_name, started_at, ended_at, seconds, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(id, req.params.id, req.user.sub, req.user.name || req.user.email, ts, ts, body.seconds, body.note || null, ts)
      db.prepare('UPDATE tickets SET time_spent_seconds = time_spent_seconds + ?, updated_at=? WHERE id=?')
        .run(body.seconds, ts, req.params.id)
      res.status(201).json({ data: db.prepare('SELECT * FROM ticket_time_entries WHERE id=?').get(id) })
    } catch (e) {
      next(e)
    }
  })
}
