// SR-16 (encrypted, hash-chained, time-limited queue) and SR-14 (receipt
// checks) on the polling terminal - Muzammil s4175334
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { OfflineQueue, QueueClosedError, QueueTamperError } = require('../src/queue')
const { SyncAgent, verifyReceipt } = require('../src/sync')
const { SoftwareEd25519Signer } = require('../src/signer')
const { OfflineError } = require('../src/serverClient')
const { canonicalize, sha256Hex, genesisHash, computeEntryHash, batchSigningBytes } = require('../../backend/services/ballotIntegrity/canonical')

const HOUR = 3600000
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sr16-'))

function makeQueue(overrides = {}) {
  return new OfflineQueue({ dbPath: path.join(tmp(), 'q.sqlite'), key: crypto.randomBytes(32), terminalId: 'T-TEST', maxOfflineMs: 12 * HOUR, ...overrides })
}
const ballot = (voter = 'V0001', preferences = [3, 1]) => ({ ballot_id: crypto.randomUUID(), preferences, auth: { type: 'declaration', voter_id: voter } })
const rows = (q) => q.db.prepare('SELECT * FROM entries ORDER BY seq').all()

describe('SR-16 encrypted offline queue', () => {
  test('queued ballots are not readable on disk (AES-256-GCM)', () => {
    const q = makeQueue()
    q.enqueue(ballot('V0777', [4, 2]))
    const raw = Buffer.concat(rows(q).map((r) => r.ciphertext)).toString('latin1')
    expect(raw).not.toContain('V0777')
    expect(raw).not.toContain('[4,2]')
    expect(q.pending(10)[0].preferences).toEqual([4, 2])
  })

  test('a modified ciphertext is detected', () => {
    const q = makeQueue()
    q.enqueue(ballot())
    q.db.prepare('UPDATE entries SET ciphertext = randomblob(length(ciphertext))').run()
    expect(() => q.pending(10)).toThrow(QueueTamperError)
  })

  test('swapping ciphertexts between rows is detected', () => {
    const q = makeQueue()
    q.enqueue(ballot('V0001', [1]))
    q.enqueue(ballot('V0002', [2]))
    const [a, b] = rows(q)
    const upd = q.db.prepare('UPDATE entries SET iv = ?, tag = ?, ciphertext = ? WHERE seq = ?')
    upd.run(b.iv, b.tag, b.ciphertext, a.seq)
    upd.run(a.iv, a.tag, a.ciphertext, b.seq)
    expect(() => q.pending(10)).toThrow(QueueTamperError)
  })

  test('the wrong key cannot read the queue', () => {
    const dbPath = path.join(tmp(), 'q.sqlite')
    const q1 = new OfflineQueue({ dbPath, key: crypto.randomBytes(32), terminalId: 'T', maxOfflineMs: HOUR })
    q1.enqueue(ballot())
    q1.close()
    const q2 = new OfflineQueue({ dbPath, key: crypto.randomBytes(32), terminalId: 'T', maxOfflineMs: HOUR })
    expect(() => q2.pending(10)).toThrow(QueueTamperError)
  })

  test('entries form an unbroken hash chain from the terminal genesis', () => {
    const q = makeQueue()
    for (let i = 0; i < 5; i++) q.enqueue(ballot('V000' + i))
    let prev = genesisHash('T-TEST')
    for (const e of q.pending(10)) {
      expect(e.prev_hash).toBe(prev)
      expect(computeEntryHash(e)).toBe(e.entry_hash)
      prev = e.entry_hash
    }
    expect(q.chainHead()).toBe(prev)
  })

  test('ballots are accepted for 12 hours offline, then refused', () => {
    let now = Date.parse('2026-11-07T08:00:00Z')
    const q = makeQueue({ now: () => now })
    q.markOffline()
    now += 11.9 * HOUR
    expect(() => q.enqueue(ballot())).not.toThrow()
    now += 0.2 * HOUR
    expect(() => q.enqueue(ballot())).toThrow(QueueClosedError)
    q.markOnline()
    expect(() => q.enqueue(ballot())).not.toThrow()
  })
})

// ---- a fake Ballot Store for the sync agent -------------------------------
function fakeServer({ loseFirstReceipt = false } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const store = { batches: new Map(), ballots: new Set(), down: false, calls: 0 }
  const client = {
    async health() { if (store.down) throw new OfflineError('down') },
    async sendBatch(batch) {
      store.calls++
      if (store.down) throw new OfflineError('down')
      if (store.batches.has(batch.batch_id)) return { receipt: store.batches.get(batch.batch_id), duplicate: true }
      batch.entries.forEach((e) => store.ballots.add(e.ballot_id))
      const body = {
        batch_id: batch.batch_id, batch_hash: sha256Hex(batchSigningBytes(batch)), ballot_count: batch.entries.length,
        accepted: batch.entries.map((e) => e.ballot_id), rejected: [], received_at: new Date().toISOString(), signer: 'test'
      }
      const receipt = { ...body, signature: crypto.sign(null, Buffer.from(canonicalize(body)), privateKey).toString('base64') }
      store.batches.set(batch.batch_id, receipt)
      if (loseFirstReceipt && store.calls === 1) throw new OfflineError('connection reset after the server stored it')
      return { receipt, duplicate: false }
    }
  }
  return { client, store, privateKey, receiptKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) }
}

function makeAgent(q, client) {
  const signer = SoftwareEd25519Signer.loadOrCreate(path.join(tmp(), 'k.pem'))
  return new SyncAgent({ queue: q, client, signer, terminalId: 'T-TEST', intervalMs: 30000, maxBackoffMs: 120000, maxBatchEntries: 2, log: {} })
}

describe('SR-16 store-and-forward and SR-14 receipt checks', () => {
  test('the queue is forwarded automatically once the network returns, then wiped', async () => {
    const q = makeQueue()
    const srv = fakeServer()
    q.setState('receipt_key_pem', srv.receiptKeyPem)
    const agent = makeAgent(q, srv.client)
    srv.store.down = true
    for (let i = 0; i < 5; i++) q.enqueue(ballot('V00' + i))
    await agent.flush()
    expect(agent.online).toBe(false)
    expect(q.offlineSince()).not.toBeNull()

    srv.store.down = false
    await agent.flush()
    expect(q.counts()).toEqual({ queued: 0, sent: 5 })
    expect(srv.store.ballots.size).toBe(5)
    expect(q.offlineSince()).toBeNull()
    expect(rows(q).every((r) => r.ciphertext.length === 0)).toBe(true) // nothing left on the device
  })

  test('offline retries never wait more than 2 minutes (limit is 15)', async () => {
    const q = makeQueue()
    const srv = fakeServer()
    const agent = makeAgent(q, srv.client)
    srv.store.down = true
    for (let i = 0; i < 6; i++) await agent.flush()
    expect(agent.backoffMs).toBe(120000)
  })

  test('a lost receipt: the identical batch is resent and nothing is counted twice', async () => {
    const q = makeQueue()
    const srv = fakeServer({ loseFirstReceipt: true })
    q.setState('receipt_key_pem', srv.receiptKeyPem)
    const agent = makeAgent(q, srv.client)
    q.enqueue(ballot())
    await agent.flush()
    expect(q.counts().queued).toBe(1)
    await agent.flush()
    expect(q.counts().queued).toBe(0)
    expect(srv.store.batches.size).toBe(1)
  })

  test('a receipt signed by the wrong key is rejected and the batch is kept', async () => {
    const q = makeQueue()
    const srv = fakeServer()
    q.setState('receipt_key_pem', crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }))
    const agent = makeAgent(q, srv.client)
    q.enqueue(ballot())
    await agent.flush()
    expect(q.counts().queued).toBe(1)
    expect(agent.lastError).toMatch(/Receipt signature invalid/)
  })

  test('a receipt for a different batch is rejected', () => {
    const srv = fakeServer()
    const body = { batch_id: crypto.randomUUID(), batch_hash: 'x', signer: 'test' }
    const receipt = { ...body, signature: crypto.sign(null, Buffer.from(canonicalize(body)), srv.privateKey).toString('base64') }
    expect(verifyReceipt(receipt, { batch_id: crypto.randomUUID(), entries: [] }, srv.receiptKeyPem)).toBe(false)
  })
})
