// Adds sample candidates for testing ballot casting (SR-05).
// Run from the backend folder:  node scripts/seedCandidates.js
const db = require('../db')

const candidates = [
  ['Alex Morgan', 'Independent'],
  ['Priya Shah', 'Green Valley Party'],
  ['Tom Nguyen', 'Coastal Alliance'],
  ['Sarah Wilson', 'Progressive Union']
]

if (db.prepare('SELECT COUNT(*) AS n FROM candidates').get().n > 0) {
  console.log('Candidates already exist - nothing added')
} else {
  const insert = db.prepare('INSERT INTO candidates (name, party) VALUES (?, ?)')
  for (const [name, party] of candidates) insert.run(name, party)
  console.log(`Added ${candidates.length} sample candidates`)
}