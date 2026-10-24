
const crypto = require('node:crypto')

const IDLE_TIMEOUT_MS = 15 * 60 * 1000
const ABSOLUTE_TIMEOUT_MS = 60 * 60 * 1000

const grants = new Map()

function createGrant(userId, now = Date.now()) {
  if (!userId) {
    throw new Error('userId is required')
  }

  const token = crypto.randomBytes(32).toString('hex')

  grants.set(token, {
    userId,
    createdAt: now,
    lastActivityAt: now
  })

  return {
    token,
    expiresAt: now + ABSOLUTE_TIMEOUT_MS
  }
}

function validateGrant(token, now = Date.now()) {
  const grant = grants.get(token)

  if (!grant) {
    return { valid: false, reason: 'invalid_or_expired' }
  }

  if (now - grant.createdAt >= ABSOLUTE_TIMEOUT_MS) {
    grants.delete(token)
    return { valid: false, reason: 'absolute_timeout' }
  }

  if (now - grant.lastActivityAt >= IDLE_TIMEOUT_MS) {
    grants.delete(token)
    return { valid: false, reason: 'idle_timeout' }
  }

  grant.lastActivityAt = now

  return {
    valid: true,
    userId: grant.userId
  }
}

function revokeGrant(token) {
  return grants.delete(token)
}

module.exports = {
  createGrant,
  validateGrant,
  revokeGrant,
  IDLE_TIMEOUT_MS,
  ABSOLUTE_TIMEOUT_MS
}

