// 관제 담당자 웨이브 W1 — 복원 영구 막힘 경보·알림(P4-1), 단계적 복원 회신(P4-7·P4-3), 키 교체 알림(P4-6), 장애 접수 차량 범위(P4-8).
// FFG-DEAC-008 · FFG-PLT-005 · FFG-SEC-002 · FFG-SOT-003
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp, KILL_REQUESTER, restoreBody } from '../helpers';

const QUALITY = actor('usr-quality', 'SAFETY_OFFICER');
const SAFETY2 = actor('usr-safety2', 'SAFETY_OFFICER');
const INTEG_CSM = actor('usr-integrator', 'SECURITY_OFFICER');
const CSM = actor('usr-csm', 'SECURITY_OFFICER');
const OPSLEAD = actor('usr-opslead', 'OPS_LEAD');
const OPERATOR = actor('usr-operator', 'OPERATOR');
const BODY = { featureId: 'FEAT-00022', featureVersion: '1.0.0', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', reason: '현장 결함', containmentJustification: '원인 분석 전 봉쇄', confirm: 'FEAT-00022' };

describe('관제 — 복원 전망·단계적 복원·알림', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-20T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });
  const http = () => b.http();
  const advance = (ms: number) => {
    const clock = b.get(Clock);
    const until = clock.now().getTime() + ms;
    b.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };
  const inbox = async (who: Record<string, string>) => (await http().get('/api/notifications').set(who).expect(200)).body.items as { eventType: string; aggregate: string; fields: { label: string; value: string }[] }[];
  const kill = async (vins: string[], approvers: Record<string, string>[]) => {
    const k = (await http().post('/api/kill-requests').set(KILL_REQUESTER).send({ ...BODY, vins }).expect(201)).body;
    let last = k;
    for (const a of approvers) last = (await http().post(`/api/kill-requests/${k.killId}/approvals`).set(a).send({}).expect(201)).body;
    return last;
  };

  let first: string;
  it('P4-1 차단 → 단계적 복원(Canary ego-01 → lead-01): 차단하지 않은 FSM·운영 리더가 승인, 단계마다 복구 게시본 회신 CONFIRMED', async () => {
    const k = await kill(['ego-01', 'lead-01'], [SAFETY2, INTEG_CSM]);
    first = k.killId;
    expect(k.approvals.map((a: { role: string }) => a.role)).toEqual(['FSM', 'CSM']);
    advance(30_000); // 차량 회신(시뮬레이터) — 차단 게시본 확인
    const active = (await http().get(`/api/kill-requests/${first}`).expect(200)).body;
    expect(active.delivery).toMatchObject({ status: 'CONFIRMED', confirmed: 2, denominator: 2 });
    expect(active.restoreOutlook).toMatchObject({ complete: true });
    const rb = await restoreBody(http, first, '원인 수정·재검증');
    await http().post(`/api/kill-requests/${first}/restore`).set(OPERATOR).send({ ...rb, cohort: ['ego-01'] }).expect(201);
    // 복원 승인 요청 알림 — 차단 승인자(safety2·integrator)는 받지 않고, 승인할 수 있는 품질 검토(FSM)·운영 리더는 받는다
    const forQuality = (await inbox(QUALITY)).find((n) => n.eventType === 'kill.restore-requested' && n.aggregate === first)!;
    expect(forQuality.fields.find((f) => f.label === '재검증 Evidence')!.value).toBe(rb.evidenceRef);
    expect(forQuality.fields.find((f) => f.label === '승인 가능')!.value).toContain('usr-opslead');
    expect((await inbox(OPSLEAD)).some((n) => n.eventType === 'kill.restore-requested' && n.aggregate === first)).toBe(true);
    expect((await inbox(SAFETY2)).some((n) => n.eventType === 'kill.restore-requested' && n.aggregate === first)).toBe(false);
    await http().post(`/api/kill-requests/${first}/restore/approvals`).set(OPSLEAD).send({}).expect(201);
    const s1 = (await http().post(`/api/kill-requests/${first}/restore/approvals`).set(QUALITY).send({}).expect(201)).body;
    expect(s1).toMatchObject({ status: 'ACTIVE', restoredVins: ['ego-01'] });
    expect(s1.restoreRequest.approvals.map((a: { role: string }) => a.role)).toEqual(['OPS_LEAD', 'FSM']);
    advance(30_000);
    const after1 = (await http().get(`/api/kill-requests/${first}`).expect(200)).body;
    expect(after1.restore).toMatchObject({ status: 'CONFIRMED', confirmed: 1, denominator: 1 });
    // 2단계 — 남은 차량
    await http().post(`/api/kill-requests/${first}/restore`).set(OPERATOR).send({ ...rb, cohort: ['lead-01'] }).expect(201);
    await http().post(`/api/kill-requests/${first}/restore/approvals`).set(OPSLEAD).send({}).expect(201);
    const s2 = (await http().post(`/api/kill-requests/${first}/restore/approvals`).set(QUALITY).send({}).expect(201)).body;
    expect(s2).toMatchObject({ status: 'RELEASED', restoredVins: ['ego-01', 'lead-01'] });
    advance(30_000);
    const pubs = (await http().get('/api/publications?kind=RESTORE').expect(200)).body.items.filter((p: { payload: { kill: { killId: string } } }) => p.payload.kill.killId === first);
    expect(pubs.map((p: { status: string; denominator: number }) => [p.status, p.denominator])).toEqual([
      ['CONFIRMED', 1],
      ['CONFIRMED', 1],
    ]);
  });

  it('P4-1 차단 승인자를 빼면 복원할 FSM이 없다 — 상세 전망 complete=false, 복원 요청 때 운영 리더·Safety Manager에게 복원 승인자 부족 경보', async () => {
    // 같은 Feature의 두 차단(차량이 다름) — A는 safety2·integrator, 뒤의 B는 품질 검토·다른 CSM이 승인. 원장의 마지막 차단 승인자는 B의 둘이라
    // A를 복원하려면 A의 승인자와 원장 승인자를 모두 빼야 하고, 데모 계정의 Safety Manager 셋이 다 빠진다
    const a = await kill(['ego-01'], [SAFETY2, INTEG_CSM]);
    const bk = await kill(['lead-01'], [QUALITY, CSM]);
    expect((await http().get(`/api/kill-requests/${bk.killId}`).expect(200)).body.restoreOutlook).toMatchObject({ complete: true });
    const o = (await http().get(`/api/kill-requests/${a.killId}`).expect(200)).body.restoreOutlook;
    expect(o).toMatchObject({ complete: false, missing: ['FSM'] });
    const rb = await restoreBody(http, a.killId);
    await http().post(`/api/kill-requests/${a.killId}/restore`).set(OPERATOR).send(rb).expect(201);
    const k = a;
    const n = (await inbox(OPSLEAD)).find((x) => x.eventType === 'kill.restore-blocked' && x.aggregate === k.killId)!;
    expect(n.fields.find((f) => f.label === '없는 승인')!.value).toBe('기능안전(Safety Manager)');
    expect(n.fields.find((f) => f.label === '상위 대응')!.value).toContain('Safety Manager를 지정');
  });

  it('P4-6 서명 키 교체 → 품질·운영 담당에게 알림(교체자 제외)', async () => {
    const r = (await http().post('/api/pki/rotate').set(INTEG_CSM).send({ reason: '정기 교체', purpose: 'restore' }).expect(201)).body;
    const n = (await inbox(OPERATOR)).find((x) => x.eventType === 'pki.key.rotated' && x.aggregate === r.keyId)!;
    expect(n.fields.find((f) => f.label === '용도')!.value).toBe('복원');
    expect((await inbox(QUALITY)).some((x) => x.eventType === 'pki.key.rotated')).toBe(true);
    expect((await inbox(INTEG_CSM)).some((x) => x.eventType === 'pki.key.rotated' && x.aggregate === r.keyId)).toBe(false);
  });

  it('P4-8 장애 접수 — 차량이 Feature 적용 범위 밖이면 경고를 남기고 접수는 받는다', async () => {
    const base = { source: 'FIELD', featureId: 'FEAT-00022', category: 'UNEXPECTED_ACTIVATION', severity: 'WARNING', summary: '현장 신고 — 의도하지 않은 감속' };
    const inScope = (await http().post('/api/incidents').set(OPERATOR).send({ ...base, vin: 'KMH-NX4-0001' }).expect(201)).body;
    expect(inScope.vehicleScope).toMatchObject({ fit: 'IN_SCOPE' });
    const out = (await http().post('/api/incidents').set(OPERATOR).send({ ...base, vin: 'HMA-NX4-0001' }).expect(201)).body;
    expect(out.vehicleScope).toMatchObject({ fit: 'OUT_OF_SCOPE' });
    expect(out.vehicleScope.message).toContain('적용 범위가 아닙니다');
    expect((await http().post('/api/incidents').set(OPERATOR).send({ ...base, vin: 'NO-SUCH-VIN' }).expect(201)).body.vehicleScope.fit).toBe('UNKNOWN_VEHICLE');
  });
});
