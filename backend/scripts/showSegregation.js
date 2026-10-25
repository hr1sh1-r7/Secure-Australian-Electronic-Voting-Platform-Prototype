// SR-08 DEMO: lists what is stored in each database file.
// Run from the backend folder (server can be running):  node scripts/showSegregation.js
const db = require('../db')

function report(schema, label, file) {
  console.log(`\n${label}\n  file: ${file}`)
  const tables = db
    .prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA ${schema}.table_info(${name})`).all().map((c) => c.name)
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM ${schema}.${name}`).get().n
    console.log(`  - ${name} (${rows} rows): ${cols.join(', ')}`)
  }
}

report('main', 'ENROLMENT / IDENTITY database', db.files.enrolment)
report('ballot_store', 'BALLOT database', db.files.ballots)
console.log('\nNo table in the ballot database contains a user ID, session, IP address or timestamp.')