// SR-10: last line of defence for bad input.
// Malformed JSON, oversized bodies and unexpected errors return a short JSON
// message - never a stack trace or internal details an attacker could use.
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' })
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' })
  }
  if (process.env.NODE_ENV !== 'test') console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
}

module.exports = errorHandler