const crypto = require('crypto')
const request = require('supertest')

const db = require('../db')
const app = require('../app')
const { createSession } = require('../services/sessionManager')

function vote(userId, preferences) {
  return request(app)
    .post('/api/ballots/cast')
    .set('Authorization', 'Bearer ' + createSession(userId, 'voter').token)
    .send({ preferences })
}

function verify(receipt) {
  return request(app).post('/api/receipts/verify').send(receipt)
}

beforeAll(() => {
  const insert = db.prepare('INSERT INTO candidates (name, party) VALUES (?, ?)')
  ;['A', 'B', 'C', 'D'].forEach((name) => insert.run('Candidate ' + name, 'Party ' + name))
})

describe('SR-07 signed voter receipt', () => {
  test('a receipt is returned when a vote is recorded', async () => {
    const res = await vote(401, [1, 2])
    expect(res.statusCode).toBe(200)
    expect(res.body.receipt).toEqual({
      receiptId: expect.stringMatching(/^[0-9a-f]{32}$/),
      commitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      signature: expect.any(String)
    })
  })

  test('the receipt is issued within 2 seconds', async () => {
    const res = await vote(402, [3])
    expect(res.body.receiptMs).toBeLessThan(2000)
  })

  test('the receipt signature is a genuine AEC Ed25519 signature', async () => {
    const { receipt } = (await vote(403, [2, 4])).body
    const pem = (await request(app).get('/api/receipts/public-key')).text

    const ok = crypto.verify(
      null,
      Buffer.from(`AEC-RECEIPT|${receipt.receiptId}|${receipt.commitment}`),
      crypto.createPublicKey(pem),
      Buffer.from(receipt.signature, 'base64')
    )
    expect(ok).toBe(true)
  })

  test('a genuine receipt verifies', async () => {
    const { receipt } = (await vote(404, [1])).body
    const res = await verify(receipt)
    expect(res.body).toEqual({ valid: true })
  })

  test('the receipt does not reveal how the person voted', async () => {
    const { receipt } = (await vote(405, [4, 3, 2, 1])).body
    const text = JSON.stringify(receipt)
    expect(text).not.toContain('[4,3,2,1]')
    expect(text).not.toContain('preferences')

    // Two people voting identically get completely different commitments
    const other = (await vote(406, [4, 3, 2, 1])).body.receipt
    expect(other.commitment).not.toBe(receipt.commitment)
  })

  test('a receipt with an altered commitment is rejected', async () => {
    const { receipt } = (await vote(407, [2])).body
    const res = await verify({ ...receipt, commitment: 'a'.repeat(64) })
    expect(res.body.valid).toBe(false)
  })

  test('a forged signature is rejected', async () => {
    const { receipt } = (await vote(408, [3])).body
    const forged = crypto.randomBytes(64).toString('base64')
    const res = await verify({ ...receipt, signature: forged })
    expect(res.body.valid).toBe(false)
  })

  test('a made-up receipt is rejected', async () => {
    const res = await verify({ receiptId: 'abc', commitment: 'def', signature: 'xyz' })
    expect(res.body.valid).toBe(false)
  })

  test('the receipts table holds no voter ID and no link to the ballot', () => {
    const columns = db.prepare('PRAGMA table_info(receipts)').all().map((c) => c.name)
    expect(columns).toEqual(['receipt_id', 'commitment', 'signature'])
  })

  test('no receipt is issued when the vote is rejected', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n
    await vote(409, [999]) // invalid candidate
    expect(db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n).toBe(before)
  })
})