const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// SR-14: the terminal's signing key (Muzammil s4175334).
//
// TerminalSigner interface - any signer provides:
//   algorithm       e.g. 'Ed25519'
//   publicKeyPem()  SPKI PEM registered with the Ballot Store at enrolment
//   sign(bytes)     base64 signature
//
// SoftwareEd25519Signer is the prototype: the key is generated on the terminal,
// saved with owner-only permissions and never sent anywhere. A production
// TpmSigner (via tpm2-tss) would create the key inside the TPM as
// non-exportable and implement the same three members, so nothing else changes.
// Note: most TPM 2.0 chips in service support RSA and ECDSA P-256 rather than
// Ed25519, so hardware would likely sign with ECDSA P-256. The server's
// verification (node:crypto) supports either.

class SoftwareEd25519Signer {
  constructor(privateKey) {
    this.algorithm = 'Ed25519'
    this._privateKey = privateKey
    this._publicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
  }

  static loadOrCreate(keyFile) {
    if (!fs.existsSync(keyFile)) {
      fs.mkdirSync(path.dirname(keyFile), { recursive: true })
      const { privateKey } = crypto.generateKeyPairSync('ed25519')
      fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    }
    return new SoftwareEd25519Signer(crypto.createPrivateKey(fs.readFileSync(keyFile)))
  }

  publicKeyPem() {
    return this._publicKeyPem
  }

  sign(bytes) {
    return crypto.sign(null, bytes, this._privateKey).toString('base64')
  }
}

module.exports = { SoftwareEd25519Signer }
