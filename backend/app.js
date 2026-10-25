```javascript
const express = require('express')
const path = require('path')
const db = require('./db')

const app = express()

app.use(express.static(path.join(__dirname, '..', 'frontend')))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

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
})

module.exports = app
```
