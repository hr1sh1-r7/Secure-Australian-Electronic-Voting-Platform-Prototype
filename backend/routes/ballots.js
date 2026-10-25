const express = require('express')
const db = require('../db')
const requireSession = require('../middleware/requireSession')
const { logEvent } = require('../services/auditLogger')
const { issueReceipt } = require('../services/receipts')
const validate = require('../middleware/validate')
const schemas = require('../validation/schemas')
const { recordCvrHash } = require('../services/cvrIntegrity')

// SR-05: Voter decoupling (ballot secrecy).
// When a ballot arrives, one transaction:
//   1. records on the IDENTITY side that this voter has voted (no ballot data)
//   2. stores the ballot on the BALLOT side with only the preferences
//      - no user ID, session, IP address or timestamp
// The two tables share no column, so a ballot can't be traced back to a voter.
const router = express.Router()
router.use(express.json({ limit: '16kb' }))

const listCandidates = db.prepare('SELECT id, name, party FROM candidates ORDER BY id')
const candidateExists = db.prepare('SELECT 1 FROM candidates WHERE id = ?')
const hasVoted = db.prepare('SELECT 1 FROM voters_voted WHERE user_id = ?')
const markVoted = db.prepare('INSERT INTO voters_voted (user_id) VALUES (?)')
const insertBallot = db.prepare('INSERT INTO ballots (preferences) VALUES (?)')

router.get('/candidates', (req, res) => {
  res.json(listCandidates.all())
})

// Shape and type are checked by the SR-10 Zod schema before this runs;
// this adds the database check that every ID is a real candidate.
function validPreferences(preferences) {
  return preferences.every((id) => candidateExists.get(id))
}

// The decoupling step: identity and ballot are written to separate tables
// in one transaction, so either both happen or neither does.
const decoupleAndStore = db.transaction((userId, preferences) => {
  if (hasVoted.get(userId)) return false
  markVoted.run(userId)                              // identity side
  const preferencesJson = JSON.stringify(preferences)
  const { lastInsertRowid } = insertBallot.run(preferencesJson) // ballot side: preferences ONLY
  recordCvrHash(Number(lastInsertRowid), preferencesJson)        // SR-10: SHA-384 hash
  return issueReceipt(preferences)                              // SR-07: signed receipt
})

router.post('/cast', requireSession, validate(schemas.castBallot), (req, res) => {
  const started = process.hrtime.bigint()

  if (req.user.role !== 'voter') {
    return res.status(403).json({ error: 'Only voters can cast a ballot' })
  }

  // Take ONLY the preferences from the request; everything else is discarded
  const { preferences } = req.body || {}
  if (!validPreferences(preferences)) {
    return res.status(400).json({ error: 'Preferences must be distinct, valid candidate IDs' })
  }

  const receipt = decoupleAndStore(req.user.id, preferences)
  if (!receipt) {
    return res.status(409).json({ error: 'You have already voted' })
  }

  const decouplingMs = Number(process.hrtime.bigint() - started) / 1e6

  // Identity side of the audit log: WHO voted, never WHAT or which ballot
  logEvent(req.user.id, 'VOTE_RECORDED', {})

  res.json({
    recorded: true,
    decouplingMs: Number(decouplingMs.toFixed(3)),
    receiptMs: Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(3)),
    receipt
  })
})

module.exports = router