const crypto = require('crypto')

// SR-09 least privilege: only a dedicated auditor may read the audit log.
function tokensMatch(given, expected) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  // timingSafeEqual stops attackers guessing the token one character at a time
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function requireAuditor(req, res, next) {
  if (req.user && req.user.role === 'auditor') {
    return next()
  }

  const header = req.get('Authorization') || ''
  const [scheme, token] = header.split(' ')
  const expected = process.env.AUDITOR_TOKEN

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Auditor authentication required' })
  }
  if (!expected || !tokensMatch(token, expected)) {
    return res.status(403).json({ error: 'Access denied' })
  }

  next()
}

module.exports = requireAuditor