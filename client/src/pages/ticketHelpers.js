export const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
export const PRIOS = ['low', 'normal', 'high', 'urgent']
export const CATS = ['support', 'repair', 'install', 'billing', 'sales', 'other']

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${m}m ${r}s`
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}
