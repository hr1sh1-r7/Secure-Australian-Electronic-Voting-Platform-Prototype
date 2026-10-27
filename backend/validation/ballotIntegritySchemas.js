const { z } = require('zod')
const { preferences } = require('./schemas')

// SR-13, SR-14, SR-16 allow-list schemas (Muzammil s4175334).
// Reuses SR-10's preference rules so terminal ballots follow exactly the same
// format as online ballots. strictObject REJECTS unknown fields (rather than
// stripping them), because a signed batch must arrive exactly as signed.

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a SHA-256 hex hash')
const terminalId = z.string().regex(/^[A-Za-z0-9_-]{3,40}$/, 'Invalid terminal ID')
const voterId = z.string().regex(/^[A-Za-z0-9]{3,20}$/, 'Invalid voter ID')
const signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/, 'Invalid Ed25519 signature format')

const tokenAuth = z.strictObject({
  type: z.literal('token'),
  token: z.string().min(20).max(4096)
})
const declarationAuth = z.strictObject({
  type: z.literal('declaration'),
  voter_id: voterId
})

const entry = z.strictObject({
  ballot_id: z.uuid(),
  preferences,
  auth: z.discriminatedUnion('type', [tokenAuth, declarationAuth]),
  queued_at: z.iso.datetime(),
  prev_hash: hex64,
  entry_hash: hex64
})

const batch = z.strictObject({
  batch_id: z.uuid(),
  terminal_id: terminalId,
  created_at: z.iso.datetime(),
  chain_start: hex64,
  entries: z.array(entry).min(1).max(500),
  signature: signature.optional()
})

const authorizeRequest = z.strictObject({
  terminal_id: terminalId,
  voter_id: voterId,
  timestamp: z.iso.datetime(),
  signature
})

const registerTerminal = z.strictObject({
  terminal_id: terminalId,
  public_key_pem: z.string().min(50).max(1000),
  polling_place: z.string().min(2).max(100)
})

const recountRun = z.object({
  simulateFault: z.boolean().optional()
})

module.exports = { batch, authorizeRequest, registerTerminal, recountRun }
