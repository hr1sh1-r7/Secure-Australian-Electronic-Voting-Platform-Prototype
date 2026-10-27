const request = require('supertest');
const app = require('../app');

describe('SR-01: Phishing-Resistant FIDO2 / WebAuthn MFA (Part A)', () => {

  test('GET /api/admin/generate-fido2 issues a valid cryptographic challenge', async () => {
    const res = await request(app).get('/api/admin/generate-fido2');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challenge');
    expect(typeof res.body.challenge).toBe('string');
    expect(res.body.challenge.length).toBeGreaterThanOrEqual(32);
  });

  test('Generates unique, randomized FIDO2 challenges to prevent replay attacks', async () => {
    const res1 = await request(app).get('/api/admin/generate-fido2');
    const res2 = await request(app).get('/api/admin/generate-fido2');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.challenge).not.toBe(res2.body.challenge);
  });

});