const db = require('../db')
const { logEvent } = require('./auditLogger')
const { sendSocAlert } = require('./socAlert')

// SR-11: adaptive sliding-window lockout.
// 3 consecutive failed logins within 5 minutes lock the account for 15 minutes
// and raise a high-priority SOC alert. The lock expires automatically, so an
// attacker can't permanently lock out real officials.
const MAX_FAILURES = 3
const WINDOW_MS = 5 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const SYSTEM_ACTOR = 0 // audit actor ID used when the username doesn't belong to a real user

const insertFailure = db.prepare('INSERT INTO failed_logins (username, attempted_at) VALUES (?, ?)')
const countRecentFailures = db.prepare(
  'SELECT COUNT(*) AS count FROM failed_logins WHERE username = ? AND attempted_at > ?'
)
const clearFailuresStmt = db.prepare('DELETE FROM failed_logins WHERE username = ?')
const getLock = db.prepare('SELECT * FROM account_locks WHERE username = ?')
const setLock = db.prepare(`
  INSERT INTO account_locks (username, locked_at, locked_until) VALUES (?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET locked_at = excluded.locked_at, locked_until = excluded.locked_until
`)
const removeLock = db.prepare('DELETE FROM account_locks WHERE username = ?')

function normalise(username) {
  return String(username).trim().toLowerCase()
}

// Check BEFORE verifying the password. Expired locks are removed automatically.
function isLocked(username, now = Date.now()) {
  const name = normalise(username)
  const lock = getLock.get(name)
  if (!lock) return { locked: false }

  if (now >= lock.locked_until) {
    removeLock.run(name)
    return { locked: false }
  }
  return { locked: true, lockedUntil: lock.locked_until }
}

// Call on every wrong password (or unknown username).
// Returns whether this failure caused a lock, plus the SOC alert promise.
const recordFailure = db.transaction((name, now) => {
  insertFailure.run(name, now)
  const { count } = countRecentFailures.get(name, now - WINDOW_MS)
  if (count < MAX_FAILURES) return { locked: false, failures: count }

  setLock.run(name, now, now + LOCK_MS)
  clearFailuresStmt.run(name) // fresh count after the lock expires
  return { locked: true, failures: count, lockedUntil: now + LOCK_MS }
})

function recordFailedLogin(username, userId = SYSTEM_ACTOR, now = Date.now()) {
  const name = normalise(username)
  const result = recordFailure(name, now)

  logEvent(userId, 'LOGIN_FAILED', { username: name, recentFailures: result.failures })

  if (result.locked) {
    logEvent(userId, 'ACCOUNT_LOCKED', {
      username: name,
      lockedUntil: new Date(result.lockedUntil).toISOString()
    })
    // Sent immediately; not awaited so the login response isn't delayed
    result.alert = sendSocAlert({
      type: 'ACCOUNT_LOCKOUT',
      username: name,
      details: {
        failedAttempts: MAX_FAILURES,
        windowMinutes: WINDOW_MS / 60000,
        lockedUntil: new Date(result.lockedUntil).toISOString()
      }
    })
  }

  return result
}

// Successful login: consecutive-failure count starts again
function clearFailures(username) {
  clearFailuresStmt.run(normalise(username))
}

module.exports = {
  isLocked,
  recordFailedLogin,
  clearFailures,
  normalise,
  MAX_FAILURES,
  WINDOW_MS,
  LOCK_MS
}