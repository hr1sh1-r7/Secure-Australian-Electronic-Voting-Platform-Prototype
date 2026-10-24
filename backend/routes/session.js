const express = require('express')
const requireSession = require('../middleware/requireSession')
const { createSession, endSession, getIdleTimeoutMs } = require('../services/sessionManager')

const router = express.Router()

const ALLOWED_ROLES = ['voter', 'admin', 'auditor']

// SR-12: the frontend calls this while the user is active, which keeps the
// server-side session alive. It also tells the page how long the idle limit is.
router.get('/status', requireSession, (req, res) => {
  res.json({
    userId: req.user.id,
    role: req.user.role,
    idleTimeoutMs: getIdleTimeoutMs()
  })
})

// SR-12: ends the session on the server so the token can't be reused.
router.post('/logout', requireSession, (req, res) => {
  endSession(req.sessionToken)
  res.json({ loggedOut: true })
})

// TEMPORARY demo login, only active when ENABLE_DEMO_LOGIN=true in .env.
// The real login (SR-01/SR-02) will call createSession() after checking
// the password and MFA; remove this route once that exists.
router.post('/demo-login', express.json(), (req, res) => {
  if (process.env.ENABLE_DEMO_LOGIN !== 'true') {
    return res.status(404).json({ error: 'Not found' })
  }

  const userId = Number(req.body?.userId)
  const role = req.body?.role

  if (!Number.isInteger(userId) || userId < 1 || !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: 'userId (positive integer) and a valid role are required' })
  }

  res.json(createSession(userId, role))
})

module.exports = router