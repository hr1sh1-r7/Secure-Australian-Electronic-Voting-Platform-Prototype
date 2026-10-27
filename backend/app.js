
const express = require('express')
const path = require('path')
const helmet = require('helmet');
const db = require('./db')

const app = express()

// SR-04: Automated CIS-Benchmark Baseline & Strict CSP
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    objectSrc: ["'none'"],
  }
}));
app.disable('x-powered-by'); // Strips Express server fingerprinting

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')))

// Root and Health check endpoints for monitoring and testing
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Each requirement keeps its routes in its own file under routes/.
app.use('/api/admin', require('./routes/admin'))   // SR-01
app.use('/api/audit', require('./routes/audit'))   // SR-09
app.use('/api/session', require('./routes/session')) // SR-12
app.use('/api/ballots', require('./routes/ballots')) // SR-05
app.use('/api/mission', require('./routes/mission')) // SR-06
app.use('/api/receipts', require('./routes/receipts')) // SR-07
app.use('/api/tally', require('./routes/tally'))       // SR-10
app.use('/api/auth', require('./routes/auth'))         // login (shared groundwork) + SR-11 lockout
app.use('/api/alerts', require('./routes/alerts'))     // SR-11 SOC alerts
app.use('/api/terminals', require('./routes/terminals'))      // SR-14
app.use('/api/markoff', require('./routes/markoff'))          // SR-13
app.use('/api/ballot-store', require('./routes/ballotStore')) // SR-14, SR-16
app.use('/api/recount', require('./routes/recount'))  
// Return candidate records for the demonstration ballot.
app.get('/api/candidates', (req, res) => {
  try {
    const candidates = db.prepare(
      'SELECT id, name, party FROM candidates ORDER BY id'
    ).all()
    res.json({ candidates })
  } catch (error) {
    console.error('Failed to load candidates:', error)
    res.status(500).json({ error: 'Unable to load candidates' })
  }
})        // SR-15
// SR-10: safe JSON errors (no stack traces). Must stay the LAST app.use
app.use(require('./middleware/errorHandler'))

module.exports = app
