export function errorHandler(err, _req, res, _next) {
  if (err?.name === 'ZodError') {
    const first = err.issues?.[0]
    const message = first ? `${first.path?.join('.') || 'field'}: ${first.message}` : 'Validation failed'
    return res.status(400).json({ error: true, message, issues: err.issues })
  }
  const status = err.status || 500
  res.status(status).json({
    error: true,
    message: err.message || 'Server error',
    code: err.code || (status === 500 ? 'INTERNAL' : 'BAD_REQUEST'),
    ...(err.data ? { data: err.data } : {}),
  })
}

export function notFound(_req, res) {
  res.status(404).json({ error: true, message: 'Not found' })
}
