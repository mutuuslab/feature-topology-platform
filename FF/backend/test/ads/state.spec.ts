// ADS 상태 읽기 모델 — 6축(활성 적격·실제 실행은 차량 보고값만, 기준 시간 초과 미확인)·수렴 7구간(배타, 합 = 대상)·행위별 판정·고객 상태·주문 추적
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp } from '../helpers';
import { DB, type Db } from '../../src/kernel/db';
import { DemoActivitySeeder } from '../../src/demo-activity/demo-activity.seeder';
import { AdsStateService } from '../../src/domains/d02-runtime/vehicle-runtime/ads-state.service';

const AT = '2026-11-06T03:00:00.000Z';
const NOW = Date.parse(AT);
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe('ADS 상태 — 데모 시드 위 읽기 API', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    ctx = await bootApp({ at: AT });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('6축 — 기준 시간을 넘긴 ADS 차량의 활성 적격·실제 실행은 현재 값이 없고(미확인) 과거 값만, 허용으로 보이지 않는다', async () => {
    const r = (await ctx.http().get('/api/vehicles/KMH-GN7-0001/feature-state').expect(200)).body;
    const f = r.features.find((x: { featureId: string }) => x.featureId === 'FEAT-00004');
    expect(f).toMatchObject({ featureClass: 'ADS', freshness: { state: 'DELAYED', staleAfterMs: 15 * 60_000, assumed: true } });
    expect(f.eligibility).toMatchObject({ current: null, past: 'ALLOW' });
    expect(f.runtime).toMatchObject({ current: null, past: 'ACTIVE', ddtOwner: 'ADS' });
    // 결제 직후·주문 권리 — 상품 권리 = 구매(결제 상태 PAID를 쓰지 않는다), 실제 실행은 미확인
    expect(f.entitlement.value).toBe('PURCHASED');
    expect(r.unconfirmed).toBe(1);
  });

  it('6축 — 관측 신선도 경계: 오프라인·보고 이력 없음, 승인 조합 불일치는 부분 실패(호환 아님)', async () => {
    const off = (await ctx.http().get('/api/vehicles/KMH-NX4-0003/feature-state').expect(200)).body.features.find((x: { featureId: string }) => x.featureId === 'FEAT-00022');
    expect(off.freshness.state).toBe('OFFLINE');
    expect(off.runtime.current).toBeNull();
    const none = (await ctx.http().get('/api/vehicles/KMH-NX4-0002/feature-state').expect(200)).body.features.find((x: { featureId: string }) => x.featureId === 'FEAT-00022');
    expect(none.freshness).toMatchObject({ state: 'UNOBSERVED', observedAt: null });
    const old = (await ctx.http().get('/api/vehicles/KMH-NX4-0004/feature-state').expect(200)).body.features.find((x: { featureId: string }) => x.featureId === 'FEAT-00022');
    expect(old.install.value).toBe('PARTIAL_FAILURE');
    const ego = (await ctx.http().get('/api/vehicles/ego-01/feature-state').expect(200)).body.features.find((x: { featureId: string }) => x.featureId === 'FEAT-00022');
    expect(ego).toMatchObject({ freshness: { state: 'FRESH' }, eligibility: { current: 'ODD_OUT' }, runtime: { current: 'AVAILABLE' } });
    const lead = (await ctx.http().get('/api/vehicles/lead-01/feature-state').expect(200)).body.features[0];
    expect(lead.freshness.reconnect).toMatchObject({ gapMs: 180 * 60_000 });
    await ctx.http().get('/api/vehicles/NO-SUCH-VIN/feature-state').expect(404);
  });

  it('행위별 판정 — 차량 보고값, 판정 보고가 기준 시간을 넘긴 행은 미확인(stale), 판단 불가는 허용으로 세지 않는다', async () => {
    const ego = (await ctx.http().get('/api/vehicles/ego-01/verdicts').expect(200)).body;
    const act = ego.items.find((x: { action: string }) => x.action === 'ACTIVATE');
    expect(act).toMatchObject({ verdict: 'DENY', reasonCodes: ['ODD_OUT'], stale: false, simulated: true });
    expect(ego.items.find((x: { action: string }) => x.action === 'REACTIVATE')).toMatchObject({ verdict: 'UNKNOWN', reasonCodes: ['INPUT_INVALID_OR_STALE'] });
    expect(ego.combos).toEqual([{ featureId: 'FEAT-00022', text: '체험 중 · 현재 운행 조건에서 사용 불가' }]);
    const gn7 = (await ctx.http().get('/api/vehicles/KMH-GN7-0001/verdicts').expect(200)).body;
    expect(gn7.items.map((x: { action: string }) => x.action)).toEqual(['ACTIVATE', 'HANDOVER', 'INSTALL', 'MRC', 'TERMINATE_CONFIRM', 'REACTIVATE']);
    expect(gn7.items.every((x: { stale: boolean }) => x.stale)).toBe(true);
    expect(gn7.combos[0].text).toBe('구매됨 · 현재 활성화 미확인');
    const lead = (await ctx.http().get('/api/vehicles/lead-01/verdicts').expect(200)).body;
    expect(lead.combos[0].text).toBe('복구 검증 완료 · 종료 차단 해제 · 현재 활성화 불가');
  });

  it('판정 보고가 없는 범위 안 Feature는 빈 목록이 아니라 판정 미확인으로 따로 — 허용으로 세지 않는다', async () => {
    const r = (await ctx.http().get('/api/vehicles/KMH-NX4-0002/verdicts').expect(200)).body;
    expect(r.items).toEqual([]);
    expect(r.unreported).toEqual(expect.arrayContaining([expect.objectContaining({ featureId: 'FEAT-00022' })]));
    const ego = (await ctx.http().get('/api/vehicles/ego-01/verdicts').expect(200)).body;
    expect(ego.unreported.map((x: { featureId: string }) => x.featureId)).not.toContain('FEAT-00022');
  });

  it('Fleet 축별 분포 — 기본은 ADS Feature 중 실제 실행 미확인 최다, 축마다 합 = 모집단, 미확인은 따로', async () => {
    const r = (await ctx.http().get('/api/fleet/axis-distribution').expect(200)).body;
    expect(r.defaultFeatureId).toBe('FEAT-00004');
    expect(r.selected).toMatchObject({ featureId: 'FEAT-00004', total: 1, unconfirmedRuntime: 1 });
    const s = (await ctx.http().get('/api/fleet/axis-distribution').query({ featureId: 'FEAT-00022' }).expect(200)).body.selected;
    expect(s.total).toBe(6);
    for (const axis of Object.values(s.axes) as Record<string, number>[]) expect(Object.values(axis).reduce((a, b) => a + b, 0)).toBe(6);
    expect(s.axes.RUNTIME.UNCONFIRMED).toBe(3);
    expect(s.reasons.reduce((a: number, x: { count: number }) => a + x.count, 0)).toBe(6);
    expect(s.reasons.find((x: { code: string | null }) => x.code === 'ODD_OUT')).toMatchObject({ verdict: 'DENY', count: 1 });
    await ctx.http().get('/api/fleet/axis-distribution').query({ featureId: 'FEAT-99999' }).expect(404);
  });

  it('고객에게 보이는 상태 — 오프라인이면 한 줄, 기준 시간 초과도 단정하지 않는다, 뒤 단계 필드는 null', async () => {
    const off = (await ctx.http().get('/api/vehicles/KMH-NX4-0003/customer-state').expect(200)).body.features.find((x: { featureId: string }) => x.featureId === 'FEAT-00022');
    expect(off.unconfirmedLine).toMatch(/^오프라인 — 마지막 확인 \d\d-\d\d \d\d:\d\d, 현재 상태 미확인$/);
    const gn7 = (await ctx.http().get('/api/vehicles/KMH-GN7-0001/customer-state').expect(200)).body.features[0];
    expect(gn7.unconfirmedLine).toMatch(/^마지막 확인 .+, 현재 상태 미확인$/);
    expect(gn7).toMatchObject({ entitlement: null, marketChange: null, ownershipTransfer: null });
    const ego = (await ctx.http().get('/api/vehicles/ego-01/customer-state').expect(200)).body.features[0];
    expect(ego.unconfirmedLine).toBeNull();
    expect(ego.answers.canUse.text).toBe('체험 중 · 현재 운행 조건에서 사용 불가');
    expect(ego.notifyBasis).toMatch(/^사용 가능 알림 근거: 차량 준비 확인 /);
  });

  it('주문 추적 — 배타 6구간 합 = 주문 수, 기한 넘긴 사용 준비 미확인 = 미확인·오프라인·부분 실패 중 기한 초과', async () => {
    const r = (await ctx.http().get('/api/orders').expect(200)).body;
    expect(r.total).toBe(12);
    expect(Object.values(r.counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(12);
    expect(r.counts).toEqual({ READY: 3, UNCONFIRMED: 4, OFFLINE: 2, PARTIAL: 1, CANCELLED: 1, REFUNDED: 1 });
    expect(r.overdueUnready).toBe(4);
    expect(r).toMatchObject({ deadlineMs: 24 * 3600_000, assumed: true, simulated: true });
    // 결제 직후 차량 보고 없음 → 주문 성공 · 활성 미확인, 주문 전 보고는 준비로 세지 않음
    expect(r.items.find((x: { orderId: string }) => x.orderId === 'ORDER-0003')).toMatchObject({ bin: 'UNCONFIRMED', justPaid: true, overdue: false });
    expect(r.items.find((x: { orderId: string }) => x.orderId === 'ORDER-0005')).toMatchObject({ bin: 'UNCONFIRMED', preOrderReport: true, overdue: true });
    // 정책 ACK가 수신(RECEIVED)만인 오프라인 차량은 사용 준비 확인이 아니다
    expect(r.items.find((x: { orderId: string }) => x.orderId === 'ORDER-0004')).toMatchObject({ bin: 'OFFLINE', conditions: { policyApplied: 'UNCONFIRMED' } });
    const only = (await ctx.http().get('/api/orders').query({ status: 'OFFLINE' }).expect(200)).body;
    expect(only.items.map((x: { orderId: string }) => x.orderId)).toEqual(['ORDER-0004', 'ORDER-0008']);
    expect(only.total).toBe(12);
    await ctx.http().get('/api/orders').query({ status: 'DONE' }).expect(400);
    const tl = (await ctx.http().get('/api/orders/ORDER-0005/timeline').expect(200)).body;
    expect(tl.events[0]).toMatchObject({ kind: 'READY_REPORT', preOrder: true, warn: true });
    await ctx.http().get('/api/orders/ORDER-9999/timeline').expect(404);
  });

  it('수렴 7구간 — 배타, 합 = 대상. 수신만 됨은 기준 시간 안, DEFERRED는 전달 보류 한 구간에만, 기준 시간 넘긴 DEFERRED·수신은 미확인', async () => {
    const db = ctx.get<Db>(DB);
    const targets = ['ego-01', 'lead-01', 'KMH-NX4-0001', 'KMH-NX4-0002', 'KMH-NX4-0003', 'KMH-NX4-0004', 'KMH-NX4-0101', 'KMH-NE-0001'];
    const pub = { publicationId: 'PUB-09001', kind: 'POLICY', status: 'DISPATCHED', createdAt: ago(60), nodes: targets.map((v) => ({ nodeId: v, state: 'UNKNOWN', reason: 'NO_REPORT' })), payload: { featureId: 'FEAT-00022', featureVersion: '1.0.0', flagKey: 'care_00022_signal', targets } };
    db.run('INSERT INTO publication (publication_id, kind, status, scope_key, sequence, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', pub.publicationId, pub.kind, pub.status, 'flag:test', 99, pub.createdAt, JSON.stringify(pub));
    const ack = (vin: string, stage: string, min: number, reason: string | null = null) => db.run("INSERT INTO delivery_ack (subject_kind, subject_id, vin, stage, reason_code, observed_at, received_at, source) VALUES ('POLICY', 'PUB-09001', ?, ?, ?, ?, ?, 'VEHICLE')", vin, stage, reason, ago(min), ago(min));
    ack('ego-01', 'RECEIVED', 50);
    ack('ego-01', 'APPLIED', 45);
    ack('lead-01', 'ACCEPTED', 5);
    ack('KMH-NX4-0001', 'RECEIVED', 6);
    ack('KMH-NX4-0001', 'DEFERRED', 5, 'DDT_ACTIVE');
    ack('KMH-NX4-0002', 'RECEIVED', 5);
    ack('KMH-NX4-0003', 'REJECTED', 5, 'SIGNATURE_INVALID');
    ack('KMH-NX4-0004', 'RECEIVED', 50); // 수신 뒤 기준 시간(30분) 넘김 → 미확인
    ack('KMH-NX4-0101', 'DEFERRED', 45, 'DDT_ACTIVE'); // 기준 시간 넘긴 전달 보류 → 미확인
    const r = (await ctx.http().get('/api/publications/PUB-09001/convergence').expect(200)).body;
    expect(r.bins).toEqual({ APPLIED: 1, ACCEPTED: 1, DEFERRED: 1, RECEIVED_ONLY: 1, NOT_RECEIVED: 1, REJECTED: 1, UNCONFIRMED: 2 });
    expect(Object.values(r.bins as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(r.total);
    expect(r).toMatchObject({ total: 8, notApplied: 7, cumulative: { received: 7, accepted: 2 }, staleAfterMs: 30 * 60_000 });
    const bin = (vin: string) => r.vehicles.find((v: { vin: string }) => v.vin === vin).bin;
    expect(bin('KMH-NX4-0001')).toBe('DEFERRED');
    expect(bin('KMH-NX4-0101')).toBe('UNCONFIRMED');
    expect(r.vehicles.find((v: { vin: string }) => v.vin === 'KMH-NX4-0101')).toMatchObject({ lastStage: 'DEFERRED', reasonCode: 'DDT_ACTIVE' });
    // 미수신과 로컬 거부는 서로 다른 차량 집합
    expect(bin('KMH-NE-0001')).toBe('NOT_RECEIVED');
    expect(bin('KMH-NX4-0003')).toBe('REJECTED');
    await ctx.http().get('/api/publications/PUB-99999/convergence').expect(404);
  });

  it('전달 단계 회신·판정·보고 원장은 추가만 — 고치거나 지울 수 없다', () => {
    const db = ctx.get<Db>(DB);
    expect(() => db.run("UPDATE delivery_ack SET stage = 'APPLIED'")).toThrow(/추가만/);
    expect(() => db.run('DELETE FROM safety_verdict')).toThrow(/추가만/);
    expect(() => db.run("UPDATE vehicle_feature_report SET runtime_state = 'ACTIVE'")).toThrow(/추가만/);
  });
});

describe('ADS 상태 — 데모 활동 위 실제 게시본', () => {
  it('긴급 차단 게시본에 전달 보류 회신이 붙어 7구간이 비지 않는다(합 = 대상), 결과 회신이 있는 차량에는 붙이지 않는다', async () => {
    const { app, http, get } = await bootApp({ demoActivity: true });
    try {
      const run = await get(DemoActivitySeeder).bootstrapCompletion;
      expect(run?.adsDelivery?.ok).toBe(true);
      const pubs = (await http().get('/api/publications').query({ kind: 'KILL' }).expect(200)).body.items;
      const kill = pubs.find((p: { payload: { featureId: string } }) => p.payload.featureId === 'FEAT-00029');
      const c = (await http().get(`/api/publications/${kill.publicationId}/convergence`).expect(200)).body;
      expect(c.total).toBe(1);
      expect(c.bins.DEFERRED + c.bins.UNCONFIRMED + c.bins.APPLIED).toBe(1);
      const cs = (await http().get('/api/vehicles/HMA-NX4-0001/customer-state').expect(200)).body.features.find((x: { featureId: string }) => x.featureId === 'FEAT-00029');
      expect(cs).toMatchObject({ restricted: true, answers: { canUse: { text: '안전 점검으로 지금은 사용이 제한됩니다' }, when: { text: '차량 확인 뒤 알려 드립니다' } } });
      // 두 번째 호출은 다시 넣지 않는다
      expect(run?.adsDelivery?.note).toMatch(/전달 단계 회신/);
      expect(get(AdsStateService).seedDeliveryAcks()).toBe('이미 있음');
    } finally {
      await app.close();
    }
  }, 60_000);
});
