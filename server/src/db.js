import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { TEMPLATE_SEED } from './seedTemplates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/said.db')
if (dbPath.startsWith('/var/data')) {
  dbPath = path.join(process.cwd(), 'data/said.db')
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY DEFAULT 'main', name TEXT, email TEXT, phone TEXT, vat_number TEXT, address TEXT,
  bank_name TEXT, account_number TEXT, branch_code TEXT, logo_url TEXT, website TEXT,
  invoice_prefix TEXT DEFAULT 'INV', default_vat_rate REAL DEFAULT 15, currency TEXT DEFAULT 'ZAR',
  business_type TEXT DEFAULT 'general', invoice_template_id TEXT DEFAULT 'tax_invoice_full',
  footer_note TEXT, terms_default TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT,
  vat_number TEXT, notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, number TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES clients(id),
  date TEXT NOT NULL, due_date TEXT, doc_type TEXT NOT NULL DEFAULT 'invoice',
  status TEXT NOT NULL DEFAULT 'unpaid', notes TEXT, account_type TEXT, devices TEXT,
  service_type TEXT, po_number TEXT, site_address TEXT, technician TEXT, serials TEXT,
  intro TEXT, payment_note TEXT, exclusive REAL DEFAULT 0, vat_amount REAL DEFAULT 0,
  total REAL DEFAULT 0, amount_paid REAL DEFAULT 0, reminder_at TEXT, template_id TEXT,
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL, qty REAL NOT NULL DEFAULT 1, price REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL, method TEXT, date TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal',
  category TEXT, tags TEXT, client_id TEXT, assignee_id TEXT, notes TEXT, due_date TEXT,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0, timer_started_at TEXT, estimated_minutes INTEGER,
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id TEXT, author_name TEXT, text TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0,
  time_logged_seconds INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_time_entries (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id TEXT, user_name TEXT, started_at TEXT NOT NULL, ended_at TEXT,
  seconds INTEGER NOT NULL DEFAULT 0, note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT DEFAULT 'General',
  business_types TEXT DEFAULT 'all', description TEXT, html TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS document_renders (
  id TEXT PRIMARY KEY, template_id TEXT, variables TEXT, created_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, code TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'register', attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
`)

try { db.exec(`CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email)`) } catch {}

const ticketCols = db.prepare(`PRAGMA table_info(tickets)`).all().map((c) => c.name)
if (!ticketCols.includes('description')) { try { db.exec(`ALTER TABLE tickets ADD COLUMN description TEXT`) } catch {} }
if (!ticketCols.includes('tags')) { try { db.exec(`ALTER TABLE tickets ADD COLUMN tags TEXT`) } catch {} }
if (!ticketCols.includes('due_date')) { try { db.exec(`ALTER TABLE tickets ADD COLUMN due_date TEXT`) } catch {} }
if (!ticketCols.includes('time_spent_seconds')) { try { db.exec(`ALTER TABLE tickets ADD COLUMN time_spent_seconds INTEGER NOT NULL DEFAULT 0`) } catch {} }
if (!ticketCols.includes('timer_started_at')) { try { db.exec(`ALTER TABLE tickets ADD COLUMN timer_started_at TEXT`) } catch {} }
if (!ticketCols.includes('estimated_minutes')) { try { db.exec(`ALTER TABLE tickets ADD COLUMN estimated_minutes INTEGER`) } catch {} }
for (const [col, def] of [
  ['warranty', 'INTEGER NOT NULL DEFAULT 0'],
  ['sla_hours', 'INTEGER'],
  ['sla_due_at', 'TEXT'],
  ['parts_json', 'TEXT'],
  ['is_template', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!ticketCols.includes(col)) { try { db.exec(`ALTER TABLE tickets ADD COLUMN ${col} ${def}`) } catch {} }
}

const companyCols = db.prepare(`PRAGMA table_info(company)`).all().map((c) => c.name)
for (const [col, def] of [
  ['logo_url', 'TEXT'], ['website', 'TEXT'], ['invoice_prefix', "TEXT DEFAULT 'INV'"],
  ['default_vat_rate', 'REAL DEFAULT 15'], ['currency', "TEXT DEFAULT 'ZAR'"],
  ['business_type', "TEXT DEFAULT 'general'"], ['invoice_template_id', "TEXT DEFAULT 'tax_invoice_full'"],
  ['footer_note', 'TEXT'], ['terms_default', 'TEXT'], ['setup_complete', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!companyCols.includes(col)) { try { db.exec(`ALTER TABLE company ADD COLUMN ${col} ${def}`) } catch {} }
}

const tplCols = db.prepare(`PRAGMA table_info(document_templates)`).all().map((c) => c.name)
for (const [col, def] of [
  ['category', "TEXT DEFAULT 'General'"], ['business_types', "TEXT DEFAULT 'all'"],
  ['description', 'TEXT'], ['is_system', 'INTEGER NOT NULL DEFAULT 1'], ['updated_at', 'TEXT'],
]) {
  if (!tplCols.includes(col)) { try { db.exec(`ALTER TABLE document_templates ADD COLUMN ${col} ${def}`) } catch {} }
}

const invCols = db.prepare(`PRAGMA table_info(invoices)`).all().map((c) => c.name)
if (!invCols.includes('template_id')) { try { db.exec(`ALTER TABLE invoices ADD COLUMN template_id TEXT`) } catch {} }
if (!invCols.includes('doc_type')) { try { db.exec(`ALTER TABLE invoices ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'invoice'`) } catch {} }

const clientCols = db.prepare(`PRAGMA table_info(clients)`).all().map((c) => c.name)
if (!clientCols.includes('vat_number')) { try { db.exec(`ALTER TABLE clients ADD COLUMN vat_number TEXT`) } catch {} }
if (!clientCols.includes('notes')) { try { db.exec(`ALTER TABLE clients ADD COLUMN notes TEXT`) } catch {} }

const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name)
for (const [col, def] of [
  ['email_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ['oauth_provider', 'TEXT'],
  ['oauth_id', 'TEXT'],
  ['phone', 'TEXT'],
]) {
  if (!userCols.includes(col)) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`) } catch {} }
}

export function uid() { return crypto.randomUUID() }
export function now() { return new Date().toISOString() }

export function seedIfEmpty() {
  try { db.prepare("UPDATE users SET email_verified = 1 WHERE email = 'admin@said.local'").run() } catch {}
  const n = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
  if (n === 0) {
    const adminId = uid()
    db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, email_verified) VALUES (?,?,?,?,?,?,1)`)
      .run(adminId, 'admin@said.local', 'SAID Admin', bcrypt.hashSync('admin123', 10), 'owner', now())
    db.prepare(`INSERT OR IGNORE INTO company (id, name, email, phone, vat_number, address, bank_name, account_number, branch_code, business_type, setup_complete)
      VALUES ('main', 'SA Invoice Desk', 'billing@said.local', '011 000 0000', '4XXXXXXXXX', 'Johannesburg, South Africa', 'FNB', '62800000000', '250655', 'pc_repair', 1)`).run()
  }
  const existing = db.prepare('SELECT COUNT(*) AS c FROM document_templates').get().c
  if (existing < 50) {
    const ins = db.prepare(`INSERT OR REPLACE INTO document_templates (id, label, category, business_types, description, html, is_system, updated_at) VALUES (?,?,?,?,?,?,1,?)`)
    const ts = now()
    const tx = db.transaction(() => { for (const t of TEMPLATE_SEED) ins.run(t.id, t.label, t.category, t.business_types, t.description, t.html, ts) })
    tx()
  }
  const set = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)')
  set.run('theme', 'system')
  set.run('ticket_auto_timer', '0')
  set.run('default_priority', 'normal')
  set.run('hourly_rate', '450')
  set.run('billable_increment_minutes', '15')
  set.run('business_types_enabled', JSON.stringify([
    'general', 'pc_repair', 'it', 'msp', 'construction', 'plumbing', 'electrical',
    'consulting', 'retail', 'hospitality', 'medical', 'automotive', 'property', 'education',
  ]))
}
