// 정적 공개 사이트의 체험권 차량 목록 성향 필터·검색·다음 쪽(frontend/src/api/sim/trial-list.ts)이 서버와 같은 결과인지 — 실제 컨트롤러 응답과 대조.
// 배경(2026-11-06): 정적 스냅샷은 상품·출처·상태별 첫 쪽(50건)만 받아 두어, 상품 권리 화면의 성향 필터·검색·다음 쪽을 막아 두었다.
// 시연 엔진은 전체 표(출처 ALL, 200건씩 모든 쪽 — tools/snapshot-api.ts)를 이 규칙으로 계산하므로, 규칙이 서버와 어긋나면 화면이 다른 결과를 보인다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEGMENT_DIMENSIONS, TRIAL_TABLE_PAGE, trialListQuery, trialTableQuery } from '@ff/contracts';
import { trialListOf, type TrialRow } from '../../../frontend/src/api/sim/trial-list';
import { bootApp } from '../helpers';

describe('시연 엔진 체험 목록 = 서버 질의 결과', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-11-06T01:00:00.000Z' }));
  }, 180_000);
  afterAll(async () => {
    await app?.close();
  });

  const get = async (query: Record<string, unknown>) => (await http().get('/api/trials').query(query).expect(200)).body;
  const str = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));

  it('성향·검색어·쪽 — 전체 표에 같은 규칙을 적용하면 서버 응답과 같다', async () => {
    const CAT = 'CAT-00019';
    const first = await get(trialTableQuery(CAT, 1));
    expect(first.pageSize).toBe(TRIAL_TABLE_PAGE);
    const rows: TrialRow[] = [...first.items];
    for (let page = 2; (page - 1) * TRIAL_TABLE_PAGE < first.total; page++) rows.push(...(await get(trialTableQuery(CAT, page))).items);
    expect(rows).toHaveLength(first.total);
    // 시험이 서로 다른 값을 고르도록 실제 성향 값에서 고른다
    const withProfile = rows.filter((r) => r.profile);
    expect(withProfile.length).toBeGreaterThan(TRIAL_TABLE_PAGE);
    const valueOf = (d: (typeof SEGMENT_DIMENSIONS)[number], i = 0) => [...new Set(withProfile.map((r) => r.profile![d]).filter(Boolean))].sort()[i]!;
    const fleetVin = rows.find((r) => r.source !== 'SYNTHETIC')!.vin;
    const cases: Record<string, unknown>[] = [];
    for (const source of ['ALL', 'FLEET', 'SYNTHETIC'] as const) {
      for (const d of SEGMENT_DIMENSIONS) cases.push(trialListQuery({ catalogId: CAT, source, segment: { [d]: valueOf(d) } }));
      cases.push(trialListQuery({ catalogId: CAT, source, q: fleetVin.slice(0, 6).toLowerCase() }));
      cases.push(trialListQuery({ catalogId: CAT, source, page: 2 }));
      cases.push(trialListQuery({ catalogId: CAT, source, state: 'EXPIRED', page: 3 }));
      cases.push(trialListQuery({ catalogId: CAT, source, state: 'ACTIVE', segment: { country: valueOf('country'), ageBand: valueOf('ageBand', 1) }, q: 'ent' }));
    }
    cases.push(trialListQuery({ catalogId: CAT, source: 'ALL', q: '없는-차량' }));
    cases.push(trialListQuery({ catalogId: CAT, source: 'ALL', page: 999 }));
    let hits = 0;
    for (const q of cases) {
      const server = await get(q);
      expect(trialListOf(rows, first.today, str(q)), JSON.stringify(q)).toEqual(server);
      hits += server.items.length;
    }
    // 빈 결과만 대조한 것이 아니다
    expect(hits).toBeGreaterThan(cases.length * 5);
  }, 120_000);
});
