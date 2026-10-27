const crypto = require('crypto')
const db = require('../db')
const { applySchema } = require('./ballotIntegrity/tables')
const { getKeys } = require('./ballotIntegrity/keys')
const { canonicalize, sha256Hex, genesisHash, computeEntryHash, batchSigningBytes } = require('./ballotIntegrity/canonical')
const { verifyTerminalSignature } = require('./terminalRegistry')
const { verifyBallotToken, markOff, MarkOffRefused } = require('./markoff')
const { recordCvrHash } = require('./cvrIntegrity')
const { electionStatus } = require('./electionState')
const { alertStateElectoralOfficer } = require('./seoAlerts')
const { logEvent } = require('./auditLogger')

// SR-14: TPM-Signed Vote Batches & Signed Acknowledgement
// SR-16: Offline Store-and-Forward Voting Continuity (server side)
// Owner: Muzammil Malek (s4175334)
//
// A batch (already schema-checked by the route) passes these gates in order:
//   1. Terminal Ed25519 signature        -> 401 UNSIGNED / BAD_SIGNATURE / UNKNOWN_OR_REVOKED_TERMINAL
//   2. Replay check on batch_id          -> 409 REPLAYED_BATCH_ID (identical bytes = original receipt)
//   3. Voting still open                 -> 409 ELECTION_CLOSED
//   4. Hash chain continuity (SR-16)     -> 409 CHAIN_BROKEN + alert to State Electoral Officer
//   5. Per ballot: real candidates, unique ballot UUID, then EITHER a valid
//      single-use token (SR-13) OR an offline declaration that is marked off
//      now (SR-16)                       -> listed as rejected in the receipt
// Ballots are stored in SR-05's ballots table with SR-10's SHA-384 CVR hash,
// so the team's existing integrity check and tally include them.
// Everything runs in ONE SQLite transaction: a batch is stored whole or not at all.
// The receipt is signed with the Ballot Store's Ed25519 key.

applySchema(db)

const SYSTEM_ACTOR = 0

class BatchRejected extends Error {
  constructor(reason, status, detail = {}) {
    super(reason)
    this.reason = reason
    this.status = status
    this.detail = detail
  }
}

const q = {
  priorBatch: db.prepare('SELECT batch_hash, receipt FROM terminal_batches WHERE batch_id = ?'),
  ensureChain: db.prepare('INSERT OR IGNORE INTO terminal_chain (terminal_id, last_hash, updated_at) VALUES (?, ?, ?)'),
  chainHead: db.prepare('SELECT last_hash FROM terminal_chain WHERE terminal_id = ?'),
  advanceChain: db.prepare('UPDATE terminal_chain SET last_hash = ?, updated_at = ? WHERE terminal_id = ?'),
  candidateExists: db.prepare('SELECT 1 FROM candidates WHERE id = ?'),
  claimBallotId: db.prepare('INSERT OR IGNORE INTO terminal_ballot_ids (ballot_uuid) VALUES (?)'),
  spendToken: db.prepare('INSERT OR IGNORE INTO spent_tokens (jti) VALUES (?)'),
  insertBallot: db.prepare('INSERT INTO ballots (preferences) VALUES (?)'),
  insertBatch: db.prepare(`
    INSERT INTO terminal_batches (batch_id, terminal_id, batch_hash, ballot_count, accepted_count, received_at, receipt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
}

function checkChain(batch, expectedStart) {
  if (batch.chain_start !== expectedStart) {
    return { ok: false, at: 0, why: 'chain_start does not continue from the last entry received' }
  }
  let prev = expectedStart
  for (let i = 0; i < batch.entries.length; i++) {
    const entry = batch.entries[i]
    if (entry.prev_hash !== prev) return { ok: false, at: i, why: 'prev_hash link missing' }
    if (computeEntryHash(entry) !== entry.entry_hash) return { ok: false, at: i, why: 'entry_hash mismatch' }
    prev = entry.entry_hash
  }
  return { ok: true, last: prev }
}

function signReceipt(body) {
  const { receiptPrivateKey, receiptKid } = getKeys()
  const unsigned = { ...body, signer: receiptKid }
  const signature = crypto.sign(null, Buffer.from(canonicalize(unsigned)), receiptPrivateKey).toString('base64')
  return { ...unsigned, signature }
}

// Returns null if stored, otherwise the reason it was rejected
function acceptEntry(entry, terminalId) {
  if (!entry.preferences.every((id) => q.candidateExists.get(id))) return 'UNKNOWN_CANDIDATE'
  if (q.claimBallotId.run(entry.ballot_id).changes === 0) return 'DUPLICATE_BALLOT_ID'

  if (entry.auth.type === 'token') {
    let payload
    try {
      payload = verifyBallotToken(entry.auth.token)
    } catch {
      return 'INVALID_TOKEN'
    }
    if (q.spendToken.run(payload.jti).changes === 0) return 'TOKEN_ALREADY_USED'
  } else {
    // Offline ballot (SR-16): the voter could not be marked off when they
    // voted, so mark them off now. If they already voted anywhere else
    // (polling place OR online), the ballot is discarded unopened.
    // The voter ID is used for this check only and is never stored with the ballot.
    try {
      markOff({ voterId: entry.auth.voter_id, terminalId, mode: 'DECLARATION_ACCEPTED' })
    } catch (err) {
      if (err instanceof MarkOffRefused) return `DECLARATION_${err.reason}`
      throw err
    }
  }

  const preferencesJson = JSON.stringify(entry.preferences)
  const { lastInsertRowid } = q.insertBallot.run(preferencesJson) // SR-05: preferences only
  recordCvrHash(Number(lastInsertRowid), preferencesJson)          // SR-10: SHA-384 CVR hash
  return null
}

// Wrapped so a thrown entry error rolls back to a savepoint, not the whole batch
const acceptEntryAtomically = db.transaction(acceptEntry)

const storeBatch = db.transaction((batch, batchHash) => {
  const terminalId = batch.terminal_id
  const now = new Date().toISOString()

  q.ensureChain.run(terminalId, genesisHash(terminalId), now)
  const chain = checkChain(batch, q.chainHead.get(terminalId).last_hash)
  if (!chain.ok) throw new BatchRejected('CHAIN_BROKEN', 409, { entryIndex: chain.at, why: chain.why })

  const accepted = []
  const rejected = []
  for (const entry of batch.entries) {
    const reason = acceptEntryAtomically(entry, terminalId)
    if (reason) rejected.push({ ballot_id: entry.ballot_id, reason })
    else accepted.push(entry.ballot_id)
  }
  q.advanceChain.run(chain.last, now, terminalId)

  const receipt = signReceipt({
    batch_id: batch.batch_id,
    terminal_id: terminalId,
    batch_hash: batchHash,
    ballot_count: batch.entries.length,
    accepted,
    rejected,
    received_at: now
  })
  q.insertBatch.run(batch.batch_id, terminalId, batchHash, batch.entries.length, accepted.length, now, JSON.stringify(receipt))
  return receipt
})

async function processBatch(batch) {
  const started = process.hrtime.bigint()
  const elapsed = () => Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(3))
  const terminalId = batch.terminal_id
  const signingBytes = batchSigningBytes(batch)

  const sig = verifyTerminalSignature(terminalId, signingBytes, batch.signature)
  if (!sig.ok) {
    logEvent(SYSTEM_ACTOR, 'BATCH_REJECTED', { terminalId, batchId: batch.batch_id, reason: sig.reason })
    throw new BatchRejected(sig.reason, 401)
  }
  const batchHash = sha256Hex(signingBytes)

  const prior = q.priorBatch.get(batch.batch_id)
  if (prior) {
    if (prior.batch_hash === batchHash) {
      // The terminal never got our receipt (network dropped). Same bytes: resend it.
      return { receipt: JSON.parse(prior.receipt), duplicate: true, processingMs: elapsed() }
    }
    logEvent(SYSTEM_ACTOR, 'BATCH_REJECTED', { terminalId, batchId: batch.batch_id, reason: 'REPLAYED_BATCH_ID' })
    throw new BatchRejected('REPLAYED_BATCH_ID', 409)
  }

  if (electionStatus().status !== 'OPEN') throw new BatchRejected('ELECTION_CLOSED', 409)

  let receipt
  try {
    receipt = storeBatch.immediate(batch, batchHash)
  } catch (err) {
    if (err instanceof BatchRejected && err.reason === 'CHAIN_BROKEN') {
      logEvent(SYSTEM_ACTOR, 'BATCH_REJECTED', { terminalId, batchId: batch.batch_id, reason: err.reason, ...err.detail })
      // Queued ballots were deleted, reordered or edited on the terminal
      await alertStateElectoralOfficer({
        severity: 'HIGH',
        subject: `Offline queue hash chain broken on terminal ${terminalId}`,
        detail: { terminalId, batchId: batch.batch_id, ...err.detail }
      })
    }
    throw err
  }

  logEvent(SYSTEM_ACTOR, 'BATCH_ACCEPTED', {
    terminalId,
    batchId: batch.batch_id,
    ballots: batch.entries.length,
    accepted: receipt.accepted.length,
    rejected: receipt.rejected.length
  })
  return { receipt, duplicate: false, processingMs: elapsed() }
}

function receiptPublicKey() {
  const { receiptPublicKeyPem, receiptKid } = getKeys()
  return { kid: receiptKid, algorithm: 'Ed25519', public_key_pem: receiptPublicKeyPem }
}

module.exports = { processBatch, receiptPublicKey, BatchRejected }
