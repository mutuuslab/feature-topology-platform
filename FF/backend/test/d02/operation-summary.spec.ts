// 홈 수신 현황 요약 (D02-03, GET /api/fleet/operation-summary) — 홈이 차량·회신·게시본 전체 목록을 받지 않게 서버가 센다.
// 숫자는 같은 역할로 전체 목록을 받아 화면에서 센 값과 같아야 하고, 회신은 운영 데이터 범주를 읽는 역할일 때만 들어간다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { INestApplication } from '@nestjs/common';
import { buildOperationModel, OPERATION_PAGE, operationAdoption } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';

const OPERATOR = actor('seo.ops', 'OPERATOR');
const PRODUCT = actor('kim.product', 'PRODUCT_AUTHOR');

describe('홈 수신 현황 요약 (D02-03)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ demoActivity: true })));
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });

  const list = async (url: string, who = OPERATOR) => (await http().get(url).set(who).expect(200)).body.items;

  it('전체 목록으로 센 화면 값과 같다 — 건수·묶음·준비 점검, 표는 첫 쪽만', async () => {
    const s = (await http().get('/api/fleet/operation-summary').set(OPERATOR).expect(200)).body;
    const input = { runtime: await list('/api/fleet/runtime'), vehicles: await list('/api/vehicles'), policies: await list('/api/policies'), features: await list('/api/features'), publications: await list('/api/publications'), readbacks: await list('/api/telemetry/readbacks'), syncs: await list('/api/integrations/calls?ifId=IF-04') };
    const model = buildOperationModel(input, { country: '', model: '', flag: '' });
    expect(s.readbacks).toBe(true);
    expect(s.total).toBeGreaterThan(0);
    expect({ total: s.total, received: s.received, unknown: s.unknown, deployed: s.deployed, approvals: s.approvals, rejected: s.rejected }).toEqual({ total: model.rows.length, received: model.received, unknown: model.unknown, deployed: model.deployed, approvals: model.approvals, rejected: model.rejected });
    expect(s.countryGroups).toEqual(model.countryGroups);
    expect(s.modelGroups).toEqual(model.modelGroups);
    expect(s.preparationIssues).toEqual(model.preparationIssues.map(({ publicationId, policyId, revision, reason }) => ({ publicationId, policyId, revision, reason })));
    expect(s.rows.map((r: { runtime: { vin: string } }) => r.runtime.vin)).toEqual(model.rows.slice(0, OPERATION_PAGE).map((r) => r.runtime.vin));
    expect(s.points.reduce((n: number, p: { count: number }) => n + p.count, 0)).toBe(model.events.length);
  });

  it('운영 데이터 범주 밖 역할 — 회신 칸은 비우고 차량 건수는 그대로', async () => {
    await http().get('/api/telemetry/readbacks').set(PRODUCT).expect(403);
    const s = (await http().get('/api/fleet/operation-summary').set(PRODUCT).expect(200)).body;
    expect(s.readbacks).toBe(false);
    expect(s.rejected).toBe(0);
    expect(s.rows.every((r: { readback?: unknown }) => r.readback === undefined)).toBe(true);
    expect(s.points.some((p: { phase: string }) => p.phase === 'READBACK')).toBe(false);
    expect(s.total).toBe((await list('/api/fleet/runtime')).length);
  });

  // 'Feature 적용 현황'(2026-11-06) — 깔때기·상태 수는 전체 목록으로 같은 함수(operationAdoption)를 돌린 값과 같다. 평가 단계는 수집기 span을 차량으로 되짚는다
  it('Feature 적용 현황 — 깔때기·상태는 전체 목록으로 센 값과 같고, 회신을 못 읽는 역할은 수신 단계가 비어 있다', async () => {
    const s = (await http().get('/api/fleet/operation-summary').set(OPERATOR).expect(200)).body;
    expect(s.adoption.evaluations).toBe(true);
    expect(s.adoption.vins).toHaveLength(s.total);
    const input = { runtime: await list('/api/fleet/runtime'), vehicles: await list('/api/vehicles'), policies: await list('/api/policies'), features: await list('/api/features'), publications: await list('/api/publications'), readbacks: await list('/api/telemetry/readbacks'), syncs: [] };
    const model = operationAdoption(input, true);
    expect(s.adoption.flags.map((f: { flagKey: string }) => f.flagKey)).toEqual(model.flags.map((f) => f.flagKey));
    // 회귀(2026-11-06): 기본 시드에 Flag 평가 기록이 없어 실제 사용 단계(USED)가 비었고, 시연 주인공(차단 중)이 목록에 없었다 —
    // 데모 시드가 차량 앱 OFREP 평가 기록을 남기고, 주인공은 수동 시계에서도 시드된다
    // 수동 시계라 차단 명령이 차량에 닿기 전 — 차단 표시는 차량 반영 뒤라서 지금은 단계 배포(Canary 5%)로 고른다
    expect(['KILL', 'CANARY']).toContain(s.adoption.flags.find((f: { flagKey: string }) => f.flagKey === 'adas_00004_assist')?.why);
    for (const f of s.adoption.flags as { flagKey: string; funnel: { USED: number | null } }[]) expect(typeof f.funnel.USED, f.flagKey).toBe('number');
    for (const [i, f] of model.flags.entries()) {
      expect(s.adoption.flags[i].states).toEqual(f.states);
      expect({ ...s.adoption.flags[i].funnel, USED: null }).toEqual({ ...f.funnel, USED: null });
      expect(s.adoption.flags[i].funnel.USED).toBeLessThanOrEqual(f.funnel.APPLIED!);
    }
    const product = (await http().get('/api/fleet/operation-summary').set(PRODUCT).expect(200)).body;
    expect(product.adoption.flags.every((f: { funnel: { RECEIVED: number | null } }) => f.funnel.RECEIVED === null)).toBe(true);
  });
});
