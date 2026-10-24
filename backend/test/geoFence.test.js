const request = require('supertest')

process.env.AUDITOR_TOKEN = 'test-auditor-token'

const db = require('../db')
const app = require('../app')
const { buildAllowList, isAllowedIp, normaliseIp } = require('../middleware/geoFence')

function lastAudit() {
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get()
}

describe('SR-06 allow-list rules', () => {
  const allowList = buildAllowList('10.20.0.0/16, 203.0.113.0/24, 2001:db8::/32')

  test('addresses inside an approved mission range are allowed', () => {
    expect(isAllowedIp('10.20.5.9', allowList)).toBe(true)
    expect(isAllowedIp('203.0.113.77', allowList)).toBe(true)
    expect(isAllowedIp('2001:db8::1', allowList)).toBe(true)
  })

  test('addresses outside every approved range are refused', () => {
    expect(isAllowedIp('10.21.0.1', allowList)).toBe(false)
    expect(isAllowedIp('8.8.8.8', allowList)).toBe(false)
    expect(isAllowedIp('2001:db9::1', allowList)).toBe(false)
  })

  test('IPv4 clients shown in IPv6 form are handled', () => {
    expect(normaliseIp('::ffff:10.20.1.5')).toBe('10.20.1.5')
    expect(isAllowedIp('::ffff:10.20.1.5', allowList)).toBe(true)
  })

  test('garbage addresses are refused', () => {
    expect(isAllowedIp('not-an-ip', allowList)).toBe(false)
    expect(isAllowedIp('', allowList)).toBe(false)
  })

  test('invalid CIDR entries are ignored rather than opening access', () => {
    const list = buildAllowList('10.20.0.0/99, banana, 10.30.0.0/16')
    expect(list.ranges).toEqual(['10.30.0.0/16'])
    expect(isAllowedIp('10.20.1.1', list)).toBe(false)
  })

  test('an empty allow-list refuses everything (fail closed)', () => {
    const list = buildAllowList('')
    expect(isAllowedIp('127.0.0.1', list)).toBe(false)
  })
})

describe('SR-06 geo-fenced mission routes', () => {
  // supertest connects from localhost (127.0.0.1 / ::1)

  test('a connection from an approved range is let through', async () => {
    process.env.MISSION_ALLOWED_CIDRS = '127.0.0.0/8,::1/128'
    const res = await request(app).get('/api/mission/status')
    expect(res.statusCode).toBe(200)
    expect(res.body.access).toBe('granted')
  })

  test('a connection from outside the approved ranges is refused with 403', async () => {
    process.env.MISSION_ALLOWED_CIDRS = '10.20.0.0/16'
    const res = await request(app).get('/api/mission/status')
    expect(res.statusCode).toBe(403)
  })

  test('a faked X-Forwarded-For header does not get around the fence', async () => {
    process.env.MISSION_ALLOWED_CIDRS = '10.20.0.0/16'
    const res = await request(app)
      .get('/api/mission/status')
      .set('X-Forwarded-For', '10.20.1.1')
    expect(res.statusCode).toBe(403)
  })

  test('with no ranges configured, every connection is refused', async () => {
    delete process.env.MISSION_ALLOWED_CIDRS
    const res = await request(app).get('/api/mission/status')
    expect(res.statusCode).toBe(403)
  })

  test('blocked attempts are recorded in the SR-09 audit log', async () => {
    process.env.MISSION_ALLOWED_CIDRS = '10.20.0.0/16'
    await request(app).get('/api/mission/status')

    const entry = lastAudit()
    expect(entry.action).toBe('MISSION_ACCESS_BLOCKED')
    const details = JSON.parse(entry.details)
    expect(details.path).toBe('/api/mission/status')
  })

  test('the block decision is made in under 100 ms', async () => {
    process.env.MISSION_ALLOWED_CIDRS = '10.20.0.0/16'
    await request(app).get('/api/mission/status')
    const details = JSON.parse(lastAudit().details)
    expect(details.decisionMs).toBeLessThan(100)
  })

  test('the rest of the site is not geo-fenced', async () => {
    process.env.MISSION_ALLOWED_CIDRS = '10.20.0.0/16'
    const res = await request(app).get('/api/health')
    expect(res.statusCode).toBe(200)
  })
})