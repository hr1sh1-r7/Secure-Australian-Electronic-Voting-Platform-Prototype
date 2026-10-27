const request = require('supertest');
const app = require('../app');

describe('SR-04: CIS Benchmark Configuration Hardening', () => {
  test('Enforces Content Security Policy and disables server fingerprinting', async () => {
    const res = await request(app).get('/api/health');

    // Asserts CIS hardening response headers
    expect(res.headers).toHaveProperty('content-security-policy');
    expect(res.headers).toHaveProperty('x-frame-options');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});