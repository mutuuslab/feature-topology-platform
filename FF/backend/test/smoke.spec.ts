import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import request from 'supertest';

describe('백엔드 스모크 — main.ts와 같은 조립으로 부팅', () => {
  it('GET /api/health', async () => {
    process.env.FF_DB = ':memory:';
    const app = await createApp({ logger: false });
    await app.init();
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    await app.close();
  });
});
