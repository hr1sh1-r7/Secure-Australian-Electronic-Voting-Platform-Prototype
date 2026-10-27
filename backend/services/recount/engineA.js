const crypto = require('crypto')

// SR-15 Engine A: full preferential count in JavaScript (Muzammil s4175334).
// Implements COUNTING_RULES.md. Shares NO counting code with Engine B
// (backend/tally-engine-b/engine_b.py).

function expectedHash(cvr) {
  return crypto.createHash('sha384').update(`CVR|${cvr.ballot_id}|${cvr.preferences_json}`).digest('hex')
}

function parsePreferences(json) {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function isFormal(prefs, candidateSet) {
  return Array.isArray(prefs) && prefs.length > 0 &&
    new Set(prefs).size === prefs.length &&
    prefs.every((p) => Number.isInteger(p) && candidateSet.has(p))
}

function pickExclusion(lowest, history) {
  let tied = lowest
  for (let r = history.length - 1; r >= 0 && tied.length > 1; r--) {
    const min = Math.min(...tied.map((c) => history[r][c]))
    tied = tied.filter((c) => history[r][c] === min)
  }
  return Math.max(...tied)
}

function countEngineA({ candidates, cvrs }) {
  const bad = cvrs.filter((c) => !c.cvr_hash || expectedHash(c) !== c.cvr_hash).map((c) => c.ballot_id)
  if (bad.length) return { error: 'INTEGRITY_FAILURE', ballot_ids: bad.sort((a, b) => a - b) }

  const candidateSet = new Set(candidates)
  const formal = cvrs.map((c) => parsePreferences(c.preferences_json)).filter((p) => isFormal(p, candidateSet))
  const continuing = new Set(candidates)
  const rounds = []
  const history = []
  let winner = null

  for (let n = 1; ; n++) {
    const counts = new Map([...continuing].map((c) => [c, 0]))
    let exhausted = 0
    for (const prefs of formal) {
      const choice = prefs.find((p) => continuing.has(p))
      if (choice === undefined) exhausted++
      else counts.set(choice, counts.get(choice) + 1)
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    const round = { round: n, counts: Object.fromEntries(counts), exhausted, total, excluded: null, elected: null }
    rounds.push(round)

    const leader = [...counts].find(([, v]) => v * 2 > total)
    if (leader) {
      winner = round.elected = leader[0]
      break
    }
    if (total === 0) break

    const min = Math.min(...counts.values())
    const lowest = [...counts].filter(([, v]) => v === min).map(([c]) => c)
    round.excluded = pickExclusion(lowest, history)
    history.push(Object.fromEntries(counts))
    continuing.delete(round.excluded)
  }

  return { formal: formal.length, informal: cvrs.length - formal.length, winner, rounds }
}

module.exports = { countEngineA }
