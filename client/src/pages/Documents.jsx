import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Documents() {
  const { notify } = useAuth()
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('invoice_cover')
  const [vars, setVars] = useState({
    client_name: '',
    company_name: 'SA Invoice Desk',
    company_address: 'Johannesburg, South Africa',
    amount_due: '0.00',
    invoice_number: '',
    due_date: '',
    payment_note: 'EFT preferred.',
    site_address: '',
    technician: '',
    devices: '',
    service_type: '',
    notes: '',
  })

  useEffect(() => {
    api('/api/v1/documents/templates')
      .then((r) => {
        setTemplates(r.data)
        if (r.data[0]) setTemplateId(r.data[0].id)
      })
      .catch((e) => notify(e.message, 'error'))
  }, [])

  const download = async () => {
    try {
      const res = await api('/api/v1/documents/render', {
        method: 'POST',
        body: { template_id: templateId, variables: vars, format: 'pdf' },
        raw: true,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || 'Render failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${templateId}.pdf`
      a.click()
      notify('PDF downloaded')
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold">Documents</h1>
      <p className="text-sm text-slate-500">Template variables → Puppeteer PDF</p>

      <div className="card mt-4 space-y-3 p-4">
        <div>
          <label className="label">Template</label>
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.keys(vars).map((k) => (
            <div key={k}>
              <label className="label">{`{{${k}}}`}</label>
              <input
                className="input"
                value={vars[k]}
                onChange={(e) => setVars({ ...vars, [k]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button type="button" className="btn-primary" onClick={download}>
          Download PDF
        </button>
      </div>
    </div>
  )
}
