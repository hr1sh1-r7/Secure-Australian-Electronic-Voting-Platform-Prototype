
const {
  TLS_VERSION,
  createMtlsServerOptions,
  isAuthorizedClient
} = require('../Security/mtls')

describe('SR-17: Mutual TLS configuration', () => {
  test('requires TLS 1.3 only', () => {
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mtls-test-')
    )

    const caPath = path.join(tempDir, 'ca.pem')
    const certPath = path.join(tempDir, 'server.pem')
    const keyPath = path.join(tempDir, 'server-key.pem')

    // These are placeholder files: Node reads their contents here,
    // but does not validate certificates until a TLS connection is made.
    fs.writeFileSync(caPath, 'test CA')
    fs.writeFileSync(certPath, 'test certificate')
    fs.writeFileSync(keyPath, 'test key')

    try {
      const options = createMtlsServerOptions({
        caPath,
        certPath,
        keyPath
      })

      expect(options.minVersion).toBe('TLSv1.3')
      expect(options.maxVersion).toBe('TLSv1.3')
      expect(options.requestCert).toBe(true)
      expect(options.rejectUnauthorized).toBe(true)
      expect(options.handshakeTimeout).toBe(1000)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('requires server certificate and key', () => {
    expect(() =>
      createMtlsServerOptions({
        caPath: 'fake-ca.pem'
      })
    ).toThrow('Server certificate and key are required')
  })

  test('rejects an unauthorized client socket', () => {
    const socket = {
      authorized: false,
      getProtocol: () => TLS_VERSION
    }

    expect(isAuthorizedClient(socket)).toBe(false)
  })

  test('accepts an authorized TLS 1.3 client socket', () => {
    const socket = {
      authorized: true,
      getProtocol: () => 'TLSv1.3'
    }

    expect(isAuthorizedClient(socket)).toBe(true)
  })

  test('rejects an authorized socket using another TLS version', () => {
    const socket = {
      authorized: true,
      getProtocol: () => 'TLSv1.2'
    }

    expect(isAuthorizedClient(socket)).toBe(false)
  })
})

