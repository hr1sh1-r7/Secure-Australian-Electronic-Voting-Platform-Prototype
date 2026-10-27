
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const {
  TLS_VERSION,
  createMtlsServerOptions,
  isCertificatePinned,
  isAuthorizedClient
} = require('../Security/mtls')

describe('SR-17: Mutual TLS configuration and pinning', () => {
  test('configures TLS 1.3 and requires client certificates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtls-test-'))
    const caPath = path.join(dir, 'ca.pem')
    const certPath = path.join(dir, 'server.pem')
    const keyPath = path.join(dir, 'server-key.pem')

    fs.writeFileSync(caPath, 'placeholder CA')
    fs.writeFileSync(certPath, 'placeholder certificate')
    fs.writeFileSync(keyPath, 'placeholder key')

    try {
      const options = createMtlsServerOptions({
        caPath,
        certPath,
        keyPath
      })

      expect(options.minVersion).toBe(TLS_VERSION)
      expect(options.maxVersion).toBe(TLS_VERSION)
      expect(options.requestCert).toBe(true)
      expect(options.rejectUnauthorized).toBe(true)
      expect(options.handshakeTimeout).toBe(1000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('requires a server certificate and key', () => {
    expect(() =>
      createMtlsServerOptions({ caPath: 'unused.pem' })
    ).toThrow('Server certificate and key are required')
  })

  test('accepts a matching SHA-256 certificate pin', () => {
    const raw = Buffer.from('test certificate')
    const pin = crypto.createHash('sha256').update(raw).digest('hex')

    expect(isCertificatePinned({ raw }, pin)).toBe(true)
  })

  test('rejects a mismatched certificate pin', () => {
    expect(
      isCertificatePinned(
        { raw: Buffer.from('unapproved certificate') },
        '00'.repeat(32)
      )
    ).toBe(false)
  })

  test('rejects a missing certificate or pin', () => {
    expect(isCertificatePinned(null, '00'.repeat(32))).toBe(false)
    expect(isCertificatePinned({ raw: Buffer.from('certificate') }, '')).toBe(false)
  })

  test('rejects an unauthorized client socket', () => {
    expect(
      isAuthorizedClient({
        authorized: false,
        getProtocol: () => TLS_VERSION
      }, '00'.repeat(32))
    ).toBe(false)
  })

  test('rejects TLS 1.2', () => {
    expect(
      isAuthorizedClient({
        authorized: true,
        getProtocol: () => 'TLSv1.2',
        getPeerCertificate: () => ({ raw: Buffer.from('certificate') })
      }, '00'.repeat(32))
    ).toBe(false)
  })

  test('rejects a socket without a peer certificate', () => {
    expect(
      isAuthorizedClient({
        authorized: true,
        getProtocol: () => TLS_VERSION,
        getPeerCertificate: () => ({})
      }, '00'.repeat(32))
    ).toBe(false)
  })
})
