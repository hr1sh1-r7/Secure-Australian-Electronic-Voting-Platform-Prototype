const crypto = require('crypto')
const db = require('../db')

// Starting value for the first entry's prev_hash (SHA-384 hex = 96 characters)
const GENESIS_HASH = '0'.repeat(96)

// Hash an entry's contents together with the previous entry's hash.
// Fields are always joined in the same order so the hash can be re-checked later.
function computeHash(entry) {
  const text = [
    entry.created_at,
    entry.actor_id,
    entry.action,
    entry.details ?? '',
    entry.prev_hash
  ].join('|')

  return crypto.createHash('sha384').update(text).digest('hex')
}

const getLastHash = db.prepare(
  'SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1'
)

const insertEntry = db.prepare(`
  INSERT INTO audit_log (created_at, actor_id, action, details, prev_hash, hash)
  VALUES (?, ?, ?, ?, ?, ?)
`)

const getAllEntries = db.prepare('SELECT * FROM audit_log ORDER BY id')

// Record an administrative or security event.
// Runs as a transaction so two events logged at once can't fork the chain.
const logEvent = db.transaction((actorId, action, details = null) => {
  if (!Number.isInteger(actorId)) {
    throw new Error('actorId must be an integer')
  }
  if (typeof action !== 'string' || action.trim() === '') {
    throw new Error('action must be a non-empty string')
  }

  const last = getLastHash.get()

  const entry = {
    created_at: new Date().toISOString(), // millisecond precision
    actor_id: actorId,
    action: action.trim(),
    details: details === null || typeof details === 'string'
      ? details
      : JSON.stringify(details),
    prev_hash: last ? last.hash : GENESIS_HASH
  }

  entry.hash = computeHash(entry)

  const result = insertEntry.run(
    entry.created_at,
    entry.actor_id,
    entry.action,
    entry.details,
    entry.prev_hash,
    entry.hash
  )

  return { id: Number(result.lastInsertRowid), ...entry }
})

// Return every entry, oldest first (read-only view for auditors).
function getAuditLog() {
  return getAllEntries.all()
}

// Recompute every hash in order. Reports the first entry where the chain breaks.
function verifyChain() {
  const rows = getAllEntries.all()
  let expectedPrev = GENESIS_HASH

  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return { valid: false, brokenAt: row.id, reason: 'prev_hash does not match previous entry' }
    }
    if (computeHash(row) !== row.hash) {
      return { valid: false, brokenAt: row.id, reason: 'entry contents have been altered' }
    }
    expectedPrev = row.hash
  }

  return { valid: true, entries: rows.length }
}

module.exports = { logEvent, getAuditLog, verifyChain, computeHash, GENESIS_HASH }