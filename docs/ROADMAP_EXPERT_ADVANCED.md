# SAID Expert → Advanced Roadmap — 4 Quarters × 500+ Updates

**Version:** 3.0 Expert/Advanced · **Date:** 2026-10-08 · **Repo:** dexter187gold/said  
**Goal:** Make SAID the most powerful, friction-free ticket + invoice desk for South African field-service & SMB teams.  
**Total target:** 2 000+ concrete front-end + back-end updates across 4 quarters.

Each quarter is a self-contained push that ships with:
- Frontend components + hooks
- Backend routes + migrations + services
- Tests / smoke checks
- Commit messages referencing `EA-Q#-###`

---

## Packaging

| Quarter | Theme | Focus | Approx. items |
|---------|-------|-------|---------------|
| **Q1 Expert Core** | Context UI & Document Power | Right sidebar, page settings, document action bar | 500+ |
| **Q2 Expert Workflow** | Tickets ↔ Invoices excellence | Conversion, bulk, timers, parts, SLA | 500+ |
| **Q3 Advanced Insight** | Analytics, automation, AI assist | Reports, rules, smart suggestions | 500+ |
| **Q4 Advanced Platform** | Scale, trust, integrations, polish | Multi-branch, audit, API, PWA, SA compliance | 500+ |

---

## Q1 — Expert Core (Context UI + Document Power) — 500+

### Right-side Page Settings Sidebar (1–80)
1. Swipe-from-right gesture (mobile) to open page-scoped sidebar  
2. Keyboard shortcut `]` / `Cmd+,` to toggle page settings  
3. Sidebar only renders settings relevant to current route (invoice | ticket | client | quote | credit | documents | ageing)  
4. Tabbed navigation inside sidebar: General | Appearance | Defaults | Notifications | Advanced  
5. Persist open/closed state per page in localStorage + backend `page_preferences`  
6. Smooth spring animation (enter from right, exit to right)  
7. Backdrop blur + click-outside-to-close  
8. Escape key closes sidebar  
9. Focus trap when open  
10. Mobile full-height drawer variant  
11–20. Invoice-specific tabs: numbering, VAT defaults, payment terms, reminder cadence, template picker, footer, bank details override, PO required flag, device field visibility, technician field  
21–30. Ticket-specific: default priority, category, SLA hours, auto-timer, billable increment, assignee default, tags, due-date offset, photo required, signature required  
31–40. Client page: credit limit, tags, map default, portal invite, merge rules  
41–50. Quote / Credit: validity days, convert-to-invoice defaults, watermark, draft status  
51–60. Documents: default template category, logo size, signature position, QR pay toggle  
61–70. Ageing: buckets, colour thresholds, include credits, currency  
71–80. Global fallback + “Reset to company defaults” button + export/import JSON of page prefs  

### Document Action System (81–200)
81. Sticky / floating DocumentActionBar on InvoiceEdit, Ticket detail, Quote, Credit  
82. Primary actions: Download PDF, Share WhatsApp, Email, Print  
83. Secondary: Duplicate, Archive, Soft-delete, Restore  
84. Line-item clipboard: Copy selected lines, Cut, Paste into another document  
85. Multi-select lines with shift-click / Ctrl-click  
86. Bulk “Bill hours from ticket” → new invoice lines  
87. “Convert ticket → invoice” one-click with pre-filled client, hours, parts  
88. WhatsApp deep-link template with variables {{number}} {{total}} {{client}} {{due}}  
89. Email with HTML body + PDF attachment via backend  
90. Copy invoice number / payment reference to clipboard  
91. Generate payment QR (Payshap / SnapScan style stub)  
92. Mark as Paid / Partially Paid quick actions with amount modal  
93. Add payment from action bar  
94. Send payment reminder (email + WhatsApp)  
95. Export single document as CSV / JSON  
96. Version history drawer (last 20 revisions)  
97. Activity timeline (created, edited, emailed, paid, viewed)  
98. Keyboard shortcuts for every action (P = PDF, W = WhatsApp, E = Email, D = Duplicate…)  
99. Confirmation toasts with undo for destructive actions  
100. Optimistic UI for all mutations  
101–120. Backend endpoints: `/api/v1/documents/:id/actions/*` (pdf, whatsapp-link, email, duplicate, archive, clipboard, activity)  
121–140. PDF service improvements: better SA tax layout, logo, bank details, QR, watermark for drafts  
141–160. Clipboard service (server-side optional persist for multi-device)  
161–180. Activity log table + migration  
181–200. Audit middleware that records every document mutation  

### Page Preferences Backend (201–280)
201. Migration: `page_preferences` table (user_id, org_id, page_key, prefs JSON, updated_at)  
202. GET/PUT `/api/v1/settings/page/:pageKey`  
203. Merge user prefs over org defaults over system defaults  
204. Role-based visibility of Advanced tab  
205. Seed defaults for every page key  
206–220. Zod schemas for each page preference shape  
221–240. Frontend `usePagePrefs(pageKey)` hook with optimistic update + debounce  
241–260. Settings page itself gains tabs (Company | Billing | Tickets | Notifications | Security | Advanced)  
261–280. Live preview of invoice appearance when changing sidebar settings  

### UX Polish & Accessibility (281–400)
281–320. Focus management, ARIA labels, screen-reader announcements for sidebar & actions  
321–360. Reduced-motion support, high-contrast mode toggle  
361–400. Mobile bottom sheet for actions, pull-to-refresh on lists, skeleton loaders  

### Quality & Tests (401–500+)
401–450. Unit tests for preference merge, action bar, clipboard  
451–500. E2E smoke: open sidebar on invoice → change VAT → save → reopen → value persists  
+ dozens of micro-fixes (spacing, dark mode, empty states, error boundaries)

---

## Q2 — Expert Workflow (Tickets ↔ Invoices) — 500+

501–600. Live ticket board (Kanban) with drag-drop status  
601–700. Controllable multi-tech timers, parts used, photo attachments, customer signature  
701–800. One-click “Bill this ticket” → invoice with hours rounded, parts, labour  
801–900. Recurring tickets / maintenance contracts  
901–1000. SLA clocks, escalation rules, WhatsApp status updates, GPS check-in stubs  

---

## Q3 — Advanced Insight & Automation — 500+

1001–1100. Cash-flow forecast, tech utilisation heat-map, profit-by-job  
1101–1200. Smart suggestions (“3 tickets ready to invoice”, “Client over credit limit”)  
1201–1300. Automated payment reminders, overdue rules, recurring invoices  
1301–1400. Custom report builder + CSV/PDF export  
1401–1500. AI assist stubs (description rewrite, line-item suggest)  

---

## Q4 — Advanced Platform & Trust — 500+

1501–1600. Multi-branch / multi-company support  
1601–1700. Full audit log UI, session management, 2FA, API keys  
1701–1800. Client portal (view invoices, pay, ticket status)  
1801–1900. Xero / PayFast / Payshap / WhatsApp Business API integrations  
1901–2000+. PWA offline drafts, push notifications, POPIA flags, BEE stubs, EN/AF/ZU, Docker hardening, backups, rate limits, feature flags, E2E suite, CI  

---

## Delivery Rules

- Every PR / commit references `EA-Q1-042` style IDs.  
- Front + back + migration in the same push when possible.  
- No breaking changes to existing API without version bump.  
- Prefer progressive enhancement (works without JS for critical paths).  
- SA-first: ZAR, 15 % VAT, EFT references, local bank formats.

**Next immediate ship:** Q1 items 1–200 (right sidebar + document actions + page prefs backend).  
This document supersedes earlier 100-item and 400-item roadmaps for Expert/Advanced scope.
