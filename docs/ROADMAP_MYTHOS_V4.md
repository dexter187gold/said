# SAID Roadmap v4 — Four Quarters × 500 (Mythos naming analysis)

**Version:** 4.0 · **Date:** 2026-10-08  
**Packaging:** Prefer **one integrated release** per cycle (front + back together). This document plans the *next* four quarters after EA-Q1–Q4.

---

## Naming analysis: Greek mythology × Chinese astrology

| Approach | Verdict |
|----------|---------|
| Greek hero names alone (Athena, Hermes…) | Clear personality metaphor; familiar in product culture |
| Chinese zodiac / five elements alone (Wood, Fire, Earth, Metal, Water) | Strong for *focus* (growth, energy, stability, precision, flow) |
| Forced hybrid every single micro-update (“Athena-Dragon-042”) | **Does not work** — noisy, hard to search in commits, alien to SA field techs |
| **Hybrid at quarter level only** | **Works** — memorable theme + element focus without clutter |

**Decision:** Use dual names **only for the four quarters**. Individual items stay `V4-Q1-###` style IDs. If a quarter name confuses the team, drop the mythos label and keep the element + theme.

| Quarter | Greek (personality) | Chinese element | Theme | Front + back focus |
|---------|---------------------|-----------------|-------|--------------------|
| **Q1** | **Athena** (wisdom, craft) | **Wood** (growth) | Craft & clarity | Templates, job cards, PDF/WhatsApp quality, UX polish |
| **Q2** | **Hermes** (messages, commerce) | **Metal** (precision) | Flow & money | Payments, reminders, integrations, ledger links |
| **Q3** | **Hephaestus** (forge, tools) | **Fire** (energy) | Field power | Mobile PWA, offline, camera, GPS, tech tools |
| **Q4** | **Hestia** (hearth, trust) | **Earth** (stability) | Trust & scale | Security, multi-tenant, compliance, reliability |

---

## Q1 Athena-Wood — Craft & clarity (500)

Focus: every document the client sees feels premium and trustworthy.

**Clusters (examples of the 500-class backlog):**
1–80 Job card / print / PDF / WhatsApp templates (iterate layouts, SA letterheads, bilingual stubs)  
81–160 Invoice & quote PDF fidelity (bank details, QR stubs, watermarks, multi-page)  
161–240 Ticket detail UX (timeline, parts, SLA chips, bulk actions)  
241–320 Client-facing copy & tone library (status messages, reassurance blocks)  
321–400 Accessibility, empty states, loading skeletons, error recovery  
401–500 Tests, PDF engine hardening (Chromium paths, Termux, fallbacks), docs  

---

## Q2 Hermes-Metal — Flow & money (500)

1–100 Payment methods, partial payments UI, reconciliation aids  
101–200 Dunning sequences, WhatsApp/email reminder templates  
201–300 PayFast / SnapScan / EFT reference helpers  
301–400 Xero / CSV accounting exports, tax reports  
401–500 Quote→invoice→credit flows, retainers, deposits  

---

## Q3 Hephaestus-Fire — Field power (500)

1–100 PWA offline drafts, sync queue  
101–200 Camera attachments, signatures, photo on close  
201–300 GPS check-in stubs, travel time  
301–400 Multi-tech assignment, utilisation views  
401–500 Push notification hooks, background sync  

---

## Q4 Hestia-Earth — Trust & scale (500)

1–100 Audit completeness, session revoke, device list  
101–200 API keys, webhooks, rate limits tuning  
201–300 Multi-branch data scoping  
301–400 POPIA workflows, retention policies  
401–500 Backups, restore drills, monitoring, CI  

---

## Delivery rule

Ship **one big integrated commit** when possible (this cycle’s job-card + PDF + WhatsApp pack is the model): front + back + docs together, then `git pull` on Termux.

## Progress log

- **2026-10-08 Athena-Wood craft batch:** empty/skeleton UI, DocList filters+search+a11y, quote defaults (hourly/flat/ad-hoc), account type dropdown, quote page-settings, trust WhatsApp for quotes/invoices, template reseed for COD layouts, Clients empty state.

- **2026-10-08 Hephaestus-Fire field batch:** GPS check-in/out, camera attachments, signature pad, multi-tech, utilisation, offline queue + SW v16, field API `/api/v1/field`.

- **2026-10-08 Hestia-Earth trust batch:** session revoke, retention policies + purge, JSON backup export, webhooks + test ping, POPIA forget-client, health-detail monitor.

## Next slices batch (2026-10-08)

- **Athena-Wood:** line-item snippets library (save/reuse on invoices/quotes)
- **Hermes-Metal:** payment receipt WhatsApp text
- **Hephaestus-Fire:** Google Maps multi-stop route + tech utilisation
- **Hestia-Earth:** security scorecard + webhook delivery purge
