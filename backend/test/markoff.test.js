// SR-13: Atomic Single-Use Mark-off (Anti-Double Voting) - Muzammil s4175334
const os = require('os')
const fs = require('fs')
const path = require('path')
const { Worker } = require('worker_threads')
const Database = require('better-sqlite3')
const jwt = require('jsonwebtoken')
const request = require('supertest')
const h = require('./helpers/ballotIntegrity')

const db = require('../db')
const app = require('../app')
const { verifyBallotToken } = require('../services/markoff')
const { applySchema } = require('../services/ballotIntegrity/tables')
const { createSession } = require('../services/sessionManager')

let term
beforeAll(async () => {
  h.seedCandidatesAndRoll()
  term = await h.enrolTerminal(app)
})

const status = (v) => db.prepare('SELECT status FROM electoral_roll WHERE voter_id = ?').get(v).status

describe('SR-13 atomic single-use mark-off', () => {
  test('an eligible voter is marked off and gets a token within 2 seconds', async () => {
    const res = await h.authorize(app, term, 'V0001')
    expect(res.statusCode).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.elapsedMs).toBeLessThan(2000)
    expect(status('V0001')).toBe('TOKEN_ISSUED')
  })

  test('a second request for the same voter is refused with 409 within 2 seconds', async () => {
    await h.authorize(app, term, 'V0002')
    const again = await h.authorize(app, term, 'V0002')
    expect(again.statusCode).toBe(409)
    expect(again.body.error).toBe('ALREADY_MARKED_OFF')
    expect(again.body.elapsedMs).toBeLessThan(2000)
  })

  test('a duplicate from another polling place is also refused', async () => {
    const other = await h.enrolTerminal(app)
    await h.authorize(app, term, 'V0003')
    expect((await h.authorize(app, other, 'V0003')).statusCode).toBe(409)
  })

  test('20 polling places with separate DB connections racing for one voter: exactly one wins', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sr13-')), 'race.sqlite')
    const setup = new Database(file)
    applySchema(setup)
    setup.exec('CREATE TABLE voters_voted (user_id INTEGER PRIMARY KEY)')
    setup.prepare("INSERT INTO electoral_roll (voter_id, user_id, full_name, division) VALUES ('V9999', 1, 'Race', 'X')").run()
    setup.close()

    const barrier = new SharedArrayBuffer(4)
    const workers = Array.from({ length: 20 }, (_, n) =>
      new Worker(path.join(__dirname, 'helpers', 'markoffWorker.js'), { workerData: { file, barrier, voterId: 'V9999', n } }))
    const results = workers.map((w) => new Promise((resolve, reject) => {
      w.on('error', reject)
      w.on('message', (m) => { if (m !== 'ready') resolve(m) })
    }))
    await Promise.all(workers.map((w) => new Promise((r) => w.once('message', r)))) // all ready
    Atomics.store(new Int32Array(barrier), 0, 1)
    Atomics.notify(new Int32Array(barrier), 0) // start!

    const outcomes = await Promise.all(results)
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
    for (const o of outcomes.filter((x) => x !== 'ok')) {
      expect(['ALREADY_MARKED_OFF', 'CONCURRENT_REQUEST']).toContain(o)
    }
    const check = new Database(file, { readonly: true })
    expect(check.prepare('SELECT COUNT(*) AS n FROM voters_voted').get().n).toBe(1)
    check.close()
  }, 20000)

  test('50 simultaneous HTTP requests for one voter produce exactly one token', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => h.authorize(app, term, 'V0004')))
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1)
    expect(results.every((r) => [200, 409].includes(r.statusCode))).toBe(true)
  })

  test('a voter not on the roll is refused', async () => {
    const res = await h.authorize(app, term, 'X9999')
    expect(res.statusCode).toBe(404)
    expect(res.body.error).toBe('NOT_ON_ROLL')
  })

  test('the token holds no voter identity and is pinned to RS256', async () => {
    const res = await h.authorize(app, term, 'V0005')
    const decoded = jwt.decode(res.body.token, { complete: true })
    expect(decoded.header.alg).toBe('RS256')
    expect(decoded.payload.jti).toBeTruthy()
    expect(decoded.payload.sub).toBeUndefined()
    expect(JSON.stringify(decoded.payload)).not.toMatch(/V0005|5005/)
  })

  test("tokens with 'alg: none' or a tampered payload are rejected", async () => {
    const { token } = (await h.authorize(app, term, 'V0006')).body
    const [hdr, payload, sig] = token.split('.')
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    expect(() => verifyBallotToken(`${none}.${payload}.`)).toThrow()
    const claims = JSON.parse(Buffer.from(payload, 'base64url'))
    claims.exp += 86400
    expect(() => verifyBallotToken(`${hdr}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`)).toThrow()
  })

  test('forged and stale mark-off requests are rejected and leave the voter eligible', async () => {
    const forger = await h.enrolTerminal(app)
    expect((await h.authorize(app, { ...forger, id: term.id }, 'V0007')).statusCode).toBe(401)
    const stale = await h.authorize(app, term, 'V0007', { timestamp: new Date(Date.now() - 5 * 60000).toISOString() })
    expect(stale.statusCode).toBe(401)
    expect(status('V0007')).toBe('ELIGIBLE')
  })

  test('a voter who voted online (SR-05) cannot then vote at a polling place', async () => {
    db.prepare('INSERT INTO candidates (name) VALUES (?)').run('Extra')
    const auth = 'Bearer ' + createSession(5008, 'voter').token
    await request(app).post('/api/ballots/cast').set('Authorization', auth).send({ preferences: [1] })
    expect((await h.authorize(app, term, 'V0008')).statusCode).toBe(409)
  })

  test('a voter marked off at a polling place cannot then vote online (SR-05)', async () => {
    await h.authorize(app, term, 'V0009')
    const auth = 'Bearer ' + createSession(5009, 'voter').token
    const res = await request(app).post('/api/ballots/cast').set('Authorization', auth).send({ preferences: [1] })
    expect(res.statusCode).toBe(409)
  })

  test('mark-offs are written to the SR-09 audit log without any token', async () => {
    const { token } = (await h.authorize(app, term, 'V0010')).body
    const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'VOTER_MARKED_OFF' ORDER BY id DESC LIMIT 1").get()
    expect(entry.actor_id).toBe(5010)
    expect(entry.details).not.toContain(jwt.decode(token).jti)
  })
})
