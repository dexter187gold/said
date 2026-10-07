import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

function fill(html, vars = {}) {
  return String(html).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  )
}

let browserPromise = null

function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  // Puppeteer's bundled Chromium
  try {
    const p = puppeteer.executablePath?.()
    if (p && fs.existsSync(p)) return p
  } catch {}
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chrome',
    '/data/data/com.termux/files/usr/bin/chromium',
    '/data/data/com.termux/files/usr/bin/chromium-browser',
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return undefined
}

async function getBrowser() {
  if (!browserPromise) {
    const executablePath = resolveExecutablePath()
    browserPromise = puppeteer
      .launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--font-render-hinting=none',
          '--single-process',
          '--disable-extensions',
        ],
        timeout: 90000,
      })
      .catch((err) => {
        browserPromise = null
        throw err
      })
  }
  return browserPromise
}

/** Minimal valid PDF with plain text lines (fallback when Chromium missing) */
export function simpleTextPdf(title, lines = []) {
  const escapePdf = (s) =>
    String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
  const contentLines = [`(${escapePdf(title)}) Tj`, '0 -18 Td']
  for (const line of lines.slice(0, 60)) {
    contentLines.push(`(${escapePdf(String(line).slice(0, 90))}) Tj`, '0 -14 Td')
  }
  const stream =
    'BT /F1 11 Tf 50 780 Td ' + contentLines.join(' ') + ' ET'
  const objs = []
  objs.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n')
  objs.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n')
  objs.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n'
  )
  objs.push(`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`)
  objs.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n')
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const o of objs) {
    offsets.push(Buffer.byteLength(body, 'utf8'))
    body += o
  }
  const xrefPos = Buffer.byteLength(body, 'utf8')
  body += `xref\n0 ${objs.length + 1}\n`
  body += '0000000000 65535 f \n'
  for (let i = 1; i <= objs.length; i++) {
    body += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  }
  body += `trailer<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return Buffer.from(body, 'utf8')
}

export async function htmlToPdf(html, vars = {}) {
  const content = fill(html, vars)
  let browser
  try {
    browser = await getBrowser()
  } catch (err) {
    const msg = err?.message || String(err)
    // Fallback: strip tags to text PDF so callers never fully die on Termux without Chromium
    const text = content
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const chunks = []
    for (let i = 0; i < text.length; i += 85) chunks.push(text.slice(i, i + 85))
    console.warn('[SAID PDF] Puppeteer unavailable, using text fallback:', msg)
    return simpleTextPdf('SAID Document', chunks)
  }

  const page = await browser.newPage()
  try {
    await page.setContent(content, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })
    await new Promise((r) => setTimeout(r, 150))
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      timeout: 45000,
    })
    return Buffer.from(pdf)
  } catch (err) {
    try {
      if (!browser?.isConnected?.()) browserPromise = null
    } catch {
      browserPromise = null
    }
    throw new Error(`PDF render failed: ${err?.message || err}`)
  } finally {
    try {
      await page.close()
    } catch {}
  }
}

export { fill }
