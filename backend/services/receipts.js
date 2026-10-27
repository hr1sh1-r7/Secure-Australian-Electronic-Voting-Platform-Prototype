const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const db = require('../db')

// SR-07: Cryptographically signed voter receipt.
// After a ballot is recorded the voter gets a receipt that proves the AEC
// received their ballot, WITHOUT revealing how they voted:
//   - commitment = SHA-256(receiptId | secret salt | ballot). The salt is never
//     given out, so the commitment reveals nothing about the preferences, and
//     the voter can't use it to prove their vote to anyone (stops vote buying).
//   - signature  = Ed25519 signature over the receipt, by the AEC's key.
// The receipts table has no voter ID and no link to the ballot row.

// ---- Signing key (kept in backend/keys/, which is git-ignored) ----------
const KEY_FILE = path.join(__dirname, '..', 'keys', 'receipt-signing.pem')

function loadOrCreateKey() {
  if (process.env.NODE_ENV !== 'test' && fs.existsSync(KEY_FILE)) {
    return crypto.createPrivateKey(fs.readFileSync(KEY_FILE))
  }
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  if (process.env.NODE_ENV !== 'test') {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true })
    fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  }
  return privateKey
}

const privateKey = loadOrCreateKey()
const publicKey = crypto.createPublicKey(privateKey)

const insertReceipt = db.prepare(
  'INSERT INTO receipts (receipt_id, commitment, signature) VALUES (?, ?, ?)'
)
const findReceipt = db.prepare('SELECT * FROM receipts WHERE receipt_id = ?')

// The exact bytes that get signed (same order every time)
function signedText(receipt) {
  return `AEC-RECEIPT|${receipt.receiptId}|${receipt.commitment}`
}

// Called inside the SR-05 ballot transaction, right after the ballot is stored
function issueReceipt(preferences) {
  const receiptId = crypto.randomBytes(16).toString('hex')
  const salt = crypto.randomBytes(32).toString('hex') // secret, never stored or returned
  const commitment = crypto
    .createHash('sha256')
    .update(`${receiptId}|${salt}|${JSON.stringify(preferences)}`)
    .digest('hex')

  const receipt = { receiptId, commitment }
  receipt.signature = crypto.sign(null, Buffer.from(signedText(receipt)), privateKey).toString('base64')

  insertReceipt.run(receipt.receiptId, receipt.commitment, receipt.signature)
  return receipt
}

// A receipt is genuine if the AEC signature checks out AND the AEC has it on record
function verifyReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return { valid: false, reason: 'No receipt provided' }
  const { receiptId, commitment, signature } = receipt

  if (![receiptId, commitment, signature].every((v) => typeof v === 'string' && v.length < 200)) {
    return { valid: false, reason: 'Receipt is incomplete or malformed' }
  }

  let signatureOk = false
  try {
    signatureOk = crypto.verify(
      null,
      Buffer.from(signedText({ receiptId, commitment })),
      publicKey,
      Buffer.from(signature, 'base64')
    )
  } catch {
    signatureOk = false
  }
  if (!signatureOk) return { valid: false, reason: 'Signature is not valid - this receipt was not issued by the AEC or has been altered' }

  const stored = findReceipt.get(receiptId)
  if (!stored || stored.commitment !== commitment) {
    return { valid: false, reason: 'No matching ballot record found' }
  }

  return { valid: true }
}

function getPublicKeyPem() {
  return publicKey.export({ type: 'spki', format: 'pem' })
}

module.exports = { issueReceipt, verifyReceipt, getPublicKeyPem }