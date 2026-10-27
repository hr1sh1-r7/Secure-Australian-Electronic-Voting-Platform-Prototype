const crypto = require('crypto')

// Password hashing with Node's built-in scrypt (a memory-hard algorithm,
// so stolen hashes are slow and expensive to crack). Each password gets a
// unique random salt. Stored format:  scrypt$<salt>$<hash>
const KEY_LENGTH = 64
const OPTIONS = { N: 16384, r: 8, p: 1 } // ~16 MB of memory per hash

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('password must be at least 8 characters')
  }
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, OPTIONS).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false

  const expected = Buffer.from(hash, 'hex')
  const actual = crypto.scryptSync(String(password), salt, expected.length, OPTIONS)
  // constant-time comparison so response time doesn't leak how close a guess was
  return crypto.timingSafeEqual(actual, expected)
}

// Used when the username doesn't exist, so the response takes the same time
// as a real check and attackers can't tell which usernames are valid
const DUMMY_HASH = hashPassword('dummy-password-for-timing')

module.exports = { hashPassword, verifyPassword, DUMMY_HASH }