/** Shared professional job card HTML + WhatsApp templates (EA trust pack) */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}

function statusLabel(st) {
  const map = {
    open: 'Received — we have your job logged',
    in_progress: 'In progress — work is underway',
    waiting: 'Waiting — on hold (parts / client / approval)',
    resolved: 'Resolved — work complete, pending close',
    closed: 'Closed — job completed',
    archived: 'Archived',
  }
  return map[st] || st
}

function priorityLabel(p) {
  const map = { low: 'Standard', normal: 'Normal', high: 'Priority', urgent: 'Urgent' }
  return map[p] || p
}

/**
 * Build trust-focused job card HTML for print + PDF.
 * Subliminal trust: clear ownership, timeline, contact, next steps, professionalism.
 */
export function buildJobCardHtml(t, parts = [], opts = {}) {
  const company = opts.company || {}
  const hours = fmtTime(t.time_spent_seconds)
  const ref = (t.id || '').slice(0, 8).toUpperCase()
  const created = t.created_at ? String(t.created_at).slice(0, 16).replace('T', ' ') : '—'
  const updated = t.updated_at ? String(t.updated_at).slice(0, 16).replace('T', ' ') : '—'
  const sla = t.sla_due_at ? String(t.sla_due_at).slice(0, 16).replace('T', ' ') : null
  const partsRows = parts
    .map(
      (p) =>
        `<tr><td>${esc(p.name)}</td><td style="text-align:center">${esc(p.qty)}</td><td style="text-align:right">R ${Number(p.cost || 0).toFixed(2)}</td><td style="text-align:right">R ${(Number(p.qty || 0) * Number(p.cost || 0)).toFixed(2)}</td></tr>`
    )
    .join('')
  const partsTotal = parts.reduce((s, p) => s + Number(p.qty || 0) * Number(p.cost || 0), 0)
  const logo = company.logo_url
    ? `<img src="${esc(company.logo_url)}" alt="" style="max-height:48px;max-width:140px;object-fit:contain"/>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Job Card · ${esc(ref)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    margin: 0; padding: 0;
    color: #0f172a; background: #fff;
    font-size: 11.5px; line-height: 1.45;
  }
  .page { max-width: 210mm; margin: 0 auto; padding: 14mm 12mm; }
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 3px solid #007A4D; padding-bottom: 12px; margin-bottom: 14px;
  }
  .brand-name { font-size: 18px; font-weight: 800; color: #007A4D; letter-spacing: -0.02em; }
  .doc-title { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; }
  .ref { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .card {
    border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px;
    background: #f8fafc;
  }
  .card h3 {
    margin: 0 0 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;
    color: #64748b; font-weight: 700;
  }
  .card strong { color: #0f172a; }
  h1 { font-size: 16px; margin: 0 0 4px; font-weight: 800; }
  .status-pill {
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-size: 10px; font-weight: 700; background: #007A4D18; color: #007A4D;
  }
  .status-pill.warn { background: #f59e0b22; color: #b45309; }
  .status-pill.done { background: #10b98122; color: #047857; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; color: #64748b; padding: 6px 4px; border-bottom: 2px solid #e2e8f0; }
  td { padding: 6px 4px; border-bottom: 1px solid #f1f5f9; }
  .section { margin: 14px 0; }
  .section-title {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    color: #007A4D; margin-bottom: 6px; border-bottom: 1px solid #007A4D33; padding-bottom: 4px;
  }
  .desc {
    white-space: pre-wrap; background: #fff; border: 1px solid #e2e8f0;
    border-radius: 6px; padding: 10px; min-height: 48px;
  }
  .timeline { display: flex; gap: 8px; flex-wrap: wrap; }
  .tl-item {
    flex: 1; min-width: 100px; border-left: 3px solid #007A4D; padding-left: 8px;
  }
  .tl-item .l { font-size: 9px; color: #64748b; text-transform: uppercase; }
  .tl-item .v { font-weight: 600; }
  .assurance {
    background: linear-gradient(135deg, #007A4D0d, #0ea5e90d);
    border: 1px solid #007A4D33; border-radius: 8px; padding: 12px; margin-top: 14px;
  }
  .assurance h3 { margin: 0 0 6px; font-size: 11px; color: #007A4D; }
  .assurance ul { margin: 0; padding-left: 16px; color: #334155; }
  .assurance li { margin-bottom: 3px; }
  .sig-row { display: flex; gap: 24px; margin-top: 28px; }
  .sig-box { flex: 1; border-top: 1.5px solid #94a3b8; padding-top: 6px; min-height: 48px; }
  .sig-box .l { font-size: 9px; color: #64748b; text-transform: uppercase; }
  .footer {
    margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0;
    font-size: 9px; color: #64748b; display: flex; justify-content: space-between; gap: 12px;
  }
  .no-print { margin-top: 16px; }
  @media print {
    .no-print { display: none !important; }
    .page { padding: 8mm; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      ${logo}
      <div class="brand-name">${esc(company.name || t.company_name || 'SA Invoice Desk')}</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px">
        ${esc(company.phone || t.company_phone || '')}
        ${company.email ? ' · ' + esc(company.email) : ''}
      </div>
      ${company.address || t.company_address ? `<div style="font-size:10px;color:#64748b">${esc(company.address || t.company_address)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="doc-title">Official Job Card</div>
      <div class="ref">JC-${esc(ref)}</div>
      <div style="margin-top:6px">
        <span class="status-pill ${['resolved', 'closed'].includes(t.status) ? 'done' : t.status === 'waiting' ? 'warn' : ''}">${esc(statusLabel(t.status))}</span>
      </div>
    </div>
  </div>

  <h1>${esc(t.title)}</h1>
  <p style="margin:0 0 12px;color:#64748b">
    ${esc(priorityLabel(t.priority))} priority
    ${t.category ? ' · ' + esc(t.category) : ''}
    ${t.warranty ? ' · <strong style="color:#b45309">Warranty job</strong>' : ''}
  </p>

  <div class="grid">
    <div class="card">
      <h3>Client</h3>
      <div><strong>${esc(t.client_name || '—')}</strong></div>
      <div>${esc(t.client_phone || '')}</div>
      <div>${esc(t.client_address || '')}</div>
    </div>
    <div class="card">
      <h3>Assigned technician</h3>
      <div><strong>${esc(t.assignee_name || 'Being assigned')}</strong></div>
      <div>You have a dedicated contact for this job.</div>
      ${sla ? `<div style="margin-top:4px"><strong>Target completion:</strong> ${esc(sla)}</div>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Work description</div>
    <div class="desc">${esc(t.description || 'Details will be updated as diagnosis progresses.')}</div>
  </div>

  ${
    parts.length
      ? `<div class="section">
    <div class="section-title">Parts & materials</div>
    <table>
      <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Line</th></tr></thead>
      <tbody>${partsRows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;padding-top:8px">Parts total</td><td style="text-align:right;font-weight:700;padding-top:8px">R ${partsTotal.toFixed(2)}</td></tr></tfoot>
    </table>
  </div>`
      : ''
  }

  <div class="section">
    <div class="section-title">Progress timeline</div>
    <div class="timeline">
      <div class="tl-item"><div class="l">Logged</div><div class="v">${esc(created)}</div></div>
      <div class="tl-item"><div class="l">Last update</div><div class="v">${esc(updated)}</div></div>
      <div class="tl-item"><div class="l">Time on job</div><div class="v">${esc(hours)}</div></div>
      ${t.resolved_at ? `<div class="tl-item"><div class="l">Resolved</div><div class="v">${esc(String(t.resolved_at).slice(0, 16).replace('T', ' '))}</div></div>` : ''}
    </div>
  </div>

  ${t.notes ? `<div class="section"><div class="section-title">Technician notes</div><div class="desc">${esc(t.notes)}</div></div>` : ''}

  <div class="assurance">
    <h3>Our commitment to you</h3>
    <ul>
      <li>This job is tracked under reference <strong>JC-${esc(ref)}</strong> — quote this if you contact us.</li>
      <li>Status updates are recorded; you can ask for a copy of this job card anytime.</li>
      <li>Work is performed by trained staff${t.assignee_name ? ` (currently: ${esc(t.assignee_name)})` : ''}.</li>
      <li>Parts used are listed above for full transparency${t.warranty ? ' · this job is under warranty cover' : ''}.</li>
      <li>If anything is unclear, call us — we are happy to explain the next step.</li>
    </ul>
  </div>

  <div class="sig-row">
    <div class="sig-box"><div class="l">Technician signature / name</div></div>
    <div class="sig-box"><div class="l">Customer acknowledgement</div></div>
  </div>

  <div class="footer">
    <span>${esc(company.name || 'SAID')} · Professional field service</span>
    <span>Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · Page 1</span>
  </div>

  <div class="no-print">
    <button onclick="window.print()" style="padding:10px 18px;font-size:13px;background:#007A4D;color:#fff;border:none;border-radius:8px;cursor:pointer">Print job card</button>
  </div>
</div>
</body>
</html>`
}

/**
 * WhatsApp-friendly job card message (Unicode formatting WhatsApp supports).
 * Builds comfort + trust: who, what status, what happens next, how to reach us.
 */
export function buildJobCardWhatsApp(t, parts = [], opts = {}) {
  const company = opts.company || {}
  const ref = (t.id || '').slice(0, 8).toUpperCase()
  const hours = fmtTime(t.time_spent_seconds)
  const coName = company.name || t.company_name || 'our team'
  const tech = t.assignee_name || 'our technician'
  const clientFirst = (t.client_name || 'there').split(/\s+/)[0]

  const statusLines = {
    open: '✅ *Received*\nWe have logged your job and it is in our queue.',
    in_progress: '🔧 *In progress*\nWork is actively underway on your equipment / site.',
    waiting: '⏳ *On hold*\nWe are waiting on a part, approval, or information — we will update you as soon as we can proceed.',
    resolved: '✨ *Resolved*\nThe work is complete. Please review and let us know if anything needs attention.',
    closed: '🏁 *Closed*\nThis job is complete. Thank you for trusting us.',
  }

  const partsBlock =
    parts.length > 0
      ? '\n*Parts / materials*\n' +
        parts
          .slice(0, 12)
          .map((p) => `• ${p.name} × ${p.qty}${p.cost ? ` — R${Number(p.cost).toFixed(2)}` : ''}`)
          .join('\n') +
        '\n'
      : ''

  const nextStep = {
    open: 'Next: we will assign a technician and begin diagnosis.',
    in_progress: 'Next: we continue work and will confirm when ready for collection / sign-off.',
    waiting: 'Next: once the hold is cleared, work resumes without delay.',
    resolved: 'Next: arrange collection or on-site sign-off if not already done.',
    closed: 'Next: keep this message for your records. We are here if you need follow-up.',
  }

  return (
    `Hi ${clientFirst} 👋\n\n` +
    `*${coName} — Job Card*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📋 *Ref:* JC-${ref}\n` +
    `📌 *Job:* ${t.title}\n` +
    `${statusLines[t.status] || `Status: ${t.status}`}\n\n` +
    `👤 *Technician:* ${tech}\n` +
    (t.category ? `🏷 *Type:* ${t.category}\n` : '') +
    (t.warranty ? `🛡 *Warranty job*\n` : '') +
    `⏱ *Time logged:* ${hours}\n` +
    partsBlock +
    `\n*What this means for you*\n` +
    `${nextStep[t.status] || 'We will keep you informed.'}\n\n` +
    `Your job is tracked in our system under *JC-${ref}*. ` +
    `If you have questions, reply here or call ${company.phone || t.company_phone || 'us'} — ` +
    `we are happy to explain anything in plain language.\n\n` +
    `_Thank you for your trust._\n` +
    `— ${coName}`
  )
}

export function saPhoneToWa(phone) {
  if (!phone) return ''
  let p = String(phone).replace(/\D/g, '')
  if (p.startsWith('0')) p = '27' + p.slice(1)
  if (p.startsWith('+')) p = p.slice(1)
  return p
}
