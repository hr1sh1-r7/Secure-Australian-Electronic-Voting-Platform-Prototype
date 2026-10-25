// SR-14 (signed batches + signed receipts) and SR-16 (store-and-forward, server side)
// Muzammil s4175334
const crypto = require('crypto')
const request = require('supertest')
const h = require('./helpers/ballotIntegrity')

const db = require('../db')
const app = require('../app')
const { verifyAllCvrs } = require('../services/cvrIntegrity')

let receiptKey
let nextVoter = 100
const voter = () => h.voterId(nextVoter++)
const token = async (term) => (await h.authorize(app, term, voter())).body.token
const reasons = (res) => res.body.receipt.rejected.map((r) => r.reason)

beforeAll(async () => {
  h.seedCandidatesAndRoll()
  const res = await request(app).get('/api/terminals/receipt-key')
  receiptKey = crypto.createPublicKey(res.body.public_key_pem)
})

function receiptVerifies(receipt) {
  const { signature, ...body } = receipt
  return crypto.verify(null, Buffer.from(h.canonicalize(body)), receiptKey, Buffer.from(signature, 'base64'))
}

describe('SR-14 signed vote batches and signed receipts', () => {
  test('terminal enrolment needs the enrolment secret', async () => {
    const res = await request(app).post('/api/terminals/register').set('X-Enrolment-Secret', 'wrong')
      .send({ terminal_id: 'T-EVIL', public_key_pem: 'x'.repeat(60), polling_place: 'Nowhere' })
    expect(res.statusCode).toBe(401)
  })

  test('a valid signed batch is accepted with a receipt whose signature verifies', async () => {
    const term = await h.enrolTerminal(app)
    const res = await h.sendBatch(app, h.buildBatch(term, [{ token: await token(term) }, { token: await token(term) }]))
    expect(res.statusCode).toBe(201)
    expect(res.body.receipt.accepted).toHaveLength(2)
    expect(receiptVerifies(res.body.receipt)).toBe(true)
    expect(res.body.processingMs).toBeLessThan(60000)
  })

  test('a receipt that has been altered fails verification', async () => {
    const term = await h.enrolTerminal(app)
    const res = await h.sendBatch(app, h.buildBatch(term, [{ token: await token(term) }]))
    expect(receiptVerifies({ ...res.body.receipt, ballot_count: 99 })).toBe(false)
  })

  test('an unsigned batch is rejected', async () => {
    const term = await h.enrolTerminal(app)
    const res = await h.sendBatch(app, h.buildBatch(term, [{ voter: voter() }], { sign: false, advance: false }))
    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('UNSIGNED')
  })

  test('a batch altered after signing is rejected', async () => {
    const term = await h.enrolTerminal(app)
    const batch = h.buildBatch(term, [{ voter: voter(), preferences: [1, 2] }], { advance: false })
    batch.entries[0].preferences = [2, 1]
    const res = await h.sendBatch(app, batch)
    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('BAD_SIGNATURE')
  })

  test('a batch from an unregistered terminal is rejected', async () => {
    const term = await h.enrolTerminal(app)
    const res = await h.sendBatch(app, h.buildBatch({ ...term, id: 'T-NOT-ENROLLED' }, [{ voter: voter() }], { advance: false }))
    expect(res.body.error).toBe('UNKNOWN_OR_REVOKED_TERMINAL')
  })

  test('a replayed batch ID with different content is rejected', async () => {
    const term = await h.enrolTerminal(app)
    const first = h.buildBatch(term, [{ token: await token(term) }])
    await h.sendBatch(app, first)
    const second = h.buildBatch(term, [{ token: await token(term) }], { sign: false })
    second.batch_id = first.batch_id
    const res = await h.sendBatch(app, h.resign(term, second))
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('REPLAYED_BATCH_ID')
  })

  test('a lost receipt: resending the identical batch returns the same receipt and stores nothing twice', async () => {
    const term = await h.enrolTerminal(app)
    const batch = h.buildBatch(term, [{ token: await token(term) }])
    const before = db.prepare('SELECT COUNT(*) AS n FROM ballots').get().n
    const first = await h.sendBatch(app, batch)
    const again = await h.sendBatch(app, batch)
    expect(again.statusCode).toBe(200)
    expect(again.body.duplicate).toBe(true)
    expect(again.body.receipt).toEqual(first.body.receipt)
    expect(db.prepare('SELECT COUNT(*) AS n FROM ballots').get().n).toBe(before + 1)
  })

  test('the same ballot token cannot be used twice (SR-13)', async () => {
    const term = await h.enrolTerminal(app)
    const t = await token(term)
    await h.sendBatch(app, h.buildBatch(term, [{ token: t }]))
    expect(reasons(await h.sendBatch(app, h.buildBatch(term, [{ token: t }])))).toEqual(['TOKEN_ALREADY_USED'])
  })

  test('unknown candidates and extra fields are rejected', async () => {
    const term = await h.enrolTerminal(app)
    expect(reasons(await h.sendBatch(app, h.buildBatch(term, [{ voter: voter(), preferences: [999] }])))).toEqual(['UNKNOWN_CANDIDATE'])
    const extra = h.buildBatch(term, [{ voter: voter() }], { advance: false })
    expect((await h.sendBatch(app, { ...extra, isAdmin: true })).statusCode).toBe(400)
  })

  test('terminal ballots go into SR-05 ballots with SR-10 hashes, and nothing identifies the voter', async () => {
    const term = await h.enrolTerminal(app)
    const v = voter()
    await h.sendBatch(app, h.buildBatch(term, [{ voter: v, preferences: [3, 4] }]))
    const last = db.prepare('SELECT * FROM ballots ORDER BY id DESC LIMIT 1').get()
    expect(last.preferences).toBe('[3,4]')
    expect(JSON.stringify(last)).not.toContain(v)
    expect(verifyAllCvrs().valid).toBe(true)
  })
})

describe('SR-16 offline store-and-forward (server side)', () => {
  test('an offline declaration ballot marks the voter off when it arrives', async () => {
    const term = await h.enrolTerminal(app)
    const v = voter()
    const res = await h.sendBatch(app, h.buildBatch(term, [{ voter: v }]))
    expect(res.body.receipt.accepted).toHaveLength(1)
    expect(db.prepare('SELECT status FROM electoral_roll WHERE voter_id = ?').get(v).status).toBe('DECLARATION_ACCEPTED')
  })

  test('an offline ballot from a voter who already voted is discarded', async () => {
    const term = await h.enrolTerminal(app)
    const v = voter()
    await h.authorize(app, term, v)
    expect(reasons(await h.sendBatch(app, h.buildBatch(term, [{ voter: v }])))).toEqual(['DECLARATION_ALREADY_MARKED_OFF'])
  })

  test('a ballot UUID sent again in a later batch is not counted twice', async () => {
    const term = await h.enrolTerminal(app)
    const id = crypto.randomUUID()
    await h.sendBatch(app, h.buildBatch(term, [{ ballot_id: id, voter: voter() }]))
    expect(reasons(await h.sendBatch(app, h.buildBatch(term, [{ ballot_id: id, voter: voter() }])))).toEqual(['DUPLICATE_BALLOT_ID'])
  })

  test('deleting a queued ballot breaks the hash chain, nothing is stored, and the SEO is alerted', async () => {
    const term = await h.enrolTerminal(app)
    const before = db.prepare('SELECT COUNT(*) AS n FROM ballots').get().n
    const batch = h.buildBatch(term, [{ voter: voter() }, { voter: voter() }, { voter: voter() }], { sign: false })
    batch.entries.splice(1, 1)
    const res = await h.sendBatch(app, h.resign(term, batch))
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('CHAIN_BROKEN')
    expect(db.prepare('SELECT COUNT(*) AS n FROM ballots').get().n).toBe(before)
    expect(db.prepare('SELECT COUNT(*) AS n FROM seo_alerts WHERE subject LIKE ?').get(`%${term.id}%`).n).toBe(1)
  })

  test('a batch that skips earlier queued ballots is rejected', async () => {
    const term = await h.enrolTerminal(app)
    h.buildBatch(term, [{ voter: voter() }]) // built but never sent
    const res = await h.sendBatch(app, h.buildBatch(term, [{ voter: voter() }]))
    expect(res.body.error).toBe('CHAIN_BROKEN')
  })
})
