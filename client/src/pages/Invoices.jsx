import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Invoices() {
  const { notify } = useAuth()
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('')

  useEffect(() => {
    const q = status ? `?status=${status}` : ''
    api(`/api/v1/invoices${q}`)
      .then((r) => setRows(r.data))
      .catch((e) => notify(e.message, 'error'))
  }, [status])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Invoices</h1>
          <p className="text-sm text-slate-500">Partial payments · Puppeteer PDF</p>
        </div>
        <Link className="btn-primary" to="/invoices/new">New invoice</Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {['', 'unpaid', 'partial', 'paid', 'overdue'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={`btn-outline !py-1 ${status === s ? '!border-brand !text-brand' : ''}`}
            onClick={() => setStatus(s)}
          >
            {s || 'all'}
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 dark:border-slate-800 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">Number</th>
              <th className="p-3">Client</th>
              <th className="p-3">Date</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/50 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="p-3">
                  <Link className="font-semibold text-brand hover:underline" to={`/invoices/${r.id}`}>
                    {r.number}
                  </Link>
                </td>
                <td className="p-3">{r.client_name}</td>
                <td className="p-3">{r.date}</td>
                <td className="p-3 capitalize">{r.status}</td>
                <td className="p-3 text-right font-semibold">R {Number(r.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-sm text-slate-500">No invoices</p>}
      </div>
    </div>
  )
}
