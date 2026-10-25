const db = require('../db')
const { applySchema } = require('./ballotIntegrity/tables')

// Voting open/closed (Muzammil s4175334). Terminal batches are refused once
// voting closes, and SR-15 results can only be published after close.
applySchema(db)

const getState = db.prepare('SELECT status, closed_at FROM election_state WHERE id = 1')
const close = db.prepare("UPDATE election_state SET status = 'CLOSED', closed_at = ? WHERE id = 1 AND status = 'OPEN'")

function electionStatus() {
  return getState.get()
}

function closeVoting() {
  return close.run(new Date().toISOString()).changes === 1
}

module.exports = { electionStatus, closeVoting }
