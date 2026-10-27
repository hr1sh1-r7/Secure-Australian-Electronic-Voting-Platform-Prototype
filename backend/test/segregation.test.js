const request = require('supertest')

const db = require('../db')
const app = require('../app')
const { createSession } = require('../services/sessionManager')

function tablesIn(schema) {
  return db
    .prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name)
}

function count(schemaTable) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${schemaTable}`).get().n
}

function vote(userId, preferences) {
  return request(app)
    .post('/api/ballots/cast')
    .set('Authorization', 'Bearer ' + createSession(userId, 'voter').token)
    .send({ preferences })
}

beforeAll(() => {
  const insert = db.prepare('INSERT INTO candidates (name, party) VALUES (?, ?)')
  ;['A', 'B', 'C'].forEach((name) => insert.run('Candidate ' + name, 'Party ' + name))
})

describe('SR-08 enrolment and ballot data are kept in separate databases', () => {
  test('there are two separate databases', () => {
    const names = db.prepare('PRAGMA database_list').all().map((d) => d.name)
    expect(names).toEqual(expect.arrayContaining(['main', 'ballot_store']))
  })

  test('ballot tables live ONLY in the ballot database', () => {
    const ballotSide = tablesIn('ballot_store')
    const identitySide = tablesIn('main')
    for (const table of db.BALLOT_TABLES) {
      expect(ballotSide).toContain(table)
      expect(identitySide).not.toContain(table)
    }
  })

  test('identity tables live ONLY in the enrolment database', () => {
    const ballotSide = tablesIn('ballot_store')
    for (const table of db.IDENTITY_TABLES) {
      expect(ballotSide).not.toContain(table)
    }
  })

  test('the ballot database has no column that could identify a voter', () => {
    // whole-word match, so e.g. 'receipt_id' isn't mistaken for 'ip'
    const banned = /(^|_)(user|voter|session|ip|address|time|timestamp|created|username|role)(_|$)|_at$/i
    for (const table of tablesIn('ballot_store')) {
      const cols = db.prepare(`PRAGMA ballot_store.table_info(${table})`).all().map((c) => c.name)
      for (const col of cols) expect(col).not.toMatch(banned)
    }
  })

  test('a vote writes "who voted" to enrolment and the ballot to the ballot database', async () => {
    const before = { voted: count('main.voters_voted'), ballots: count('ballot_store.ballots') }
    const res = await vote(701, [1, 2])
    expect(res.statusCode).toBe(200)
    expect(count('main.voters_voted')).toBe(before.voted + 1)
    expect(count('ballot_store.ballots')).toBe(before.ballots + 1)
    expect(count('ballot_store.cvr_hashes')).toBe(count('ballot_store.ballots'))
    expect(count('ballot_store.receipts')).toBe(count('ballot_store.ballots'))
  })

  test('voting is all-or-nothing across both databases', async () => {
    const before = { voted: count('main.voters_voted'), ballots: count('ballot_store.ballots') }

    // Break the ballot side mid-vote (receipts can't be written)
    db.exec('ALTER TABLE ballot_store.receipts RENAME TO receipts_offline')
    const res = await vote(702, [3])
    db.exec('ALTER TABLE ballot_store.receipts_offline RENAME TO receipts')

    expect(res.statusCode).toBe(500)
    // Nothing was half-recorded on EITHER side
    expect(count('main.voters_voted')).toBe(before.voted)
    expect(count('ballot_store.ballots')).toBe(before.ballots)

    // ...so the voter can still vote once the system is fixed
    expect((await vote(702, [3])).statusCode).toBe(200)
  })

  test('no query joins voters to ballots anywhere in the application code', () => {
    const fs = require('fs')
    const path = require('path')
    const dirs = ['routes', 'services', 'middleware']
    for (const dir of dirs) {
      // recursive: also checks sub-folders such as services/ballotIntegrity and services/recount
      const files = fs.readdirSync(path.join(__dirname, '..', dir), { recursive: true })
        .filter((file) => file.endsWith('.js'))
      for (const file of files) {
        const code = fs.readFileSync(path.join(__dirname, '..', dir, file), 'utf8')
        expect(code).not.toMatch(/voters_voted[\s\S]{0,200}JOIN[\s\S]{0,200}ballots|ballots[\s\S]{0,200}JOIN[\s\S]{0,200}voters_voted/i)
        expect(code).not.toMatch(/JOIN\s+(main\.)?users[\s\S]{0,100}ballot|ballot[\s\S]{0,100}JOIN\s+(main\.)?users/i)
      }
    }
  })
})