/**
 * PC REPAIR DEX–style quote layouts (Hourly · Flat rate · Ad-hoc COD)
 * Layer 1 templates: structure only; company + instance filled via {{placeholders}}.
 * Designed to match professional SA first-time COD account quotes.
 */

const sharedCss = `
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #0f172a; margin: 0; padding: 0; font-size: 10.5px; line-height: 1.45;
  }
  .page { max-width: 210mm; margin: 0 auto; padding: 12mm 14mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .co-name { font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; }
  .co-meta { font-size: 9.5px; color: #64748b; margin-top: 2px; }
  .doc-meta { text-align: right; font-size: 10px; }
  .doc-meta .num { font-weight: 800; color: #0ea5e9; font-size: 12px; }
  .banner {
    background: #f59e0b; color: #0f172a; font-weight: 800; font-size: 11px;
    padding: 8px 12px; border-radius: 4px; margin: 10px 0 12px;
    display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  }
  .banner.blue { background: #0ea5e9; color: #fff; }
  .banner.green { background: #007A4D; color: #fff; }
  .banner .tag { font-weight: 600; font-size: 9.5px; opacity: 0.95; }
  .info-grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0;
    border: 1px solid #e2e8f0; border-radius: 4px; overflow: hidden; margin-bottom: 10px;
  }
  .info-cell { padding: 8px 10px; border-right: 1px solid #e2e8f0; background: #f8fafc; }
  .info-cell:last-child { border-right: none; }
  .info-cell .l { font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; font-weight: 700; margin-bottom: 3px; }
  .info-cell .v { font-weight: 600; font-size: 10.5px; }
  .intro { margin: 8px 0 12px; color: #334155; }
  h2 { font-size: 11px; font-weight: 800; margin: 14px 0 6px; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  th {
    background: #1e3a5f; color: #fff; text-align: left; padding: 6px 8px;
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  th.amber { background: #b45309; }
  th.green { background: #007A4D; }
  td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .right { text-align: right; }
  .center { text-align: center; }
  .price-box {
    background: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 6px;
    padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;
    margin: 8px 0 12px;
  }
  .price-box .label { font-weight: 700; font-size: 12px; }
  .price-box .amount { font-size: 22px; font-weight: 800; color: #0ea5e9; }
  .price-box .save { font-size: 10px; color: #047857; font-weight: 600; }
  .note { font-size: 9.5px; color: #64748b; margin: 6px 0; }
  .terms { font-size: 9px; color: #475569; }
  .terms p { margin: 4px 0; }
  .sig-row { display: flex; gap: 20px; margin-top: 28px; }
  .sig-box { flex: 1; border-top: 1px solid #94a3b8; padding-top: 6px; min-height: 40px; font-size: 9px; color: #64748b; }
  .footer {
    margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0;
    font-size: 8.5px; color: #94a3b8; text-align: center;
  }
  ul.inc { margin: 4px 0 8px; padding-left: 16px; }
  ul.inc li { margin-bottom: 2px; }
  .badge-line { font-size: 9px; color: #64748b; margin-bottom: 4px; }
`

function page(bannerClass, bannerTitle, bannerSub, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${sharedCss}</style></head><body>
<div class="page">
  <div class="header">
    <div>
      <div class="co-name">{{company_name}}</div>
      <div class="co-meta">{{company_address}}</div>
      <div class="co-meta">{{company_phone}} · {{company_email}}</div>
      <div class="co-meta">IT Support · Device Setup · Drivers &amp; Software</div>
    </div>
    <div class="doc-meta">
      <div class="num">QUOTE · {{number}}</div>
      <div>Date: {{date}}</div>
      <div>Valid until: {{due_date}}</div>
      <div>Account Type: {{account_type}}</div>
    </div>
  </div>
  <div class="banner ${bannerClass}">
    <span>${bannerTitle}</span>
    <span class="tag">${bannerSub}</span>
  </div>
  <div class="info-grid">
    <div class="info-cell"><div class="l">Client</div><div class="v">{{client_name}}</div><div class="badge-line">{{client_note}}</div></div>
    <div class="info-cell"><div class="l">Devices</div><div class="v">{{devices}}</div></div>
    <div class="info-cell"><div class="l">Service type</div><div class="v">{{service_type}}</div></div>
  </div>
  <p class="intro">{{intro}}</p>
  ${body}
  <div class="footer">
    {{company_name}} · {{company_address}} · {{company_phone}}<br/>
    This is a quotation, not a tax invoice. A tax invoice can be issued on request after payment.
  </div>
</div>
</body></html>`
}

const termsBlock = `
  <h2>STANDARD TERMS &amp; CONDITIONS</h2>
  <div class="terms">
    <p>These terms reference the Consumer Protection Act 68 of 2008 (CPA), the Protection of Personal Information Act 4 of 2013 (POPIA) and South African common law.</p>
    <p><strong>5.1 Acceptance</strong> — Accepting this quote (in writing, electronically or by handing over devices) creates a binding agreement on these terms.</p>
    <p><strong>5.2 Scope</strong> — Only the services listed are included. Extra work (hardware faults, data recovery, full OS reinstall, malware removal) is quoted separately.</p>
    <p><strong>5.3 Data</strong> — Customer is responsible for all backups. {{company_name}} accepts no liability for data loss. Backup service available on request.</p>
    <p><strong>5.4 Software Licences</strong> — Customer must supply valid licences / product keys / Microsoft accounts for Microsoft Office and any other paid software. Installation of unlicensed software is not performed.</p>
    <p><strong>5.5 Labour Warranty</strong> — 14 calendar days on workmanship. Does not cover later updates, user changes, malware or hardware failure.</p>
    <p><strong>5.6 Liability</strong> — Total liability is limited to the amount paid under this quote (to the maximum allowed by the CPA).</p>
    <p><strong>5.7 POPIA</strong> — Minimal personal information is processed only to deliver the service and invoice. Not shared with third parties except as required by law.</p>
    <p><strong>5.8 Independent Contractor</strong> — {{company_name}} acts as an independent contractor. No employment or partnership is created.</p>
    <p><strong>5.9 Cancellation</strong> — Free cancellation before work starts. Once work has begun, reasonable costs already incurred are payable.</p>
    <p><strong>5.10 Law</strong> — Governed by the laws of South Africa. Disputes first attempted amicably.</p>
    <p><strong>5.11 CPA</strong> — Nothing here limits any non-excludable rights under the Consumer Protection Act 68 of 2008.</p>
  </div>
  <h2>ACCEPTANCE</h2>
  <p class="note">Signature or electronic confirmation + provision of devices = acceptance of this quote and the terms above.</p>
  <div class="sig-row">
    <div class="sig-box">Customer / Authorised Signatory</div>
    <div class="sig-box">Date</div>
    <div class="sig-box">{{company_name}}</div>
  </div>
`

export const PC_REPAIR_QUOTE_TEMPLATES = [
  {
    id: 'quote_hourly_cod',
    label: 'Quote — Hourly model (COD)',
    category: 'Sales',
    business_types: 'pc_repair,it,msp,all',
    description: 'Transparent time-based pricing · first-time COD clients',
    html: page(
      'blue',
      'HOURLY MODEL',
      'Transparent time-based pricing · Ideal for first-time clients who want full control',
      `
  <h2>1. PRICING MODEL — HOURLY</h2>
  <table>
    <thead><tr><th>Item</th><th class="right">Rate</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td>Blended hourly rate</td><td class="right"><strong>{{hourly_rate}}</strong></td><td>{{hourly_rate_note}}</td></tr>
      <tr><td>Minimum charge</td><td class="right">{{minimum_charge}}</td><td>1 hour minimum</td></tr>
      <tr><td>Estimated time for job</td><td class="right">{{estimated_hours}}</td><td>{{estimated_hours_note}}</td></tr>
      <tr><td>Estimated total range</td><td class="right"><strong>{{estimated_range}}</strong></td><td>Final = actual hours × rate</td></tr>
    </tbody>
  </table>
  <p class="note">You receive a simple time log at the end. If the job finishes faster, you pay less. If unexpected issues appear we stop and agree any extra time with you first.</p>
  <h2>2. WHAT IS INCLUDED IN THE HOURLY RATE</h2>
  <ul class="inc">{{scope_html}}</ul>
  <p class="note"><strong>Licensing note:</strong> Microsoft Office is installed only when the customer provides a valid licence. {{company_name}} does not supply or sell Microsoft licences.</p>
  <h2>3. LINE DETAIL (IF ITEMISED)</h2>
  <table>
    <thead><tr><th>Description</th><th class="center">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
    <tbody>{{lines_html}}</tbody>
  </table>
  <p class="right"><strong>Indicative total: {{total}}</strong></p>
  <h2>4. PAYMENT (COD ACCOUNT)</h2>
  <p>{{payment_note}}</p>
  <h2>5. WHY THIS WORKS FOR BOTH OF US</h2>
  <p>{{strategic_note}}</p>
  ${termsBlock}
`
    ),
  },
  {
    id: 'quote_flatrate_cod',
    label: 'Quote — Flat rate package (COD)',
    category: 'Sales',
    business_types: 'pc_repair,it,msp,all',
    description: 'One clear price · no surprises · peace of mind',
    html: page(
      '',
      'FLAT RATE PACKAGE',
      'One clear price · No surprises · Best for peace of mind',
      `
  <h2>1. FLAT RATE INVESTMENT</h2>
  <div class="price-box">
    <div>
      <div class="label">{{package_name}}</div>
      <div class="save">{{package_save_note}}</div>
    </div>
    <div class="amount">{{total}}</div>
  </div>
  <p class="note">{{vat_note}}</p>
  <h2>2. WHAT IS INCLUDED</h2>
  <ul class="inc">{{scope_html}}</ul>
  <p class="note"><strong>Licensing note:</strong> Microsoft Office is installed only when the customer provides a valid licence. {{company_name}} does not supply or sell Microsoft licences.</p>
  <h2>3. WHAT IS NOT INCLUDED</h2>
  <p class="note">{{exclusions}}</p>
  <h2>4. LINE DETAIL</h2>
  <table>
    <thead><tr><th class="amber">Description</th><th class="center amber">Qty</th><th class="right amber">Rate</th><th class="right amber">Amount</th></tr></thead>
    <tbody>{{lines_html}}</tbody>
  </table>
  <h2>5. PAYMENT (COD ACCOUNT)</h2>
  <p>{{payment_note}}</p>
  <h2>6. WHY THIS IS STRATEGIC FOR A FIRST-TIME CLIENT</h2>
  <p>{{strategic_note}}</p>
  ${termsBlock}
`
    ),
  },
  {
    id: 'quote_adhoc_cod',
    label: 'Quote — Ad-hoc rate card (COD)',
    category: 'Sales',
    business_types: 'pc_repair,it,msp,all',
    description: 'Pay only for what you use · unit rates · maximum flexibility',
    html: page(
      'green',
      'AD-HOC RATE CARD',
      'Pay only for what you use · Maximum flexibility · Ideal when scope may vary',
      `
  <h2>1. AD-HOC RATE CARD (UNIT RATES)</h2>
  <table>
    <thead><tr><th class="green">Service</th><th class="green">Unit</th><th class="right green">Rate (ZAR)</th><th class="green">Typical use</th></tr></thead>
    <tbody>{{rate_card_html}}</tbody>
  </table>
  <p class="note"><strong>Licensing note:</strong> Microsoft Office is installed only when the customer provides a valid licence / product key / Microsoft account. Unlicensed software will not be installed.</p>
  <h2>2. EXAMPLE / INDICATIVE CALCULATION</h2>
  <table>
    <thead><tr><th>Example scope</th><th class="center">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
    <tbody>{{lines_html}}</tbody>
  </table>
  <p class="right"><strong>Indicative total: {{total}}</strong></p>
  <p class="note">Final invoice = only the services actually performed × the rates above.</p>
  <h2>3. PAYMENT (COD ACCOUNT)</h2>
  <p>{{payment_note}}</p>
  <h2>4. STRATEGIC VALUE FOR FIRST-TIME CLIENTS</h2>
  <p>{{strategic_note}}</p>
  ${termsBlock}
`
    ),
  },
]
