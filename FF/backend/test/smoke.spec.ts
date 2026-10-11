import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';

describe('백엔드 스모크 — 앱 부팅과 기존 API', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /api/catalog 가 Feature 목록을 돌려준다', async () => {
    const res = await request(app.getHttpServer()).get('/api/catalog').expect(200);
    expect(Array.isArray(res.body.features)).toBe(true);
    expect(res.body.features.length).toBeGreaterThan(0);
  });
});
