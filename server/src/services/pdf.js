import puppeteer from 'puppeteer'

function fill(html, vars = {}) {
  return String(html).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  )
}

let browserPromise = null

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
  }
  return browserPromise
}

export async function htmlToPdf(html, vars = {}) {
  const content = fill(html, vars)
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(content, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

export { fill }
