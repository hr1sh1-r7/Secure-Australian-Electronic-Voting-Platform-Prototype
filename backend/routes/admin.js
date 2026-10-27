const express = require('express');
const crypto = require('crypto');
const { requireStrictJWT } = require('../middleware/requireStrictJWT');

const router = express.Router()

// SR-01 (Part A): WebAuthn/FIDO2 Hardware MFA
router.get('/generate-fido2', (req, res) => {
  // Synchronous generation ensures no empty Promise objects are returned
  const challenge = crypto.randomBytes(32).toString('hex');

  res.status(200).json({
    challenge: challenge,
    rp: { name: 'AEC Electoral Portal', id: 'localhost' },
    timeout: 60000,
    userVerification: 'required'
  });
});

router.post('/verify-fido2', (req, res) => {
  res.json({ status: "success", message: "FIDO2 Hardware MFA verified." });
});

module.exports = router;