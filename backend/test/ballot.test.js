const request = require('supertest')

const db = require('../db')
const app = require('../app')
const { createSession } = require('../services/sessionManager')

function voterSession(userId) {
  return 'Bearer ' + createSession(userId, 'voter').token
}

function cast(auth, body) {
  return request(app).post('/api/ballots/cast').set('Authorization', auth).send(body)
}

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
}

beforeAll(() => {
  const insert = db.prepare('INSERT INTO candidates (name, party) VALUES (?, ?)')
  ;['A', 'B', 'C', 'D'].forEach((name) => insert.run('Candidate ' + name, 'Party ' + name))
})

describe('SR-05 voter decoupling', () => {
  test('a logged-in voter can cast a ballot', async () => {
    const res = await cast(voterSession(101), { preferences: [2, 1, 3] })
    expect(res.statusCode).toBe(200)
    expect(res.body.recorded).toBe(true)
  })

  test('the ballot is decoupled from the voter in under 50 ms', async () => {
    const res = await cast(voterSession(102), { preferences: [1] })
    expect(res.body.decouplingMs).toBeLessThan(50)
  })

  test('stored ballots contain only preferences - no voter ID, IP or timestamp', () => {
    expect(columns('ballots')).toEqual(['id', 'preferences'])
  })

  test('the identity side stores only who voted - no ballot data', () => {
    expect(columns('voters_voted')).toEqual(['user_id'])
  })

  test('the two sides share no column that could link them', () => {
    const shared = columns('ballots').filter(
      (c) => c !== 'id' && columns('voters_voted').includes(c)
    )
    expect(shared).toEqual([])
  })

  test('extra identifying fields sent with a ballot are discarded', async () => {
    await cast(voterSession(103), {
      preferences: [4],
      userId: 103,
      name: 'Jane Voter',
      ip: '10.1.2.3'
    })
    const last = db.prepare('SELECT * FROM ballots ORDER BY id DESC LIMIT 1').get()
    expect(last.preferences).toBe('[4]')
    expect(JSON.stringify(last)).not.toMatch(/103|Jane|10\.1\.2\.3/)
  })

  test('the audit log records who voted but never the ballot', async () => {
    const before = db.prepare('SELECT MAX(id) AS id FROM audit_log').get().id || 0
    await cast(voterSession(104), { preferences: [3, 2] })
    const entries = db.prepare('SELECT * FROM audit_log WHERE id > ?').all(before)

    const vote = entries.find((e) => e.action === 'VOTE_RECORDED')
    expect(vote.actor_id).toBe(104)
    for (const entry of entries) {
      expect(entry.details || '').not.toContain('[3,2]')
      expect(entry.details || '').not.toContain('preferences')
    }
  })

  test('a voter can only vote once', async () => {
    const auth = voterSession(105)
    await cast(auth, { preferences: [1] })
    const again = await cast(voterSession(105), { preferences: [2] })
    expect(again.statusCode).toBe(409)
  })

  test('voting needs a logged-in voter', async () => {
    const noLogin = await request(app).post('/api/ballots/cast').send({ preferences: [1] })
    expect(noLogin.statusCode).toBe(401)

    const admin = await cast('Bearer ' + createSession(900, 'admin').token, { preferences: [1] })
    expect(admin.statusCode).toBe(403)
  })

  test('invalid preferences are rejected and nothing is stored', async () => {
    const countBefore = db.prepare('SELECT COUNT(*) AS n FROM ballots').get().n
    const bad = [[], [1, 1], [999], ['1'], 'not-a-list']
    for (const [i, preferences] of bad.entries()) {
      const res = await cast(voterSession(300 + i), { preferences })
      expect(res.statusCode).toBe(400)
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM ballots').get().n).toBe(countBefore)
  })
})