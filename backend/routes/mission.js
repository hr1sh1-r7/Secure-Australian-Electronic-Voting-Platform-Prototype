const express = require('express')
const { geoFence } = require('../middleware/geoFence')

const router = express.Router()

// SR-06: every route of the diplomatic mission voting subsystem is geo-fenced.
// Overseas voting features (e.g. mission ballot submission) go in this router.
router.use(geoFence)

router.get('/status', (req, res) => {
  res.json({
    access: 'granted',
    subsystem: 'Diplomatic mission voting',
    clientIp: req.missionIp
  })
})

module.exports = router