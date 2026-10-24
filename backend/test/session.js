const request = require('supertest')

process.env.ENABLE_DEMO_LOGIN = 'true'
delete process.env.SESSION_IDLE_MINUTES // use the real 10-minute requirement

const db = require('../db')
const app = require('../app')
const {
  createSession,
  validateSession,
  endSession,
  getIdleTimeoutMs,
  hashToken
} = require('../services/sessionManager')

const MINUTE = 60 * 1000

function auth(token) {
  return { Authorization: 'Bearer ' + token }
}

function lastAuditAction() {
  return db.prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1').get().action
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('SR-12 inactivity timeout (session manager)', () => {
  test('idle limit is 10 minutes', () => {
    expect(getIdleTimeoutMs()).toBe(10 * MINUTE)
  })

  test('a new session is valid', () => {
    const { token } = createSession(1, 'voter')
    expect(validateSession(token).valid).toBe(true)
  })

  test('a session idle for 9 minutes 59 seconds is still valid', () => {
    const start = 1_000_000
    const { token } = createSession(1, 'voter', start)
    expect(validateSession(token, start + 10 * MINUTE - 1000).valid).toBe(true)
  })

  test('a session idle for 10 minutes is expired and destroyed', () => {
    const start = 1_000_000
    const { token } = createSession(1, 'voter', start)

    const result = validateSession(token, start + 10 * MINUTE)
    expect(result).toEqual({ valid: false, reason: 'idle_timeout' })

    // the old token can never be used again
    expect(validateSession(token, start + 10 * MINUTE + 1).reason).toBe('invalid_or_expired')
  })

  test('activity restarts the 10-minute window', () => {
    const start = 1_000_000
    const { token } = createSession(1, 'admin', start)

    expect(validateSession(token, start + 8 * MINUTE).valid).toBe(true)   // active at 8 min
    expect(validateSession(token, start + 16 * MINUTE).valid).toBe(true)  // 8 min after that
    expect(validateSession(token, start + 27 * MINUTE).valid).toBe(false) // 11 min idle
  })

  test('a timeout is recorded in the SR-09 audit log', () => {
    const start = 1_000_000
    const { token } = createSession(7, 'admin', start)
    validateSession(token, start + 11 * MINUTE)
    expect(lastAuditAction()).toBe('SESSION_TIMEOUT')
  })

  test('only a hash of the token is stored in the database', () => {
    const { token } = createSession(1, 'voter')
    const raw = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(token)
    const hashed = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token))
    expect(raw).toBeUndefined()
    expect(hashed).toBeDefined()
  })

  test('logging out ends the session', () => {
    const { token } = createSession(1, 'voter')
    expect(endSession(token)).toBe(true)
    expect(validateSession(token).valid).toBe(false)
  })

  test('the idle limit can be shortened for demos via SESSION_IDLE_MINUTES', () => {
    process.env.SESSION_IDLE_MINUTES = '1'
    expect(getIdleTimeoutMs()).toBe(1 * MINUTE)
    process.env.SESSION_IDLE_MINUTES = 'not-a-number'
    expect(getIdleTimeoutMs()).toBe(10 * MINUTE)
    delete process.env.SESSION_IDLE_MINUTES
  })
})

describe('SR-12 inactivity timeout (API)', () => {
  test('protected route is refused without a token', async () => {
    const res = await request(app).get('/api/session/status')
    expect(res.statusCode).toBe(401)
    expect(res.body.reason).toBe('missing_token')
  })

  test('protected route works with an active session', async () => {
    const { token } = createSession(3, 'auditor')
    const res = await request(app).get('/api/session/status').set(auth(token))
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ userId: 3, role: 'auditor', idleTimeoutMs: 10 * MINUTE })
  })

  test('protected route is refused after 10 minutes of inactivity', async () => {
    const { token } = createSession(3, 'voter')
    const later = Date.now() + 10 * MINUTE + 1000
    jest.spyOn(Date, 'now').mockReturnValue(later)

    const res = await request(app).get('/api/session/status').set(auth(token))
    expect(res.statusCode).toBe(401)
    expect(res.body.reason).toBe('idle_timeout')
  })

  test('logout endpoint ends the session on the server', async () => {
    const { token } = createSession(4, 'voter')
    const logout = await request(app).post('/api/session/logout').set(auth(token))
    expect(logout.statusCode).toBe(200)

    const after = await request(app).get('/api/session/status').set(auth(token))
    expect(after.statusCode).toBe(401)
  })

  test('demo login rejects invalid input', async () => {
    const res = await request(app)
      .post('/api/session/demo-login')
      .send({ userId: 'abc', role: 'superuser' })
    expect(res.statusCode).toBe(400)
  })

  test('demo login is disabled unless ENABLE_DEMO_LOGIN=true', async () => {
    process.env.ENABLE_DEMO_LOGIN = 'false'
    const res = await request(app)
      .post('/api/session/demo-login')
      .send({ userId: 1, role: 'voter' })
    expect(res.statusCode).toBe(404)
    process.env.ENABLE_DEMO_LOGIN = 'true'
  })
})