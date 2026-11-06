// 정적 공개 사이트의 '일반 목록 거르기 읽기'(frontend/src/api/sim/list-filter.ts)가 서버와 같은 결과인지 — 실제 컨트롤러 응답과 대조.
// 배경(2026-11-06 하네스 리뷰): 정적 데모에서 필터(출처·유형·판정·검색어·변경 속성)를 고르면 질의 스냅샷이 없어 오류 상자가 떴다.
// 시연 엔진은 기본 목록 스냅샷을 이 규칙으로 거르므로, 규칙이 서버와 어긋나면 화면이 다른 결과를 보인다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyQuerySpec, baseQuery, QUERY_SPECS } from '../../../frontend/src/api/sim/list-filter';
import { bootApp } from '../helpers';

describe('시연 엔진 목록 거르기 = 서버 질의 결과', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    // 데모 활동 시드(접수된 장애·VOC 등)까지 — 부팅이 길다
    ({ app, http } = await bootApp({ at: '2026-11-06T01:00:00.000Z', demoActivity: true }));
  }, 180_000);
  afterAll(async () => {
    await app?.close();
  });

  const get = async (path: string, query: Record<string, string> = {}) => (await http().get(path).query(query).expect(200)).body;
  /** 서버가 거른 응답 = 기본 응답(필터 키를 뺀 질의)에 규칙을 적용한 것 */
  const same = async (name: string, path: string, query: Record<string, string>) => {
    const spec = QUERY_SPECS[name];
    const bq = baseQuery(spec, query);
    expect(bq, `${name} ${JSON.stringify(query)}`).not.toBeNull();
    const server = await get(path, query);
    expect(applyQuerySpec(spec, await get(path, bq!), query), `${name} ${JSON.stringify(query)}`).toEqual(server);
    return server;
  };

  it('incidents — 출처·상태·Feature 같음(접수 뒤 LINKED로 바뀐 상태 포함)', async () => {
    const all = (await get('/api/incidents')).items as { source: string; status: string; featureId: string | null }[];
    expect(all.length).toBeGreaterThan(1);
    const sources = [...new Set(all.map((i) => i.source))];
    expect(sources.length).toBeGreaterThan(1);
    let hits = 0;
    for (const source of [...sources, 'NOPE']) hits += (await same('incidents', '/api/incidents', { source })).items.length;
    expect(hits).toBe(all.length);
    for (const status of [...new Set(all.map((i) => i.status)), 'CLOSED']) await same('incidents', '/api/incidents', { status });
    const f = all.find((i) => i.featureId)?.featureId;
    if (f) await same('incidents', '/api/incidents', { featureId: f, source: sources[0] });
  });

  it('dependencies — 유형·판정 같음, Feature는 원천 또는 대상', async () => {
    const all = (await get('/api/dependencies')).items as { type: string; verdict: string; sourceFeatureId: string; targetFeatureId: string }[];
    expect(all.length).toBeGreaterThan(2);
    for (const type of [...new Set(all.map((d) => d.type)), 'CONFLICTS']) await same('dependencies', '/api/dependencies', { type });
    for (const verdict of [...new Set(all.map((d) => d.verdict))]) await same('dependencies', '/api/dependencies', { verdict });
    // 화면 질의 모양(type, verdict 순서)
    await same('dependencies', '/api/dependencies', { type: all[0].type, verdict: all[0].verdict });
    const asTarget = await same('dependencies', '/api/dependencies', { featureId: all[0].targetFeatureId });
    expect(asTarget.items.length).toBeGreaterThan(0);
    await same('dependencies', '/api/dependencies', { featureId: all[0].sourceFeatureId });
  });

  it('masterSw — 검색어는 SW ID·이름·공급사 소문자 부분 일치, ECU 같음', async () => {
    const all = (await get('/api/master/sw')).items as { swId: string; name: string; supplier: string; ecuPno: string }[];
    expect(all.length).toBeGreaterThan(2);
    const s = all[0];
    for (const q of [s.swId.slice(0, 5), s.swId.toLowerCase(), s.name.slice(1, 4).toUpperCase(), s.supplier.slice(0, 3), `${s.swId} ${s.name}`, 'zz-없음']) await same('masterSw', '/api/master/sw', { q });
    await same('masterSw', '/api/master/sw', { ecuPno: s.ecuPno, q: s.supplier.slice(0, 2) });
  });

  it('impact — 변경 속성(쉼표)은 재판정 Gate·요약 건수만 바꾼다', async () => {
    const f = (await get('/api/features', { latestOnly: 'true' })).items as { featureId: string; version: string }[];
    expect(f.length).toBeGreaterThan(0);
    for (const { featureId, version } of f.slice(0, 4)) {
      const path = `/api/impact/${featureId}/${version}`;
      for (const changed of ['controlPoints', 'swIds,controlPoints', 'name', 'asil,trim,country']) await same('impact', path, { changed });
    }
  });

  it('rollbacks — 상태·결과·배포·Feature 같음, 대상 유형·VIN은 배열 포함(/ops/rollback 상태 필터)', async () => {
    const all = (await get('/api/rollbacks')).items as { status: string; result: string | null; deploymentId: string; featureId: string; targetTypes: string[]; vins: string[] }[];
    expect(all.length).toBeGreaterThan(0);
    for (const status of ['REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED']) await same('rollbacks', '/api/rollbacks', { status });
    for (const result of ['SUCCESS', 'FAILURE']) await same('rollbacks', '/api/rollbacks', { result });
    const x = all[0];
    expect((await same('rollbacks', '/api/rollbacks', { deploymentId: x.deploymentId, status: x.status })).items.length).toBeGreaterThan(0);
    await same('rollbacks', '/api/rollbacks', { featureId: x.featureId });
    await same('rollbacks', '/api/rollbacks', { targetType: x.targetTypes[0] });
    if (x.vins.length) expect((await same('rollbacks', '/api/rollbacks', { vin: x.vins[0] })).items.length).toBeGreaterThan(0);
  });
});
