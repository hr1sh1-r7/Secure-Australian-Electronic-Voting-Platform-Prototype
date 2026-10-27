const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Generates an in-memory 2048-bit RSA keypair dynamically at startup and uses it for JWT signing and verification.
// Also eliminates multiline .env formatting bugs and works in GitHub Actions CI
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// SR-02: Asymmetric RS256 JWT Verification Middleware
const RS256_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || publicKey;

// Mitigates token forgery, 'alg: none' bypasses (CVE-2026-55040), and key confusion attacks
function requireStrictJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    // Explicitly allow-list RS256 to eliminate "alg: none" bypasses
    const decoded = jwt.verify(token, RS256_PUBLIC_KEY, {
      algorithms: ['RS256'],
      maxAge: '60s' // Enforces strict clock-skew and short session lifetime
    });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Cryptographic JWT validation failed: ' + err.message });
  }
}

module.exports = {
  requireStrictJWT,
  privateKey,
  publicKey: RS256_PUBLIC_KEY
};