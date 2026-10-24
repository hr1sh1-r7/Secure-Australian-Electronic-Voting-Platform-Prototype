const crypto = require('crypto')
const db = require('../db')
const { logEvent } = require('./auditLogger')

// SR-12: sessions expire after 10 minutes of inactivity.
const DEFAULT_IDLE_MINUTES = 10

function getIdleTimeoutMs() {
  const minutes = Number(process.env.SESSION_IDLE_MINUTES)
  const valid = Number.isFinite(minutes) && minutes > 0
  return (valid ? minutes : DEFAULT_IDLE_MINUTES) * 60 * 1000
}

// Tokens are stored hashed, so a leaked database can't be used to hijack sessions
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const insertSession = db.prepare(`
  INSERT INTO sessions (token_hash, user_id, role, created_at, last_activity)
  VALUES (?, ?, ?, ?, ?)
`)
const findSession = db.prepare('SELECT * FROM sessions WHERE token_hash = ?')
const touchSession = db.prepare('UPDATE sessions SET last_activity = ? WHERE token_hash = ?')
const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?')

// Called by login (SR-01/SR-02) once a user has authenticated
function createSession(userId, role, now = Date.now()) {
  if (!Number.isInteger(userId)) {
    throw new Error('userId must be an integer')
  }
  if (typeof role !== 'string' || role.trim() === '') {
    throw new Error('role is required')
  }

  const token = crypto.randomBytes(32).toString('hex')
  insertSession.run(hashToken(token), userId, role, now, now)
  logEvent(userId, 'SESSION_STARTED', { role })

  return { token, idleTimeoutMs: getIdleTimeoutMs() }
}

// Checks a session on every request. Idle sessions are destroyed on the server,
// so the old token can never be reused, even if the browser still has it.
function validateSession(token, now = Date.now()) {
  if (typeof token !== 'string' || token === '') {
    return { valid: false, reason: 'missing_token' }
  }

  const tokenHash = hashToken(token)
  const session = findSession.get(tokenHash)

  if (!session) {
    return { valid: false, reason: 'invalid_or_expired' }
  }

  if (now - session.last_activity >= getIdleTimeoutMs()) {
    deleteSession.run(tokenHash)
    logEvent(session.user_id, 'SESSION_TIMEOUT', {
      role: session.role,
      idleMinutes: Math.round((now - session.last_activity) / 60000)
    })
    return { valid: false, reason: 'idle_timeout' }
  }

  // Activity: restart the 10-minute window
  touchSession.run(now, tokenHash)

  return { valid: true, userId: session.user_id, role: session.role }
}

function endSession(token) {
  const tokenHash = hashToken(token)
  const session = findSession.get(tokenHash)
  if (!session) return false

  deleteSession.run(tokenHash)
  logEvent(session.user_id, 'SESSION_LOGOUT', { role: session.role })
  return true
}

module.exports = {
  createSession,
  validateSession,
  endSession,
  getIdleTimeoutMs,
  hashToken,
  DEFAULT_IDLE_MINUTES
}