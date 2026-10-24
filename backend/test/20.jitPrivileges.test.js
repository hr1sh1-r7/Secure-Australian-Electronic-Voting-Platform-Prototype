
const {
  createGrant,
  validateGrant,
  revokeGrant,
  IDLE_TIMEOUT_MS,
  ABSOLUTE_TIMEOUT_MS
} = require('../security/jitPrivileges')

describe('JIT privilege expiry (SR-20)', () => {
  test('allows a newly created grant', () => {
    const grant = createGrant('user-1', 1000)

    expect(validateGrant(grant.token, 1000)).toEqual({
      valid: true,
      userId: 'user-1'
    })
  })

  test('expires after 15 minutes of inactivity', () => {
    const grant = createGrant('user-1', 1000)

    const result = validateGrant(
      grant.token,
      1000 + IDLE_TIMEOUT_MS
    )

    expect(result).toEqual({
      valid: false,
      reason: 'idle_timeout'
    })
  })

  test('expires after 60 minutes even with activity', () => {
    const grant = createGrant('user-1', 1000)

    // Activity shortly before the absolute expiry.
    validateGrant(grant.token, 1000 + 59 * 60 * 1000)

    const result = validateGrant(
      grant.token,
      1000 + ABSOLUTE_TIMEOUT_MS
    )

    expect(result).toEqual({
      valid: false,
      reason: 'absolute_timeout'
    })
  })

  test('allows a grant to be revoked', () => {
    const grant = createGrant('user-1', 1000)

    expect(revokeGrant(grant.token)).toBe(true)
    expect(validateGrant(grant.token, 1000).valid).toBe(false)
  })

  test('rejects a missing token', () => {
    expect(validateGrant('unknown-token', 1000)).toEqual({
      valid: false,
      reason: 'invalid_or_expired'
    })
  })
})
