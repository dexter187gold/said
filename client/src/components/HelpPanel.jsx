import React, { useState } from 'react'
import { useAssistant } from '../hooks/useAssistant'

export default function HelpPanel() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const { hints, search, pathname } = useAssistant()
  const results = search(q)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 grid h-12 w-12 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition-all duration-200 hover:scale-105"
        title="Help"
      >
        ✦
      </button>
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-[min(360px,calc(100vw-1.5rem))] max-h-[70vh] overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 p-4 shadow-xl backdrop-blur-md">
          <div className="mb-3 flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
            <div>
              <div className="font-bold">Help & tips</div>
              <div className="text-xs text-slate-500">{pathname}</div>
            </div>
            <button type="button" className="btn-outline !px-2 !py-1 text-xs" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
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
    </>
  )
}
