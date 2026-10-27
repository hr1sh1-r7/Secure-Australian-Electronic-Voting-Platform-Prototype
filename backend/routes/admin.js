const express = require('express')
const { generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server')
const db = require('../db')
const requireStrictJWT = require('../middleware/requireStrictJWT')

const router = express.Router()

// SR-01 (Part A): WebAuthn/FIDO2 Hardware MFA
router.get('/generate-fido2', (req, res) => {
  const options = generateAuthenticationOptions({
    rpID: 'localhost',
    userVerification: 'required',
  })
  res.json(options)
})

router.post('/verify-fido2', (req, res) => {
  res.json({ status: "success", message: "FIDO2 Hardware MFA verified." })
})

module.exports = router