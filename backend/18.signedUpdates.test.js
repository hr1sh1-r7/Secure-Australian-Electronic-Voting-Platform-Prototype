
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const {
  verifySignedUpdate,
  MAX_VERIFICATION_TIME_MS
} = require('../Security/signedUpdates')

describe('SR-18: Signed updates and SBOM verification', () => {
  let tempDir
  let updatePath
  let signaturePath
  let publicKeyPath
  let sbomPath
  let privateKey
  let publicKey

  const updateContent = Buffer.from('test firmware update')
  const sbomContent = Buffer.from('{"components":[]}')

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sr18-test-')
    )

    updatePath = path.join(tempDir, 'update.bin')
    signaturePath = path.join(tempDir, 'update.sig')
    publicKeyPath = path.join(tempDir, 'public.pem')
    sbomPath = path.join(tempDir, 'sbom.json')

    const keys = crypto.generateKeyPairSync('ed25519')
    privateKey = keys.privateKey
    publicKey = keys.publicKey

    fs.writeFileSync(updatePath, updateContent)
    fs.writeFileSync(
      signaturePath,
      crypto.sign(null, updateContent, privateKey)
    )
    fs.writeFileSync(
      publicKeyPath,
      publicKey.export({ type: 'spki', format: 'pem' })
    )
    fs.writeFileSync(sbomPath, sbomContent)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function approvedHash() {
    return crypto
      .createHash('sha256')
      .update(sbomContent)
      .digest('hex')
  }

  function verify(overrides = {}) {
    return verifySignedUpdate({
      updatePath,
      signaturePath,
      publicKeyPath,
      sbomPath,
      approvedSbomHash: approvedHash(),
      ...overrides
    })
  }

  test('accepts a valid signature and matching SBOM hash', () => {
    const result = verify()

    expect(result.valid).toBe(true)
    expect(result.reason).toBe('verified')
    expect(result.elapsedMs).toBeLessThanOrEqual(
      MAX_VERIFICATION_TIME_MS
    )
  })

  test('rejects a tampered update', () => {
    fs.writeFileSync(updatePath, 'tampered firmware')

    const result = verify()

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_signature')
  })

  test('rejects an incorrect SBOM hash', () => {
    const result = verify({
      approvedSbomHash: '0'.repeat(64)
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('sbom_hash_mismatch')
  })

  test('rejects a missing public key path', () => {
    const result = verify({ publicKeyPath: undefined })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing_configuration')
  })

  test('rejects an invalid approved SBOM hash', () => {
    const result = verify({ approvedSbomHash: 'not-a-hash' })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_approved_sbom_hash')
  })
})
