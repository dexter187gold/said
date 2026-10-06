import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

const FAQ = [
  { q: 'Create invoice', a: 'Invoices → New. Pick client, add lines, Save. PDF via the PDF button.' },
  { q: 'Partial payment', a: 'Open invoice → Log payment. Status becomes partial until fully paid.' },
  { q: 'Tickets desk', a: 'Tickets: list left, thread right. Post internal notes with the Internal toggle.' },
  { q: 'Documents PDF', a: 'Documents → choose template, fill variables, Download PDF (Puppeteer).' },
  { q: 'Roles', a: 'owner/admin/staff can write; viewer is read-only on mutating routes.' },
]

const HINTS = {
  '/': ['Welcome to SAID. Start with Invoices or Tickets.', 'Glass logo marks the SA Invoice Desk brand.'],
  '/invoices': ['Filter by status. Open a row to edit or download PDF.'],
  '/invoices/new': ['Client is required. VAT defaults to 15%.'],
  '/tickets': ['Two-column desk: select a ticket to open the thread.', 'Urgent tickets sort first.'],
  '/documents': ['Templates support {{client_name}} style variables.'],
  '/clients': ['Add clients before invoicing.'],
  '/login': ['Default: admin@said.local / admin123'],
}

export function useAssistant() {
  const { pathname } = useLocation()
  const hints = useMemo(() => {
    if (HINTS[pathname]) return HINTS[pathname]
    if (pathname.startsWith('/invoices/')) return ['Edit lines, save, or download PDF.']
    return HINTS['/']
  }, [pathname])
  const search = (q) => {
    const s = String(q || '').toLowerCase()
    if (!s) return FAQ
    return FAQ.filter((f) => f.q.toLowerCase().includes(s) || f.a.toLowerCase().includes(s))
  }
  return { pathname, hints, search, faq: FAQ }
}
