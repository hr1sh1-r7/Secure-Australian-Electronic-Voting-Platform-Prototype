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

module.exports = app