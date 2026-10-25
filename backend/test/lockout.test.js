const request = require('supertest')

process.env.AUDITOR_TOKEN = 'test-auditor-token'
process.env.SOC_WEBHOOK_URL = 'http://soc.example.test/alerts'

const db = require('../db')
const app = require('../app')
const { hashPassword, verifyPassword } = require('../services/passwords')
const { isLocked, recordFailedLogin, MAX_FAILURES, WINDOW_MS, LOCK_MS } = require('../services/lockout')

const MINUTE = 60 * 1000

function addUser(username, password, role = 'admin') {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hashPassword(password), role)
}

function login(username, password) {
  return request(app).post('/api/auth/login').send({ username, password })
}

function auditActions(username) {
  return db.prepare("SELECT action FROM audit_log WHERE details LIKE ? ORDER BY id")
    .all(`%"username":"${username}"%`)
    .map((r) => r.action)
}

let fetchMock

beforeEach(() => {
  // Pretend to be the SOC webhook so no real network call is made
  fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('SR-11 password storage', () => {
  test('passwords are stored hashed with a unique salt', () => {
    const a = hashPassword('SamePassword1!')
    const b = hashPassword('SamePassword1!')
    expect(a).not.toContain('SamePassword1!')
    expect(a).not.toBe(b) // different salts
    expect(verifyPassword('SamePassword1!', a)).toBe(true)
    expect(verifyPassword('wrong', a)).toBe(false)
  })
})

describe('SR-11 lockout rules', () => {
  test('policy is 3 failures in 5 minutes -> 15-minute lock', () => {
    expect(MAX_FAILURES).toBe(3)
    expect(WINDOW_MS).toBe(5 * MINUTE)
    expect(LOCK_MS).toBe(15 * MINUTE)
  })

  test('2 failures do not lock; the 3rd within 5 minutes does', () => {
    const t = 1_000_000
    expect(recordFailedLogin('rule1', 0, t).locked).toBe(false)
    expect(recordFailedLogin('rule1', 0, t + MINUTE).locked).toBe(false)
    expect(recordFailedLogin('rule1', 0, t + 2 * MINUTE).locked).toBe(true)
    expect(isLocked('rule1', t + 3 * MINUTE).locked).toBe(true)
  })

  test('failures spread over more than 5 minutes do not lock', () => {
    const t = 1_000_000
    recordFailedLogin('rule2', 0, t)
    recordFailedLogin('rule2', 0, t + 3 * MINUTE)
    // first failure is now outside the 5-minute window
    expect(recordFailedLogin('rule2', 0, t + 6 * MINUTE).locked).toBe(false)
  })

  test('the lock expires automatically after 15 minutes', () => {
    const t = 1_000_000
    for (let i = 0; i < 3; i++) recordFailedLogin('rule3', 0, t + i * 1000)
    expect(isLocked('rule3', t + 14 * MINUTE).locked).toBe(true)
    expect(isLocked('rule3', t + 16 * MINUTE).locked).toBe(false)
  })
})

describe('SR-11 login endpoint', () => {
  beforeAll(() => {
    addUser('admin_ok', 'CorrectPass1!')
    addUser('admin_lock', 'CorrectPass1!')
    addUser('admin_reset', 'CorrectPass1!')
  })

  test('correct password logs in and returns a session token', async () => {
    const res = await login('admin_ok', 'CorrectPass1!')
    expect(res.statusCode).toBe(200)
    expect(res.body.token).toHaveLength(64)
  })

  test('wrong password and unknown user get the same generic message', async () => {
    const wrong = await login('admin_ok', 'nope')
    const unknown = await login('no_such_user', 'nope')
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.body.error).toBe(unknown.body.error)
  })

  test('3 wrong passwords lock the account, and even the right password is then refused', async () => {
    await login('admin_lock', 'bad1')
    await login('admin_lock', 'bad2')
    const third = await login('admin_lock', 'bad3')
    expect(third.statusCode).toBe(423)

    const correct = await login('admin_lock', 'CorrectPass1!')
    expect(correct.statusCode).toBe(423)
    expect(correct.body.lockedUntil).toBeDefined()
  })

  test('the lockout is recorded in the SR-09 audit log', () => {
    const actions = auditActions('admin_lock')
    expect(actions.filter((a) => a === 'LOGIN_FAILED')).toHaveLength(3)
    expect(actions).toContain('ACCOUNT_LOCKED')
  })

  test('a successful login resets the consecutive-failure count', async () => {
    await login('admin_reset', 'bad1')
    await login('admin_reset', 'bad2')
    await login('admin_reset', 'CorrectPass1!')
    const res = await login('admin_reset', 'bad3') // only 1 consecutive failure now
    expect(res.statusCode).toBe(401)
  })

  test('unknown usernames lock too, so lockouts reveal nothing about which accounts exist', async () => {
    await login('ghost', 'x1')
    await login('ghost', 'x2')
    const res = await login('ghost', 'x3')
    expect(res.statusCode).toBe(423)
  })

  test('missing or oversized input is rejected', async () => {
    expect((await login('', 'x')).statusCode).toBe(400)
    expect((await request(app).post('/api/auth/login').send({ username: 'a' })).statusCode).toBe(400)
    expect((await login('a'.repeat(100), 'x')).statusCode).toBe(400)
  })
})

describe('SR-11 SOC alert', () => {
  test('a lockout sends a HIGH alert to the SOC webhook within 15 seconds', async () => {
    const t = Date.now()
    let result
    for (let i = 0; i < 3; i++) result = recordFailedLogin('alert_user', 0, t + i)

    const alert = await result.alert
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://soc.example.test/alerts')
    const body = JSON.parse(options.body)
    expect(body).toMatchObject({ severity: 'HIGH', type: 'ACCOUNT_LOCKOUT', username: 'alert_user' })

    expect(alert.delivered).toBe(true)
    expect(alert.deliveryMs).toBeLessThan(15 * 1000)
  })

  test('a failed webhook is recorded, not lost', async () => {
    fetchMock.mockRejectedValue(new Error('SOC unreachable'))
    let result
    for (let i = 0; i < 3; i++) result = recordFailedLogin('alert_fail', 0, Date.now() + i)

    const alert = await result.alert
    expect(alert.delivered).toBe(false)
    const row = db.prepare("SELECT * FROM security_alerts WHERE username = 'alert_fail'").get()
    expect(row.delivery_error).toBe('SOC unreachable')
  })

  test('alerts are visible to the auditor only', async () => {
    expect((await request(app).get('/api/alerts')).statusCode).toBe(401)

    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', 'Bearer test-auditor-token')
    expect(res.statusCode).toBe(200)
    expect(res.body.some((a) => a.type === 'ACCOUNT_LOCKOUT')).toBe(true)
  })
})