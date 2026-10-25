const express = require('express')
const path = require('path')
const db = require('./db')

const app = express()

app.use(express.static(path.join(__dirname, '..', 'frontend')))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Each requirement keeps its routes in its own file under routes/.
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
app.use('/api/recount', require('./routes/recount'))          // SR-15
// SR-10: safe JSON errors (no stack traces). Must stay the LAST app.use
app.use(require('./middleware/errorHandler'))

module.exports = app