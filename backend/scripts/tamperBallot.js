// DEMO ONLY (SR-10): simulates an attacker editing a stored ballot directly in
// the database file. Run from the backend folder with the server stopped:
//   node scripts/tamperBallot.js
const db = require('../db')

const ballot = db.prepare('SELECT id, preferences FROM ballots ORDER BY id LIMIT 1').get()
if (!ballot) {
  console.log('No ballots yet - cast a vote first')
  process.exit(1)
}

const changed = JSON.stringify([...JSON.parse(ballot.preferences)].reverse())
const forced = changed === ballot.preferences ? '[999]' : changed
db.prepare('UPDATE ballots SET preferences = ? WHERE id = ?').run(forced, ballot.id)
console.log(`Ballot ${ballot.id} changed from ${ballot.preferences} to ${forced}`)
console.log('Now start the server and click "Check ballot integrity" on the audit page.')