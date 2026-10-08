# Competitor gaps → SAID opportunities (2026 research)

## Common complaints (field service)
- Clunky slow mobile UI; techs lose time to data entry
- Offline unreliability; photos/notes fail to save
- Bloated enterprise tools — steep learning curve, cost
- GPS/clock-in failures on Android
- Disconnected systems (job app ≠ accounting)
- Weak reporting / export friction

## Common complaints (invoicing / accounting)
- Overkill complexity for simple shops
- Missing SA WhatsApp delivery and local pay (PayFast/Yoco/Ozow)
- Limited templates / logo control
- Tier gates: features locked behind higher plans
- Bank feed / sync breakage; duplicate customers on integrations
- Inventory not flowing to COGS on job materials

## SAID response (this release + roadmap)
| Gap | SAID action |
|-----|-------------|
| Mobile friction | Glass UI, gestures, page settings rail, large actions |
| Doc actions scattered | **DocActions**: copy/JSON/cut/paste/PDF/WhatsApp/Facebook/email/print |
| Settings maze | **Tabbed Settings** (Company / Invoices / Tickets / Appearance / Security) |
| Page-level prefs buried | **Right PageRail** — swipe from right / `\\` / Page ⚙ |
| SA channels | WhatsApp share + roadmap PayFast/Yoco |
| Tickets ↔ money | Bill hours → invoice; expert roadmap deepens |
| Trust / POPIA | 2FA, backup, export, audit; expert security quarter |
| Cost bloat | Self-host / Render single stack |

## This code drop
- `PageRail.jsx` + Shell gestures
- `DocActions.jsx` on DocList, InvoiceEdit, Tickets
- Settings tabs
- Expert roadmap v3 (400 items, 2 pushes)
