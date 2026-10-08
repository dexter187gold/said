import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAssistant } from '../hooks/useAssistant'

/**
 * Bottom-right green gear: Start (create) + open page settings.
 * Page settings state lives in Shell via said:open-page-settings event.
 */
export default function HelpPanel() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const { hints, search, pathname } = useAssistant()
  const results = search(q)
  const nav = useNavigate()

  const start = (path) => {
    setOpen(false)
    nav(path)
  }

  const openPageSettings = () => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent('said:open-page-settings'))
  }

  return (
    <>
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
        {open && (
          <div className="w-[min(360px,calc(100vw-1.5rem))] max-h-[75vh] overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 p-4 shadow-xl backdrop-blur-md">
            <div className="mb-3 flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
              <div>
                <div className="font-bold">Start</div>
                <div className="text-xs text-slate-500">{pathname}</div>
              </div>
              <button type="button" className="btn-outline !px-2 !py-1 text-xs" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <div className="mb-3">
              <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1.5">Create</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" className="btn-primary !text-xs !py-2" onClick={() => start('/invoices/new')}>
                  New invoice
                </button>
                <button type="button" className="btn-outline !text-xs !py-2" onClick={() => start('/quotes/new')}>
                  New quote
                </button>
                <button type="button" className="btn-outline !text-xs !py-2" onClick={() => start('/tickets')}>
                  Tickets
                </button>
                <button type="button" className="btn-outline !text-xs !py-2" onClick={() => start('/clients')}>
                  Clients
                </button>
                <button type="button" className="btn-outline !text-xs !py-2" onClick={() => start('/credits/new')}>
                  Credit note
                </button>
                <button type="button" className="btn-outline !text-xs !py-2" onClick={() => start('/money')}>
                  Money
                </button>
              </div>
            </div>

            <button type="button" className="btn-outline w-full !text-xs mb-3" onClick={openPageSettings}>
              ⚙ Page settings
            </button>

            <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Tips</div>
            <ul className="mb-3 list-disc space-y-1 pl-4 text-sm">
              {hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <input className="input mb-2" placeholder="Search FAQ…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="space-y-2">
              {results.map((f) => (
                <details key={f.q} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-semibold">{f.q}</summary>
                  <p className="mt-1 text-slate-500">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/40 transition-all duration-200 hover:scale-105 hover:bg-emerald-500"
          title="Start — create invoice, quote, open page settings"
          aria-label="Start and page tools"
        >
          <span className="text-xl leading-none">⚙</span>
        </button>
      </div>
    </>
  )
}
