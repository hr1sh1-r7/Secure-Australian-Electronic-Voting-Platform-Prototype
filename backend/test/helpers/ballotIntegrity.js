// Shared test helpers for SR-13 to SR-16 (Muzammil s4175334).
// Simulates a polling terminal: its own Ed25519 key, signed requests and
// hash-chained, signed vote batches.
const crypto = require('crypto')
const request = require('supertest')
const db = require('../../db')
const { applySchema } = require('../../services/ballotIntegrity/tables')
const { canonicalize, genesisHash, computeEntryHash, batchSigningBytes } = require('../../services/ballotIntegrity/canonical')

const ENROLMENT_SECRET = 'test-enrolment-secret-0123456789'
process.env.TERMINAL_ENROLMENT_SECRET = ENROLMENT_SECRET

function seedCandidatesAndRoll(voters = 300) {
  applySchema(db)
  const addCandidate = db.prepare('INSERT INTO candidates (name, party) VALUES (?, ?)')
  ;['A', 'B', 'C', 'D'].forEach((n) => addCandidate.run('Candidate ' + n, 'Party ' + n))
  const addVoter = db.prepare('INSERT INTO electoral_roll (voter_id, user_id, full_name, division) VALUES (?, ?, ?, ?)')
  for (let n = 1; n <= voters; n++) addVoter.run(voterId(n), 5000 + n, 'Voter ' + n, 'Melbourne')
}

const voterId = (n) => 'V' + String(n).padStart(4, '0')

async function enrolTerminal(app, terminalId = 'T-' + crypto.randomBytes(4).toString('hex')) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const res = await request(app)
    .post('/api/terminals/register')
    .set('X-Enrolment-Secret', ENROLMENT_SECRET)
    .send({ terminal_id: terminalId, public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }), polling_place: 'Test Hall' })
  if (res.statusCode !== 201) throw new Error('enrol failed: ' + JSON.stringify(res.body))
  return {
    id: terminalId,
    chainHead: genesisHash(terminalId),
    sign: (bytes) => crypto.sign(null, bytes, privateKey).toString('base64')
  }
}

function authorize(app, term, voter, overrides = {}) {
  const fields = { terminal_id: term.id, voter_id: voter, timestamp: new Date().toISOString(), ...overrides }
  return request(app).post('/api/markoff/authorize').send({ ...fields, signature: term.sign(Buffer.from(canonicalize(fields))) })
}

// Each spec: { token } or { voter } (offline declaration), optional preferences/ballot_id
function buildBatch(term, specs, { advance = true, sign = true } = {}) {
  let prev = term.chainHead
  const chainStart = prev
  const entries = specs.map((s) => {
    const entry = {
      ballot_id: s.ballot_id || crypto.randomUUID(),
      preferences: s.preferences || [1, 2],
      auth: s.token ? { type: 'token', token: s.token } : { type: 'declaration', voter_id: s.voter },
      queued_at: new Date().toISOString(),
      prev_hash: prev
    }
    entry.entry_hash = computeEntryHash(entry)
    prev = entry.entry_hash
    return entry
  })
  const batch = { batch_id: crypto.randomUUID(), terminal_id: term.id, created_at: new Date().toISOString(), chain_start: chainStart, entries }
  if (sign) batch.signature = term.sign(batchSigningBytes(batch))
  if (advance) term.chainHead = prev
  return batch
}

function resign(term, batch) {
  batch.signature = term.sign(batchSigningBytes(batch))
  return batch
}

const sendBatch = (app, batch) => request(app).post('/api/ballot-store/batches').send(batch)

module.exports = { seedCandidatesAndRoll, voterId, enrolTerminal, authorize, buildBatch, resign, sendBatch, canonicalize }
