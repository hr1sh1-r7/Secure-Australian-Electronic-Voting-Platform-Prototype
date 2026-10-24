const path = require('path')

// Load settings (PORT, AUDITOR_TOKEN, ...) from the .env file in the project folder, if present
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'))
} catch {
  console.warn('No .env file found - using defaults')
}

const app = require('./app')
const port = process.env.PORT || 3000

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})