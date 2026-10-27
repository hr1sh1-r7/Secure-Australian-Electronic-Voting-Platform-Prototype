const path = require('path')

// Polling terminal settings. Read from terminal/.env (see .env.example).
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'))
} catch {
  // no .env: defaults and real environment variables are used
}

const env = process.env

const config = {
  port: Number(env.TERMINAL_PORT || 4100),
  serverUrl: (env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, ''),
  terminalId: env.TERMINAL_ID || 'T-MELB-001',
  pollingPlace: env.POLLING_PLACE || 'Melbourne Town Hall',
  dataDir: env.TERMINAL_DATA_DIR || path.join(__dirname, '..', 'data'),
  enrolmentSecret: env.TERMINAL_ENROLMENT_SECRET || '',
  queueKeyB64: env.TERMINAL_QUEUE_KEY || '', // 32-byte AES-256 key (TPM-sealed in production)
  syncIntervalMs: Number(env.SYNC_INTERVAL_MS || 30000),
  maxBackoffMs: 120000, // retry at least every 2 minutes while offline (SR-16 limit is 15)
  maxOfflineMs: 12 * 60 * 60 * 1000, // SR-16: stop accepting ballots after 12 hours offline
  maxBatchEntries: 200,
  sessionTtlMs: 10 * 60 * 1000
}

function queueKey() {
  const key = Buffer.from(config.queueKeyB64, 'base64')
  if (key.length !== 32) {
    throw new Error('TERMINAL_QUEUE_KEY must be a base64 32-byte key. Generate one with:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"")
  }
  return key
}

module.exports = { config, queueKey }
