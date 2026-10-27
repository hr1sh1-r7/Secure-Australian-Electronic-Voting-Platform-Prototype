// SR-15: Independent N-Version Recount Engine - Muzammil s4175334
process.env.ENABLE_RECOUNT_FAULT_DEMO = 'true'
const request = require('supertest')

const db = require('../db')
const app = require('../app')
const { createSession } = require('../services/sessionManager')
const { hashCvr, recordCvrHash } = require('../services/cvrIntegrity')
const { countEngineA } = require('../services/recount/engineA')
const { countEngineB } = require('../services/recount/engineB')
const { canonicalize } = require('../services/ballotIntegrity/canonical')
require('../services/ballotIntegrity/tables').applySchema(db)

// Build engine input in the same shape as the ballots + cvr_hashes tables
function election(candidates, ballots) {
  return {
    candidates,
    cvrs: ballots.map((prefs, i) => {
      const json = JSON.stringify(prefs)
      return { ballot_id: i + 1, preferences_json: json, cvr_hash: hashCvr(i + 1, json) }
    })
  }
}
const times = (n, prefs) => Array.from({ length: n }, () => prefs)

async function both(input) {
  const a = countEngineA(input)
  const b = await countEngineB(input)
  expect(canonicalize(b)).toBe(canonicalize(a))
  return a
}

describe('SR-15 known-answer elections: both engines agree and are correct', () => {
  test('outright majority in round 1', async () => {
    const r = await both(election([1, 2, 3], [...times(3, [1]), [2], [3]]))
    expect(r.winner).toBe(1)
    expect(r.rounds).toHaveLength(1)
  })

  test('preferences flow when a candidate is excluded', async () => {
    const r = await both(election([1, 2, 3], [...times(4, [1, 2]), ...times(3, [2, 3]), ...times(2, [3, 2])]))
    expect(r.rounds.map((x) => x.excluded)).toEqual([3, null])
    expect(r.rounds[1].counts).toEqual({ 1: 4, 2: 5 })
    expect(r.winner).toBe(2)
  })

  test('a tie for last is broken by looking back at earlier rounds', async () => {
    const r = await both(election([1, 2, 3, 4], [...times(5, [1]), ...times(4, [2]), ...times(3, [4]), [3, 4], [3, 1]]))
    expect(r.rounds[1].counts).toEqual({ 1: 6, 2: 4, 4: 4 })
    expect(r.rounds[1].excluded).toBe(4)
    expect(r.rounds[2].exhausted).toBe(4)
    expect(r.winner).toBe(1)
  })

  test('a tie with no earlier round excludes the highest candidate ID', async () => {
    const r = await both(election([1, 2, 3], [[1], [1], [2], [3]]))
    expect(r.rounds[0].excluded).toBe(3)
  })

  test('no ballots means no winner', async () => {
    expect((await both(election([1, 2], []))).winner).toBeNull()
  })

  test('a tampered or unhashed CVR stops both engines before counting', async () => {
    const input = election([1, 2], [[1], [2], [1]])
    input.cvrs[1].preferences_json = '[1]'
    input.cvrs[2].cvr_hash = null
    const r = await both(input)
    expect(r).toEqual({ error: 'INTEGRITY_FAILURE', ballot_ids: [2, 3] })
  })
})

test('SR-15 differential test: engines agree on 150 random elections', async () => {
  let seed = 20261025
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const pick = (n) => Math.floor(rand() * n)
  for (let e = 0; e < 150; e++) {
    const candidates = [1, 2, 3, 4, 5, 6].slice(0, 2 + pick(5))
    const ballots = Array.from({ length: pick(90) }, () => {
      const prefs = [...candidates].sort(() => rand() - 0.5).slice(0, 1 + pick(candidates.length))
      if (rand() < 0.03) prefs.push(prefs[0]) // occasional informal ballot
      return prefs
    })
    await both(election(candidates, ballots))
  }
}, 60000)

describe('SR-15 publication gate (API)', () => {
  const admin = () => 'Bearer ' + createSession(1, 'admin').token
  const post = (url, body = {}) => request(app).post(url).set('Authorization', admin()).send(body)
  let runId

  beforeAll(() => {
    const addCandidate = db.prepare('INSERT INTO candidates (name) VALUES (?)')
    ;['A', 'B', 'C', 'D'].forEach((n) => addCandidate.run('Candidate ' + n))
    const addBallot = db.prepare('INSERT INTO ballots (preferences) VALUES (?)')
    for (const prefs of [[3, 1], [3], [1, 2], [2, 3], [4, 2], [3, 4], [1]]) {
      const json = JSON.stringify(prefs)
      recordCvrHash(Number(addBallot.run(json).lastInsertRowid), json)
    }
  })

  test('recount needs a logged-in admin', async () => {
    expect((await request(app).post('/api/recount/run').send({})).statusCode).toBe(401)
    const voter = 'Bearer ' + createSession(2, 'voter').token
    expect((await request(app).post('/api/recount/run').set('Authorization', voter).send({})).statusCode).toBe(403)
  })

  test('a one-vote discrepancy blocks publication and alerts the State Electoral Officer', async () => {
    const run = await post('/api/recount/run', { simulateFault: true })
    expect(run.body.status).toBe('BLOCKED')
    expect(run.body.discrepancy.type).toBe('VOTE_COUNT_MISMATCH')
    const d = run.body.discrepancy.diffs[0]
    expect(d.engineB - d.engineA).toBe(1)
    expect(run.body.alert.alertId).toBeTruthy()

    const audit = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('RECOUNT_BLOCKED', 'SEO_ALERT_RAISED')").get()
    expect(audit.n).toBe(2)
    const pub = await post(`/api/recount/runs/${run.body.runId}/publish`)
    expect(pub.body.error).toBe('RUN_BLOCKED_BY_DISCREPANCY')
  })

  test('a matched run cannot be published while voting is open', async () => {
    const run = await post('/api/recount/run')
    expect(run.body.status).toBe('MATCHED')
    runId = run.body.runId
    expect((await post(`/api/recount/runs/${runId}/publish`)).body.error).toBe('VOTING_STILL_OPEN')
  })

  test('ballots added after the count make the run unpublishable', async () => {
    await post('/api/recount/close-voting')
    const json = '[4]'
    const id = Number(db.prepare('INSERT INTO ballots (preferences) VALUES (?)').run(json).lastInsertRowid)
    recordCvrHash(id, json)
    expect((await post(`/api/recount/runs/${runId}/publish`)).body.error).toBe('BALLOTS_CHANGED_SINCE_COUNT')
    db.prepare('DELETE FROM cvr_hashes WHERE ballot_id = ?').run(id)
    db.prepare('DELETE FROM ballots WHERE id = ?').run(id)
  })

  test('a matched run on closed voting publishes exactly once', async () => {
    const pub = await post(`/api/recount/runs/${runId}/publish`)
    expect(pub.statusCode).toBe(200)
    expect(pub.body.winner).toBe(3)
    expect((await post(`/api/recount/runs/${runId}/publish`)).statusCode).toBe(409)
    const published = await request(app).get('/api/recount/published')
    expect(published.body.result.winner).toBe(3)
  })

  test('a ballot tampered with in storage blocks the recount (with SR-10)', async () => {
    db.prepare('UPDATE ballots SET preferences = ? WHERE id = 1').run('[4]')
    const run = await post('/api/recount/run')
    expect(run.body.status).toBe('BLOCKED')
    expect(run.body.engineA.error).toBe('INTEGRITY_FAILURE')
    expect(run.body.engineB.ballot_ids).toEqual([1])
  })
})
