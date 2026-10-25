const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const db = require('../db')
const { applySchema } = require('./ballotIntegrity/tables')
const { createMarkOff, MarkOffRefused } = require('./ballotIntegrity/markoffCore')
const { getKeys } = require('./ballotIntegrity/keys')
const { logEvent } = require('./auditLogger')

// SR-13: Atomic Single-Use Mark-off (Anti-Double Voting)
// Owner: Muzammil Malek (s4175334)
//
//  1. The voter is marked off the certified electoral roll under the write
//     lock (see markoffCore.js). A second request for the same voter, from
//     any polling place, is refused with HTTP 409 in milliseconds.
//  2. Only then is a single-use ballot authorization token issued. It holds
//     a random jti and NO voter identity. The jti is not stored on the roll,
//     so a ballot can never be traced back to the voter (supports SR-05).
//  3. The Ballot Store accepts each jti once (spent_tokens).

applySchema(db)

const ISSUER = 'aec-markoff-service'
const AUDIENCE = 'aec-ballot-store'
const TOKEN_TTL_SECONDS = 600
const SYSTEM_ACTOR = 0

const markOffCore = createMarkOff(db)

function markOff({ voterId, terminalId, mode }) {
  const started = process.hrtime.bigint()
  try {
    const userId = markOffCore({ voterId, terminalId, mode })
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    // Identity side only: WHO was marked off and where, never a token or ballot
    logEvent(userId, 'VOTER_MARKED_OFF', { terminalId, mode })
    return { ms }
  } catch (err) {
    if (err instanceof MarkOffRefused) {
      logEvent(SYSTEM_ACTOR, 'MARKOFF_REFUSED', { terminalId, reason: err.reason })
    }
    throw err
  }
}

// RS256 to match SR-02. No 'sub' claim: the token does not say who the voter is.
function issueBallotToken() {
  const { tokenPrivateKey, tokenKid } = getKeys()
  return jwt.sign({ typ: 'ballot-authorization' }, tokenPrivateKey, {
    algorithm: 'RS256',
    keyid: tokenKid,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: TOKEN_TTL_SECONDS,
    jwtid: crypto.randomUUID()
  })
}

function markOffAndAuthorize({ voterId, terminalId }) {
  const { ms } = markOff({ voterId, terminalId, mode: 'TOKEN_ISSUED' })
  return { token: issueBallotToken(), expiresIn: TOKEN_TTL_SECONDS, markOffMs: ms }
}

// Used by the Ballot Store. Algorithms pinned to RS256, so 'alg: none' and
// HS256 key-confusion tokens are rejected (consistent with SR-02).
function verifyBallotToken(token) {
  const { tokenPublicKey } = getKeys()
  const payload = jwt.verify(token, tokenPublicKey, {
    algorithms: ['RS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
    clockTolerance: 60
  })
  if (payload.typ !== 'ballot-authorization') throw new Error('Wrong token type')
  if (typeof payload.jti !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.jti)) throw new Error('Malformed jti')
  return payload
}

module.exports = { markOff, markOffAndAuthorize, issueBallotToken, verifyBallotToken, MarkOffRefused }
