const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { requireStrictJWT, privateKey } = require('../middleware/requireStrictJWT');

const app = express();
app.use(express.json());
app.get('/api/protected-route', requireStrictJWT, (req, res) => {
  res.json({ status: 'success', user: req.user });
});

describe('SR-02: Strict RS256 JWT Cryptographic Validation', () => {
  test('Accepts valid RS256 asymmetrically signed token', async () => {
    const validToken = jwt.sign({ id: 1, role: 'DELEGATE' }, privateKey, { algorithm: 'RS256', expiresIn: '15m' });
    const res = await request(app)
      .get('/api/protected-route')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('DELEGATE');
  });

  test('Strictly rejects unauthenticated "alg: none" bypass attempt', async () => {
    // Manually building forged header with "alg": "none"
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 1, role: 'DELEGATE' })).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    const res = await request(app)
      .get('/api/protected-route')
      .set('Authorization', `Bearer ${forgedToken}`);

    expect(res.status).toBe(403);
  });

  test('Rejects request with missing Authorization header', async () => {
    const res = await request(app).get('/api/protected-route');
    expect(res.status).toBe(401);
  });
});