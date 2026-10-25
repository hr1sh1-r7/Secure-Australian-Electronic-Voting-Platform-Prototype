const path = require('path')
const Database = require('better-sqlite3')

// Tests use a throwaway in-memory database so they never touch real data.
// Normal runs use voting.sqlite inside the backend folder.
const dbFile = process.env.NODE_ENV === 'test'
  ? ':memory:'
  : path.join(__dirname, 'voting.sqlite')

const db = new Database(dbFile)

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

  CREATE TABLE IF NOT EXISTS ballots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preferences TEXT NOT NULL
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
    -- SR-05: identity side - which voters have voted. Holds NO ballot data.
  CREATE TABLE IF NOT EXISTS voters_voted (
    user_id INTEGER PRIMARY KEY
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
  
  -- SR-12: server-side sessions with last-activity tracking.
  -- Only a SHA-256 hash of each session token is stored, never the token itself.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL
  );
`)

module.exports = db