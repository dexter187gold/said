/**
 * Hephaestus-Fire offline action queue (localStorage)
 * Flushes to POST /api/v1/field/sync when online
 */
const KEY = 'said_offline_queue_v1'

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export function enqueue(item) {
  const q = getQueue()
  const entry = {
    ...item,
    client_id: item.client_id || `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    queued_at: new Date().toISOString(),
  }
  q.push(entry)
  localStorage.setItem(KEY, JSON.stringify(q.slice(-100)))
  return entry
}

export function clearQueue() {
  localStorage.removeItem(KEY)
}

export async function flushQueue(api) {
  const q = getQueue()
  if (!q.length) return { processed: 0 }
  if (!navigator.onLine) return { processed: 0, offline: true }
  const res = await api('/api/v1/field/sync', { method: 'POST', body: { items: q } })
  clearQueue()
  return res.data || { processed: q.length }
}

export function registerOnlineFlush(api, notify) {
  const run = async () => {
    try {
      const r = await flushQueue(api)
      if (r.processed > 0 && notify) notify(`Synced ${r.processed} offline action(s)`)
    } catch {}
  }
  window.addEventListener('online', run)
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'SAID_OFFLINE_SYNC') run()
    })
  }
  // attempt on load
  if (navigator.onLine) setTimeout(run, 1500)
  return () => window.removeEventListener('online', run)
}
