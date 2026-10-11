// API 계약 드리프트 방지 — 실제 Nest 라우트 = contracts ROUTES (양방향). 컨트롤러에 경로를 추가하면 ROUTES에도 선언해야 한다.
import { INestApplication } from '@nestjs/common';
import { ROUTES, routeKey } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp } from './helpers';

function nestRoutes(app: INestApplication): string[] {
  const router = app.getHttpAdapter().getInstance()._router;
  const out: string[] = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${layer.route.path}`);
  }
  return [...new Set(out)].sort();
}

describe('API 계약 (ROUTES ↔ 실제 라우트)', () => {
  let app: INestApplication;
  beforeAll(async () => ({ app } = await bootApp()));
  afterAll(() => app.close());

  it('실제 라우트가 모두 ROUTES에 선언되어 있고, 선언된 경로가 모두 실재한다', () => {
    const actual = nestRoutes(app);
    const declared = ROUTES.map(routeKey).sort();
    expect({ undeclared: actual.filter((r) => !declared.includes(r)), missing: declared.filter((r) => !actual.includes(r)) }).toEqual({ undeclared: [], missing: [] });
  });

  it('쓰기 경로는 역할과 본문 스키마를 선언한다', () => {
    for (const r of ROUTES.filter((x) => x.method !== 'GET' && !x.public)) {
      expect(r.roles?.length, routeKey(r)).toBeGreaterThan(0);
      expect(r.body, routeKey(r)).toBeDefined();
    }
  });

  it('함수 이름이 유일하다 (프론트 API 클라이언트)', () => {
    expect(new Set(ROUTES.map((r) => r.name)).size).toBe(ROUTES.length);
  });
});
