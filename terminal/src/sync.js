const crypto = require('crypto')
const { canonicalize, sha256Hex, batchSigningBytes } = require('../../backend/services/ballotIntegrity/canonical')
const { OfflineError, HttpError } = require('./serverClient')

// SR-14 + SR-16: builds signed batches from the queue and forwards them.
// Owner: Muzammil Malek (s4175334)
//  - Checks every 30 s online. Offline, retries with backoff (60 s, then every
//    120 s), so the queue is sent at most ~2 minutes after the network returns.
//  - The batch being sent is saved (encrypted) BEFORE sending. If the receipt
//    is lost, the identical batch is resent and the server returns the
//    original receipt: no double counting and the hash chain stays intact.
//  - Every receipt's Ed25519 signature is checked against the Ballot Store key
//    pinned at enrolment, and must match the batch ID and hash.

function verifyReceipt(receipt, batch, receiptKeyPem) {
  if (!receipt || typeof receipt.signature !== 'string' || !receiptKeyPem) return false
  const { signature, ...body } = receipt
  let ok = false
  try {
    ok = crypto.verify(null, Buffer.from(canonicalize(body)), crypto.createPublicKey(receiptKeyPem), Buffer.from(signature, 'base64'))
  } catch {
    ok = false
  }
  return ok && receipt.batch_id === batch.batch_id && receipt.batch_hash === sha256Hex(batchSigningBytes(batch))
}

class SyncAgent {
  constructor({ queue, client, signer, terminalId, intervalMs, maxBackoffMs, maxBatchEntries, log = console }) {
    Object.assign(this, { queue, client, signer, terminalId, intervalMs, maxBackoffMs, maxBatchEntries, log })
    this.online = false
    this.lastError = null
    this.lastSyncAt = null
    this.backoffMs = intervalMs
    this.flushing = null
    this.timer = null
  }

  start() {
    this._schedule(0)
  }

  stop() {
    clearTimeout(this.timer)
  }

  _schedule(ms) {
    clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      await this.flush()
      this._schedule(this.online ? this.intervalMs : this.backoffMs)
    }, ms)
    if (this.timer.unref) this.timer.unref()
  }

  buildBatch(entries) {
    const batch = {
      batch_id: crypto.randomUUID(),
      terminal_id: this.terminalId,
      created_at: new Date().toISOString(),
      chain_start: entries[0].prev_hash,
      entries
    }
    batch.signature = this.signer.sign(batchSigningBytes(batch))
    return batch
  }

  // Send everything queued. Callers at the same time share one flush.
  flush() {
    if (!this.flushing) {
      this.flushing = this._flush().finally(() => { this.flushing = null })
    }
    return this.flushing
  }

  async _flush() {
    try {
      for (;;) {
        let batch = this.queue.getSecretState('inflight_batch')
        if (!batch) {
          const entries = this.queue.pending(this.maxBatchEntries)
          if (entries.length === 0) {
            await this.client.health()
            return this._wentOnline()
          }
          batch = this.buildBatch(entries)
          this.queue.setSecretState('inflight_batch', batch)
        }

        let response
        try {
          response = await this.client.sendBatch(batch)
        } catch (err) {
          if (err instanceof HttpError) {
            // Refused outright, so the server changed nothing. Keep the ballots
            // queued and build a fresh batch next time.
            this.queue.setSecretState('inflight_batch', null)
            this.lastError = `Batch refused by Ballot Store: ${err.message}`
            this.online = true
            if (this.log.error) this.log.error('[sync] ' + this.lastError)
            return
          }
          throw err
        }

        if (!verifyReceipt(response.receipt, batch, this.queue.getState('receipt_key_pem'))) {
          this.lastError = 'Receipt signature invalid - batch kept for resend'
          if (this.log.error) this.log.error('[sync] ' + this.lastError)
          return
        }
        this.queue.markSent(batch.entries.map((e) => e.ballot_id), batch.batch_id)
        this.queue.setSecretState('inflight_batch', null)
        this.queue.setState('last_receipt', JSON.stringify(response.receipt))
        this.lastError = null
        this._wentOnline()
      }
    } catch (err) {
      if (err instanceof OfflineError) {
        if (this.online && this.log.warn) this.log.warn('[sync] network unreachable - queueing offline')
        this.online = false
        this.queue.markOffline()
        this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
        return
      }
      this.lastError = err.message
      if (this.log.error) this.log.error('[sync]', err)
    }
  }

  _wentOnline() {
    this.online = true
    this.lastSyncAt = new Date().toISOString()
    this.backoffMs = this.intervalMs
    this.queue.markOnline()
  }

  lastReceipt() {
    const raw = this.queue.getState('last_receipt')
    return raw ? JSON.parse(raw) : null
  }
}

module.exports = { SyncAgent, verifyReceipt }
