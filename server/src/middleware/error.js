export function errorHandler(err, _req, res, _next) {
  if (err?.name === 'ZodError') {
    return res.status(400).json({ error: true, message: 'Validation failed', issues: err.issues })
  }
  const status = err.status || 500
  res.status(status).json({
    error: true,
    message: err.message || 'Server error',
    code: err.code || (status === 500 ? 'INTERNAL' : 'BAD_REQUEST'),
  })
}

export function notFound(_req, res) {
  res.status(404).json({ error: true, message: 'Not found' })
}
