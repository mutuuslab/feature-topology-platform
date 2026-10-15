// 운행 중 감시 지표 (D04-03, 보고서 v1.1 13.4·13.5 · FFG-TEL-009) — 수용 기준: 지표가 없는 출시 Feature Version 0건, 부속서 1 항목 누락 0건.
// 지표는 수신 검사를 통과한 상태 보고·Kill 시간 기록·보안 이벤트에서 계산하고, Safety Case 경보 기준(FSM 기록)이 13.5 예시값을 대신한다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp, killV2 } from '../helpers';

const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');

describe('운행 중 감시 지표 (FFG-TEL-009)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });
  const kpi = async () => (await b.http().get('/api/safety-kpi').expect(200)).body;
  const metric = (body: any, featureId: string, id: string) => body.items.find((i: any) => i.featureId === featureId).metrics.find((m: any) => m.id === id);

  it('FFG-TEL-009 출시 Feature Version마다 13.5 지표 6종 — 지표 없는 Version 0건, Safety Case 미기록은 예시값으로 드러난다', async () => {
    const k = await kpi();
    expect(k.items.length).toBeGreaterThan(0);
    expect(k.coverage.missing).toEqual([]);
    for (const i of k.items) expect(i.metrics.map((m: any) => m.id)).toEqual(['KILL_LATENCY_P95', 'INCOMPLETE_DEACTIVATION', 'PENDING_OVERDUE', 'ONBOARD_FAULT_RATIO', 'STATE_PROOF_FAILURE', 'PERSISTENCE_FAILED']);
    expect(k.coverage.exampleOnly).toHaveLength(k.items.length);
    expect(k.items.find((i: any) => i.featureId === 'FEAT-00022')).toMatchObject({ version: '1.0.0', plan: { source: 'EXAMPLE' } });
  });

  it('FFG-TEL-009 Kill 적용 지연(p95)·상태 증명 실패가 실제 보고로 계산되고, FSM이 기록한 기준이 경보를 바꾼다', async () => {
    const http = b.http;
    await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '감시 지표 시험', confirm: 'FEAT-00022' });
    const clock = b.get(Clock);
    b.get(Scheduler).flush(8_000);
    clock.set(new Date(clock.now().getTime() + 8_000));
    const k1 = await kpi();
    const lat = metric(k1, 'FEAT-00022', 'KILL_LATENCY_P95');
    expect(lat.value).toBeGreaterThanOrEqual(0);
    expect(lat.alert).toBe(false); // 예시 상한 24시간 안

    // 위조 상태 보고(state_auth 불일치) → 상태 증명 실패 1건 → 예시 기준(1건 이상) 경보
    const last = (await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0].report;
    await http().post('/vehicle/v1/ego-01/status').set({ 'X-Vehicle-Id': 'ego-01' }).send({ ...last, state: 'ACTIVE', report_seq: last.report_seq + 1 }).expect(200);
    expect(metric(await kpi(), 'FEAT-00022', 'STATE_PROOF_FAILURE')).toMatchObject({ value: 1, threshold: 1, alert: true });

    await http().put('/api/safety-kpi/FEAT-00022/1.0.0/plan').set(actor('seo.ops', 'OPERATOR')).send({ thresholds: { STATE_PROOF_FAILURE: 5 } }).expect(403);
    const plan = (await http().put('/api/safety-kpi/FEAT-00022/1.0.0/plan').set(SAFETY).send({ thresholds: { STATE_PROOF_FAILURE: 5 } }).expect(200)).body;
    expect(plan).toMatchObject({ source: 'SAFETY_CASE', recordedBy: 'usr-safety', thresholds: { STATE_PROOF_FAILURE: 5, PENDING_OVERDUE: 1 } });
    const k2 = await kpi();
    expect(metric(k2, 'FEAT-00022', 'STATE_PROOF_FAILURE')).toMatchObject({ value: 1, threshold: 5, alert: false });
    expect(k2.coverage.exampleOnly.map((r: any) => r.featureId)).not.toContain('FEAT-00022');
  });

  it('FFG-TEL-009 ADS 기능 부속서 1 정기 보고 — 6항목 모두 값이 있다(누락 0건), ADS가 아니면 해당 없음', async () => {
    const http = b.http;
    expect((await http().get('/api/safety-kpi/FEAT-00022/1.0.0/annex1').expect(200)).body).toMatchObject({ applicable: false, missing: [] });
    await http().put('/api/features/FEAT-00023/versions/1.0.0/safety').set(actor('usr-author', 'FEATURE_AUTHOR')).send({ adsFeature: true, adsfType: 'ADSF-1' }).expect(200);
    const r = (await http().get('/api/safety-kpi/FEAT-00023/1.0.0/annex1').expect(200)).body;
    expect(r).toMatchObject({ applicable: true, missing: [] });
    expect(r.lines.map((l: any) => l.id)).toEqual(['DEACT_NOT_COMPLETED', 'COMMUNICATION', 'CYBERSECURITY', 'UNAUTHORIZED_CHANGE', 'MRC_MANEUVER', 'REMOTE_INTERACTION']);
    expect(r.lines.every((l: any) => typeof l.count === 'number')).toBe(true);
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(365 * 86_400_000);
  });
});
