const crypto = require('crypto')

// SR-14 / SR-16 (Muzammil s4175334): shared by the server and the polling terminal.
// Signatures and hash chains are computed over CANONICAL JSON (keys sorted,
// no whitespace), so the same object always gives the same bytes.

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Non-finite numbers cannot be canonicalised')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  return '{' + Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]))
    .join(',') + '}'
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

// First link of every terminal's queue chain
function genesisHash(terminalId) {
  return sha256Hex('genesis:' + terminalId)
}

// An entry's hash covers every field, including prev_hash, so deleting,
// reordering or editing a queued ballot breaks the chain.
function computeEntryHash(entry) {
  const { entry_hash: _ignored, ...body } = entry
  return sha256Hex(canonicalize(body))
}

// The bytes a batch signature covers: everything except the signature
function batchSigningBytes(batch) {
  const { signature: _ignored, ...body } = batch
  return Buffer.from(canonicalize(body), 'utf8')
}

module.exports = { canonicalize, sha256Hex, genesisHash, computeEntryHash, batchSigningBytes }
