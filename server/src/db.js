import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/said.db')
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY DEFAULT 'main',
  name TEXT, email TEXT, phone TEXT, vat_number TEXT, address TEXT,
  bank_name TEXT, account_number TEXT, branch_code TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT, phone TEXT, address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  account_type TEXT,
  devices TEXT, service_type TEXT, po_number TEXT, site_address TEXT,
  technician TEXT, serials TEXT, intro TEXT, payment_note TEXT,
  exclusive REAL DEFAULT 0, vat_amount REAL DEFAULT 0, total REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  reminder_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  method TEXT,
  date TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  category TEXT,
  client_id TEXT,
  assignee_id TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id TEXT,
  author_name TEXT,
  text TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  html TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_renders (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  variables TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
`)

export function uid() {
  return crypto.randomUUID()
}

export function now() {
  return new Date().toISOString()
}

export function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
  if (n > 0) return

  const adminId = uid()
  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?)`
  ).run(adminId, 'admin@said.local', 'SAID Admin', hash, 'owner', now())

  db.prepare(
    `INSERT OR IGNORE INTO company (id, name, email, phone, vat_number, address, bank_name, account_number, branch_code)
     VALUES ('main', 'SA Invoice Desk', 'billing@said.local', '011 000 0000', '4XXXXXXXXX', 'Johannesburg, South Africa', 'FNB', '62800000000', '250655')`
  ).run()

  const templates = [
    {
      id: 'invoice_cover',
      label: 'Tax invoice cover',
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:system-ui,sans-serif;color:#0f172a;padding:40px;max-width:800px;margin:0 auto}
        .brand{color:#007A4D;font-weight:800;letter-spacing:.08em;font-size:12px}
        h1{margin:.4rem 0 1rem;font-size:28px}
        .box{border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:12px 0}
        .muted{color:#64748b;font-size:13px}
        .total{font-size:22px;font-weight:800;color:#007A4D}
      </style></head><body>
        <div class="brand">SA INVOICE DESK</div>
        <h1>Tax invoice — {{client_name}}</h1>
        <div class="box"><div class="muted">Company</div><strong>{{company_name}}</strong><br>{{company_address}}</div>
        <div class="box"><div class="muted">Amount due</div><div class="total">R {{amount_due}}</div>
        <p class="muted">Invoice {{invoice_number}} · Due {{due_date}}</p></div>
        <p class="muted">{{payment_note}}</p>
      </body></html>`,
    },
    {
      id: 'job_card',
      label: 'Job card',
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:system-ui,sans-serif;padding:32px}
        h1{color:#007A4D} .row{margin:8px 0;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
      </style></head><body>
        <h1>Job card</h1>
        <div class="row"><strong>Client:</strong> {{client_name}}</div>
        <div class="row"><strong>Site:</strong> {{site_address}}</div>
        <div class="row"><strong>Technician:</strong> {{technician}}</div>
        <div class="row"><strong>Devices:</strong> {{devices}}</div>
        <div class="row"><strong>Work:</strong> {{service_type}}</div>
        <p>{{notes}}</p>
      </body></html>`,
    },
  ]
  const ins = db.prepare('INSERT INTO document_templates (id, label, html) VALUES (?,?,?)')
  for (const t of templates) ins.run(t.id, t.label, t.html)
}
