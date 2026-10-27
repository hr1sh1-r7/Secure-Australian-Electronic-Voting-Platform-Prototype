const fs = require('fs')
const path = require('path')
const { config, queueKey } = require('./config')
const { SoftwareEd25519Signer } = require('./signer')
const { OfflineQueue } = require('./queue')
const { ServerClient, OfflineError } = require('./serverClient')
const { SyncAgent } = require('./sync')
const { createTerminalApp } = require('./app')

async function main() {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const signer = SoftwareEd25519Signer.loadOrCreate(path.join(config.dataDir, 'terminal-signing-key.pem'))
  const queue = new OfflineQueue({
    dbPath: path.join(config.dataDir, `queue-${config.terminalId}.sqlite`),
    key: queueKey(),
    terminalId: config.terminalId,
    maxOfflineMs: config.maxOfflineMs
  })
  const client = new ServerClient({ baseUrl: config.serverUrl, terminalId: config.terminalId, signer })

  // First run: register our public key and pin the Ballot Store's receipt key
  if (!queue.getState('enrolled')) {
    if (!config.enrolmentSecret) throw new Error('TERMINAL_ENROLMENT_SECRET is required for first-time enrolment')
    await client.register({ pollingPlace: config.pollingPlace, enrolmentSecret: config.enrolmentSecret })
    const rk = await client.receiptKey()
    queue.setState('receipt_key_pem', rk.public_key_pem)
    queue.setState('enrolled', new Date().toISOString())
    console.log(`Enrolled ${config.terminalId}; pinned receipt key ${rk.kid}`)
  }

  // Load the ballot paper, or use the cached copy if offline at start-up
  let candidates = JSON.parse(queue.getState('candidates') || 'null')
  try {
    candidates = await client.candidates()
    queue.setState('candidates', JSON.stringify(candidates))
  } catch (err) {
    if (!(err instanceof OfflineError) || !candidates) throw err
    console.warn('Server unreachable - using cached ballot paper')
  }
  if (!candidates.length) throw new Error('No candidates on the server. Run: node scripts/seedCandidates.js')

  const sync = new SyncAgent({
    queue, client, signer,
    terminalId: config.terminalId,
    intervalMs: config.syncIntervalMs,
    maxBackoffMs: config.maxBackoffMs,
    maxBatchEntries: config.maxBatchEntries
  })
  sync.start()

  createTerminalApp({ cfg: config, queue, client, sync, getCandidates: () => candidates })
    .listen(config.port, '127.0.0.1', () => {
      console.log(`Polling terminal ${config.terminalId} on http://127.0.0.1:${config.port}`)
    })
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
