
const fs = require('node:fs')
const tls = require('node:tls')
const path = require('node:path')

const TLS_VERSION = 'TLSv1.3'

/**
 * Load the trusted AEC CA certificate.
 * The certificate path is supplied through an environment variable.
 */
function loadTrustedCA(
  caPath = process.env.AEC_CA_CERT_PATH
) {
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
 * Build TLS options for a server that requires client certificates.
 * The server certificate and private key must also be configured.
 */
function createMtlsServerOptions({
  caPath,
  certPath,
  keyPath
}) {
  if (!certPath || !keyPath) {
    throw new Error('Server certificate and key are required')
  }

  const ca = loadTrustedCA(caPath)

  return {
    minVersion: TLS_VERSION,
    maxVersion: TLS_VERSION,
    ca,
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    requestCert: true,
    rejectUnauthorized: true,
    handshakeTimeout: 1000
  }
}

/**
 * Check whether a completed TLS connection has a valid client certificate.
 */
function isAuthorizedClient(socket) {
  return Boolean(
    socket &&
    socket.authorized &&
    socket.getProtocol() === TLS_VERSION
  )
}

module.exports = {
  TLS_VERSION,
  loadTrustedCA,
  createMtlsServerOptions,
  isAuthorizedClient
}
