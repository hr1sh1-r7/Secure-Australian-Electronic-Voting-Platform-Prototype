// Creates demo accounts for testing login and lockout (SR-11).
// Run from the backend folder:  node scripts/seedUsers.js
// DEMO PASSWORDS ONLY - never use these outside a local prototype.
const db = require('../db')
const { hashPassword } = require('../services/passwords')

const users = [
  { username: 'voter1', password: 'VoterPass123!', role: 'voter' },
  { username: 'voter2', password: 'VoterPass123!', role: 'voter' },
  { username: 'voter3', password: 'VoterPass123!', role: 'voter' },
  { username: 'admin1', password: 'AdminPass123!', role: 'admin' },
  { username: 'auditor1', password: 'AuditPass123!', role: 'auditor' }
]

const insert = db.prepare(`
  INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role
`)

for (const u of users) {
  insert.run(u.username, hashPassword(u.password), u.role)
  console.log(`User ready: ${u.username} / ${u.password} (${u.role})`)
}