# SAID — SA Invoice Desk

Full-stack redesign of SA Invoice Pro.

| Layer | Stack |
|-------|--------|
| API | Node.js, Express, better-sqlite3, Zod, JWT (RBAC) |
| PDF | Puppeteer (HTML templates → PDF) |
| UI | React 18, Vite, Tailwind CSS, React Router |

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
| GET/POST | `/api/v1/documents/render` | Template → HTML/PDF |
| GET/POST | `/api/v1/clients` | Clients |

Roles: `owner`, `admin`, `staff`, `viewer`

## Deploy notes

- Set `JWT_SECRET` and `DATABASE_PATH` in production.
- Puppeteer needs Chromium; on Debian use `PUPPETEER_EXECUTABLE_PATH` or install deps.
- Build client: `cd client && npm run build` → serve `client/dist` from Express in production (`npm start` from server after build).
