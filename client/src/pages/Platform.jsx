import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'

export default function Platform() {
  const { notify, user } = useAuth()
  const isAdmin = user?.role === 'owner' || user?.role === 'admin'
  const [tab, setTab] = useState('flags')
  const [flags, setFlags] = useState([])
  const [audit, setAudit] = useState([])
  const [keys, setKeys] = useState([])
  const [branches, setBranches] = useState([])
  const [newKey, setNewKey] = useState(null)
  const [branchName, setBranchName] = useState('')
  const [keyName, setKeyName] = useState('')
  const [popia, setPopia] = useState(null)
  const [retention, setRetention] = useState([])
  const [webhooks, setWebhooks] = useState([])
  const [health, setHealth] = useState(null)
  const [backupStatus, setBackupStatus] = useState(null)
  const [hookUrl, setHookUrl] = useState('')
  const [hookEvents, setHookEvents] = useState('invoice.paid,ticket.closed')
  const [sessions, setSessions] = useState([])

  const load = () => {
    api('/api/v1/platform/flags').then((r) => setFlags(r.data || [])).catch(() => {})
    if (isAdmin) {
      api('/api/v1/platform/audit?limit=80').then((r) => setAudit(r.data || [])).catch(() => {})
      api('/api/v1/platform/api-keys').then((r) => setKeys(r.data || [])).catch(() => {})
      api('/api/v1/platform/popia/summary').then((r) => setPopia(r.data)).catch(() => {})
      api('/api/v1/platform/retention').then((r) => setRetention(r.data || [])).catch(() => {})
      api('/api/v1/platform/webhooks').then((r) => setWebhooks(r.data || [])).catch(() => {})
      api('/api/v1/platform/health-detail').then((r) => setHealth(r.data)).catch(() => {})
      api('/api/v1/platform/backup/status').then((r) => setBackupStatus(r.data)).catch(() => {})
    }
    api('/api/v1/platform/branches').then((r) => setBranches(r.data || [])).catch(() => {})
    api('/api/v1/platform/sessions').then((r) => setSessions(r.data || [])).catch(() => {})
  }

  useEffect(() => {
    load()
  }, [isAdmin])

  const toggleFlag = async (key, enabled) => {
    try {
      await api(`/api/v1/platform/flags/${key}`, { method: 'PUT', body: { enabled: !enabled } })
      notify(`Flag ${key} ${!enabled ? 'on' : 'off'}`)
      load()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const createKey = async () => {
    if (!keyName.trim()) return
    try {
      const r = await api('/api/v1/platform/api-keys', { method: 'POST', body: { name: keyName, role: 'staff' } })
      setNewKey(r.data.key)
      setKeyName('')
      notify('API key created — copy it now')
      load()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const revokeKey = async (id) => {
    if (!confirm('Revoke this API key?')) return
    try {
      await api(`/api/v1/platform/api-keys/${id}/revoke`, { method: 'POST' })
      notify('Key revoked')
      load()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const addBranch = async () => {
    if (!branchName.trim()) return
    try {
      await api('/api/v1/platform/branches', { method: 'POST', body: { name: branchName } })
      setBranchName('')
      notify('Branch added')
      load()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const TABS = [
    { id: 'flags', label: 'Feature flags' },
    { id: 'audit', label: 'Audit log' },
    { id: 'keys', label: 'API keys' },
    { id: 'branches', label: 'Branches' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'retention', label: 'Retention' },
    { id: 'backup', label: 'Backup' },
    { id: 'webhooks', label: 'Webhooks' },
    { id: 'popia', label: 'POPIA' },
    { id: 'monitor', label: 'Monitor' },
  ]

  return (
    <div className="space-y-3">
      <PageHeader
        title="Platform & trust"
        subtitle="Hestia-Earth · trust · retention · backup · webhooks · sessions"
        meta={[user?.role, "v2.1 hestia"]}
      />

      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              tab === t.id ? 'bg-accent/15 text-accent' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'flags' && (
        <div className="card p-3 space-y-2">
          <p className="text-xs text-slate-500">Toggle experimental and integration features.</p>
          {flags.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
              <div>
                <div className="text-sm font-medium">{f.key}</div>
                <div className="text-[11px] text-slate-500">{f.description}</div>
              </div>
              <button
                type="button"
                disabled={!isAdmin}
                onClick={() => toggleFlag(f.key, !!f.enabled)}
                className={`relative h-6 w-11 rounded-full transition ${f.enabled ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-600'} ${!isAdmin ? 'opacity-50' : ''}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${f.enabled ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card overflow-hidden">
          {!isAdmin ? (
            <p className="p-4 text-sm text-slate-500">Admin only</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white/90 dark:bg-slate-900/90 text-left text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-2 py-2">User</th>
                    <th className="px-2 py-2">Action</th>
                    <th className="px-2 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{(a.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                      <td className="px-2 py-1.5">{a.user_name || a.user_email || '—'}</td>
                      <td className="px-2 py-1.5 font-medium">{a.action}</td>
                      <td className="px-2 py-1.5 text-slate-500 truncate max-w-[200px]">{a.detail || ''}</td>
                    </tr>
                  ))}
                  {!audit.length && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                        No audit events yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'keys' && (
        <div className="card p-3 space-y-3">
          {!isAdmin ? (
            <p className="text-sm text-slate-500">Admin only</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <input className="input max-w-xs" placeholder="Key name" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
                <button type="button" className="btn-primary !text-xs" onClick={createKey}>
                  Create API key
                </button>
              </div>
              {newKey && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                  <div className="font-semibold mb-1">Copy this key now — it won&apos;t be shown again</div>
                  <code className="break-all select-all">{newKey}</code>
                  <button type="button" className="btn-ghost !text-[10px] mt-1" onClick={() => { navigator.clipboard?.writeText(newKey); notify('Copied') }}>
                    Copy
                  </button>
                </div>
              )}
              <ul className="text-xs space-y-1">
                {keys.map((k) => (
                  <li key={k.id} className="flex justify-between gap-2 border-b border-slate-100 dark:border-slate-800 py-1.5">
                    <span>
                      <span className="font-medium">{k.name}</span> · {k.key_prefix}… · {k.role}
                      {k.revoked ? <span className="text-red-600 ml-1">revoked</span> : null}
                    </span>
                    {!k.revoked && (
                      <button type="button" className="text-red-600 hover:underline" onClick={() => revokeKey(k.id)}>
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'branches' && (
        <div className="card p-3 space-y-3">
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <input className="input max-w-xs" placeholder="Branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
              <button type="button" className="btn-primary !text-xs" onClick={addBranch}>
                Add branch
              </button>
            </div>
          )}
          <ul className="text-sm space-y-1">
            {branches.map((b) => (
              <li key={b.id} className="flex justify-between border-b border-slate-100 dark:border-slate-800 py-1.5">
                <span className="font-medium">{b.name}</span>
                <span className="text-xs text-slate-500">{b.code || ''}</span>
              </li>
            ))}
            {!branches.length && <li className="text-slate-500 text-xs">No branches yet — enable multi_branch flag when ready</li>}
          </ul>
        </div>
      )}

      {tab === 'popia' && (
        <div className="card p-4 space-y-2 text-sm">
          <p className="text-xs text-slate-500">South African POPIA-oriented controls (summary).</p>
          {popia ? (
            <ul className="text-xs space-y-1">
              <li>Clients on file: <strong>{popia.clients}</strong></li>
              <li>Users: <strong>{popia.users}</strong></li>
              <li>Audit events: <strong>{popia.audit_events}</strong></li>
              <li>Strict mode: <strong>{popia.popia_strict ? 'on' : 'off'}</strong></li>
              <li className="text-slate-500 pt-2">{popia.note}</li>
            </ul>
          ) : (
            <p className="text-xs text-slate-500">Admin required for summary. Use Settings → Security for personal export.</p>
          )}
        </div>
      )}

      {tab === 'sessions' && (
        <div className="card p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-outline !text-xs"
              onClick={async () => {
                try {
                  await api('/api/v1/platform/sessions/revoke-all', { method: 'POST' })
                  notify('All your sessions revoked')
                  load()
                } catch (e) {
                  notify(e.message, 'error')
                }
              }}
            >
              Revoke all my sessions
            </button>
          </div>
          <ul className="text-xs space-y-1 max-h-80 overflow-auto">
            {(sessions || []).map((s) => (
              <li key={s.id} className="flex justify-between gap-2 border-b border-slate-100 dark:border-slate-800 py-1">
                <span className="truncate">
                  {(s.created_at || '').slice(0, 19)} · {s.ip || '—'} · {(s.user_agent || '').slice(0, 40)}
                  {s.revoked_at ? ' · revoked' : ''}
                </span>
                {!s.revoked_at && (
                  <button
                    type="button"
                    className="btn-outline !text-[10px] !py-0.5 shrink-0"
                    onClick={async () => {
                      try {
                        await api(`/api/v1/platform/sessions/${s.id}/revoke`, { method: 'POST' })
                        notify('Session revoked')
                        load()
                      } catch (e) {
                        notify(e.message, 'error')
                      }
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
            {!sessions?.length && <li className="text-slate-500">No sessions listed</li>}
          </ul>
        </div>
      )}

      {tab === 'retention' && isAdmin && (
        <div className="card p-3 space-y-3">
          <p className="text-xs text-slate-500">How long operational logs are kept. Purge deletes older rows.</p>
          <ul className="space-y-2">
            {retention.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium min-w-[140px]">{r.key}</span>
                <input
                  className="input !w-20 !text-xs"
                  type="number"
                  defaultValue={r.days}
                  id={`ret-${r.key}`}
                />
                <span className="text-xs text-slate-500">days</span>
                <button
                  type="button"
                  className="btn-outline !text-[10px]"
                  onClick={async () => {
                    const el = document.getElementById(`ret-${r.key}`)
                    try {
                      await api(`/api/v1/platform/retention/${r.key}`, {
                        method: 'PUT',
                        body: { days: Number(el?.value || r.days) },
                      })
                      notify('Policy updated')
                      load()
                    } catch (e) {
                      notify(e.message, 'error')
                    }
                  }}
                >
                  Save
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-primary !text-xs"
            onClick={async () => {
              if (!confirm('Purge data older than retention policies?')) return
              try {
                const r = await api('/api/v1/platform/retention/purge', { method: 'POST' })
                notify(`Purged: ${JSON.stringify(r.data.purged)}`)
              } catch (e) {
                notify(e.message, 'error')
              }
            }}
          >
            Run purge now
          </button>
        </div>
      )}

      {tab === 'backup' && isAdmin && (
        <div className="card p-3 space-y-3">
          <p className="text-xs text-slate-500">Download a JSON snapshot of core tables for off-site storage.</p>
          {backupStatus?.counts && (
            <ul className="text-xs grid grid-cols-2 sm:grid-cols-3 gap-1">
              {Object.entries(backupStatus.counts).map(([k, v]) => (
                <li key={k}>
                  {k}: <strong>{v}</strong>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn-primary !text-xs"
            onClick={async () => {
              try {
                const token = localStorage.getItem('said_token')
                const res = await fetch('/api/v1/platform/backup', {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                })
                if (!res.ok) throw new Error('Backup failed')
                const blob = await res.blob()
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `said-backup-${new Date().toISOString().slice(0, 10)}.json`
                a.click()
                notify('Backup downloaded')
              } catch (e) {
                notify(e.message, 'error')
              }
            }}
          >
            Download backup JSON
          </button>
        </div>
      )}

      {tab === 'webhooks' && isAdmin && (
        <div className="card p-3 space-y-3">
          <p className="text-xs text-slate-500">POST JSON to your URL on events (invoice.paid, ticket.closed, or *).</p>
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1 min-w-[180px]" placeholder="https://hooks.example/said" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
            <input className="input flex-1 min-w-[140px]" placeholder="events" value={hookEvents} onChange={(e) => setHookEvents(e.target.value)} />
            <button
              type="button"
              className="btn-primary !text-xs"
              onClick={async () => {
                try {
                  await api('/api/v1/platform/webhooks', {
                    method: 'POST',
                    body: { url: hookUrl, events: hookEvents },
                  })
                  setHookUrl('')
                  notify('Webhook added')
                  load()
                } catch (e) {
                  notify(e.message, 'error')
                }
              }}
            >
              Add
            </button>
            <button
              type="button"
              className="btn-outline !text-xs"
              onClick={async () => {
                try {
                  const r = await api('/api/v1/platform/webhooks/test', { method: 'POST', body: { event: 'test.ping' } })
                  notify(`Test sent to ${r.data.results?.length || 0} hook(s)`)
                } catch (e) {
                  notify(e.message, 'error')
                }
              }}
            >
              Test ping
            </button>
          </div>
          <ul className="text-xs space-y-1">
            {webhooks.map((w) => (
              <li key={w.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {w.url} · {w.events}
                </span>
                <button
                  type="button"
                  className="btn-outline !text-[10px] !py-0.5"
                  onClick={async () => {
                    await api(`/api/v1/platform/webhooks/${w.id}`, { method: 'DELETE' })
                    load()
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'monitor' && isAdmin && (
        <div className="card p-3">
          {!health ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : (
            <ul className="text-sm grid gap-2 sm:grid-cols-2">
              <li>Users: <strong>{health.users}</strong></li>
              <li>Open tickets: <strong>{health.open_tickets}</strong></li>
              <li>Unpaid invoices: <strong>{health.unpaid_invoices}</strong></li>
              <li>Audit (24h): <strong>{health.audit_24h}</strong></li>
              <li>API keys: <strong>{health.api_keys_active}</strong></li>
              <li>Webhooks: <strong>{health.webhooks_active}</strong></li>
              <li>Active sessions: <strong>{health.sessions_active}</strong></li>
              <li className="text-xs text-slate-500 sm:col-span-2">As of {health.at}</li>
            </ul>
          )}
        </div>
      )}

    </div>
  )
}
