
const fs = require('node:fs')
const path = require('node:path')
const tls = require('node:tls')
const crypto = require('node:crypto')

const {
  createMtlsServerOptions,
  isAuthorizedClient
} = require('../Security/mtls')

const certDir = path.join(__dirname, 'certs')

const clientCertPath = path.join(certDir, 'client.pem')
const clientKeyPath = path.join(certDir, 'client-key.pem')
const caPath = path.join(certDir, 'test-ca.pem')
const serverCertPath = path.join(certDir, 'server.pem')
const serverKeyPath = path.join(certDir, 'server-key.pem')

function fingerprintOf(certPath) {
  const certificate = new crypto.X509Certificate(
    fs.readFileSync(certPath)
  )

  return certificate.fingerprint256
}

const correctPin = fingerprintOf(clientCertPath)
const wrongPin = '00'.repeat(32)

describe('SR-17: TLS 1.3 integration and certificate pinning', () => {
  let server
  let port
  let expectedPin

  beforeAll(async () => {
    server = tls.createServer(
      createMtlsServerOptions({
        caPath,
        certPath: serverCertPath,
        keyPath: serverKeyPath
      }),
      socket => {
        // Check the client's certificate pin before granting access.
        if (!isAuthorizedClient(socket, expectedPin)) {
          socket.destroy()
          return
        }

        socket.end('authorized')
      }
    )

    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port
        resolve()
      })
    })
  })

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve))
    }
  })

  function connectWithClientCertificate() {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: '127.0.0.1',
        port,
        servername: 'localhost',
        ca: fs.readFileSync(caPath),
        cert: fs.readFileSync(clientCertPath),
        key: fs.readFileSync(clientKeyPath),
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3'
      })

      let response = ''
      let settled = false

      const finish = result => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        resolve(result)
      }

      const timer = setTimeout(() => {
        finish({ response, timedOut: true })
      }, 3000)

      socket.once('secureConnect', () => {
        if (socket.getProtocol() !== 'TLSv1.3') {
          finish({ response, wrongProtocol: true })
        }
      })

      socket.on('data', chunk => {
        response += chunk.toString()
      })

      socket.once('end', () => finish({ response }))
      socket.once('error', () => finish({ response }))
      socket.once('close', () => finish({ response }))
    })
  }

  test('accepts a trusted client with the correct certificate pin', async () => {
    expectedPin = correctPin

    const result = await connectWithClientCertificate()

    expect(result).toEqual({ response: 'authorized' })
  })

  test('denies a real connection with an incorrect certificate pin', async () => {
    expectedPin = wrongPin

    const result = await connectWithClientCertificate()

    expect(result.timedOut).not.toBe(true)
    expect(result.wrongProtocol).not.toBe(true)
    expect(result.response).not.toContain('authorized')
  })
})
