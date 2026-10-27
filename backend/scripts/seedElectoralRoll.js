// Adds a demo electoral roll for polling-place voting (SR-13).
// Run from the backend folder:  node scripts/seedElectoralRoll.js
// Voter V0001 is linked to online account user 1, V0002 to user 2, and so on,
// so a voter who votes at a polling place cannot also vote online (SR-05).
const db = require('../db')
const { applySchema } = require('../services/ballotIntegrity/tables')

applySchema(db)
const VOTERS = 200

if (db.prepare('SELECT COUNT(*) AS n FROM electoral_roll').get().n > 0) {
  console.log('Electoral roll already exists - nothing added')
} else {
  const insert = db.prepare('INSERT INTO electoral_roll (voter_id, user_id, full_name, division) VALUES (?, ?, ?, ?)')
  db.transaction(() => {
    for (let n = 1; n <= VOTERS; n++) {
      insert.run('V' + String(n).padStart(4, '0'), n, 'Demo Voter ' + n, 'Melbourne')
    }
  })()
  console.log(`Added ${VOTERS} demo voters (V0001-V${String(VOTERS).padStart(4, '0')})`)
}
