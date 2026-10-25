
const fs = require('node:fs')
const crypto = require('node:crypto')
const { performance } = require('node:perf_hooks')

const MAX_VERIFICATION_TIME_MS = 5000

function verifySignedUpdate({
  updatePath,
  signaturePath,
  publicKeyPath,
  sbomPath,
  approvedSbomHash
}) {
  const startTime = performance.now()

  try {
    if (
      !updatePath ||
      !signaturePath ||
      !publicKeyPath ||
      !sbomPath ||
      !approvedSbomHash
    ) {
      return { valid: false, reason: 'missing_configuration' }
    }

    const update = fs.readFileSync(updatePath)
    const signature = fs.readFileSync(signaturePath)
    const publicKey = fs.readFileSync(publicKeyPath)
    const sbom = fs.readFileSync(sbomPath)

    const approvedHash = approvedSbomHash
      .replace(/^sha256:/i, '')
      .toLowerCase()

    if (!/^[a-f0-9]{64}$/.test(approvedHash)) {
      return { valid: false, reason: 'invalid_approved_sbom_hash' }
    }

    const actualSbomHash = crypto
      .createHash('sha256')
      .update(sbom)
      .digest('hex')

    if (actualSbomHash !== approvedHash) {
      return { valid: false, reason: 'sbom_hash_mismatch' }
    }

    const signatureIsValid = crypto.verify(
      null,
      update,
      publicKey,
      signature
    )

    if (!signatureIsValid) {
      return { valid: false, reason: 'invalid_signature' }
    }

    const elapsedMs = performance.now() - startTime

    if (elapsedMs > MAX_VERIFICATION_TIME_MS) {
      return { valid: false, reason: 'verification_timeout' }
    }

    return {
      valid: true,
      reason: 'verified',
      elapsedMs
    }
  } catch {
    return { valid: false, reason: 'verification_error' }
  }
}

module.exports = {
  verifySignedUpdate,
  MAX_VERIFICATION_TIME_MS
}
