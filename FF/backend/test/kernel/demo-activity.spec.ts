// 데모 활동 시드(DemoActivitySeeder) — 데모 화면이 '아직 기록이 없습니다'로 비지 않게, 부팅 때 담당자 활동을 도메인 서비스로 한 번 재현한다.
// 수용 기준: 빈 화면 감사(E1~E7)의 대상 API가 비어 있지 않다 · 같은 DB에서 다시 돌지 않는다(meta seed-activity) ·
// FF_DEMO_ACTIVITY=0·운영 모드·FF_SEED=none이면 하지 않는다 · RELEASED Feature의 안전 분류가 확정돼 있다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { DemoActivitySeeder, DEMO_ACTIVITY_META, demoActivityEnabled } from '../../src/demo-activity/demo-activity.seeder';
import { SafetyProfileService } from '../../src/domains/d01-policy/registry/safety-profile.service';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { actor, bootApp } from '../helpers';

const AT = '2026-10-20T01:00:00.000Z';
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const APPROVER = actor('usr-approver', 'FEATURE_APPROVER');
const CSM = actor('usr-integrator', 'SECURITY_OFFICER');
/** 시연·e2e가 직접 다루는 Feature — 시드가 분류를 건드리지 않는다 */
const KEEP = ['FEAT-00001', 'FEAT-00013', 'FEAT-00022', 'FEAT-00024', 'FEAT-00145'];

describe('데모 활동 시드 — 켜짐 조건', () => {
  it('운영 모드·FF_SEED=none은 강제(1)여도 끔, 0은 끔, 기본은 켬(5년 재생 데이터셋은 끔)', () => {
    expect(demoActivityEnabled({})).toBe(true);
    expect(demoActivityEnabled({ FF_SEED: 'v0.81' })).toBe(true);
    expect(demoActivityEnabled({ FF_DEMO_ACTIVITY: '0' })).toBe(false);
    expect(demoActivityEnabled({ FF_ENV: 'production', FF_SEED: 'v0.81', FF_DEMO_ACTIVITY: '1' })).toBe(false);
    expect(demoActivityEnabled({ FF_SEED: 'none', FF_DEMO_ACTIVITY: '1' })).toBe(false);
    expect(demoActivityEnabled({ FF_DATASET: 'ops5y' })).toBe(false);
    expect(demoActivityEnabled({ FF_DATASET: 'ops5y', FF_DEMO_ACTIVITY: '1' })).toBe(true);
  });

  it('bootApp 기본(시험)은 시드하지 않는다 — 활동 목록이 비고 meta가 없다', async () => {
    const b = await bootApp({ at: AT });
    try {
      expect(b.get<Db>(DB).get('SELECT value FROM meta WHERE key = ?', DEMO_ACTIVITY_META)).toBeUndefined();
      expect((await b.http().get('/api/experiments').expect(200)).body.items).toHaveLength(0);
      expect((await b.http().get('/api/incidents').expect(200)).body.items).toHaveLength(0);
    } finally {
      await b.app.close();
    }
  });
});

describe('데모 활동 시드 — 켠 부팅', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  let bootMs = 0;
  beforeAll(async () => {
    const t = Date.now();
    b = await bootApp({ at: AT, demoActivity: true });
    bootMs = Date.now() - t;
  });
  afterAll(async () => {
    await b.app.close();
    delete process.env.FF_DEMO_ACTIVITY;
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });
  const items = async (path: string, who: Record<string, string> = {}) => (await b.http().get(path).set(who).expect(200)).body.items as any[];

  it('모든 단계가 성공했고 요약이 meta seed-activity에 남는다', () => {
    const run = b.get(DemoActivitySeeder).lastRun!;
    const failed = Object.entries(run).filter(([, v]) => !v.ok);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    const meta = JSON.parse(b.get<Db>(DB).get<{ value: string }>('SELECT value FROM meta WHERE key = ?', DEMO_ACTIVITY_META)!.value);
    expect(Object.keys(meta.steps)).toContain('experiments');
    expect(bootMs).toBeLessThan(15_000); // 부팅 비용 상한(여유) — 실측은 보고서에
  });

  it('실험 — 실행 중 1·종료 1', async () => {
    const e = await items('/api/experiments');
    expect(e.map((x) => x.status).sort()).toEqual(['CONCLUDED', 'RUNNING']);
    expect(e.every((x) => x.policyId !== 'POL-00002' || x.status === 'CONCLUDED')).toBe(true);
  });

  it('장애·VOC 6건, 열린 이상 건, 품질 피드백', async () => {
    expect((await items('/api/incidents')).length).toBeGreaterThanOrEqual(6);
    const anomalies = await items('/api/anomalies');
    expect(anomalies.some((a) => a.status === 'OPEN')).toBe(true);
    expect(anomalies.find((a) => a.featureId === 'FEAT-00022' && a.kind === 'FIELD_SOTIF')).toMatchObject({ status: 'OPEN' });
    expect((await items('/api/quality-feedback')).length).toBeGreaterThanOrEqual(1);
  });

  it('해외공장 주문 · VEX · 보안 이벤트 · 권한 거부', async () => {
    expect((await items('/api/legacy/orders')).length).toBeGreaterThanOrEqual(5);
    expect((await items('/api/vex')).length).toBeGreaterThanOrEqual(3);
    expect((await items('/api/security-events', CSM)).length).toBeGreaterThanOrEqual(1);
    expect((await items('/api/iam/denials')).length).toBeGreaterThanOrEqual(4);
  });

  it('Flag Retirement 진행 중 · 되돌리기 요청 대기 · 승인 대기 정책 · 개정 이력', async () => {
    const r = await items('/api/flag-retirements');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ status: 'APPROVED', next: 'FINAL_STATE' });
    // 되돌리기는 첫 판 게시본이 차량 확인까지 간 뒤에 잇는다 — 차량 회신(내부 시뮬레이터)을 흘려보낸다
    const seeder = b.get(DemoActivitySeeder);
    const clock = b.get(Clock);
    for (let i = 0; i < 6 && !(await Promise.race([seeder.continuation!.then(() => true), new Promise((r) => setTimeout(() => r(false), 50))])); i++) {
      b.get(Scheduler).flush(12_000);
      clock.set(new Date(clock.now().getTime() + 12_000));
    }
    expect(await seeder.continuation).toMatch(/REQUESTED/);
    const rb = await items('/api/rollback-requests?status=REQUESTED');
    expect(rb).toHaveLength(1);
    expect((await items('/api/rollbacks')).length).toBeGreaterThanOrEqual(1);
    expect((await items('/api/policies?status=VALIDATED')).length).toBeGreaterThanOrEqual(1);
    const h = (await b.http().get(`/api/policies/${rb[0].deployed.policyId}/history`).expect(200)).body;
    expect(h.versions.length).toBeGreaterThanOrEqual(2);
    expect(h.requests.length).toBeGreaterThanOrEqual(1);
    // 시드 정책(care_00022_*·ivi_00024_guide)은 그대로 배포 중
    const seed = await items('/api/policies');
    for (const id of ['POL-00001', 'POL-00002', 'POL-00003']) expect(seed.find((p) => p.policyId === id)?.status).toBe('DEPLOYED');
  });

  it('외부 연계 — 받은 변경·실패한 보내기·열린 충돌', async () => {
    expect((await items('/api/integrations/sync/inbox')).length).toBeGreaterThanOrEqual(1);
    expect((await items('/api/integrations/sync/outbox?status=FAILED')).length).toBeGreaterThanOrEqual(1);
    expect((await items('/api/integrations/sync/conflicts?status=OPEN')).length).toBeGreaterThanOrEqual(1);
  });

  it('업무 절차 완료 · 대시보드(내 판 + 공유 판) · BOM 확정 대기 2건', async () => {
    const st = (await b.http().get('/api/procedures/state').expect(200)).body;
    expect(st.done.length).toBeGreaterThanOrEqual(1);
    expect(st.done.some((x: string | { activityId: string }) => String(typeof x === 'string' ? x : x.activityId).startsWith('FPW.1-'))).toBe(false); // 작성자 '내 차례' 시연용
    expect((await items('/api/dashboards', AUTHOR)).length).toBeGreaterThanOrEqual(2);
    expect((await items('/api/dashboards', APPROVER)).length).toBeGreaterThanOrEqual(1);
    expect(await items('/api/baselines/requests?status=PENDING')).toHaveLength(2);
  });

  it('Safety KPI 경보 기준(Safety Case) · 체험 전환', async () => {
    const kpi = (await b.http().get('/api/safety-kpi').expect(200)).body.items as any[];
    expect(kpi.some((k) => k.plan.source === 'SAFETY_CASE')).toBe(true);
    const trials = (await b.http().get('/api/trials?source=ALL&pageSize=50').expect(200)).body.items as any[];
    expect(trials.filter((t) => t.status === 'CONVERTED' && t.convertedAt).length).toBeGreaterThanOrEqual(1);
  });

  it('RELEASED Feature의 안전 분류는 확정(서명 검증)돼 있다 — 시연 Feature는 그대로', () => {
    const profiles = b.get(SafetyProfileService);
    const released = b.get(FeatureRepo).all().filter((f) => f.lifecycle === 'RELEASED' && !KEEP.includes(f.featureId));
    expect(released.length).toBeGreaterThan(10);
    const draft = released.filter((f) => !profiles.verifyConfirmation(profiles.ensure(f.featureId, f.version))).map((f) => `${f.featureId}@${f.version}`);
    expect(draft).toEqual([]);
  });

  it('같은 DB에서 다시 부르면 아무것도 하지 않는다 (meta seed-activity)', async () => {
    const before = { e: (await items('/api/experiments')).length, i: (await items('/api/incidents')).length, d: (await items('/api/dashboards', AUTHOR)).length };
    const seeder = b.get(DemoActivitySeeder);
    expect(await seeder.run()).toBeNull();
    await seeder.onApplicationBootstrap();
    expect({ e: (await items('/api/experiments')).length, i: (await items('/api/incidents')).length, d: (await items('/api/dashboards', AUTHOR)).length }).toEqual(before);
  });

  it('정의 승인·Release Sign-off·상품·Feature DB 검토의 실제 대기 건이 있다', async () => {
    const q = (await b.http().get('/api/work-queues').expect(200)).body;
    expect(q.definitions).toEqual(expect.arrayContaining([expect.objectContaining({ featureId: 'FEAT-00180' })]));
    expect(q.signoffs).toEqual(expect.arrayContaining([expect.objectContaining({ featureId: 'FEAT-00144' })]));
    expect((await items('/api/products')).some((p) => p.lifecycle === 'PROPOSED' && p.name === '고속도로 상세 안내 체험 상품')).toBe(true);
    expect((await items('/api/refdb/changes?status=REVIEW')).length).toBeGreaterThanOrEqual(2);
  });

  it('PoC 밖 기능의 차단·복원 승인 대기 — FSM·CSM 기록, 남은 다른 승인자 두 명', async () => {
    const kills = await items('/api/kill-requests');
    const k = kills.find((x) => x.featureId === 'FEAT-00029');
    expect(k).toMatchObject({ status: 'ACTIVE', vins: ['HMA-NX4-0001'], restoreRequest: { status: 'REQUESTED', cohort: ['HMA-NX4-0001'], evidenceRef: expect.any(String) } });
    expect(k.approvals.map((a: any) => a.role)).toEqual(['FSM', 'CSM']);
    expect(kills.some((x) => x.featureId === 'FEAT-00022')).toBe(false);
  });

  it('차량 조회 관문을 통과한 QUERY 요청이 차량 상세에 보인다', async () => {
    const requests = await items('/api/vehicles/ego-01/requests');
    expect(requests).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'QUERY', outcome: 'ACCEPTED' })]));
  });

});
