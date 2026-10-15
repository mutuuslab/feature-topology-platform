// 목적별 데이터 범주와 접근 분리 (D04-03·D06-09, 보고서 v1.1 13.1 · FFG-TEL-001) — 수용 기준: 범주 밖 접근 권한 0건.
// 텔레메트리 읽기 경로는 범주 역할(DATA_CATEGORY_ACCESS)로만 열리고, 거부는 감사에 DENIED로 남는다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_CATEGORY_ACCESS, routeUrl, TELEMETRY_READS } from '@ff/contracts';
import { actor, bootApp } from '../helpers';

describe('텔레메트리 범주별 접근 (FFG-TEL-001)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
  });
  afterAll(async () => b.app.close());
  const url = (route: string) => routeUrl(route, { vin: 'ego-01' }, {});

  it('FFG-TEL-001 범주 역할은 읽고, 범주 밖 역할은 403 — 보안 로그는 운영자도 못 읽는다', async () => {
    const http = b.http;
    for (const t of TELEMETRY_READS) {
      await http().get(url(t.route)).set(actor('usr-in', DATA_CATEGORY_ACCESS[t.category][0])).expect(200);
      const outsider = t.category === 'SECURITY_MONITORING' ? 'OPERATOR' : 'PRODUCT_AUTHOR';
      await http().get(url(t.route)).set(actor('usr-out', outsider)).expect(403);
    }
    await http().get('/api/security-events').set(actor('usr-csm', 'SECURITY_OFFICER')).expect(200);
    await http().get('/api/security-events').set(actor('usr-safety', 'SAFETY_OFFICER')).expect(403);
  });

  it('FFG-TEL-001 범주 밖 읽기 시도는 감사에 DENIED로 남는다', async () => {
    await b.http().get('/api/security-events').set(actor('usr-ops-peek', 'OPERATOR')).expect(403);
    const audit = (await b.http().get('/api/audit?actorId=usr-ops-peek').expect(200)).body.items;
    expect(audit.some((a: any) => a.result === 'DENIED')).toBe(true);
  });
});
