const express = require('express')
const path = require('path')
const db = require('./db')

const app = express()

app.use(express.static(path.join(__dirname, '..', 'frontend')))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

module.exports = app