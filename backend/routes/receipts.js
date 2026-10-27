const express = require('express')
const { verifyReceipt, getPublicKeyPem } = require('../services/receipts')
const validate = require('../middleware/validate')
const schemas = require('../validation/schemas')

// SR-07: anyone can check a receipt. Verifying needs no login and reveals
// nothing about the ballot - only whether the receipt is genuine and on record.
const router = express.Router()

router.get('/public-key', (req, res) => {
  res.type('text/plain').send(getPublicKeyPem())
})

router.post('/verify', express.json({ limit: '4kb' }), validate(schemas.verifyReceipt, {
  valid: false,
  reason: 'Receipt is incomplete or malformed'
}), (req, res) => {
  res.json(verifyReceipt(req.body))
})

module.exports = router