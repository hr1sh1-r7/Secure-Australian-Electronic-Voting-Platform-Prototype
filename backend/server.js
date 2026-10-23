const express = require('express')
const db = require('./db')
const app = express()
const port = 3000

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

const path = require('path')
app.use(express.static(path.join(__dirname, '..', 'frontend')))

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})