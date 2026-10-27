const express = require('express')
const db = require('../db')
const requireAuditor = require('../middleware/requireAuditor')
const { verifyAllCvrs } = require('../services/cvrIntegrity')
const { logEvent } = require('../services/auditLogger')

// SR-10: Central Tabulation. Ballots are integrity-checked BEFORE counting;
// if any CVR fails its SHA-384 check, the count is refused.
const router = express.Router()
router.use(requireAuditor)

const SYSTEM_ACTOR = 0
const allBallots = db.prepare('SELECT preferences FROM ballots')
const candidates = db.prepare('SELECT id, name, party FROM candidates ORDER BY id')

router.get('/integrity', (req, res) => {
  const result = verifyAllCvrs()
  if (!result.valid) logEvent(SYSTEM_ACTOR, 'CVR_INTEGRITY_FAILURE', result)
  res.json(result)
})

// Simple first-preference count (enough to demonstrate the pre-tally check)
router.get('/', (req, res) => {
  const integrity = verifyAllCvrs()
  if (!integrity.valid) {
    logEvent(SYSTEM_ACTOR, 'TALLY_BLOCKED', integrity)
    return res.status(409).json({ error: 'Tally refused: ballot integrity check failed', integrity })
  }

  const counts = new Map(candidates.all().map((c) => [c.id, { ...c, firstPreferences: 0 }]))
  for (const { preferences } of allBallots.all()) {
    const first = JSON.parse(preferences)[0]
    if (counts.has(first)) counts.get(first).firstPreferences++
  }

  res.json({ integrity, results: [...counts.values()] })
})

module.exports = router