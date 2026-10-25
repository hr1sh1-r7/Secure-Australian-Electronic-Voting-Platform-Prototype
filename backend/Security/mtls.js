
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const TLS_VERSION = 'TLSv1.3'

/**
 * Load the trusted CA certificate.
 * Configure AEC_CA_CERT_PATH to point to the CA certificate file.
 */
function loadTrustedCA(caPath = process.env.AEC_CA_CERT_PATH) {
  if (!caPath) {
    throw new Error('AEC_CA_CERT_PATH must be configured')
  }

  const resolvedPath = path.resolve(caPath)

  if (!fs.existsSync(resolvedPath)) {
    throw new Error('Trusted AEC CA certificate was not found')
  }

  return fs.readFileSync(resolvedPath)
}

/**
 * Build TLS server options requiring client certificate authentication.
 * certPath and keyPath identify the server's certificate and private key.
 */
function createMtlsServerOptions({ caPath, certPath, keyPath }) {
  if (!certPath || !keyPath) {
    throw new Error('Server certificate and key are required')
  }

  return {
    minVersion: TLS_VERSION,
    maxVersion: TLS_VERSION,
    ca: loadTrustedCA(caPath),
    cert: fs.readFileSync(path.resolve(certPath)),
    key: fs.readFileSync(path.resolve(keyPath)),
    requestCert: true,
    rejectUnauthorized: true,
    handshakeTimeout: 1000
  }
}

/**
 * Normalize a SHA-256 fingerprint.
 * Accepts hexadecimal fingerprints with or without colon separators.
 */
function normalizeFingerprint(fingerprint) {
  return String(fingerprint || '')
    .replace(/:/g, '')
    .toLowerCase()
}

/**
 * Read the expected client certificate SHA-256 fingerprint
 * from trusted application configuration.
 */
function getExpectedClientFingerprint(
  fingerprint = process.env.AEC_CLIENT_CERT_SHA256
) {
  if (!fingerprint) {
    throw new Error(
      'AEC_CLIENT_CERT_SHA256 must be configured'
    )
  }

  const normalized = normalizeFingerprint(fingerprint)

  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(
      'AEC_CLIENT_CERT_SHA256 must be a SHA-256 fingerprint'
    )
  }

  return normalized
}

/**
 * Verify the SHA-256 fingerprint of a peer certificate.
 * peerCertificate.raw contains the DER-encoded certificate bytes.
 */
function isCertificatePinned(peerCertificate, expectedFingerprint) {
  if (
    !peerCertificate ||
    !Buffer.isBuffer(peerCertificate.raw) ||
    !expectedFingerprint
  ) {
    return false
  }

  const expected = normalizeFingerprint(expectedFingerprint)

  if (!/^[a-f0-9]{64}$/.test(expected)) {
    return false
  }

  const actual = crypto
    .createHash('sha256')
    .update(peerCertificate.raw)
    .digest()

  const expectedBuffer = Buffer.from(expected, 'hex')

  return crypto.timingSafeEqual(actual, expectedBuffer)
}

/**
 * Check TLS authorization, TLS version, and the peer certificate pin.
 *
 * Call this from the TLS connection handler before allowing
 * the client to access protected resources.
 */
function isAuthorizedClient(socket, expectedFingerprint) {
  if (
    !socket ||
    !socket.authorized ||
    socket.getProtocol() !== TLS_VERSION
  ) {
    return false
  }

  let peerCertificate

  try {
    peerCertificate = socket.getPeerCertificate()
  } catch {
    return false
  }

  return isCertificatePinned(
    peerCertificate,
    expectedFingerprint
  )
}

module.exports = {
  TLS_VERSION,
  loadTrustedCA,
  createMtlsServerOptions,
  normalizeFingerprint,
  getExpectedClientFingerprint,
  isCertificatePinned,
  isAuthorizedClient
}
