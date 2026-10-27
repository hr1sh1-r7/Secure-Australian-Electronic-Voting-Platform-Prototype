// SR-13: Atomic Single-Use Mark-off (Anti-Double Voting) - the locking core.
// Owner: Muzammil Malek (s4175334)
//
// Part 2 selected a pessimistic lock inside a SERIALIZABLE transaction.
// The team's database is SQLite, which has no row-level locks, so the same
// guarantee is achieved with SQLite's equivalent:
//
//   BEGIN IMMEDIATE  - takes the database write lock BEFORE reading the
//                      voter's row (pessimistic: nobody else can write until
//                      we commit). SQLite transactions are always SERIALIZABLE.
//   SQLITE_BUSY      - another connection (e.g. a second server instance)
//                      holds the lock. Like NOWAIT, we refuse rather than
//                      risk a second ballot: HTTP 409 CONCURRENT_REQUEST.
//
// This file depends on nothing but the connection it is given, so the
// concurrency test can run it from many worker threads, each with its own
// database connection, exactly like several polling places at once.

class MarkOffRefused extends Error {
  constructor(reason, status) {
    super(reason)
    this.reason = reason
    this.status = status
  }
}

const BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED'])

function createMarkOff(conn) {
  const getVoter = conn.prepare('SELECT status, user_id FROM electoral_roll WHERE voter_id = ?')
  const votedOnline = conn.prepare('SELECT 1 FROM voters_voted WHERE user_id = ?')
  const update = conn.prepare(`
    UPDATE electoral_roll
    SET status = ?, marked_off_at = ?, marked_off_by_terminal = ?
    WHERE voter_id = ? AND status = 'ELIGIBLE'
  `)
  // SR-05's identity table: marking it here also stops the voter voting online
  const markVoted = conn.prepare('INSERT INTO voters_voted (user_id) VALUES (?)')

  const transaction = conn.transaction((voterId, terminalId, mode) => {
    const voter = getVoter.get(voterId)
    if (!voter) throw new MarkOffRefused('NOT_ON_ROLL', 404)
    if (voter.status !== 'ELIGIBLE' || votedOnline.get(voter.user_id)) {
      throw new MarkOffRefused('ALREADY_MARKED_OFF', 409)
    }
    const { changes } = update.run(mode, new Date().toISOString(), terminalId, voterId)
    if (changes !== 1) throw new MarkOffRefused('ALREADY_MARKED_OFF', 409)
    markVoted.run(voter.user_id)
    return voter.user_id
  })

  // mode: 'TOKEN_ISSUED' (online at the polling place) or
  //       'DECLARATION_ACCEPTED' (offline ballot reconciled later, SR-16)
  return function markOff({ voterId, terminalId, mode }) {
    try {
      // .immediate = BEGIN IMMEDIATE. If called inside an outer transaction
      // (the SR-16 batch), better-sqlite3 uses a savepoint inside it instead.
      return transaction.immediate(voterId, terminalId, mode)
    } catch (err) {
      if (err instanceof MarkOffRefused) throw err
      if (BUSY_CODES.has(err.code)) throw new MarkOffRefused('CONCURRENT_REQUEST', 409)
      if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new MarkOffRefused('ALREADY_MARKED_OFF', 409)
      throw err
    }
  }
}

module.exports = { createMarkOff, MarkOffRefused }
