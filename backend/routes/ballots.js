const express = require('express')
const db = require('../db')
const requireSession = require('../middleware/requireSession')
const { logEvent } = require('../services/auditLogger')
const { issueReceipt } = require('../services/receipts')

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

// Preferences: ordered list of distinct, existing candidate IDs
// (SR-10 replaces this with a full Zod schema)
function validPreferences(preferences) {
  if (!Array.isArray(preferences) || preferences.length < 1 || preferences.length > 150) return false
  if (!preferences.every((id) => Number.isInteger(id) && id > 0)) return false
  if (new Set(preferences).size !== preferences.length) return false
  return preferences.every((id) => candidateExists.get(id))
}

// The decoupling step: identity and ballot are written to separate tables
// in one transaction, so either both happen or neither does.
const decoupleAndStore = db.transaction((userId, preferences) => {
  if (hasVoted.get(userId)) return false
  markVoted.run(userId)                              // identity side
  insertBallot.run(JSON.stringify(preferences))      // ballot side: preferences ONLY
  return issueReceipt(preferences)                   // SR-07: signed receipt
})

router.post('/cast', requireSession, (req, res) => {
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