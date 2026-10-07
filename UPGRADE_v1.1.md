# SAID v1.1 upgrade notes

## Puppeteer PDF fix
- Changed `waitUntil` from `networkidle0` → `domcontentloaded` (was hanging on static HTML)
- Added Chromium path auto-discovery + `PUPPETEER_EXECUTABLE_PATH`
- Browser relaunch if process dies
- Clearer error messages when Chromium is missing

### Host requirements
```bash
# Debian/Ubuntu
sudo apt-get install -y chromium
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Or let Puppeteer download its own Chromium on first npm install
cd server && npx puppeteer browsers install chrome
```

## Files in this release
- server/src/services/pdf.js — PDF fix
- server/src/seedTemplates.js — 130 templates
- server/src/db.js — schema + migrations
- server/src/routes/{tickets,documents,settings}.js
- client pages: Home, Tickets, Documents, Settings, TemplateDesigner
- App.jsx + Shell.jsx routes

## After pull
```bash
cd server && npm install && npm run dev
cd client && npm install && npm run dev
```
Delete old SQLite DB if schema migration fails: `rm server/data/said.db` (re-seeds admin + templates).
