import React from 'react'

export default function AppLogo({ size = 48, wordmark = false }) {
  const px = typeof size === 'number' ? size : 48
  return (
    <div className="inline-flex items-center gap-3">
      <div
        className="grid place-items-center rounded-full border border-brand/30 bg-brand/20 shadow-lg shadow-brand/10 backdrop-blur-md transition-transform duration-200 hover:scale-105"
        style={{ width: px, height: px }}
        aria-hidden
      >
        <span
          className="font-extrabold tracking-widest text-brand-dark dark:text-emerald-100"
          style={{ fontSize: Math.max(10, px * 0.28) }}
        >
          SA
        </span>
      </div>
      {wordmark && (
        <div>
          <div className="text-xs font-extrabold tracking-[0.18em]">SA INVOICE DESK</div>
          <div className="text-[11px] text-slate-500">SAID · South Africa</div>
        </div>
      )}
    </div>
  )
}
