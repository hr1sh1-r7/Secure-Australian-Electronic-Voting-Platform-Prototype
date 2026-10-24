const request = require('supertest')

process.env.AUDITOR_TOKEN = 'test-auditor-token'
const AUTH = { Authorization: 'Bearer test-auditor-token' }

const db = require('../db')
const app = require('../app')
const { logEvent, verifyChain, GENESIS_HASH } = require('../services/auditLogger')

describe('SR-09 append-only audit log', () => {
  test('first entry links to the genesis hash', () => {
    const first = logEvent(1, 'TEST_EVENT', { n: 1 })
    expect(first.prev_hash).toBe(GENESIS_HASH)
    expect(first.hash).toHaveLength(96) // SHA-384 in hex
  })

  test('each entry links to the previous entry and the chain verifies', () => {
    const a = logEvent(1, 'EXCLUDE_CANDIDATE', { candidateId: 3 })
    const b = logEvent(2, 'ADD_CANDIDATE', { candidateId: 7 })
    expect(b.prev_hash).toBe(a.hash)
    expect(verifyChain().valid).toBe(true)
  })

  test('entries record a millisecond timestamp and the administrator ID', () => {
    const entry = logEvent(5, 'TEST_EVENT')
    expect(entry.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(entry.actor_id).toBe(5)
  })

  test('invalid input is rejected', () => {
    expect(() => logEvent('admin', 'TEST_EVENT')).toThrow()
    expect(() => logEvent(1, '')).toThrow()
  })

  test('updating an entry is blocked by the database', () => {
    expect(() =>
      db.prepare("UPDATE audit_log SET action = 'HACKED'").run()
    ).toThrow('append-only')
  })

  test('deleting an entry is blocked by the database', () => {
    expect(() =>
      db.prepare('DELETE FROM audit_log').run()
    ).toThrow('append-only')
  })

  test('audit log is refused without an auditor token', async () => {
    const res = await request(app).get('/api/audit')
    expect(res.statusCode).toBe(401)
  })

  test('audit log is refused with a wrong token', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', 'Bearer wrong-token')
    expect(res.statusCode).toBe(403)
  })

  test('audit log has no write routes (read-only)', async () => {
    const res = await request(app).delete('/api/audit').set(AUTH)
    expect(res.statusCode).toBe(404)
  })

  test('GET /api/audit returns the log to the auditor', async () => {
    const res = await request(app).get('/api/audit').set(AUTH)
    expect(res.statusCode).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
  })

  test('GET /api/audit/verify reports a valid chain', async () => {
    const res = await request(app).get('/api/audit/verify').set(AUTH)
    expect(res.statusCode).toBe(200)
    expect(res.body.valid).toBe(true)
  })

  // Runs last: simulates an attacker bypassing the triggers
  // (e.g. editing the database file directly) and checks the tampering is detected.
  test('tampering that bypasses the triggers is detected', () => {
    db.exec('DROP TRIGGER audit_log_no_update')
    db.prepare("UPDATE audit_log SET action = 'HACKED' WHERE id = 2").run()

    const result = verifyChain()
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(2)
  })
})