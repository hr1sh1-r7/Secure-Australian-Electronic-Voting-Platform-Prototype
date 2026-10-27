const express = require('express')
const db = require('../db')
const requireSession = require('../middleware/requireSession')
const validate = require('../middleware/validate')
const schemas = require('../validation/ballotIntegritySchemas')
const { runRecount, publish, publishedResult, RecountError } = require('../services/recount/gate')
const { electionStatus, closeVoting } = require('../services/electionState')
const { listAlerts } = require('../services/seoAlerts')
const { logEvent } = require('../services/auditLogger')

// SR-15: N-version recount and publication (Muzammil s4175334).
// Everything except the published result needs a logged-in admin (SR-12
// session). Swap requireAdmin for the SR-01 FIDO2 / four-eyes check once merged.
const router = express.Router()
router.use(express.json({ limit: '1kb' }))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const rollStats = db.prepare(`
  SELECT COUNT(*) AS enrolled, SUM(status <> 'ELIGIBLE') AS markedOff FROM electoral_roll
`)
const ballotCount = db.prepare('SELECT COUNT(*) AS n FROM ballots')

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (err) {
      if (err instanceof RecountError) return res.status(err.status).json({ error: err.reason })
      next(err)
    }
  }
}

// Public once published
router.get('/published', (req, res) => {
  const result = publishedResult()
  if (!result) return res.status(404).json({ error: 'No result has been published' })
  res.json(result)
})

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Election officials only' })
  next()
}
router.use(requireSession, requireAdmin)

router.get('/status', (req, res) => {
  const roll = rollStats.get()
  res.json({
    ...electionStatus(),
    enrolled: roll.enrolled,
    markedOff: roll.markedOff ?? 0,
    ballots: ballotCount.get().n,
    faultDemoEnabled: process.env.ENABLE_RECOUNT_FAULT_DEMO === 'true',
    alerts: listAlerts()
  })
})

router.post('/close-voting', (req, res) => {
  const closed = closeVoting()
  logEvent(req.user.id, 'VOTING_CLOSED', { closed })
  res.status(closed ? 200 : 409).json({ closed })
})

router.post('/run', validate(schemas.recountRun), handle(async (req, res) => {
  res.json(await runRecount({ actorId: req.user.id, simulateFault: req.body.simulateFault === true }))
}))

router.post('/runs/:runId/publish', handle(async (req, res) => {
  if (!UUID.test(req.params.runId)) return res.status(400).json({ error: 'Invalid run ID' })
  res.json(publish(req.params.runId, { actorId: req.user.id }))
}))

module.exports = router
