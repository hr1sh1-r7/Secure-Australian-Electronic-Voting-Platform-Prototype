const path = require('path')
const Database = require('better-sqlite3')

// SR-08: two physically separate database files.
//   voting.sqlite   - ENROLMENT / IDENTITY side: voters, sessions, who has voted, audit log
//   ballots.sqlite  - BALLOT side: cast ballots, their integrity hashes, receipts
// Neither file holds anything that links a person to a ballot.
// The ballot file is ATTACHED as "ballot_store", which lets casting a vote update
// both files in ONE all-or-nothing transaction (no half-recorded votes).
// Tests use throwaway in-memory databases so they never touch real data.
const isTest = process.env.NODE_ENV === 'test'
const ENROLMENT_FILE = isTest ? ':memory:' : path.join(__dirname, 'voting.sqlite')
const BALLOT_FILE = isTest ? ':memory:' : path.join(__dirname, 'ballots.sqlite')

const db = new Database(ENROLMENT_FILE)

// Safety check: databases created before SR-08 still have ballot tables in the
// enrolment file. Refuse to start rather than mix the two sides.
const legacy = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('ballots', 'cvr_hashes', 'receipts')")
  .all()
if (legacy.length > 0) {
  throw new Error(
    'voting.sqlite was created before SR-08 and still contains ballot tables. ' +
    'Stop the server, delete backend/voting.sqlite, and start again.'
  )
}

db.prepare('ATTACH DATABASE ? AS ballot_store').run(BALLOT_FILE)

// ---- ENROLMENT / IDENTITY side (voting.sqlite) --------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    fido2_public_key TEXT,
    fido2_credential_id TEXT
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    party TEXT
  );

  -- SR-01: Four-Eyes Dual Authorization Workflow
  CREATE TABLE IF NOT EXISTS admin_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT,
    target TEXT,
    initiator_id INTEGER,
    status TEXT DEFAULT 'PENDING_APPROVAL',
    FOREIGN KEY(initiator_id) REFERENCES users(id)
  );

  -- SR-05: identity side - which voters have voted. Holds NO ballot data.
  CREATE TABLE IF NOT EXISTS voters_voted (
    user_id INTEGER PRIMARY KEY
  );

  -- SR-12: server-side sessions with last-activity tracking.
  -- Only a SHA-256 hash of each session token is stored, never the token itself.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL
  );

  -- SR-11: failed login attempts (sliding 5-minute window)
  CREATE TABLE IF NOT EXISTS failed_logins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    attempted_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_failed_logins_user ON failed_logins (username, attempted_at);

  -- SR-11: temporarily locked accounts
  CREATE TABLE IF NOT EXISTS account_locks (
    username TEXT PRIMARY KEY,
    locked_at INTEGER NOT NULL,
    locked_until INTEGER NOT NULL
  );

  -- SR-11: high-priority alerts raised for the Security Operations Centre (SOC)
  CREATE TABLE IF NOT EXISTS security_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    severity TEXT NOT NULL,
    type TEXT NOT NULL,
    username TEXT,
    details TEXT,
    delivered_at INTEGER,
    delivery_error TEXT
  );

  -- SR-09: append-only, hash-chained audit log
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );

  -- SR-09: block any modification of existing entries
  CREATE TRIGGER IF NOT EXISTS audit_log_no_update
  BEFORE UPDATE ON audit_log
  BEGIN
    SELECT RAISE(ABORT, 'audit log is append-only');
  END;

  -- SR-09: block any deletion of entries
  CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
  BEFORE DELETE ON audit_log
  BEGIN
    SELECT RAISE(ABORT, 'audit log is append-only');
  END;
`)

// ---- BALLOT side (ballots.sqlite) ----------------------------------------
// No user IDs, sessions, IP addresses or timestamps anywhere in this file.
db.exec(`
  -- SR-05: cast ballots - preferences only
  CREATE TABLE IF NOT EXISTS ballot_store.ballots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preferences TEXT NOT NULL
  );

  -- SR-10: SHA-384 integrity hash for every Cast Vote Record (ballot)
  CREATE TABLE IF NOT EXISTS ballot_store.cvr_hashes (
    ballot_id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL
  );

  -- SR-07: signed voter receipts. No voter ID and no link to the ballot row.
  CREATE TABLE IF NOT EXISTS ballot_store.receipts (
    receipt_id TEXT PRIMARY KEY,
    commitment TEXT NOT NULL,
    signature TEXT NOT NULL
  );
`)

// Tables on each side, used by tests and the SR-08 segregation report
const IDENTITY_TABLES = ['users', 'sessions', 'voters_voted', 'audit_log', 'failed_logins', 'account_locks', 'security_alerts', 'admin_actions', 'candidates']
const BALLOT_TABLES = ['ballots', 'cvr_hashes', 'receipts']

db.files = { enrolment: ENROLMENT_FILE, ballots: BALLOT_FILE }
db.IDENTITY_TABLES = IDENTITY_TABLES
db.BALLOT_TABLES = BALLOT_TABLES

module.exports = db