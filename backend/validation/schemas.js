const { z } = require('zod')

// SR-10: allow-list input schemas (Zod).
// Senate-style preference list: whole positive candidate IDs, no repeats,
// capped in length so huge payloads can't exhaust the server.
const preferences = z
  .array(z.number().int().positive().max(1_000_000))
  .min(1, 'Rank at least one candidate')
  .max(150, 'Too many preferences')
  .refine((ids) => new Set(ids).size === ids.length, 'Each candidate can only be ranked once')

// Unknown fields (e.g. a smuggled "userId" or "name") are stripped, not stored
const castBallot = z.object({ preferences })

// Receipt fields may only contain the characters they are generated from
const hex = (length) => z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`), 'Invalid receipt format')
const verifyReceipt = z.object({
  receiptId: hex(32),
  commitment: hex(64),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/, 'Invalid receipt signature format')
})

// Demo login (SR-12): numeric ID and one of three fixed roles
const demoLogin = z.object({
  userId: z.coerce.number().int().positive().max(1_000_000),
  role: z.enum(['voter', 'admin', 'auditor'])
})

// Login: username limited to safe characters; password just length-limited
// (passwords may contain any character, and are only ever hashed, never stored)
const login = z.object({
  username: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, 'Invalid username'),
  password: z.string().min(1).max(256)
})

module.exports = { castBallot, verifyReceipt, demoLogin, login, preferences }