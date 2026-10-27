const crypto = require('crypto')
const db = require('../db')
const { applySchema } = require('./ballotIntegrity/tables')
const { canonicalize } = require('./ballotIntegrity/canonical')

// SR-14: polling terminal registry and signature checks (Muzammil s4175334).
// Each terminal holds a private signing key that never leaves the device;
// only its public key is registered here. Everything a terminal sends
// (mark-off requests and vote batches) is signed with it.

applySchema(db)

const REQUEST_MAX_AGE_MS = 60 * 1000
const insertTerminal = db.prepare(`
  INSERT INTO terminals (terminal_id, public_key_pem, polling_place, registered_at)
  VALUES (?, ?, ?, ?) ON CONFLICT (terminal_id) DO NOTHING
`)
const findTerminal = db.prepare('SELECT public_key_pem, revoked FROM terminals WHERE terminal_id = ?')

function secretsMatch(given, expected) {
  if (typeof given !== 'string' || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

class RegistrationError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function registerTerminal({ terminalId, publicKeyPem, pollingPlace }) {
  let key
  try {
    key = crypto.createPublicKey(publicKeyPem)
  } catch {
    throw new RegistrationError('Public key is not a valid PEM', 400)
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new RegistrationError('Terminal key must be Ed25519', 400)
  const pem = key.export({ type: 'spki', format: 'pem' })

  const { changes } = insertTerminal.run(terminalId, pem, pollingPlace, new Date().toISOString())
  // A terminal ID is enrolled once. Re-enrolling with the SAME key (restart) is fine;
  // a different key for an existing ID needs an administrator.
  if (changes === 0 && findTerminal.get(terminalId).public_key_pem !== pem) {
    throw new RegistrationError('Terminal ID already enrolled with a different key', 409)
  }
}

function verifyTerminalSignature(terminalId, bytes, signatureB64) {
  if (typeof signatureB64 !== 'string' || signatureB64 === '') return { ok: false, reason: 'UNSIGNED' }
  const row = findTerminal.get(terminalId)
  if (!row || row.revoked) return { ok: false, reason: 'UNKNOWN_OR_REVOKED_TERMINAL' }
  let valid = false
  try {
    valid = crypto.verify(null, bytes, crypto.createPublicKey(row.public_key_pem), Buffer.from(signatureB64, 'base64'))
  } catch {
    valid = false
  }
  return valid ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' }
}

// Small signed request: { ...fields, terminal_id, timestamp, signature }.
// The 60-second timestamp window limits how long a captured request is usable.
function verifySignedRequest(body) {
  const { signature, ...fields } = body
  const ts = Date.parse(fields.timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > REQUEST_MAX_AGE_MS) {
    return { ok: false, reason: 'STALE_OR_MISSING_TIMESTAMP' }
  }
  return verifyTerminalSignature(fields.terminal_id, Buffer.from(canonicalize(fields)), signature)
}

module.exports = { registerTerminal, verifyTerminalSignature, verifySignedRequest, secretsMatch, RegistrationError }
