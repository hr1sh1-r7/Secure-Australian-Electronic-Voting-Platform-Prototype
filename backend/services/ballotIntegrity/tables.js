// SR-13 to SR-16 tables (Muzammil s4175334).
// Kept here instead of db.js so my changes never conflict with teammates'.
// applySchema() is idempotent and is called by each of my services at load.

function applySchema(conn) {
  conn.exec(`
    -- SR-13: certified electoral roll for polling-place voting.
    -- user_id links to the same voter's online account so that SR-05's
    -- voters_voted table blocks voting in both channels.
    -- The ballot authorization token ID (jti) is NEVER stored here.
    CREATE TABLE IF NOT EXISTS electoral_roll (
      voter_id TEXT PRIMARY KEY CHECK (length(voter_id) BETWEEN 3 AND 20),
      user_id INTEGER UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      division TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ELIGIBLE'
        CHECK (status IN ('ELIGIBLE', 'TOKEN_ISSUED', 'DECLARATION_ACCEPTED')),
      marked_off_at TEXT,
      marked_off_by_terminal TEXT
    );

    -- SR-13: each token can be redeemed once. WITHOUT ROWID so rows are kept
    -- in random UUID order, not arrival order (nothing to correlate).
    CREATE TABLE IF NOT EXISTS spent_tokens (
      jti TEXT PRIMARY KEY
    ) WITHOUT ROWID;

    -- SR-16: a terminal ballot UUID can only ever be stored once, so a
    -- retransmitted ballot is never counted twice. No link to the ballots row.
    CREATE TABLE IF NOT EXISTS terminal_ballot_ids (
      ballot_uuid TEXT PRIMARY KEY
    ) WITHOUT ROWID;

    -- SR-14: each polling terminal's public signing key, registered at enrolment
    CREATE TABLE IF NOT EXISTS terminals (
      terminal_id TEXT PRIMARY KEY,
      public_key_pem TEXT NOT NULL,
      polling_place TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );

    -- SR-14: every accepted batch and the signed receipt returned for it
    CREATE TABLE IF NOT EXISTS terminal_batches (
      batch_id TEXT PRIMARY KEY,
      terminal_id TEXT NOT NULL,
      batch_hash TEXT NOT NULL,
      ballot_count INTEGER NOT NULL,
      accepted_count INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      receipt TEXT NOT NULL
    );

    -- SR-16: last hash-chain link received from each terminal
    CREATE TABLE IF NOT EXISTS terminal_chain (
      terminal_id TEXT PRIMARY KEY,
      last_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Voting open/closed (results can only be published after close)
    CREATE TABLE IF NOT EXISTS election_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
      closed_at TEXT
    );
    INSERT OR IGNORE INTO election_state (id, status) VALUES (1, 'OPEN');

    -- SR-15: every N-version recount and its comparison result
    CREATE TABLE IF NOT EXISTS recount_runs (
      run_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      cvr_count INTEGER NOT NULL,
      cvr_set_hash TEXT NOT NULL,
      engine_a TEXT NOT NULL,
      engine_b TEXT NOT NULL,
      matched INTEGER NOT NULL,
      discrepancy TEXT,
      status TEXT NOT NULL CHECK (status IN ('MATCHED', 'BLOCKED', 'PUBLISHED'))
    );

    CREATE TABLE IF NOT EXISTS published_results (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      run_id TEXT NOT NULL,
      result TEXT NOT NULL,
      published_at TEXT NOT NULL
    );

    -- SR-15: alerts to the State Electoral Officer
    CREATE TABLE IF NOT EXISTS seo_alerts (
      alert_id TEXT PRIMARY KEY,
      raised_at TEXT NOT NULL,
      severity TEXT NOT NULL,
      subject TEXT NOT NULL,
      detail TEXT NOT NULL,
      delivered_via TEXT NOT NULL
    );
  `)
}

module.exports = { applySchema }
