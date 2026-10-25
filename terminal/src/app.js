const path = require('path')
const crypto = require('crypto')
const express = require('express')
const { OfflineError, HttpError } = require('./serverClient')
const { QueueClosedError } = require('./queue')

// Local API behind the polling terminal screen (listens on 127.0.0.1 only).
// Owner: Muzammil Malek (s4175334)
const VOTER_ID = /^[A-Za-z0-9]{3,20}$/

function createTerminalApp({ cfg, queue, client, sync, getCandidates }) {
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'")
    res.set('X-Content-Type-Options', 'nosniff')
    next()
  })
  app.use(express.json({ limit: '16kb' }))

  // One-time ballot sessions. The authorization token stays inside the
  // terminal process and is never sent to the browser.
  const sessions = new Map()
  const takeSession = (id) => {
    const s = sessions.get(id)
    sessions.delete(id)
    return s && s.expires > Date.now() ? s : null
  }

  app.get('/api/status', (req, res) => {
    res.json({
      terminalId: cfg.terminalId,
      pollingPlace: cfg.pollingPlace,
      online: sync.online && !client.forcedOffline,
      networkDisabled: client.forcedOffline,
      offlineSince: queue.offlineSince(),
      acceptingBallots: queue.acceptingBallots(),
      ...queue.counts(),
      lastSyncAt: sync.lastSyncAt,
      lastError: sync.lastError,
      lastReceipt: sync.lastReceipt()
    })
  })

  app.get('/api/candidates', (req, res) => res.json(getCandidates()))

  // Step 1: the polling official identifies the voter
  app.post('/api/voters/authorize', async (req, res, next) => {
    const voterId = req.body && req.body.voter_id
    if (typeof voterId !== 'string' || !VOTER_ID.test(voterId)) {
      return res.status(400).json({ error: 'INVALID_VOTER_ID' })
    }
    let auth
    let mode
    try {
      const { token } = await client.authorize(voterId) // SR-13 national mark-off
      auth = { type: 'token', token }
      mode = 'online'
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
      if (!(err instanceof OfflineError)) return next(err)
      // SR-16: offline declaration vote, reconciled when the terminal reconnects
      queue.markOffline()
      sync.online = false
      if (!queue.acceptingBallots()) return res.status(423).json({ error: 'OFFLINE_LIMIT_REACHED' })
      auth = { type: 'declaration', voter_id: voterId }
      mode = 'declaration'
    }
    const sessionId = crypto.randomUUID()
    sessions.set(sessionId, { auth, expires: Date.now() + cfg.sessionTtlMs })
    res.json({ sessionId, mode })
  })

  // Step 2: the voter submits their ranked ballot
  app.post('/api/ballots', (req, res) => {
    const { sessionId, preferences } = req.body || {}
    const session = typeof sessionId === 'string' ? takeSession(sessionId) : null
    if (!session) return res.status(401).json({ error: 'SESSION_INVALID_OR_EXPIRED' })

    const known = new Set(getCandidates().map((c) => c.id))
    const formal = Array.isArray(preferences) && preferences.length > 0 && preferences.length <= known.size &&
      new Set(preferences).size === preferences.length && preferences.every((p) => known.has(p))
    if (!formal) return res.status(400).json({ error: 'INFORMAL_BALLOT' })

    try {
      queue.enqueue({ ballot_id: crypto.randomUUID(), preferences, auth: session.auth })
    } catch (err) {
      if (err instanceof QueueClosedError) return res.status(423).json({ error: err.code })
      throw err
    }
    sync.flush() // send now if possible; the queue keeps it safe if not
    res.status(201).json({ queued: true })
  })

  // Demo control: simulate the polling place losing its network link
  app.post('/api/demo/network', async (req, res) => {
    client.forcedOffline = req.body && req.body.offline === true
    if (client.forcedOffline) {
      sync.online = false
      queue.markOffline()
    }
    await sync.flush()
    res.json({ networkDisabled: client.forcedOffline, online: sync.online })
  })

  app.use(express.static(path.join(__dirname, '..', 'public')))
  app.use((req, res) => res.status(404).json({ error: 'Not found' }))
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[terminal]', err)
    res.status(500).json({ error: 'Something went wrong' })
  })
  return app
}

module.exports = { createTerminalApp }
