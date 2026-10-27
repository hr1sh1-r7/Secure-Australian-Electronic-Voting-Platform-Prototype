const crypto = require('crypto')
const db = require('../db')

// SR-10: SHA-384 integrity hash for every Cast Vote Record (CVR).
// The hash is generated the moment a ballot is stored. Before tallying, every
// ballot is re-hashed and compared, so a ballot changed in storage is detected.

function hashCvr(ballotId, preferencesJson) {
  return crypto.createHash('sha384').update(`CVR|${ballotId}|${preferencesJson}`).digest('hex')
}

const insertHash = db.prepare('INSERT INTO cvr_hashes (ballot_id, hash) VALUES (?, ?)')
const allBallotsWithHashes = db.prepare(`
  SELECT b.id, b.preferences, h.hash
  FROM ballots b LEFT JOIN cvr_hashes h ON h.ballot_id = b.id
  ORDER BY b.id
`)

// Called inside the SR-05 ballot transaction, straight after the INSERT
function recordCvrHash(ballotId, preferencesJson) {
  const hash = hashCvr(ballotId, preferencesJson)
  insertHash.run(ballotId, hash)
  return hash
}

function verifyAllCvrs() {
  const rows = allBallotsWithHashes.all()
  const tampered = []
  const missingHash = []

  for (const row of rows) {
    if (!row.hash) missingHash.push(row.id)
    else if (hashCvr(row.id, row.preferences) !== row.hash) tampered.push(row.id)
  }

  return {
    valid: tampered.length === 0 && missingHash.length === 0,
    checked: rows.length,
    tampered,
    missingHash
  }
}

module.exports = { hashCvr, recordCvrHash, verifyAllCvrs }