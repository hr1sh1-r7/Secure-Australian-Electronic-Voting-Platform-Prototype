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
    role TEXT NOT NULL
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

module.exports = db