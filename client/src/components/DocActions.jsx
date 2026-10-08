import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * Universal action strip for invoices, quotes, credits, tickets, documents.
 * Actions: copy, cut (clipboard JSON), paste hint, PDF, WhatsApp, print, email, duplicate.
 */
export default function DocActions({
  kind = 'document',
  title = '',
  number = '',
  total,
  clientName = '',
  clientPhone = '',
  status = '',
  payload = null,
  pdfUrl = null,
  onPdf,
  onDuplicate,
  onDelete,
  onRefresh,
  className = '',
}) {
  const { notify } = useAuth()
  const [busy, setBusy] = useState('')

  const textSummary = () => {
    const parts = [kind, number || title, clientName, status]
    if (total != null && total !== '') parts.push(`R${Number(total).toFixed(2)}`)
    return parts.filter(Boolean).join(' · ')
  }

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(textSummary())
      notify('Copied summary')
    } catch {
      notify('Clipboard blocked', 'error')
    }
  }

  const copyJson = async () => {
    try {
      const data = payload || { kind, number, title, total, clientName, status }
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      notify('Copied JSON to clipboard')
    } catch {
      notify('Clipboard blocked', 'error')
    }
  }

  const cutJson = async () => {
    await copyJson()
    notify('Cut: JSON on clipboard (original not deleted)')
  }

  const pasteHint = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (!t) return notify('Clipboard empty', 'error')
      notify(`Clipboard has ${t.length} chars — paste into a form field`)
    } catch {
      notify('Cannot read clipboard (permission)', 'error')
    }
  }

  const shareWhatsApp = () => {
    const msg = encodeURIComponent(
      `${textSummary()}${pdfUrl ? `\n${pdfUrl}` : ''}`
    )
    const phone = (clientPhone || '').replace(/\D/g, '')
    const url = phone
      ? `https://wa.me/${phone.startsWith('0') ? '27' + phone.slice(1) : phone}?text=${msg}`
      : `https://wa.me/?text=${msg}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const shareFacebook = () => {
    const u = encodeURIComponent(pdfUrl || window.location.href)
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${u}`, '_blank', 'noopener,noreferrer')
  }

  const doPdf = async () => {
    if (onPdf) {
      setBusy('pdf')
      try {
        await onPdf()
      } catch (e) {
        notify(e.message || 'PDF failed', 'error')
      } finally {
        setBusy('')
      }
      return
    }
    if (pdfUrl) window.open(pdfUrl, '_blank', 'noopener,noreferrer')
    else notify('No PDF available yet', 'error')
  }

  const printPage = () => window.print()

  const emailMailto = () => {
    const subject = encodeURIComponent(`${kind} ${number || title || ''}`.trim())
    const body = encodeURIComponent(`${textSummary()}\n${pdfUrl || ''}`)
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/40 dark:bg-black/20 px-2 py-1 text-[11px] font-medium hover:bg-accent/10 hover:border-accent/40 transition disabled:opacity-40'

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-1">Actions</span>
      <button type="button" className={btn} onClick={copyText} title="Copy summary">Copy</button>
      <button type="button" className={btn} onClick={copyJson} title="Copy full JSON">JSON</button>
      <button type="button" className={btn} onClick={cutJson} title="Cut JSON to clipboard">Cut</button>
      <button type="button" className={btn} onClick={pasteHint} title="Check clipboard">Paste</button>
      <button type="button" className={btn} disabled={busy === 'pdf'} onClick={doPdf} title="PDF">
        {busy === 'pdf' ? 'PDF…' : 'PDF'}
      </button>
      <button type="button" className={btn} onClick={printPage} title="Print">Print</button>
      <button type="button" className={btn} onClick={shareWhatsApp} title="WhatsApp">WhatsApp</button>
      <button type="button" className={btn} onClick={shareFacebook} title="Facebook">Facebook</button>
      <button type="button" className={btn} onClick={emailMailto} title="Email">Email</button>
      {onDuplicate && (
        <button type="button" className={btn} onClick={onDuplicate} title="Duplicate">Duplicate</button>
      )}
      {onRefresh && (
        <button type="button" className={btn} onClick={onRefresh} title="Refresh">Refresh</button>
      )}
      {onDelete && (
        <button type="button" className={`${btn} !text-red-600`} onClick={onDelete} title="Delete">Delete</button>
      )}
    </div>
  )
}
