// DEMO ONLY: simulates an attacker who edits the database file directly,
// bypassing the app and the append-only triggers (SR-09).
// Run from the backend folder, with the server stopped:  node scripts/tamperDemo.js
const db = require('../db')

const target = db.prepare('SELECT id, action FROM audit_log ORDER BY id LIMIT 1 OFFSET 1').get()
if (!target) {
  console.log('Need at least 2 log entries first - run: node scripts/seedAudit.js')
  process.exit(1)
}

// 1. Attacker removes the protection...
db.exec('DROP TRIGGER IF EXISTS audit_log_no_update')

// 2. ...secretly rewrites an entry...
db.prepare("UPDATE audit_log SET action = 'TAMPERED_ACTION' WHERE id = ?").run(target.id)

// 3. ...and puts the protection back to cover their tracks.
db.exec(`
  CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  BEGIN
    SELECT RAISE(ABORT, 'audit log is append-only');
  END;
`)

console.log(`Entry ${target.id} changed from "${target.action}" to "TAMPERED_ACTION"`)
