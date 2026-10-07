import React, { useState, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

/**
 * Sticky action bar for invoices, quotes, credits, tickets.
 * Actions: PDF, WhatsApp, Email, Duplicate, Copy/Cut/Paste lines, Archive, Mark paid, etc.
 */
export default function DocumentActionBar({
  type = 'invoice', // invoice | quote | credit | ticket
  id,
  number,
  status,
  onRefresh,
  selectedLineIds = [],
  lines = [],
  onLinesChange,
  className = '',
}) {
  const { notify } = useAuth()
  const [busy, setBusy] = useState(null)
  const [clipboard, setClipboard] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('said_line_clipboard') || 'null')
    } catch {
      return null
    }
  })

  const run = useCallback(
    async (key, fn) => {
      if (!id || id === 'new') {
        notify('Save the document first', 'error')
        return
      }
      setBusy(key)
      try {
        await fn()
      } catch (e) {
        notify(e.message || 'Action failed', 'error')
      } finally {
        setBusy(null)
      }
    },
    [id, notify]
  )

  const downloadPdf = () =>
    run('pdf', async () => {
      if (type === 'ticket') {
        try {
          const res = await api(`/api/v1/tickets/${id}/pdf`, { raw: true })
          if (res.ok) {
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `jobcard-${id.slice(0, 8)}.pdf`
            a.click()
            window.open(url, '_blank', 'noopener')
            notify('Job card PDF ready', 'success')
            return
          }
        } catch (_) { /* HTML print fallback */ }
        const res = await api(`/api/v1/tickets/${id}/print`, { raw: true })
        if (!res.ok) throw new Error('Print failed')
        const html = await res.text()
        const w = window.open('', '_blank')
        if (w) { w.document.open(); w.document.write(html); w.document.close() }
        notify('Job card opened for print', 'success')
        return
      }
      const res = await api(`/api/v1/invoices/${id}/pdf`, { raw: true })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || 'PDF failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${number || type}-${id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      notify('PDF downloaded', 'success')
    })

  const whatsapp = () =>
    run('wa', async () => {
      if (type === 'ticket') {
        const r = await api(`/api/v1/tickets/${id}/whatsapp-jobcard`, { method: 'POST' })
        window.open(r.data.url, '_blank', 'noopener')
        notify('WhatsApp job card opened', 'success')
        return
      }
      const r = await api(`/api/v1/doc-actions/${type}/${id}/whatsapp-link`, { method: 'POST' })
      window.open(r.data.url, '_blank', 'noopener')
      notify('WhatsApp opened', 'success')
    })

  const duplicate = () =>
    run('dup', async () => {
      const r = await api(`/api/v1/doc-actions/${type}/${id}/duplicate`, { method: 'POST' })
      notify(`Duplicated as ${r.data.number}`, 'success')
      if (onRefresh) onRefresh(r.data.id)
    })

  const copyLines = () =>
    run('copy', async () => {
      const body = selectedLineIds.length ? { action: 'copy', line_ids: selectedLineIds } : { action: 'copy' }
      const r = await api(`/api/v1/doc-actions/${type}/${id}/clipboard`, { method: 'POST', body })
      const data = r.data.lines || []
      setClipboard(data)
      sessionStorage.setItem('said_line_clipboard', JSON.stringify(data))
      notify(`Copied ${data.length} line(s)`, 'success')
    })

  const cutLines = () =>
    run('cut', async () => {
      if (!selectedLineIds.length) {
        notify('Select lines to cut', 'error')
        return
      }
      const r = await api(`/api/v1/doc-actions/${type}/${id}/clipboard`, {
        method: 'POST',
        body: { action: 'cut', line_ids: selectedLineIds },
      })
      const data = r.data.lines || []
      setClipboard(data)
      sessionStorage.setItem('said_line_clipboard', JSON.stringify(data))
      notify(`Cut ${data.length} line(s)`, 'success')
      if (onRefresh) onRefresh()
    })

  const pasteLines = () =>
    run('paste', async () => {
      const data = clipboard || JSON.parse(sessionStorage.getItem('said_line_clipboard') || 'null')
      if (!data?.length) {
        notify('Clipboard empty', 'error')
        return
      }
      await api(`/api/v1/doc-actions/${type}/${id}/paste-lines`, {
        method: 'POST',
        body: { lines: data },
      })
      notify(`Pasted ${data.length} line(s)`, 'success')
      if (onRefresh) onRefresh()
      if (onLinesChange) onLinesChange()
    })

  const archive = () =>
    run('arch', async () => {
      if (!confirm('Archive this document?')) return
      await api(`/api/v1/doc-actions/${type}/${id}/archive`, { method: 'POST' })
      notify('Archived', 'success')
      if (onRefresh) onRefresh()
    })

  const copyNumber = () => {
    if (!number) return
    navigator.clipboard?.writeText(number)
    notify('Number copied', 'success')
  }

  const isNew = !id || id === 'new'
  const isTicket = type === 'ticket'
  const isDoc = type === 'invoice' || type === 'quote' || type === 'credit'
  const Btn = ({ k, onClick, children, title, danger }) => (
    <button
      type="button"
      title={title}
      disabled={!!busy || isNew}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
      } ${busy === k ? 'ring-2 ring-accent/40' : ''}`}
    >
      {busy === k ? '…' : children}
    </button>
  )

  return (
    <div
      className={`sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 ${className}`}
    >
      <span className="mr-2 hidden text-xs font-semibold uppercase tracking-wide text-slate-400 sm:inline">
        Actions
      </span>
      <Btn k="pdf" onClick={downloadPdf} title={isTicket ? 'Print job card' : 'Download PDF (P)'}>
        {isTicket ? '🖨 Print' : '📄 PDF'}
      </Btn>
      <Btn k="wa" onClick={whatsapp} title="Share via WhatsApp (W)">
        💬 WhatsApp
      </Btn>
      {isDoc && (
        <Btn k="dup" onClick={duplicate} title="Duplicate (D)">
          ⧉ Duplicate
        </Btn>
      )}
      {isDoc && (
        <>
          <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-600" />
          <Btn k="copy" onClick={copyLines} title="Copy lines (Ctrl+C)">
            ⎘ Copy
          </Btn>
          <Btn k="cut" onClick={cutLines} title="Cut selected lines">
            ✂ Cut
          </Btn>
          <Btn k="paste" onClick={pasteLines} title="Paste lines (Ctrl+V)">
            📋 Paste
          </Btn>
        </>
      )}
      <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <Btn k="num" onClick={copyNumber} title="Copy document number / title">
        # Copy
      </Btn>
      <Btn k="arch" onClick={archive} title="Archive" danger>
        🗄 Archive
      </Btn>
      {status && (
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {status}
        </span>
      )}
    </div>
  )
}
