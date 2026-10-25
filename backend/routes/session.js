const express = require('express')
const requireSession = require('../middleware/requireSession')
const { createSession, endSession, getIdleTimeoutMs } = require('../services/sessionManager')
const validate = require('../middleware/validate')
const schemas = require('../validation/schemas')

const router = express.Router()

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
router.post('/demo-login', (req, res, next) => {
  if (process.env.ENABLE_DEMO_LOGIN !== 'true') {
    return res.status(404).json({ error: 'Not found' })
  }
  next()
}, express.json({ limit: '1kb' }), validate(schemas.demoLogin), (req, res) => {
  res.json(createSession(req.body.userId, req.body.role))
})

module.exports = router