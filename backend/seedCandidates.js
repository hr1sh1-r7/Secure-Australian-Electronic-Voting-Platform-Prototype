
const db = require('./db')

const candidates = [
  { name: 'Demonstration Option A', party: 'Fictional demo group A' },
  { name: 'Demonstration Option B', party: 'Fictional demo group B' },
  { name: 'Demonstration Option C', party: 'Fictional demo group C' }
]

const insertCandidate = db.prepare(
  'INSERT INTO candidates (name, party) VALUES (?, ?)'
)

const seedCandidates = db.transaction(() => {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM candidates').get()

  if (existing.count > 0) {
    console.log('Candidates already exist; no changes made.')
    return
  }

  for (const candidate of candidates) {
    insertCandidate.run(candidate.name, candidate.party)
  }

  console.log('Added 3 fictional demonstration candidates.')
})

try {
  seedCandidates()
} finally {
  db.close()
}
