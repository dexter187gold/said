/**
 * Hephaestus-Fire offline action queue
 * Prefers IndexedDB; falls back to localStorage
 * Flushes to POST /api/v1/field/sync when online
 */

const LS_KEY = 'said_offline_queue_v1'
const DB_NAME = 'said_field'
const DB_STORE = 'queue'
const DB_VER = 1

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'))
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'client_id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGetAll() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const req = tx.objectStore(DB_STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(entry) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(entry)
    tx.oncomplete = () => resolve(entry)
    tx.onerror = () => reject(tx.error)
  })
}

async function idbClear() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function lsGet() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]')
  } catch {
    return []
  }
}

function lsSet(q) {
  localStorage.setItem(LS_KEY, JSON.stringify(q.slice(-100)))
}

export async function getQueue() {
  try {
    return await idbGetAll()
  } catch {
    return lsGet()
  }
}

export async function enqueue(item) {
  const entry = {
    ...item,
    client_id: item.client_id || `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    queued_at: new Date().toISOString(),
  }
  try {
    await idbPut(entry)
  } catch {
    const q = lsGet()
    q.push(entry)
    lsSet(q)
  }
  try {
    const reg = await navigator.serviceWorker?.ready
    if (reg?.sync) await reg.sync.register('said-offline-sync')
  } catch {}
  return entry
}

export async function clearQueue() {
  try {
    await idbClear()
  } catch {}
  localStorage.removeItem(LS_KEY)
}

export async function flushQueue(api) {
  const q = await getQueue()
  if (!q.length) return { processed: 0 }
  if (!navigator.onLine) return { processed: 0, offline: true }
  const res = await api('/api/v1/field/sync', { method: 'POST', body: { items: q } })
  await clearQueue()
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
  if (navigator.onLine) setTimeout(run, 1500)
  return () => window.removeEventListener('online', run)
}

export async function queueSize() {
  const q = await getQueue()
  return q.length
}
