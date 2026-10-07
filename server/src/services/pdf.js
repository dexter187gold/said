import puppeteer from 'puppeteer'
import fs from 'fs'

function fill(html, vars = {}) {
  return String(html).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  )
}

let browserPromise = null

function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chrome',
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
    browserPromise = puppeteer
      .launch({
        headless: true,
        executablePath: resolveExecutablePath(),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--font-render-hinting=none',
          '--single-process',
        ],
        timeout: 60000,
      })
      .catch((err) => {
        browserPromise = null
        throw err
      })
  }
  return browserPromise
}

export async function htmlToPdf(html, vars = {}) {
  const content = fill(html, vars)
  let browser
  try {
    browser = await getBrowser()
  } catch (err) {
    const msg = err?.message || String(err)
    throw new Error(
      `PDF engine failed to start (Puppeteer/Chromium). ` +
        `Install Chromium or set PUPPETEER_EXECUTABLE_PATH. Detail: ${msg}`
    )
  }

  const page = await browser.newPage()
  try {
    await page.setContent(content, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await new Promise((r) => setTimeout(r, 100))
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
      timeout: 30000,
    })
    return Buffer.from(pdf)
  } catch (err) {
    try {
      const connected = browser?.isConnected?.()
      if (!connected) browserPromise = null
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
