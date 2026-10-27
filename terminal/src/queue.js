const crypto = require('crypto')
const Database = require('better-sqlite3')
const { canonicalize, genesisHash, computeEntryHash } = require('../../backend/services/ballotIntegrity/canonical')

// SR-16: Offline Store-and-Forward Voting Continuity - the terminal's queue
// Owner: Muzammil Malek (s4175334)
//
// Part 2 solution: AES-256-GCM encrypted local SQLite queue.
//  - EVERY ballot is written here first, online or offline, so a network
//    drop mid-send can never lose a ballot.
//  - Each entry is encrypted with AES-256-GCM (random 96-bit IV). The terminal
//    ID, ballot ID and entry hash are bound in as associated data, so
//    ciphertexts cannot be swapped between rows without detection.
//  - Entries are hash-chained; the Ballot Store checks the chain, so deleting
//    or reordering queued ballots is detected.
//  - Once the Ballot Store's signed receipt arrives, the ciphertext is wiped
//    (only the hash stays, for the chain). No ballot lingers on the device.
//  - After 12 hours offline the queue refuses new ballots.

class QueueClosedError extends Error {
  constructor() {
    super('OFFLINE_LIMIT_REACHED')
    this.code = 'OFFLINE_LIMIT_REACHED'
  }
}
class QueueTamperError extends Error {}

class OfflineQueue {
  constructor({ dbPath, key, terminalId, maxOfflineMs, now = () => Date.now() }) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('AES-256 key must be 32 bytes')
    this._key = key
    this.terminalId = terminalId
    this.maxOfflineMs = maxOfflineMs
    this.now = now
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ballot_id TEXT UNIQUE NOT NULL,
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL,
        iv BLOB NOT NULL,
        tag BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        sent_batch TEXT
      );
      CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `)
  }

  // ---- AES-256-GCM -------------------------------------------------------
  _encrypt(plaintext, aad) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv)
    cipher.setAAD(Buffer.from(aad))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { iv, tag: cipher.getAuthTag(), ciphertext }
  }

  _decrypt({ iv, tag, ciphertext }, aad) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv)
    decipher.setAAD(Buffer.from(aad))
    decipher.setAuthTag(tag)
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch {
      throw new QueueTamperError('Queue entry failed authentication (tampered or wrong key)')
    }
  }

  _aad(ballotId, entryHash) {
    return `${this.terminalId}|${ballotId}|${entryHash}`
  }

  // ---- key/value state ---------------------------------------------------
  getState(k) {
    const row = this.db.prepare('SELECT v FROM state WHERE k = ?').get(k)
    return row ? row.v : null
  }

  setState(k, v) {
    if (v === null || v === undefined) this.db.prepare('DELETE FROM state WHERE k = ?').run(k)
    else this.db.prepare('INSERT INTO state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v))
  }

  // The batch in flight contains ballots, so it is stored encrypted too
  setSecretState(k, obj) {
    if (obj === null) return this.setState(k, null)
    const box = this._encrypt(JSON.stringify(obj), `${this.terminalId}|state|${k}`)
    this.setState(k, JSON.stringify({ iv: box.iv.toString('base64'), tag: box.tag.toString('base64'), ct: box.ciphertext.toString('base64') }))
  }

  getSecretState(k) {
    const raw = this.getState(k)
    if (!raw) return null
    const b = JSON.parse(raw)
    return JSON.parse(this._decrypt({
      iv: Buffer.from(b.iv, 'base64'), tag: Buffer.from(b.tag, 'base64'), ciphertext: Buffer.from(b.ct, 'base64')
    }, `${this.terminalId}|state|${k}`))
  }

  chainHead() {
    return this.getState('chain_head') || genesisHash(this.terminalId)
  }

  // ---- offline window (12 hours) -----------------------------------------
  markOffline() {
    if (!this.getState('offline_since')) this.setState('offline_since', this.now())
  }

  markOnline() {
    this.setState('offline_since', null)
  }

  offlineSince() {
    const v = this.getState('offline_since')
    return v ? Number(v) : null
  }

  acceptingBallots() {
    const since = this.offlineSince()
    return since === null || this.now() - since <= this.maxOfflineMs
  }

  // ---- the queue ---------------------------------------------------------
  enqueue({ ballot_id, preferences, auth }) {
    if (!this.acceptingBallots()) throw new QueueClosedError()
    return this.db.transaction(() => {
      const entry = {
        ballot_id,
        preferences,
        auth,
        queued_at: new Date(this.now()).toISOString(),
        prev_hash: this.chainHead()
      }
      entry.entry_hash = computeEntryHash(entry)
      const box = this._encrypt(canonicalize(entry), this._aad(ballot_id, entry.entry_hash))
      this.db.prepare('INSERT INTO entries (ballot_id, prev_hash, entry_hash, iv, tag, ciphertext) VALUES (?, ?, ?, ?, ?, ?)')
        .run(ballot_id, entry.prev_hash, entry.entry_hash, box.iv, box.tag, box.ciphertext)
      this.setState('chain_head', entry.entry_hash)
      return { ballot_id, entry_hash: entry.entry_hash }
    }).immediate()
  }

  pending(limit) {
    const rows = this.db.prepare('SELECT * FROM entries WHERE sent_batch IS NULL ORDER BY seq LIMIT ?').all(limit)
    return rows.map((row) => {
      const entry = JSON.parse(this._decrypt(row, this._aad(row.ballot_id, row.entry_hash)))
      if (computeEntryHash(entry) !== row.entry_hash || entry.prev_hash !== row.prev_hash) {
        throw new QueueTamperError(`Queue entry ${row.ballot_id} does not match its hash`)
      }
      return entry
    })
  }

  // Receipt received: mark sent and wipe the encrypted ballot from the device
  markSent(ballotIds, batchId) {
    const stmt = this.db.prepare("UPDATE entries SET sent_batch = ?, iv = x'', tag = x'', ciphertext = x'' WHERE ballot_id = ?")
    this.db.transaction(() => ballotIds.forEach((id) => stmt.run(batchId, id)))()
  }

  counts() {
    const r = this.db.prepare('SELECT SUM(sent_batch IS NULL) AS queued, SUM(sent_batch IS NOT NULL) AS sent FROM entries').get()
    return { queued: r.queued || 0, sent: r.sent || 0 }
  }

  close() {
    this.db.close()
  }
}

module.exports = { OfflineQueue, QueueClosedError, QueueTamperError }
