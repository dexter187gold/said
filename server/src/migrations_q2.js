/** Run after db init — safe to call every boot */
export function applyQ2Migrations(db) {
  const clientCols = db.prepare(`PRAGMA table_info(clients)`).all().map((c) => c.name)
  for (const [col, def] of [
    ['tags', 'TEXT'],
    ['credit_limit', 'REAL'],
    ['contacts_json', 'TEXT'],
    ['contract_renewal', 'TEXT'],
    ['vat_number', 'TEXT'],
    ['notes', 'TEXT'],
  ]) {
    if (!clientCols.includes(col)) {
      try { db.exec(`ALTER TABLE clients ADD COLUMN ${col} ${def}`) } catch {}
    }
  }
  const invCols = db.prepare(`PRAGMA table_info(invoices)`).all().map((c) => c.name)
  if (!invCols.includes('converted_from_id')) {
    try { db.exec(`ALTER TABLE invoices ADD COLUMN converted_from_id TEXT`) } catch {}
  }
  const lineCols = db.prepare(`PRAGMA table_info(invoice_lines)`).all().map((c) => c.name)
  if (!lineCols.includes('discount')) {
    try { db.exec(`ALTER TABLE invoice_lines ADD COLUMN discount REAL NOT NULL DEFAULT 0`) } catch {}
  }
}
