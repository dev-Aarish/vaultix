import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestHarness } from './helpers';

const harness = useTestHarness();
const { app } = harness;

describe('request hardening', () => {
  it('returns a structured error for malformed JSON', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await request(app).get('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('does not expose server internals on validation errors', async () => {
    const response = await request(app).post('/auth/login').send({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('node_modules');
  });

  it('sets a request id header', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-request-id']).toBeTypeOf('string');
  });
});
