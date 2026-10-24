// 질의 계획 회귀 시험(출시 준비 RD-P2-01) — 부하 시험(tools/load)에서 찾은 전체 훑기·N+1을 시간과 무관하게 막는다.
// 주요 API를 부르며 실행된 SELECT를 모아 EXPLAIN QUERY PLAN으로 확인한다: 큰 표(감사·이벤트·차량·알림…)를 LIMIT 없이 통째로 훑으면 실패.
// 데이터 크기와 무관한 판정이라 기본 verify(CI)에서 기계 속도 잡음 없이 돈다. 전후 수치는 docs/20-architecture/20-92-performance.md.
// readiness: RD-P2-01
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vehiclePseudonym } from '../../src/kernel/crypto';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

/** 운영 중 계속 커지는 표 — 요청마다 통째로 읽으면 안 된다 */
const BIG = ['audit', 'events', 'vehicle', 'notification', 'notification_recipient', 'status_report', 'vehicle_delivery', 'vehicle_request', 'readback', 'entitlement', 'gate_record'];
/** 알고 남긴 전체 훑기 — 이유가 있어야 한다(목록 화면의 '전체' 응답 등은 시험 대상 요청에 넣지 않는다) */
const ALLOWED: { sql: RegExp; why: string }[] = [
  { sql: /^SELECT vin FROM vehicle$/, why: '가명 → VIN 표를 차량이 늘 때 한 번 만든다(FleetRepo.vinByPseudonym 캐시)' },
  { sql: /^SELECT count\(\*\) AS n FROM vehicle$/, why: '차량 수 — 문서를 읽지 않는 색인 개수 세기' },
  { sql: /^SELECT feature_id, feature_version, gate, status FROM gate_record ORDER BY/, why: 'Gate 상태 전체 표 — 문서 없이 네 열만, 쓰기 때까지 캐시(GateRepo.latestStatuses)' },
];

type Call = { sql: string; params: unknown[] };

// SQLite 플래너(EXPLAIN QUERY PLAN) 판정 — PG 실행(npm run test:pg)에서는 건너뛴다. PG의 질의 계획은 20-92 2단계(부하 시험)에서 본다
describe.skipIf(!!process.env.FF_TEST_PG_URL)('질의 계획 — 주요 API가 큰 표를 통째로 훑지 않는다', () => {
  let app: Awaited<ReturnType<typeof bootApp>>;
  let db: Db;
  let calls: Call[] = [];
  beforeAll(async () => {
    process.env.FF_SCHEDULER = 'manual';
    app = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
    db = app.get<Db>(DB);
    for (const m of ['all', 'get'] as const) {
      const orig = db[m].bind(db) as (sql: string, ...p: unknown[]) => unknown;
      (db as unknown as Record<string, unknown>)[m] = (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params });
        return orig(sql, ...params);
      };
    }
  });
  afterAll(async () => {
    await app.app.close();
    delete process.env.FF_SCHEDULER;
  });

  /** 요청 하나가 실행한 SELECT 중 큰 표를 LIMIT 없이 훑는 것 */
  async function scansOf(run: () => Promise<unknown>): Promise<{ scans: string[]; calls: Call[] }> {
    calls = [];
    await run();
    const mine = calls;
    calls = [];
    const scans: string[] = [];
    const seen = new Set<string>();
    for (const c of mine) {
      const sql = c.sql.replace(/\s+/g, ' ').trim();
      if (!/^SELECT/i.test(sql) || seen.has(sql)) continue;
      seen.add(sql);
      if (ALLOWED.some((a) => a.sql.test(sql))) continue;
      const plan = (db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${c.sql}`, ...(c.params as never[])) as { detail: string }[]).map((r) => r.detail);
      for (const d of plan) {
        const m = /^SCAN (\w+)(?: AS (\w+))?/.exec(d);
        if (!m) continue;
        // 별칭(n, e…)이면 FROM 절에서 표 이름을 찾는다
        const name = m[1];
        const table = BIG.includes(name) ? name : (new RegExp(`(\\w+) (?:AS )?${name}\\b`).exec(sql.replace(/^.*?FROM /i, ''))?.[1] ?? name);
        if (!BIG.includes(table)) continue;
        if (/\bLIMIT\b/i.test(sql)) continue; // 정렬된 색인으로 앞 몇 건만 읽는다
        scans.push(`${table}: ${d} ⟵ ${sql.slice(0, 160)}`);
      }
    }
    return { scans, calls: mine };
  }

  const OPS = actor('usr-ops', 'OPERATOR');
  const cases: [string, () => Promise<unknown>][] = [
    ['Feature 목록 한 페이지', () => app.http().get('/api/features?limit=20').expect(200)],
    ['Feature 최신 버전 전체(대시보드)', () => app.http().get('/api/features?latestOnly=true').expect(200)],
    ['컴포넌트 최근 활동', () => app.http().get('/api/components/activity?minutes=60').expect(200)],
    ['내 알림', () => app.http().get('/api/notifications?limit=100').set(OPS).expect(200)],
    ['대시보드 차량 수', () => app.http().get('/api/vehicles?limit=1').expect(200)],
    ['차량 목록 한 페이지', () => app.http().get('/api/vehicles?limit=5').expect(200)],
    ['긴급 차단 영향 범위(차량 지정)', () => app.http().get('/api/kill-requests/preview?featureId=FEAT-00022&featureVersion=1.0.0&vins=ego-01').expect(200)],
    ['긴급 차단 영향 범위(범위 전체)', () => app.http().get('/api/kill-requests/preview?featureId=FEAT-00022&featureVersion=1.0.0').expect(200)],
    ['OFREP 전체 평가(가명)', () => app.http().post('/ofrep/v1/evaluate/flags').send({ context: { targetingKey: vehiclePseudonym('ego-01') } }).expect(200)],
    ['감사 커서 페이지', () => app.http().get('/api/audit?limit=100').expect(200)],
    ['이벤트 커서 페이지', () => app.http().get('/api/events?after=0&limit=200').expect(200)],
  ];
  for (const [name, run] of cases) {
    it(name, async () => {
      const { scans } = await scansOf(run);
      expect(scans).toEqual([]);
    });
  }

  it('Feature 목록 — Gate 상태를 버전마다 묻지 않는다(N+1 없음)', async () => {
    const { calls: page } = await scansOf(() => app.http().get('/api/features?limit=20').expect(200));
    expect(page.filter((c) => /FROM gate_record/.test(c.sql)).length).toBeLessThanOrEqual(1);
    const { calls: all } = await scansOf(() => app.http().get('/api/features').expect(200));
    expect(all.filter((c) => /FROM gate_record/.test(c.sql)).length).toBeLessThanOrEqual(1);
  });

  it('Feature 목록 — 한 번에 읽은 Gate 상태가 버전별 상세의 최신 Gate 판정과 같다', async () => {
    const list = (await app.http().get('/api/features?limit=500').expect(200)).body.items as { featureId: string; version: string; gates: Record<string, string> }[];
    for (const f of list.slice(0, 15)) {
      const d = (await app.http().get(`/api/features/${f.featureId}/versions/${f.version}`).expect(200)).body;
      const want = Object.fromEntries(Object.entries(d.gates as Record<string, { status: string }>).map(([g, r]) => [g, r.status]));
      expect(f.gates).toEqual(want);
    }
  });

  it('긴급 차단 요청 — 대상 차량의 시장을 차량마다 전체 목록에서 찾지 않는다', async () => {
    const { calls: issued } = await scansOf(() =>
      app
        .http()
        .post('/api/kill-requests')
        .set(OPS)
        .send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['KMH-NX4-0003'], reason: '질의 계획 시험', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' })
        .expect(201),
    );
    expect(issued.filter((c) => /^SELECT doc FROM vehicle ORDER BY vin$/.test(c.sql.trim()))).toEqual([]);
  });
});
