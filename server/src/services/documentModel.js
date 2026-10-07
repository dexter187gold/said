/**
 * 3-way document model (SAID)
 *
 * Layer 1 — LAYOUT: system/custom HTML template (structure only, {{placeholders}})
 * Layer 2 — COMPANY: logo, name, VAT, bank, address from company + settings
 * Layer 3 — INSTANCE: this invoice/ticket/quote data (client, lines, status, dates)
 *
 * Flow: Template → fill company vars → fill instance vars → HTML / PDF
 */

import { db } from '../db.js'
import { fill } from './pdf.js'

export function getCompanyLayer() {
  const co = db.prepare(`SELECT * FROM company WHERE id = 'main'`).get() || {}
  return {
    company_name: co.name || '',
    company_email: co.email || '',
    company_phone: co.phone || '',
    company_address: co.address || '',
    company_vat: co.vat_number || '',
    company_website: co.website || '',
    company_bank: co.bank_name || '',
    company_account: co.account_number || '',
    company_branch: co.branch_code || '',
    company_logo: co.logo_url || '',
    currency: co.currency || 'ZAR',
    default_vat_rate: co.default_vat_rate ?? 15,
    invoice_prefix: co.invoice_prefix || 'INV',
    footer_note: co.footer_note || '',
    terms_default: co.terms_default || '',
    business_type: co.business_type || 'general',
  }
}

export function getDefaultTemplateId(docType = 'invoice') {
  const co = db.prepare(`SELECT invoice_template_id FROM company WHERE id = 'main'`).get()
  if (docType === 'invoice' || docType === 'quote' || docType === 'credit') {
    return co?.invoice_template_id || 'tax_invoice_full'
  }
  if (docType === 'ticket' || docType === 'jobcard') {
    return 'vehicle_job_card' // fallback system template if exists; else built-in job card
  }
  return null
}

export function loadTemplate(templateId) {
  if (!templateId) return null
  return db.prepare(`SELECT * FROM document_templates WHERE id = ?`).get(templateId) || null
}

/** Build vars for an invoice-like document (layer 3) */
export function invoiceInstanceVars(inv, client = null) {
  const lines = inv.lines || []
  const lines_html = lines
    .map(
      (l) =>
        `<tr><td>${esc(l.description)}</td><td>${l.qty}</td><td>${money(l.price)}</td><td>${money(Number(l.qty) * Number(l.price))}</td></tr>`
    )
    .join('')
  const c = client || inv.client || {}
  return {
    doc_type: inv.doc_type || 'invoice',
    number: inv.number || '',
    date: inv.date || '',
    due_date: inv.due_date || '',
    status: inv.status || '',
    notes: inv.notes || '',
    po_number: inv.po_number || '',
    devices: inv.devices || '',
    service_type: inv.service_type || '',
    payment_note: inv.payment_note || '',
    exclusive: money(inv.exclusive),
    vat_amount: money(inv.vat_amount),
    total: money(inv.total),
    amount_paid: money(inv.amount_paid),
    balance: money(Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))),
    client_name: c.name || '',
    client_email: c.email || '',
    client_phone: c.phone || '',
    client_address: c.address || '',
    client_vat: c.vat_number || '',
    lines_html,
    lines_count: String(lines.length),
  }
}

function money(n) {
  return `R ${Number(n || 0).toFixed(2)}`
}
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Resolve full HTML: Layer1 template + Layer2 company + Layer3 instance
 */
export function renderThreeWay({ templateId, instanceVars = {}, fallbackHtml = null }) {
  const company = getCompanyLayer()
  const tpl = templateId ? loadTemplate(templateId) : null
  const baseHtml = tpl?.html || fallbackHtml
  if (!baseHtml) {
    throw new Error('No layout template (layer 1) and no fallback HTML')
  }
  const merged = { ...company, ...instanceVars }
  return {
    html: fill(baseHtml, merged),
    template_id: tpl?.id || null,
    template_label: tpl?.label || null,
    layers: {
      layout: tpl?.id || 'fallback',
      company: company.company_name || '(company)',
      instance_keys: Object.keys(instanceVars),
    },
  }
}

/** List templates suitable as layout bases (blank structure) */
export function listLayoutTemplates(category = null) {
  let sql = `SELECT id, label, category, business_types, description, is_system FROM document_templates WHERE 1=1`
  const params = []
  if (category) {
    sql += ` AND category = ?`
    params.push(category)
  }
  sql += ` ORDER BY is_system DESC, category, label`
  return db.prepare(sql).all(...params)
}
