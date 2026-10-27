// DEMO SETUP: wipes the local databases and loads fresh demo data.
// Run from the backend folder with the server STOPPED:  node scripts/resetDemo.js
const fs = require('fs')
const path = require('path')

// 1. Delete both database files (SR-08 enrolment + ballot) - must happen before db.js loads
for (const file of ['voting.sqlite', 'ballots.sqlite']) {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    fs.rmSync(path.join(__dirname, '..', file + suffix), { force: true })
  }
}
console.log('Deleted voting.sqlite and ballots.sqlite')

// 2. Demo accounts and candidates
require('./seedUsers')
require('./seedCandidates')

// 3. A few sample administrative actions for the audit log (SR-09)
const { logEvent } = require('../services/auditLogger')
logEvent(4, 'ADD_CANDIDATE', { candidateId: 4, name: 'Sarah Wilson' })
logEvent(4, 'EXCLUDE_CANDIDATE', { candidateId: 3, reason: 'Court of Disputed Returns order' })
console.log('Added 2 sample admin actions to the audit log')

console.log('\nDemo data ready. Start the server with: npm start')