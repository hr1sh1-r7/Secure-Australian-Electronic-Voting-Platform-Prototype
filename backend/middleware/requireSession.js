const { validateSession } = require('../services/sessionManager')

// SR-12: protects any route that needs a logged-in user.
// Rejects missing, unknown and idle (10+ minutes) sessions with 401,
// and sets req.user for the route when the session is active.
const MESSAGES = {
  missing_token: 'Login required',
  invalid_or_expired: 'Session is invalid or has ended',
  idle_timeout: 'Session expired after 10 minutes of inactivity'
}

function requireSession(req, res, next) {
  const header = req.get('Authorization') || ''
  const [scheme, token] = header.split(' ')

  const result = validateSession(scheme === 'Bearer' ? token : '')

  if (!result.valid) {
    return res.status(401).json({ error: MESSAGES[result.reason], reason: result.reason })
  }

  req.user = { id: result.userId, role: result.role }
  req.sessionToken = token
  next()
}

module.exports = requireSession