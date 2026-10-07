# SAID — SA Invoice Desk

Full-stack redesign of SA Invoice Pro. **v1.1.0**

| Layer | Stack |
|-------|--------|
| API | Node.js, Express, better-sqlite3, Zod, JWT (RBAC) |
| PDF | Puppeteer (HTML templates → PDF) |
| UI | React 18, Vite, Tailwind CSS, React Router |

## What's new in 1.1

- **Dashboard** with revenue charts, status tables, recent invoices & tickets
- **Configuration / Settings** — company profile, VAT, business type, invoice defaults
- **130+ categorized document templates** by business nature (IT/PC repair, construction, medical, automotive, HR, legal, hospitality, education, …)
- **Template designer** — create & edit custom HTML templates with live preview
- **Tickets upgrades** — timer (start/stop + live counter), description, category, tags, due date, manual time log, time entries history
- Filter documents by category & business type

## Quick start

```bash
# API (port 8787)
cd server && npm install && npm run dev

# UI (port 5173) — new terminal
cd client && npm install && npm run dev
```

Default admin (created on first boot):

- **email:** `admin@said.local`
- **password:** `admin123`

Open http://localhost:5173

## API

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/v1/auth/register` | Create user |
| POST | `/api/v1/auth/login` | JWT |
| GET/POST | `/api/v1/invoices` | CRUD + partial status |
| GET | `/api/v1/invoices/:id/pdf` | Puppeteer PDF |
| GET/POST | `/api/v1/tickets` | CRM tickets |
| GET/POST | `/api/v1/tickets/:id/comments` | Thread |
| POST | `/api/v1/tickets/:id/timer/start` | Start timer |
| POST | `/api/v1/tickets/:id/timer/stop` | Stop timer |
| POST | `/api/v1/tickets/:id/time` | Manual time log |
| GET/POST | `/api/v1/documents/templates` | List / create templates |
| PUT/DELETE | `/api/v1/documents/templates/:id` | Update / delete (admin) |
| POST | `/api/v1/documents/render` | Template → HTML/PDF |
| GET/PUT | `/api/v1/settings` | Config + company |
| GET | `/api/v1/settings/dashboard` | Dashboard metrics |

Roles: `owner`, `admin`, `staff`, `viewer`

## Deploy notes

- Set `JWT_SECRET` and `DATABASE_PATH` in production.
- Puppeteer needs Chromium; on Debian use `PUPPETEER_EXECUTABLE_PATH` or install deps.
- Build client: `cd client && npm run build` → serve `client/dist` from Express in production (`npm start` from server after build).
