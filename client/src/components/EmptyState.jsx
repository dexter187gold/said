import React from 'react'
import { Link } from 'react-router-dom'

/** Athena-Wood: consistent empty / loading UI */
export function EmptyState({ title, body, actionLabel, actionTo, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center" role="status">
      <div className="text-3xl opacity-40" aria-hidden>
        ◇
      </div>
      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
      {body && <p className="max-w-sm text-xs text-slate-500">{body}</p>}
      {actionTo && (
        <Link className="btn-primary mt-2 !text-xs" to={actionTo}>
          {actionLabel || 'Get started'}
        </Link>
      )}
      {onAction && !actionTo && (
        <button type="button" className="btn-primary mt-2 !text-xs" onClick={onAction}>
          {actionLabel || 'Get started'}
        </button>
      )}
    </div>
  )
}

export function SkeletonRows({ rows = 5, cols = 4 }) {
  return (
    <div className="animate-pulse space-y-2 p-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2">
          {Array.from({ length: cols }).map((__, j) => (
            <div
              key={j}
              className="h-3 flex-1 rounded bg-slate-200 dark:bg-slate-700"
              style={{ opacity: 1 - i * 0.08 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
