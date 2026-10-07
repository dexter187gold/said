import React from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import AppLogo from '../components/AppLogo'

const FEATURES = [
  { t: 'Tax invoices', d: 'SA VAT-ready invoices with line items, payments, and PDF export.' },
  { t: 'Quotes', d: 'Send quotes before work starts; convert to invoices when accepted.' },
  { t: 'Credit notes', d: 'Issue credit notes against invoices for refunds or adjustments.' },
  { t: 'Tickets + timer', d: 'Support desk with live timer, categories, tags, and time logs.' },
  { t: 'Doc generator', d: '130+ business templates — filter by industry and download PDF.' },
  { t: 'Template designer', d: 'Edit HTML templates with live preview and variables.' },
  { t: 'Clients CRM', d: 'Central client records linked to invoices, tickets, and docs.' },
  { t: 'Settings', d: 'Company profile, VAT, bank details, business type defaults.' },
]

export default function About() {
  return (
    <div>
      <PageHeader
        title="About SAID"
        subtitle="SA Invoice Desk — built for South African SMEs"
        meta={['v1.2.0', 'Express · SQLite · React', 'Puppeteer PDF']}
      />

      <div className="card p-5 sm:p-6 flex flex-col sm:flex-row gap-4 items-start">
        <AppLogo size={64} />
        <div className="min-w-0 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <p>
            <strong className="text-slate-900 dark:text-white">SA Invoice Desk (SAID)</strong> is a
            full-stack invoicing and operations desk for local businesses — PC repair, IT, construction,
            consulting, medical, and more.
          </p>
          <p>
            Designed for clarity on desktop and mobile: collapsible sidebar, swipe gestures, dark mode,
            and document workflows that match SA tax practice (VAT 15%, ZAR, bank EFT details).
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link className="btn-primary !text-xs" to="/documents">Open doc generator</Link>
            <Link className="btn-outline !text-xs" to="/settings">Company settings</Link>
          </div>
        </div>
      </div>

      <h2 className="mt-6 mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Capabilities</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.t} className="card p-3.5">
            <div className="font-semibold text-sm text-brand">{f.t}</div>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">{f.d}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 card p-4 text-xs text-slate-500 space-y-1">
        <div><strong className="text-slate-700 dark:text-slate-300">Default login</strong> · admin@said.local / admin123</div>
        <div><strong className="text-slate-700 dark:text-slate-300">Stack</strong> · Node/Express, better-sqlite3, JWT, React, Vite, Tailwind, Puppeteer</div>
        <div><strong className="text-slate-700 dark:text-slate-300">Gestures</strong> · Swipe left to hide menu · swipe right to show · works on all pages</div>
        <div><strong className="text-slate-700 dark:text-slate-300">Repo</strong> · github.com/dexter187gold/said</div>
      </div>
    </div>
  )
}
