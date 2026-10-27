const express = require('express')
const validate = require('../middleware/validate')
const schemas = require('../validation/ballotIntegritySchemas')
const { registerTerminal, secretsMatch, RegistrationError } = require('../services/terminalRegistry')
const { receiptPublicKey } = require('../services/ballotStore')
const { logEvent } = require('../services/auditLogger')

// SR-14: polling terminal enrolment (Muzammil s4175334).
// A terminal registers its public signing key using the enrolment secret
// handed to the polling place out of band (TERMINAL_ENROLMENT_SECRET in .env).
const router = express.Router()
const SYSTEM_ACTOR = 0

// Terminals pin this key at enrolment and use it to verify batch receipts
router.get('/receipt-key', (req, res) => {
  res.json(receiptPublicKey())
})

router.post('/register',
  (req, res, next) => {
    if (!secretsMatch(req.get('X-Enrolment-Secret'), process.env.TERMINAL_ENROLMENT_SECRET)) {
      logEvent(SYSTEM_ACTOR, 'TERMINAL_ENROLMENT_REFUSED', {})
      return res.status(401).json({ error: 'Invalid enrolment secret' })
    }
    next()
  },
  express.json({ limit: '4kb' }),
  validate(schemas.registerTerminal),
  (req, res) => {
    try {
      registerTerminal({
        terminalId: req.body.terminal_id,
        publicKeyPem: req.body.public_key_pem,
        pollingPlace: req.body.polling_place
      })
    } catch (err) {
      if (err instanceof RegistrationError) return res.status(err.status).json({ error: err.message })
      throw err
    }
    logEvent(SYSTEM_ACTOR, 'TERMINAL_ENROLLED', { terminalId: req.body.terminal_id, pollingPlace: req.body.polling_place })
    res.status(201).json({ enrolled: true })
  })

module.exports = router
