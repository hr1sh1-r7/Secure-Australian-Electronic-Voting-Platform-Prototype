const express = require('express')
const requireAuditor = require('../middleware/requireAuditor')
const { getAlerts } = require('../services/socAlert')

const router = express.Router()

// SR-11: security alerts are visible to the auditor only (read-only)
router.get('/', requireAuditor, (req, res) => {
  res.json(getAlerts())
})

// MOCK Security Operations Centre, only when ENABLE_MOCK_SOC=true.
// Point SOC_WEBHOOK_URL at http://localhost:3000/api/alerts/mock-soc to see
// alerts "arrive" at the SOC. A real deployment would use the SOC's own URL.
const received = []

router.post('/mock-soc', express.json({ limit: '10kb' }), (req, res) => {
  if (process.env.ENABLE_MOCK_SOC !== 'true') {
    return res.status(404).json({ error: 'Not found' })
  }
  received.push({ receivedAt: new Date().toISOString(), alert: req.body })
  console.log(`[MOCK SOC] HIGH-PRIORITY ALERT: ${req.body.type} for "${req.body.username}"`)
  res.json({ received: true })
})

router.get('/mock-soc', requireAuditor, (req, res) => {
  if (process.env.ENABLE_MOCK_SOC !== 'true') {
    return res.status(404).json({ error: 'Not found' })
  }
  res.json(received)
})

module.exports = router