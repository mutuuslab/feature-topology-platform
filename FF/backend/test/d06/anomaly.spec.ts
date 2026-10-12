// PoC ⑥ → ① 운영 되먹임: 차량 고장 보고(차량 발신 API) → 이상 건(D06-12) → 긴급 차단(anomalyId) → 조치됨
// → 품질 피드백(D04-06) → 새 Version의 G5 PASS로 자동 해소. 서명 거부 회신 → 보안 이상, 배포 회신 PARTIAL → 전달 이상.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const OPERATOR = actor('seo.ops', 'OPERATOR');
const at = '2026-10-12T01:00:00.000Z';

describe('운영 되먹임 — 이상 징후 대응 · 품질 피드백', () => {
  let app: INestApplication;
  let http: () => any;
  const seq: Record<string, number> = {};
  /** 차량 발신 보고 — 처음이면 HELLO로 부팅을 연다 */
  const report = async (vin: string, body: Record<string, unknown>) => {
    const send = (b: Record<string, unknown>) => http().post(`/vehicle/v1/${vin}/reports`).set({ 'X-Vehicle-Id': vin }).send({ bootId: `BOOT-${vin}-9`, sequence: (seq[vin] = (seq[vin] ?? 0) + 1), observedAt: at, ...b });
    if (seq[vin] === undefined) await send({ type: 'HELLO', highest: {} }).expect(200);
    return send(body).expect(200);
  };
  const advance = (ms: number) => {
    const clock = app.get(Clock);
    const until = clock.now().getTime() + ms;
    app.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };

  beforeAll(async () => {
    Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
    ({ app, http } = await bootApp());
    app.get(Clock).set(at);
  });
  afterAll(async () => {
    await app.close();
    delete process.env.FF_SCHEDULER;
    delete process.env.GLEO_MODE;
  });

  let anm: string;

  it('차량 1대 WARNING 고장 → FEATURE_FAULT 이상 건 OPEN(조사 권고)', async () => {
    await report('ego-01', { type: 'FAULT', featureId: 'FEAT-00022', code: 'GAP_EST_DRIFT', severity: 'WARNING', detail: '추정 거리 2배' });
    const r = (await http().get('/api/anomalies?kind=FEATURE_FAULT').expect(200)).body.items;
    expect(r).toHaveLength(1);
    anm = r[0].anomalyId;
    expect(r[0]).toMatchObject({ status: 'OPEN', featureId: 'FEAT-00022', severity: 'WARNING', advice: 'INVESTIGATE', vins: ['ego-01'] });
  });

  it('ASIL B 기능에서 2대째 보고 → 같은 이상 건이 CRITICAL(긴급 차단 권고)로 격상, 이벤트 anomaly.escalated', async () => {
    await report('lead-01', { type: 'FAULT', featureId: 'FEAT-00022', code: 'GAP_EST_DRIFT', severity: 'WARNING' });
    const a = (await http().get(`/api/anomalies/${anm}`).expect(200)).body;
    expect(a).toMatchObject({ severity: 'CRITICAL', advice: 'KILL', vins: ['ego-01', 'lead-01'] });
    expect(a.reasons.join(' ')).toMatch(/ASIL B/);
    const ev = (await http().get('/api/events?type=anomaly.escalated').expect(200)).body.items;
    expect(ev.at(-1).payload).toMatchObject({ anomalyId: anm, severity: 'CRITICAL' });
  });

  it('확인은 운영자·안전 담당만', async () => {
    await http().post(`/api/anomalies/${anm}/acknowledge`).set(AUTHOR).send({ reason: '확인' }).expect(403);
    const r = await http().post(`/api/anomalies/${anm}/acknowledge`).set(OPERATOR).send({ reason: '현장 데이터 확인' }).expect(200);
    expect(r.body).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedBy: 'seo.ops' });
  });

  it('이상 건을 가리켜 긴급 차단 발령 → 이상 건 MITIGATED(killId) → 품질 피드백 FB 생성(G5·G7·vECU 회귀)', async () => {
    const k = await http().post('/api/kill-requests').set(OPERATOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], safeMode: 'SAFE_DEFAULT', reason: '이상 건 조치', confirm: 'FEAT-00022', anomalyId: anm }).expect(201);
    const a = (await http().get(`/api/anomalies/${anm}`).expect(200)).body;
    expect(a).toMatchObject({ status: 'MITIGATED', killId: k.body.killId });
    const fb = (await http().get('/api/quality-feedback?featureId=FEAT-00022').expect(200)).body.items;
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ status: 'OPEN', featureVersion: '1.0.0', anomalyId: anm, kind: 'FEATURE_FAULT' });
    expect(fb[0].actions.map((x: any) => x.ref)).toEqual(['G5', 'G7', 'SCN-FEAT00022-NOMINAL', 'SCN-FEAT00022-FAULT-KILL']);
    await http().post(`/api/anomalies/${anm}/dismiss`).set(OPERATOR).send({ reason: '중복' }).expect(422); // 이미 닫힘
    await http().post(`/api/kill-requests/${k.body.killId}/release`).set(OPERATOR).send({ reason: '정리' }).expect(200);
  });

  it('피드백 수용은 설계·품질·안전 담당 — 새 Version이 G5 PASS를 받으면 자동 해소', async () => {
    const id = (await http().get('/api/quality-feedback').expect(200)).body.items[0].feedbackId;
    await http().post(`/api/quality-feedback/${id}/accept`).set(OPERATOR).send({ reason: '수용' }).expect(403);
    await http().post(`/api/quality-feedback/${id}/accept`).set(AUTHOR).send({ reason: '1.1.0에서 거리 추정 보정' }).expect(200);
    const v = await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '현장 피드백 반영', changes: { description: '거리 추정 편향 보정' } }).expect(201);
    const ver = v.body.feature.version;
    const judge = (gate: string) => http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${gate}` }).expect(201);
    for (const g of ['G1', 'G2', 'G3']) await judge(g);
    await http().post(`/api/features/FEAT-00022/versions/${ver}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
    expect((await http().get(`/api/quality-feedback/${id}`).expect(200)).body.status).toBe('ACCEPTED');
    await judge('G4');
    await judge('G5');
    const fb = (await http().get(`/api/quality-feedback/${id}`).expect(200)).body;
    expect(fb).toMatchObject({ status: 'RESOLVED', resolvedBy: 'system' });
    expect(fb.note).toMatch(new RegExp(`${ver.replace(/\./g, '\\.')} G5 PASS`));
  });

  it('차량이 서명 게시본을 거부(변조) → SECURITY 이상 CRITICAL(보안 검토)', async () => {
    const pub = (await http().get('/api/publications?kind=POLICY').expect(200)).body.items.at(-1);
    const detail = (await http().get(`/api/publications/${pub.publicationId}`).expect(200)).body.publication;
    app.get(VehicleRuntimeService).receive('KMH-NX4-0001', { ...detail, payload: { ...detail.payload, desired: 'sha256:forged' } });
    const r = (await http().get('/api/anomalies?kind=SECURITY').expect(200)).body.items[0];
    expect(r).toMatchObject({ featureId: 'FEAT-00022', severity: 'CRITICAL', advice: 'SECURITY_REVIEW', vins: ['KMH-NX4-0001'] });
    expect(r.signals[0].code).toBe('PAYLOAD_TAMPERED');
  });

  it('배포 회신 PARTIAL(통신 단절 차량) → DELIVERY 이상(재전달 권고), 기각 가능 — 피드백은 만들지 않는다', async () => {
    advance(10_000);
    const r = (await http().get('/api/anomalies?kind=DELIVERY').expect(200)).body.items[0];
    expect(r).toMatchObject({ featureId: 'FEAT-00022', advice: 'REDELIVER' });
    expect(r.signals.map((s: any) => s.code)).toContain('PARTIAL');
    await http().post(`/api/anomalies/${r.anomalyId}/mitigate`).set(OPERATOR).send({ reason: '통신 복구 후 재전달 예정' }).expect(200);
    expect((await http().get('/api/quality-feedback').expect(200)).body.items).toHaveLength(1);
  });
});
