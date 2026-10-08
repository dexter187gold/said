/**
 * Hestia-Earth — branch isolation for non-admin staff
 * Admin/owner see all; staff with branch_id are scoped unless ?branch_id=all (ignored for staff)
 */
import { db } from '../db.js'

export function isBranchAdmin(user) {
  return user?.role === 'admin' || user?.role === 'owner'
}

export function resolveBranchScope(req) {
  const userId = req.user?.sub
  if (!userId) return { scoped: false, branchId: null }
  if (isBranchAdmin(req.user)) {
    // admin may still filter via query
    return { scoped: false, branchId: req.query.branch_id || null, admin: true }
  }
  try {
    const row = db.prepare(`SELECT branch_id FROM users WHERE id = ?`).get(userId)
    if (row?.branch_id) {
      return { scoped: true, branchId: row.branch_id, admin: false }
    }
  } catch {}
  return { scoped: false, branchId: null, admin: false }
}
