const Database = require('better-sqlite3')

// Opens (or creates) the database file inside the backend folder
const db = new Database('voting.sqlite')

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
`)

module.exports = db