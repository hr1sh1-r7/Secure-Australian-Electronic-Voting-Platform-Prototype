const express = require('express')
const db = require('../db')
const { verifyPassword, DUMMY_HASH } = require('../services/passwords')
const { isLocked, recordFailedLogin, clearFailures, normalise } = require('../services/lockout')
const { createSession } = require('../services/sessionManager')
const { logEvent } = require('../services/auditLogger')
const validate = require('../middleware/validate')
const schemas = require('../validation/schemas')

const router = express.Router()
const findUser = db.prepare('SELECT * FROM users WHERE username = ?')

// One message for both "unknown user" and "wrong password",
// so attackers can't discover which usernames exist
const INVALID = { error: 'Invalid username or password' }

// POST /api/auth/login  { username, password }
// BASIC password login - shared groundwork so SR-11 and SR-12 work end to end.
//   SR-10 validates the input, SR-11 lockout wraps the password check,
//   and on success an SR-12 session is created.
// TODO SR-01 (Hrishiraj): add FIDO2 MFA after the password check (step 2).
// TODO SR-02 (Hrishiraj): issue/validate a signed JWT alongside the session if required.
router.post('/login', express.json({ limit: '10kb' }), validate(schemas.login), (req, res) => {
  const { username, password } = req.body

  const name = normalise(username)

  // 1. Locked accounts are refused BEFORE the password is checked,
  //    so even the correct password can't be used during the lock
  const lock = isLocked(name)
  if (lock.locked) {
    return res.status(423).json({
      error: 'Account temporarily locked after repeated failed logins. Try again later.',
      lockedUntil: new Date(lock.lockedUntil).toISOString()
    })
  }

  // 2. Check the password (dummy hash for unknown users keeps timing the same)
  const user = findUser.get(name)
  const passwordOk = verifyPassword(password, user ? user.password_hash : DUMMY_HASH)

  if (!user || !passwordOk) {
    const result = recordFailedLogin(name, user ? user.id : undefined)
    if (result.locked) {
      return res.status(423).json({
        error: 'Account temporarily locked after repeated failed logins. Try again later.',
        lockedUntil: new Date(result.lockedUntil).toISOString()
      })
    }
    return res.status(401).json(INVALID)
  }

  // 3. Success
  clearFailures(name)
  logEvent(user.id, 'LOGIN_SUCCESS', { username: name, role: user.role })
  const session = createSession(user.id, user.role)
  res.json({ ...session, role: user.role })
})

module.exports = router