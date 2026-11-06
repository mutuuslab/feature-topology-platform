// Data Lake 연계(IF-15 모의)·Closed loop — 80-70 4·6·9장, BACKLOG TL-B01·B02·B06·B08·B09·B10, INV-16·17·20.
// 모의 Lake(data/fixtures/lake)는 결정적이다: FEAT-00004@4.1.0 DTC 증가(문제 축 조치 필요), FEAT-00028 사용 지표 가림(개선 축 판단 불가),
// EU Canary 집계 23분 지연, care_00022_param DTC 상대위험 1.8.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CanaryService } from '../../src/domains/d01-policy/staged-rollout/canary.service';
import { FeatureHealthService } from '../../src/domains/d04-ops/telemetry-ingest/feature-health.service';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');
const SAFETY2 = actor('usr-safety2', 'SAFETY_OFFICER');
const OPSLEAD = actor('usr-opslead', 'OPS_LEAD');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');
const OPERATOR = actor('seo.ops', 'OPERATOR');

describe('Data Lake 연계 — 모의 Lake(IF-15)·4축 판정·점검 결과·Canary', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: '2026-10-20T03:00:00.000Z' })));
  afterAll(() => app?.close());

  it('연결 상태 — 데이터셋 신선도, EU Canary 집계만 기준 초과, 라벨은 3건 적재 중', async () => {
    const r = (await http().get('/api/lake/status').expect(200)).body;
    expect(r.connected).toBe(true);
    expect(r.datasets.filter((d: any) => d.stale).map((d: any) => d.dataset)).toEqual(['gold.canary_5m_eu']);
    expect(r.labelBacklog).toBe(3);
    const l = (await http().get('/api/lake/labels').expect(200)).body;
    expect(l.items.map((i: any) => i.kind)).toEqual(['ff.change', 'relay.verdict', 'anomaly', 'incident', 'security.alert', 'entitlement']);
    expect(l.backlog).toBe(3);
    const sys = (await http().get('/api/integrations/systems').expect(200)).body.items.find((s: any) => s.ifId === 'IF-15');
    expect(sys).toMatchObject({ mode: 'mock', lagSeconds: 1380, failures: 0 });
  });

  it('4축 판정 — 조치 필요·판단 불가를 정상과 나누고, 감지한 축마다 점검 결과 한 건(같은 원인은 중복 없음)', async () => {
    const r = (await http().get('/api/feature-health').expect(200)).body;
    const row = (id: string) => r.rows.find((x: any) => `${x.featureId}@${x.version}` === id);
    expect(row('FEAT-00004@4.1.0').axes.PROBLEM).toEqual({ state: 'ACTION', cause: 'dtc_vehicle_rate' });
    expect(row('FEAT-00028@1.0.0').axes.IMPROVEMENT.state).toBe('UNKNOWN');
    expect(row('FEAT-00030@1.0.0').worst).toBe('UNKNOWN'); // 표본 140대 < 200
    const f = r.findings.find((x: any) => x.featureId === 'FEAT-00004' && x.version === '4.1.0' && x.axis === 'PROBLEM');
    expect(f).toMatchObject({ status: 'DETECTED', severity: 'ACTION', ownerRole: 'SAFETY_OFFICER', cause: 'dtc_vehicle_rate' });
    const before = r.findings.length;
    expect(get<FeatureHealthService>(FeatureHealthService).refresh()).toBe(0);
    expect((await http().get('/api/feature-health').expect(200)).body.findings).toHaveLength(before);
  });

  it('점검 결과 흐름 — 조치 없이 조치 중 불가, 효과 미달이면 닫기 불가(INV-20)·다시 열림, 감사·라벨 이벤트', async () => {
    const all = (await http().get('/api/feature-health').expect(200)).body.findings;
    const id = all.find((x: any) => x.featureId === 'FEAT-00004' && x.axis === 'PROBLEM').findingId;
    const move = (to: string, extra: object = {}, who = SAFETY) => http().post(`/api/feature-health/findings/${id}/transition`).set(who).send({ to, note: '진행', ...extra });
    await move('ACTING').expect(422);
    await move('ANALYZING').expect(201);
    expect((await move('ACTING').expect(422)).body.error.message).toContain('조치');
    await move('ACTING', { action: { kind: 'JIRA', ref: 'FFP-9001', title: 'DTC 결함' } }).expect(201);
    const v = (await move('VERIFYING').expect(201)).body;
    expect(v.effect).toMatchObject({ indicator: 'dtc_vehicle_rate', target: 0.004, after: 0.0093, met: false });
    expect((await move('CLOSED').expect(422)).body.error.message).toContain('효과');
    const re = (await move('REOPENED').expect(201)).body;
    expect(re).toMatchObject({ status: 'REOPENED', repeats: 1 });
    await http().post(`/api/feature-health/findings/${id}/transition`).set(actor('usr-viewer', 'AUDITOR')).send({ to: 'ANALYZING', note: '조회자' }).expect(403);
    const ev = (await http().get('/api/events?type=finding.moved&limit=10').expect(200)).body.items;
    expect(ev.filter((e: any) => e.aggregate === id).map((e: any) => e.payload.to)).toEqual(expect.arrayContaining(['ANALYZING', 'ACTING', 'VERIFYING', 'REOPENED']));
  });

  it('Feature 운영 지표 — 버전별 활성 차량·실패율·DTC와 14일 4축 이력', async () => {
    const r = (await http().get('/api/features/FEAT-00004/ops-metrics').expect(200)).body;
    expect(r.versions.map((v: any) => v.version)).toContain('4.1.0');
    const v = r.versions.find((x: any) => x.version === '4.1.0');
    expect(v.activeVehicles).toBeGreaterThan(10000);
    expect(v.dtcRate).toBe(0.0093);
    expect(r.history.filter((h: any) => h.version === '4.1.0')).toHaveLength(14);
    expect(r.history.filter((h: any) => h.version === '4.1.0').at(-1).axes.PROBLEM).toBe('ACTION');
    await http().get('/api/features/FEAT-99999/ops-metrics').expect(404);
  });

  it('Canary — 신선도 초과는 보류, 상대위험 신뢰구간 하한이 기준을 넘으면 중단, 모델 점수는 사용 승인 전이면 참고 불가', async () => {
    const o = (await http().get('/api/canary').expect(200)).body;
    const param = o.items.find((x: any) => x.flagKey === 'care_00022_param');
    expect(param.verdict).toBe('ABORT');
    expect(param.breached).toEqual(['dtc_per_1k']);
    expect(param.criteria.registered).toBe(false);
    expect(param.risk).toMatchObject({ modelId: 'LAKE-M3-DEPLOY-RISK', usable: false });
    expect(o.items.find((x: any) => x.flagKey === 'care_00022_signal').verdict).toBe('OK');
    expect(o.items.find((x: any) => x.flagKey === 'ivi_00024_guide').verdict).toBe('INSUFFICIENT');
    // EU 판(FEAT-00025) 정책이면 집계가 23분 늦어 보류 — 등록 여부와 무관(INV-16)
    const p = get<PolicyRepo>(PolicyRepo).deployed('care_00022_param')!;
    const eu = get<CanaryService>(CanaryService);
    expect(eu.observe({ ...p, featureId: 'FEAT-00025', featureVersion: '1.0.0' })!.verdict).toBe('HOLD_STALE');
    expect(eu.stageInput({ ...p, featureId: 'FEAT-00025', featureVersion: '1.0.0' })).toMatchObject({ verdict: 'HOLD_STALE', lagMinutes: 23 });
    // 등록 전에는 경계 초과로 막지 않는다 → 등록 뒤에는 넓히기 거부(줄이기는 됨)
    expect(eu.stageInput(p)).toBeNull();
  });

  it('중단 기준 사전 등록(FR-ROL-002-006) — 등록 뒤 경계를 넘은 정책은 넓힐 수 없다, 줄이기는 언제나', async () => {
    const pid = (await http().get('/api/canary').expect(200)).body.items.find((x: any) => x.flagKey === 'care_00022_param').policyId;
    const body = { metrics: [{ metric: 'dtc_per_1k', maxRelativeRisk: 1.5 }], confidence: 0.95, observeHours: 24, maxLagMinutes: 10, reason: '출시 전 사전 등록' };
    await http().put(`/api/policies/${pid}/abort-criteria`).set(OPERATOR).send(body).expect(403);
    await http().put(`/api/policies/${pid}/abort-criteria`).set(RELEASE).send(body).expect(200);
    const d = (await http().get(`/api/policies/${pid}/canary`).expect(200)).body.item;
    expect(d.criteria).toMatchObject({ registered: true, registeredBy: 'usr-coordinator' });
    await http().post(`/api/policies/${pid}/rollout`).set(OPERATOR).send({ basisPoints: 300, reason: 'Canary로 줄이기' }).expect(200);
    const r = await http().post(`/api/policies/${pid}/rollout`).set(OPERATOR).send({ basisPoints: 2000, reason: '20% 확대' }).expect(422);
    expect(r.body.error.message).toContain('사전 등록한 중단 기준을 넘었습니다');
    expect(r.body.error.details.judgement.blockers.map((b: any) => b.code)).toContain('ABORT_CRITERIA');
    // 통합 회귀(D-INT-3): 사전 등록 중단 기준을 넘은 확대 거부도 '배포 중단 필요'로 알린다 — 열린 이상 징후·진행 중 차단(STOP_CRITERIA)만 보던 것
    const halt = get<Db>(DB).all<{ payload: string }>("SELECT payload FROM events WHERE type = 'rollout.halt-required' AND aggregate = ?", pid).map((e) => JSON.parse(e.payload));
    expect(halt.at(-1)).toMatchObject({ policyId: pid, to: 2000, requestedBy: 'seo.ops' });
    expect(halt.at(-1).reasons.join(' ')).toContain('사전 등록한 중단 기준을 넘었습니다');
  });

  it('모델 사용 승인(TL-B06) — 서로 다른 두 사람, 같은 사람 두 번은 거부, 드리프트 판은 승인 불가', async () => {
    const approve = (who: object, version = '2.1.0', id = 'LAKE-M3-DEPLOY-RISK') => http().post(`/api/lake/models/${id}/approvals`).set(who).send({ version, decision: 'APPROVE', reason: '모델 카드 확인' });
    expect((await approve(SAFETY).expect(201)).body).toMatchObject({ use: 'PENDING', usable: false });
    await approve(SAFETY).expect(403);
    await approve(OPERATOR).expect(403);
    expect((await approve(OPSLEAD).expect(201)).body).toMatchObject({ use: 'APPROVED', usable: true });
    await approve(SAFETY2, '3.1.0', 'LAKE-M2-ANOMALY').expect(422);
    // 승인 뒤 Canary 위험 점수는 권고로 쓸 수 있다 — 판정(verdict)은 그대로(INV-17)
    const param = (await http().get('/api/canary').expect(200)).body.items.find((x: any) => x.flagKey === 'care_00022_param');
    expect(param.risk).toMatchObject({ version: '2.1.0', usable: true });
  });

  it('조회 보조 — 이상 징후 증거·실험 실측·체험 분석(사용 승인 전 모델의 추천 대상은 숨김)', async () => {
    expect((await http().get('/api/lake/anomaly-evidence').expect(200)).body.connected).toBe(true);
    expect((await http().get('/api/lake/experiments').expect(200)).body.connected).toBe(true);
    const t = (await http().get('/api/lake/trials').expect(200)).body;
    expect(t.usage).toHaveLength(4);
    expect(t.model).toMatchObject({ modelId: 'LAKE-M4-TRIAL', use: 'PENDING' });
    expect(t.targets).toEqual([]);
    expect((await http().get('/api/collection-policies').expect(200)).body).toEqual({ connected: true, items: [] });
  });
});

describe('Data Lake 꺼짐(IF_MODE_15=off) — 판단에 Lake 값을 쓰지 않는다', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    process.env.IF_MODE_15 = 'off';
    ({ app, http } = await bootApp({ at: '2026-10-20T03:00:00.000Z' }));
  });
  afterAll(async () => {
    delete process.env.IF_MODE_15;
    await app?.close();
  });

  it('연결 안 됨 — 빈 목록과 connected=false, 확대는 Lake 판정 없이 기존 규칙만', async () => {
    expect((await http().get('/api/lake/status').expect(200)).body).toMatchObject({ connected: false, datasets: [] });
    expect((await http().get('/api/feature-health').expect(200)).body).toMatchObject({ connected: false, rows: [], findings: [] });
    expect((await http().get('/api/canary').expect(200)).body).toMatchObject({ connected: false, items: [] });
    expect((await http().get('/api/system/connections').expect(200)).body.items.find((i: any) => i.key === 'datalake').mode).toBe('off');
    await http().post('/api/lake/models/LAKE-M3-DEPLOY-RISK/approvals').set(SAFETY).send({ version: '2.1.0', decision: 'APPROVE', reason: '확인' }).expect(422);
  });
});

describe('데모 시드 — FF가 주인인 예시(진행된 점검 결과·수집 정책·모델 승인·중단 기준)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: '2026-10-20T03:00:00.000Z', demoActivity: true })));
  afterAll(() => app?.close());

  it('점검 결과 다섯 상태가 모두 있고 기한 지남이 있다, 수집 정책·모델 승인이 채워진다', async () => {
    const r = (await http().get('/api/feature-health').expect(200)).body;
    const by = (k: string) => r.findings.find((f: any) => `${f.featureId}@${f.version}:${f.axis}` === k);
    expect(by('FEAT-00022@1.0.0:OPERATION')).toMatchObject({ status: 'VERIFYING', effect: { met: true } });
    expect(by('FEAT-00002@1.6.0:PROBLEM')).toMatchObject({ status: 'REOPENED', repeats: 1 });
    expect(by('FEAT-00005@5.4.2:OPERATION')).toMatchObject({ status: 'CLOSED' });
    expect(by('FEAT-00163@3.8.0:IMPROVEMENT')).toMatchObject({ status: 'ANALYZING', overdue: true });
    expect(by('FEAT-00004@4.1.0:PROBLEM')).toMatchObject({ status: 'ACTING' });
    expect((await http().get('/api/collection-policies').expect(200)).body.items).toHaveLength(5);
    const m = (await http().get('/api/lake/models').expect(200)).body.items;
    expect(m.find((x: any) => x.modelId === 'LAKE-M3-DEPLOY-RISK' && x.version === '2.1.0')).toMatchObject({ use: 'PENDING' });
    expect(m.find((x: any) => x.modelId === 'LAKE-M3-DEPLOY-RISK' && x.version === '2.0.0')).toMatchObject({ use: 'APPROVED', usable: true });
    const c = (await http().get('/api/canary').expect(200)).body.items.find((x: any) => x.flagKey === 'care_00022_param');
    expect(c.criteria.registered).toBe(true);
    expect(c.risk).toMatchObject({ version: '2.0.0', usable: true });
  });
});
