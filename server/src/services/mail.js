/**
 * Email delivery for OTP.
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
let transporterPromise = null

async function getTransporter() {
  if (transporterPromise) return transporterPromise
  const host = process.env.SMTP_HOST
  if (!host) return null
  transporterPromise = (async () => {
    try {
      const nodemailer = await import('nodemailer')
      return nodemailer.default.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === '1',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
          : undefined,
      })
    } catch (e) {
      console.warn('[SAID mail] nodemailer not available:', e.message)
      return null
    }
  })()
  return transporterPromise
}

export async function sendOtpEmail(to, code, purpose = 'verify') {
  const subject =
    purpose === 'login' || purpose === 'login_2fa'
      ? 'Your SAID login code'
      : purpose === 'enable_2fa'
        ? 'Enable two-factor authentication — SAID'
        : purpose === 'reset'
          ? 'Reset your SAID password'
          : 'Verify your SAID account'
  const text = `Your SAID verification code is ${code}. It expires in 10 minutes.`
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px">
    <div style="color:#007A4D;font-weight:800;letter-spacing:.12em;font-size:12px">SA INVOICE DESK</div>
    <h1 style="font-size:20px;margin:12px 0">Verification code</h1>
    <p style="color:#475569;font-size:14px">Expires in <strong>10 minutes</strong>.</p>
    <div style="font-size:32px;font-weight:800;letter-spacing:.3em;background:#f1f5f9;padding:16px;border-radius:12px;text-align:center;margin:20px 0">${code}</div>
  </div>`
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@said.local'
  const tx = await getTransporter()
  if (!tx) {
    console.log(`[SAID OTP] ${to} → ${code} (${purpose})`)
    return { delivered: false, devCode: code }
  }
  try {
    await tx.sendMail({ from, to, subject, text, html })
    return { delivered: true }
  } catch (e) {
    console.error('[SAID mail] send failed:', e.message)
    console.log(`[SAID OTP fallback] ${to} → ${code}`)
    return { delivered: false, devCode: code }
  }
}
