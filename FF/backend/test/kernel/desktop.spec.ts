// Windows 데스크톱 배포본(FF_DESKTOP=1, src-tauri) — 루프백 같은 출처만 받고, 화면(FF_WEB_DIR)과 API를 한 출처로 낸다.
// 같은 PC의 다른 웹 페이지(교차 출처·DNS rebinding Host)는 403. PORT=0은 데스크톱에서만 임의 포트.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { isDesktop, portOf } from '../../src/kernel/desktop';

describe('데스크톱 — 규칙', () => {
  it('FF_DESKTOP=1일 때만 데스크톱, PORT=0은 데스크톱에서만 임의 포트', () => {
    expect(isDesktop({})).toBe(false);
    expect(isDesktop({ FF_DESKTOP: '1' })).toBe(true);
    expect(portOf({ FF_DESKTOP: '1', PORT: '0' })).toBe(0);
    expect(portOf({ PORT: '0' })).toBe(9101);
    expect(portOf({ PORT: '9131' })).toBe(9131);
  });
});

describe('데스크톱 — 부팅한 앱', () => {
  const saved = { ...process.env };
  let dir: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ff-desk-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>FF</title><div id="root"></div>');
    for (const k of ['FF_ENV', 'FF_AUTH', 'FF_CORS_ORIGINS']) delete process.env[k];
    Object.assign(process.env, { FF_DB: ':memory:', FF_SEED: 'none', FF_WEB_DIR: dir, FF_DESKTOP: '1' });
    app = await createApp({ logger: false });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('루프백 Host면 화면과 API를 함께 낸다', async () => {
    const page = await http().get('/features').set('Host', '127.0.0.1:41234').set('Accept', 'text/html');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<div id="root">');
    const health = await http().get('/api/health').set('Host', '127.0.0.1:41234');
    expect(health.status).toBe(200);
  });

  it('루프백이 아닌 Host(DNS rebinding)·다른 출처·교차 사이트 요청은 403', async () => {
    expect((await http().get('/api/health').set('Host', 'evil.example:41234')).status).toBe(403);
    expect((await http().get('/api/health').set('Host', 'localhost:41234')).status).toBe(403);
    expect((await http().get('/api/health').set('Host', '127.0.0.1:41234').set('Origin', 'http://evil.example')).status).toBe(403);
    expect((await http().get('/api/health').set('Host', '127.0.0.1:41234').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
  });

  it('같은 출처 요청은 받고 CORS 허용 헤더를 내지 않는다', async () => {
    const r = await http().get('/api/health').set('Host', '127.0.0.1:41234').set('Origin', 'http://127.0.0.1:41234');
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});
