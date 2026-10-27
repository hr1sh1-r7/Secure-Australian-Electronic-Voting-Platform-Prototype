const request = require('supertest');
const app = require('../app');

describe('SR-03: Memory-Safe Paradigms & Fuzzing Gate', () => {

  test('Fuzzing Gate: Handles oversized buffer payload without crashing', async () => {
    // 1MB string to simulate an oversized buffer attack
    const largePayload = 'A'.repeat(1024 * 1024);

    const res = await request(app)
      .post('/api/health')
      .send({ data: largePayload });

    // The runtime must respond with a standard HTTP status (not crash with an unhandled error)
    expect(res.status).toBeLessThan(500);
  });

  test('Input Mutation Fuzzing: Handles null bytes and escape characters safely', async () => {
    const maliciousInputs = ['\0\0\0', '%00%0d%0a', '../../../etc/passwd'];

    for (const input of maliciousInputs) {
      const res = await request(app)
        .get('/api/health')
        .query({ search: input });

      expect(res.status).toBeLessThan(500);
    }
  });

});