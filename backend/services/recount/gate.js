const crypto = require('crypto')
const db = require('../../db')
const { applySchema } = require('../ballotIntegrity/tables')
const { canonicalize } = require('../ballotIntegrity/canonical')
const { electionStatus } = require('../electionState')
const { alertStateElectoralOfficer } = require('../seoAlerts')
const { logEvent } = require('../auditLogger')
const { countEngineA } = require('./engineA')
const { countEngineB } = require('./engineB')

// SR-15: Independent N-Version Recount Engine - publication gate
// Owner: Muzammil Malek (s4175334)
//
// Both engines count the same Cast Vote Records (SR-05 ballots table, with
// SR-10 SHA-384 hashes). Their full round-by-round results are compared.
// Any difference of 1 or more votes:
//   - marks the run BLOCKED, so it can never be published,
//   - writes to the SR-09 audit log,
//   - alerts the State Electoral Officer immediately (well inside 10 minutes).

applySchema(db)

class RecountError extends Error {
  constructor(reason, status) {
    super(reason)
    this.reason = reason
    this.status = status
  }
}

const q = {
  cvrs: db.prepare(`
    SELECT b.id AS ballot_id, b.preferences AS preferences_json, h.hash AS cvr_hash
    FROM ballots b LEFT JOIN cvr_hashes h ON h.ballot_id = b.id
    ORDER BY b.id
  `),
  candidates: db.prepare('SELECT id FROM candidates ORDER BY id'),
  insertRun: db.prepare(`
    INSERT INTO recount_runs (run_id, started_at, cvr_count, cvr_set_hash, engine_a, engine_b, matched, discrepancy, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getRun: db.prepare('SELECT * FROM recount_runs WHERE run_id = ?'),
  latestRun: db.prepare('SELECT run_id FROM recount_runs ORDER BY started_at DESC, rowid DESC LIMIT 1'),
  markPublished: db.prepare("UPDATE recount_runs SET status = 'PUBLISHED' WHERE run_id = ?"),
  insertResult: db.prepare('INSERT OR IGNORE INTO published_results (id, run_id, result, published_at) VALUES (1, ?, ?, ?)'),
  published: db.prepare('SELECT run_id, result, published_at FROM published_results WHERE id = 1')
}

// Fingerprint of the exact ballots counted. A run cannot be published if the
// ballots changed after it was counted.
function cvrSetHash(cvrs) {
  const h = crypto.createHash('sha384')
  for (const c of cvrs) h.update(`${c.ballot_id}:${c.cvr_hash}|`)
  return h.digest('hex')
}

// Where do two engine outputs first differ?
function findDiscrepancy(a, b) {
  if (a.error || b.error) {
    return a.error === b.error && canonicalize(a) === canonicalize(b)
      ? null
      : { type: 'ERROR_MISMATCH', engineA: a.error ?? null, engineB: b.error ?? null }
  }
  const n = Math.max(a.rounds.length, b.rounds.length)
  for (let i = 0; i < n; i++) {
    const ra = a.rounds[i]
    const rb = b.rounds[i]
    if (!ra || !rb) return { type: 'ROUND_COUNT_MISMATCH', round: i + 1 }
    const ids = [...new Set([...Object.keys(ra.counts), ...Object.keys(rb.counts)])].sort((x, y) => x - y)
    const diffs = ids
      .filter((id) => ra.counts[id] !== rb.counts[id])
      .map((id) => ({ candidate: Number(id), engineA: ra.counts[id] ?? null, engineB: rb.counts[id] ?? null }))
    if (diffs.length) return { type: 'VOTE_COUNT_MISMATCH', round: i + 1, diffs }
    if (canonicalize(ra) !== canonicalize(rb)) return { type: 'ROUND_DETAIL_MISMATCH', round: i + 1 }
  }
  return canonicalize(a) === canonicalize(b) ? null : { type: 'SUMMARY_MISMATCH' }
}

// DEMO ONLY: imitate a defective second engine that counts one extra vote
function injectFault(result) {
  const copy = structuredClone(result)
  const first = copy.rounds && copy.rounds[0]
  if (first) {
    const id = Object.keys(first.counts).sort((x, y) => x - y)[0]
    first.counts[id] += 1
  }
  return copy
}

async function runRecount({ actorId, simulateFault = false }) {
  if (simulateFault && process.env.ENABLE_RECOUNT_FAULT_DEMO !== 'true') {
    throw new RecountError('FAULT_INJECTION_DISABLED', 403)
  }
  const cvrs = q.cvrs.all()
  const input = { candidates: q.candidates.all().map((c) => c.id), cvrs }

  const started = process.hrtime.bigint()
  const [engineA, rawB] = await Promise.all([Promise.resolve(countEngineA(input)), countEngineB(input)])
  const engineB = simulateFault ? injectFault(rawB) : rawB
  const ms = Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(1))

  let discrepancy = findDiscrepancy(engineA, engineB)
  if (!discrepancy && engineA.error) discrepancy = { type: 'INTEGRITY_FAILURE', ballotIds: engineA.ballot_ids }
  const matched = discrepancy === null
  const status = matched ? 'MATCHED' : 'BLOCKED'
  const runId = crypto.randomUUID()

  q.insertRun.run(runId, new Date().toISOString(), cvrs.length, cvrSetHash(cvrs),
    JSON.stringify(engineA), JSON.stringify(engineB), matched ? 1 : 0,
    discrepancy ? JSON.stringify(discrepancy) : null, status)
  logEvent(actorId, matched ? 'RECOUNT_MATCHED' : 'RECOUNT_BLOCKED', { runId, ballots: cvrs.length, ms, simulateFault })

  let alert = null
  if (!matched) {
    alert = await alertStateElectoralOfficer({
      severity: 'CRITICAL',
      subject: 'N-version recount discrepancy: publication blocked',
      detail: { runId, discrepancy }
    })
  }
  return { runId, status, matched, ballots: cvrs.length, ms, discrepancy, engineA, engineB, alert }
}

function publish(runId, { actorId }) {
  const refuse = (reason, status = 409) => {
    logEvent(actorId, 'PUBLISH_REFUSED', { runId, reason })
    throw new RecountError(reason, status)
  }
  const run = q.getRun.get(runId)
  if (!run) refuse('UNKNOWN_RUN', 404)
  if (run.status === 'BLOCKED') refuse('RUN_BLOCKED_BY_DISCREPANCY')
  if (run.status === 'PUBLISHED' || q.published.get()) refuse('ALREADY_PUBLISHED')
  if (electionStatus().status !== 'CLOSED') refuse('VOTING_STILL_OPEN')
  if (q.latestRun.get().run_id !== runId) refuse('NOT_LATEST_RUN')
  if (cvrSetHash(q.cvrs.all()) !== run.cvr_set_hash) refuse('BALLOTS_CHANGED_SINCE_COUNT')

  const result = JSON.parse(run.engine_a)
  db.transaction(() => {
    q.insertResult.run(runId, run.engine_a, new Date().toISOString())
    q.markPublished.run(runId)
  })()
  logEvent(actorId, 'RESULT_PUBLISHED', { runId, winner: result.winner })
  return { published: true, winner: result.winner }
}

function publishedResult() {
  const row = q.published.get()
  return row ? { runId: row.run_id, publishedAt: row.published_at, result: JSON.parse(row.result) } : null
}

module.exports = { runRecount, publish, publishedResult, findDiscrepancy, RecountError }
