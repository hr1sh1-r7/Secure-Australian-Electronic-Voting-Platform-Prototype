const request = require('supertest')

process.env.AUDITOR_TOKEN = 'test-auditor-token'
process.env.ENABLE_DEMO_LOGIN = 'true'

const db = require('../db')
const app = require('../app')
const { createSession } = require('../services/sessionManager')
const { hashCvr } = require('../services/cvrIntegrity')

const AUDITOR = { Authorization: 'Bearer test-auditor-token' }
let nextVoter = 500

function vote(preferences, extra = {}) {
  return request(app)
    .post('/api/ballots/cast')
    .set('Authorization', 'Bearer ' + createSession(nextVoter++, 'voter').token)
    .send({ preferences, ...extra })
}

function ballotCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM ballots').get().n
}

beforeAll(() => {
  const insert = db.prepare('INSERT INTO candidates (name, party) VALUES (?, ?)')
  ;['A', 'B', 'C', 'D'].forEach((name) => insert.run('Candidate ' + name, 'Party ' + name))
})

describe('SR-10 SHA-384 hash for every Cast Vote Record', () => {
  test('a SHA-384 hash is stored when a ballot is cast', async () => {
    await vote([2, 1])
    const ballot = db.prepare('SELECT * FROM ballots ORDER BY id DESC LIMIT 1').get()
    const stored = db.prepare('SELECT hash FROM cvr_hashes WHERE ballot_id = ?').get(ballot.id)

    expect(stored.hash).toHaveLength(96) // SHA-384 in hex
    expect(stored.hash).toBe(hashCvr(ballot.id, ballot.preferences))
  })

  test('every stored ballot passes the integrity check', async () => {
    await vote([3])
    const res = await request(app).get('/api/tally/integrity').set(AUDITOR)
    expect(res.body.valid).toBe(true)
    expect(res.body.checked).toBe(ballotCount())
  })

  test('the tally counts ballots when integrity is intact', async () => {
    const res = await request(app).get('/api/tally').set(AUDITOR)
    expect(res.statusCode).toBe(200)
    expect(res.body.results.find((c) => c.id === 2).firstPreferences).toBeGreaterThan(0)
  })

  test('integrity and tally endpoints are auditor-only', async () => {
    expect((await request(app).get('/api/tally/integrity')).statusCode).toBe(401)
    expect((await request(app).get('/api/tally')).statusCode).toBe(401)
  })

  // Runs last in this block: tampers with a stored ballot
  test('a ballot changed in storage is detected and the tally is refused', async () => {
    await vote([4])
    const target = db.prepare('SELECT id FROM ballots ORDER BY id DESC LIMIT 1').get().id
    db.prepare("UPDATE ballots SET preferences = '[1]' WHERE id = ?").run(target) // attacker edit

    const integrity = await request(app).get('/api/tally/integrity').set(AUDITOR)
    expect(integrity.body.valid).toBe(false)
    expect(integrity.body.tampered).toContain(target)

    const tally = await request(app).get('/api/tally').set(AUDITOR)
    expect(tally.statusCode).toBe(409)

    const logged = db.prepare("SELECT 1 FROM audit_log WHERE action = 'TALLY_BLOCKED'").get()
    expect(logged).toBeDefined()

    db.prepare("UPDATE ballots SET preferences = '[4]' WHERE id = ?").run(target) // restore
  })
})

describe('SR-10 schema validation rejects malicious and malformed input', () => {
  const attacks = {
    'SQL injection string': ["1; DROP TABLE ballots; --"],
    'SQL injection OR trick': ["1' OR '1'='1"],
    'XSS script tag': ['<script>alert(1)</script>'],
    'XSS image onerror': ['<img src=x onerror=alert(1)>'],
    'decimal number': [1.5],
    'negative number': [-1],
    'zero': [0],
    'numeric string': ['1'],
    'nested object': [{ $gt: 0 }],
    'duplicate candidates': [1, 1],
    'empty list': [],
    'over 150 preferences': Array.from({ length: 151 }, (_, i) => i + 1)
  }

  for (const [name, preferences] of Object.entries(attacks)) {
    test(`rejects ${name}`, async () => {
      const before = ballotCount()
      const res = await vote(preferences)
      expect(res.statusCode).toBe(400)
      expect(ballotCount()).toBe(before) // nothing stored
    })
  }

  test('rejects preferences that are not a list', async () => {
    expect((await vote('DROP TABLE ballots')).statusCode).toBe(400)
    expect((await vote({ 0: 1 })).statusCode).toBe(400)
  })

  test('error replies never echo the submitted payload back', async () => {
    const res = await vote(['<script>alert(1)</script>'])
    expect(JSON.stringify(res.body)).not.toContain('<script>')
  })

  test('unknown fields are stripped before storage', async () => {
    await vote([1], { userId: 42, ip: '10.0.0.1', note: '<script>x</script>' })
    const last = db.prepare('SELECT preferences FROM ballots ORDER BY id DESC LIMIT 1').get()
    expect(last.preferences).toBe('[1]')
  })

  test('the ballots table survives an injection attempt', async () => {
    await vote(["1); DELETE FROM ballots; --"])
    expect(ballotCount()).toBeGreaterThan(0)
  })
})

describe('SR-10 validation on other input fields', () => {
  test('receipt check rejects non-hex / script content', async () => {
    const res = await request(app)
      .post('/api/receipts/verify')
      .send({ receiptId: '<script>', commitment: "' OR 1=1 --", signature: 'x' })
    expect(res.statusCode).toBe(400)
    expect(res.body.valid).toBe(false)
  })

  test('demo login rejects injection in the role field', async () => {
    const res = await request(app)
      .post('/api/session/demo-login')
      .send({ userId: 1, role: "admin' --" })
    expect(res.statusCode).toBe(400)
  })

  test('malformed JSON gets a clean 400 with no stack trace', async () => {
    const res = await request(app)
      .post('/api/ballots/cast')
      .set('Content-Type', 'application/json')
      .send('{"preferences": [1,')
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Request body is not valid JSON' })
    expect(res.text).not.toMatch(/at .*\.js/)
  })

  test('oversized request bodies are refused', async () => {
    const res = await request(app)
      .post('/api/ballots/cast')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ preferences: [1], padding: 'x'.repeat(20000) }))
    expect(res.statusCode).toBe(413)
  })
})