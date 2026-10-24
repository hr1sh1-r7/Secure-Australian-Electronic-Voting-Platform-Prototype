const express = require('express')
const requireAuditor = require('../middleware/requireAuditor')
const { getAuditLog, verifyChain } = require('../services/auditLogger')

const router = express.Router()

// SR-09: every audit route is auditor-only and read-only
router.use(requireAuditor)

router.get('/', (req, res) => {
  res.json(getAuditLog())
})

router.get('/verify', (req, res) => {
  res.json(verifyChain())
})

module.exports = router