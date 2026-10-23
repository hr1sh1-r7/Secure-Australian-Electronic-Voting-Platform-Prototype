const express = require('express')
const app = express()
const port = 3000

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})