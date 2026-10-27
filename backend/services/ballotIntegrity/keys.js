const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// Server keys for SR-13 and SR-14 (Muzammil s4175334). Same pattern as SR-07's
// receipts.js: stored in backend/keys/ (git-ignored), throwaway keys in tests.
//   - Mark-off token key (RS256): signs single-use ballot authorization tokens.
//     RS256 matches the team's SR-02 JWT standard.
//   - Ballot Store receipt key (Ed25519): signs terminal batch receipts.

const KEY_DIR = path.join(__dirname, '..', '..', 'keys')
const testing = process.env.NODE_ENV === 'test'
let cached = null

function loadOrCreate(file, generate) {
  const keyFile = path.join(KEY_DIR, file)
  if (!testing && fs.existsSync(keyFile)) {
    return crypto.createPrivateKey(fs.readFileSync(keyFile))
  }
  const { privateKey } = generate()
  if (!testing) {
    fs.mkdirSync(KEY_DIR, { recursive: true })
    fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  }
  return privateKey
}

// Created on first use, not at require time, so loading the app stays fast
function getKeys() {
  if (!cached) {
    const tokenKey = loadOrCreate('markoff-token-rs256.pem', () =>
      crypto.generateKeyPairSync('rsa', { modulusLength: testing ? 2048 : 3072 }))
    const receiptKey = loadOrCreate('ballot-store-receipt-ed25519.pem', () =>
      crypto.generateKeyPairSync('ed25519'))
    const receiptPublic = crypto.createPublicKey(receiptKey)
    cached = {
      tokenPrivateKey: tokenKey,
      tokenPublicKey: crypto.createPublicKey(tokenKey),
      tokenKid: 'markoff-rs256-1',
      receiptPrivateKey: receiptKey,
      receiptPublicKeyPem: receiptPublic.export({ type: 'spki', format: 'pem' }),
      receiptKid: 'ballot-store-ed25519-1'
    }
  }
  return cached
}

module.exports = { getKeys }
