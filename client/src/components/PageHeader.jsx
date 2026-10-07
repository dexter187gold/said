import React from 'react'

/**
 * Corporate page header with title, subtitle, meta chips, and actions.
 */
export default function PageHeader({ title, subtitle, meta = [], actions }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        )}
        {meta?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {meta.map((m, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300"
              >
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>
      )}
    </div>
  )
}
