const { canonicalize } = require('../../backend/services/ballotIntegrity/canonical')

// Talks to the central backend. Tells apart "network unreachable" (go offline
// and keep queueing) from "server said no" (show the reason).
class OfflineError extends Error {}
class HttpError extends Error {
  constructor(status, body) {
    super((body && body.error) || `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

class ServerClient {
  constructor({ baseUrl, terminalId, signer, timeoutMs = 8000 }) {
    this.baseUrl = baseUrl
    this.terminalId = terminalId
    this.signer = signer
    this.timeoutMs = timeoutMs
    this.forcedOffline = false // demo switch: behave as if the network is down
  }

  async _request(method, route, body, headers = {}) {
    if (this.forcedOffline) throw new OfflineError('Network disabled (demo)')
    let res
    try {
      res = await fetch(this.baseUrl + route, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (err) {
      throw new OfflineError(err.message)
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new HttpError(res.status, data)
    return data
  }

  health() {
    return this._request('GET', '/api/health')
  }

  candidates() {
    return this._request('GET', '/api/ballots/candidates')
  }

  receiptKey() {
    return this._request('GET', '/api/terminals/receipt-key')
  }

  register({ pollingPlace, enrolmentSecret }) {
    return this._request('POST', '/api/terminals/register',
      { terminal_id: this.terminalId, public_key_pem: this.signer.publicKeyPem(), polling_place: pollingPlace },
      { 'X-Enrolment-Secret': enrolmentSecret })
  }

  // SR-13: signed request to mark a voter off and get a single-use token
  authorize(voterId) {
    const fields = { terminal_id: this.terminalId, voter_id: voterId, timestamp: new Date().toISOString() }
    const signature = this.signer.sign(Buffer.from(canonicalize(fields)))
    return this._request('POST', '/api/markoff/authorize', { ...fields, signature })
  }

  sendBatch(batch) {
    return this._request('POST', '/api/ballot-store/batches', batch)
  }
}

module.exports = { ServerClient, OfflineError, HttpError }
