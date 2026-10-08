/**
 * Document render (SAID)
 * PDF-style templates (Hourly · Flat rate · Ad-hoc) + company defaults + document data.
 * Pricing model picks the layout; user can override template on the form.
 */

import { db } from '../db.js'
import { fill } from './pdf.js'

export function getCompanyLayer() {
  const co = db.prepare(`SELECT * FROM company WHERE id = 'main'`).get() || {}
  return {
    company_name: co.name || 'Company',
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

export function getDefaultTemplateId(docType = 'invoice', pricingModel = null) {
  return resolveTemplateForPricing(docType, pricingModel)
}

/** Map IT billing style → PDF foundation template */
export function resolveTemplateForPricing(docType = 'invoice', pricingModel = null) {
  const co = db.prepare(`SELECT * FROM company WHERE id = 'main'`).get() || {}
  const model = String(pricingModel || '').toLowerCase().replace(/[\s-]/g, '')
  const isQuote = docType === 'quote'
  if (model === 'hourly' || model === 'timeandmaterials' || model === 'tm') {
    return isQuote ? 'quote_hourly_cod' : 'invoice_hourly_cod'
  }
  if (model === 'flat' || model === 'flatrate' || model === 'package' || model === 'sla') {
    return isQuote ? 'quote_flatrate_cod' : 'invoice_flatrate_cod'
  }
  if (model === 'adhoc' || model === 'ad-hoc' || model === 'cod' || model === 'onceoff') {
    return isQuote ? 'quote_adhoc_cod' : 'invoice_adhoc_cod'
  }
  if (docType === 'quote') return co.quote_template_id || 'quote_flatrate_cod'
  if (docType === 'credit') return co.credit_template_id || 'credit_note'
  if (docType === 'ticket' || docType === 'jobcard') return 'job_card'
  return co.invoice_template_id || 'invoice_flatrate_cod'
}

export function loadTemplate(templateId) {
  if (!templateId) return null
  return db.prepare(`SELECT * FROM document_templates WHERE id = ?`).get(templateId) || null
}

function money(n) {
  return `R ${Number(n || 0).toFixed(2)}`
}
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Line rows matching PDF tables (Description | Qty | Rate | Amount) */
export function buildLinesHtml(lines = []) {
  return (lines || [])
    .map((l) => {
      const qty = Number(l.qty || 0)
      const price = Number(l.price || 0)
      return `<tr>
        <td>${esc(l.description)}</td>
        <td class="center">${qty}</td>
        <td class="right">${money(price)}</td>
        <td class="right">${money(qty * price)}</td>
      </tr>`
    })
    .join('')
}

/** Ad-hoc rate card rows */
export function buildRateCardHtml(lines = []) {
  if (!lines?.length) {
    return `<tr><td>Driver installation &amp; verification</td><td class="center">per device</td><td class="right">R 220.00</td><td>Essential for every device</td></tr>
<tr><td>Essential applications install</td><td class="center">per device</td><td class="right">R 150.00</td><td>Browser, PDF, media, security</td></tr>
<tr><td>Microsoft Office installation</td><td class="center">per device</td><td class="right">R 120.00</td><td>Customer-supplied licence</td></tr>`
  }
  return lines
    .map(
      (l) =>
        `<tr><td>${esc(l.description)}</td><td class="center">per unit</td><td class="right">${money(l.price)}</td><td>${esc(l.notes || '')}</td></tr>`
    )
    .join('')
}

export function invoiceInstanceVars(inv, client = null) {
  const lines = inv.lines || []
  const lines_html = buildLinesHtml(lines)
  const c = client || inv.client || {}
  const totalFmt = money(inv.total)
  const balanceFmt = money(Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)))

  return {
    doc_type: inv.doc_type || 'invoice',
    number: inv.number || '',
    invoice_number: inv.number || '',
    date: inv.date || '',
    invoice_date: inv.date || '',
    due_date: inv.due_date || '',
    status: inv.status || '',
    notes: inv.notes || '',
    po_number: inv.po_number || '',
    devices: inv.devices || '—',
    service_type: inv.service_type || '—',
    account_type: inv.account_type || 'COD Account',
    payment_note:
      inv.payment_note ||
      'Full payment due on completion and collection / hand-over, unless stated otherwise in writing. Cash, EFT (proof required) or instant payment. Devices released only after payment is confirmed.',
    exclusive: money(inv.exclusive),
    vat_amount: money(inv.vat_amount),
    total: totalFmt,
    amount_paid: money(inv.amount_paid),
    amount_due: balanceFmt,
    balance: balanceFmt,
    client_name: c.name || '',
    client_email: c.email || '',
    client_phone: c.phone || '',
    client_address: c.address || '',
    client_vat: c.vat_number || '',
    client_note: c.notes || '',
    lines_html,
    line_items_html: lines_html,
    lines_count: String(lines.length),
    intro:
      inv.intro ||
      'First-time client approach: clear pricing so you stay in control. We only charge for the services actually performed.',
    hourly_rate: inv.hourly_rate || 'R 480.00 / hour',
    hourly_rate_note: inv.hourly_rate_note || 'First-time client rate',
    minimum_charge: inv.minimum_charge || 'R 480.00',
    estimated_hours: inv.estimated_hours || '2.0 – 2.5 hours',
    estimated_hours_note: inv.estimated_hours_note || 'Typical for drivers + apps',
    estimated_range: inv.estimated_range || totalFmt,
    package_name: inv.package_name || inv.devices || 'COMPLETE JOB',
    package_save_note: inv.package_save_note || 'First-time COD Account client rate',
    vat_note: inv.vat_note || 'VAT: as applicable on final invoice.',
    exclusions:
      inv.exclusions ||
      'Microsoft Office licences, full Windows reinstall, data backup/transfer, malware removal, hardware repairs, or work outside the listed scope.',
    strategic_note:
      inv.strategic_note ||
      'You stay in control of cost. We only charge for real work delivered. This model builds trust — many long-term clients started exactly this way.',
    scope_html:
      inv.scope_html ||
      '<li>Driver installation &amp; verification</li><li>Essential applications</li><li>Microsoft Office installation (customer licence)</li><li>Critical Windows updates</li><li>Light optimisation</li><li>Travel within local area</li><li>14-day labour warranty</li>',
    rate_card_html: inv.rate_card_html || buildRateCardHtml(lines),
  }
}

/** Fill template HTML with company + document fields (no multi-layer API) */
export function renderDocument({ templateId, instanceVars = {}, fallbackHtml = null }) {
  const company = getCompanyLayer()
  const tpl = templateId ? loadTemplate(templateId) : null
  const baseHtml = (tpl?.html && String(tpl.html).trim()) || fallbackHtml
  if (!baseHtml) {
    throw new Error('No document template and no fallback HTML')
  }
  const merged = { ...company }
  for (const [k, v] of Object.entries(instanceVars || {})) {
    if (v !== undefined && v !== null) merged[k] = v
  }
  if (merged.number && !merged.invoice_number) merged.invoice_number = merged.number
  if (merged.lines_html && !merged.line_items_html) merged.line_items_html = merged.lines_html
  if (merged.total && !merged.amount_due) merged.amount_due = merged.balance || merged.total

  return {
    html: fill(baseHtml, merged),
    template_id: tpl?.id || null,
    template_label: tpl?.label || null,
  }
}

/** @deprecated use renderDocument */
export function renderThreeWay(opts) {
  return renderDocument(opts)
}

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
