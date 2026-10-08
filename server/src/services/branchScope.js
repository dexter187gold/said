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


export function isFlagEnabled(key) {
  try {
    return db.prepare(`SELECT enabled FROM feature_flags WHERE key = ?`).get(key)?.enabled === 1
  } catch {
    return false
  }
}

/** Block non-admin staff from mutations if branch_required and they have no branch */
export function assertStaffHasBranch(req) {
  if (!isFlagEnabled('branch_required')) return null
  if (isBranchAdmin(req.user)) return null
  try {
    const row = db.prepare(`SELECT branch_id FROM users WHERE id = ?`).get(req.user?.sub)
    if (!row?.branch_id) {
      const err = new Error('Branch required: ask an admin to assign your branch')
      err.status = 403
      err.code = 'BRANCH_REQUIRED'
      return err
    }
  } catch {
    return null
  }
  return null
}
