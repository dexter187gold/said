import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Clients() {
  const { notify } = useAuth()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ name: '', email: '', phone: '' })

  const load = () => api('/api/v1/clients').then((r) => setRows(r.data))
  useEffect(() => {
    load().catch((e) => notify(e.message, 'error'))
  }, [])

  const save = async (e) => {
    e.preventDefault()
    try {
      await api('/api/v1/clients', { method: 'POST', body: form })
      setForm({ name: '', email: '', phone: '' })
      notify('Client added')
      load()
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold">Clients</h1>
      <form className="card mt-4 grid gap-3 p-4 sm:grid-cols-4" onSubmit={save}>
        <input className="input" placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button className="btn-primary" type="submit">Add</button>
      </form>
      <div className="mt-4 space-y-2">
        {rows.map((c) => (
          <div key={c.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <strong>{c.name}</strong>
            <span className="text-slate-500">{c.email}</span>
            <span className="text-slate-500">{c.phone}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
