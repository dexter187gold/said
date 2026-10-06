const API = import.meta.env.VITE_API_URL || ''

function token() {
  return localStorage.getItem('said_token')
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {}
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const t = token()
  if (t) headers.Authorization = `Bearer ${t}`
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
  })
  if (raw) return res
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || res.statusText || 'Request failed')
  return data
}

export function setToken(t) {
  if (t) localStorage.setItem('said_token', t)
  else localStorage.removeItem('said_token')
}
