const express = require('express')
const validate = require('../middleware/validate')
const schemas = require('../validation/ballotIntegritySchemas')
const { processBatch, BatchRejected } = require('../services/ballotStore')

// SR-14 + SR-16: receives signed vote batches from polling terminals and
// returns a signed receipt (Muzammil s4175334).
const router = express.Router()
router.use(express.json({ limit: '1mb' }))

router.post('/batches', validate(schemas.batch), async (req, res) => {
  try {
    const { receipt, duplicate, processingMs } = await processBatch(req.body)
    res.status(duplicate ? 200 : 201).json({ receipt, duplicate, processingMs })
  } catch (err) {
    if (err instanceof BatchRejected) {
      return res.status(err.status).json({ error: err.reason, detail: err.detail })
    }
    throw err
  }
})

module.exports = router
