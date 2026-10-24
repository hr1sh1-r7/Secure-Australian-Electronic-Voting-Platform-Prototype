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

module.exports = app