const express = require('express')
const validate = require('../middleware/validate')
const schemas = require('../validation/ballotIntegritySchemas')
const { verifySignedRequest } = require('../services/terminalRegistry')
const { markOffAndAuthorize, MarkOffRefused } = require('../services/markoff')
const { logEvent } = require('../services/auditLogger')

// SR-13: a polling terminal marks a voter off the certified roll and receives
// a single-use ballot authorization token (Muzammil s4175334).
// The request must be signed by a registered terminal (SR-14).
const router = express.Router()
router.use(express.json({ limit: '4kb' }))
const SYSTEM_ACTOR = 0

router.post('/authorize', validate(schemas.authorizeRequest), (req, res) => {
  const started = process.hrtime.bigint()
  const elapsed = () => Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(3))

  const sig = verifySignedRequest(req.body)
  if (!sig.ok) {
    logEvent(SYSTEM_ACTOR, 'MARKOFF_REQUEST_REJECTED', { terminalId: req.body.terminal_id, reason: sig.reason })
    return res.status(401).json({ error: sig.reason })
  }

  try {
    const { token, expiresIn } = markOffAndAuthorize({ voterId: req.body.voter_id, terminalId: req.body.terminal_id })
    res.json({ token, expiresIn, elapsedMs: elapsed() })
  } catch (err) {
    if (err instanceof MarkOffRefused) {
      return res.status(err.status).json({ error: err.reason, elapsedMs: elapsed() })
    }
    throw err
  }
})

module.exports = router
