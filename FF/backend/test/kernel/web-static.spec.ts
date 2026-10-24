// 화면 같은 출처 제공(FF_WEB_DIR) — 단독 설치 이미지가 백엔드 하나로 화면·API를 함께 낸다(출시 준비 RD-OPS-05).
// 화면 응답은 빌드의 _headers(CSP) · API 응답은 API용 CSP, 새로 고침한 화면 주소는 index.html, 없는 자산·배포 메타 파일은 404.
// readiness: RD-OPS-05
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { deployHeadersOf, isApiPath, webDirOf } from '../../src/kernel/web-static';

const HEADERS = `# 주석
/*
  Content-Security-Policy: default-src 'self'; frame-ancestors 'none'
  X-Frame-Options: DENY

/models/*
  Cache-Control: public, max-age=600
`;

describe('화면 제공 — 규칙', () => {
  it("_headers의 '/*' 묶음만 읽는다", () => {
    expect(deployHeadersOf(HEADERS)).toEqual({ 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
  });
  it('API 경로는 화면으로 바꾸지 않는다', () => {
    for (const p of ['/api', '/api/health', '/ofrep/v1/evaluate/flags', '/vehicle/v1/VIN/x']) expect(isApiPath(p)).toBe(true);
    for (const p of ['/', '/features', '/apis', '/vehicles', '/assets/a.js']) expect(isApiPath(p)).toBe(false);
  });
  it('FF_WEB_DIR가 없으면 꺼짐, index.html 없는 폴더면 부팅을 멈춘다', () => {
    expect(webDirOf({})).toBeNull();
    expect(() => webDirOf({ FF_WEB_DIR: tmpdir() + '/ff-no-such-web-dir' })).toThrow(/index\.html/);
  });
});

describe('화면 제공 — 부팅한 앱', () => {
  const saved = { ...process.env };
  let dir: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ff-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>FF</title><div id="root"></div>');
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(dir, 'robots.txt'), 'User-agent: *');
    writeFileSync(join(dir, '_headers'), HEADERS);
    writeFileSync(join(dir, '_redirects'), '/*  /index.html  200');
    for (const k of ['FF_ENV', 'FF_AUTH']) delete process.env[k];
    Object.assign(process.env, { FF_DB: ':memory:', FF_SEED: 'none', FF_WEB_DIR: dir });
    app = await createApp({ logger: false });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('첫 화면 — index.html, 빌드의 CSP, 캐시 금지', async () => {
    const r = await http().get('/').expect(200);
    expect(r.text).toContain('<div id="root">');
    expect(r.headers['content-security-policy']).toBe("default-src 'self'; frame-ancestors 'none'");
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('화면 주소를 새로 고쳐도 index.html(SPA)', async () => {
    const r = await http().get('/features/FEAT-00001/1.0.0').set('Accept', 'text/html').expect(200);
    expect(r.text).toContain('<div id="root">');
  });

  it('해시 붙은 자산은 오래 캐시, 그 밖의 정적 파일도 낸다', async () => {
    const js = await http().get('/assets/index-abc123.js').expect(200);
    expect(js.headers['cache-control']).toContain('immutable');
    await http().get('/robots.txt').expect(200);
  });

  it('없는 자산·배포 메타 파일은 404 — 화면으로 덮지 않는다', async () => {
    await http().get('/assets/missing-000.js').expect(404);
    await http().get('/_headers').expect(404);
    await http().get('/_redirects').expect(404);
  });

  it('API는 그대로 — API용 CSP, 없는 API 경로는 화면이 아니라 404 봉투', async () => {
    const h = await http().get('/api/health/live').expect(200);
    expect(h.body.status).toBe('ok');
    expect(h.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    const miss = await http().get('/api/no-such-route');
    expect(miss.status).toBe(404);
    expect(miss.text).not.toContain('<div id="root">');
  });
});
