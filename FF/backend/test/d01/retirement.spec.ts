// Flag 은퇴 6단계 (D01-01, 보고서 v1.1 6.5 · FFG-LCY-011 플랫폼 몫) — 순서대로만 진행, 승인은 Feature Owner와 F2 이상 Safety Manager(요청자 제외),
// 코드 참조 0건 전 퇴역 금지, 퇴역하면 배포 정책 RETIRED·Flag ID 재사용 금지, 코드 삭제 기한(6개월·다음 릴리스 중 이른 쪽)이 지나면 기한 초과.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const FSM = actor('usr-safety', 'SAFETY_OFFICER');
const IMPL = actor('jung.impl', 'IMPLEMENTER');
const REG = actor('usr-reg', 'REGULATORY_OWNER');
const FLAG = 'care_00022_signal';

describe('Flag 은퇴 6단계 (FFG-LCY-011)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  let id: string;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
  });
  afterAll(async () => b.app.close());
  const step = (body: Record<string, unknown>, who = IMPL) => b.http().post(`/api/flag-retirements/${id}/steps`).set(who).send(body);

  it('FFG-LCY-011 요청 → F3 Flag는 Feature Owner와 Safety Manager 승인(요청자 제외) — 승인 전에는 어떤 단계도 진행 불가', async () => {
    const http = b.http;
    const r = (await http().post('/api/flag-retirements').set(AUTHOR).send({ flagKey: FLAG, reason: '신호 Control Point 통합으로 불필요', nextReleaseAt: '2027-01-15T00:00:00.000Z' }).expect(201)).body;
    id = r.retirementId;
    expect(r).toMatchObject({ status: 'REQUESTED', fClass: 'F3', requiredApprovals: ['FEATURE_APPROVER', 'SAFETY_OFFICER'], codeRemovalDue: null });
    expect((await step({ step: 'REMAINING_VEHICLES' }).expect(422)).body.error.message).toMatch(/승인 전/);
    await http().post(`/api/flag-retirements/${id}/approvals`).set({ ...AUTHOR, 'X-Actor-Role': 'FEATURE_APPROVER' }).send({}).expect(403);
    expect((await http().post(`/api/flag-retirements/${id}/approvals`).set(APPROVER).send({}).expect(201)).body.status).toBe('REQUESTED');
    const ok = (await http().post(`/api/flag-retirements/${id}/approvals`).set(FSM).send({}).expect(201)).body;
    // 코드 삭제 기한 = 다음 정기 릴리스(2027-01-15)가 6개월(2027-04-15)보다 이르다
    expect(ok).toMatchObject({ status: 'APPROVED', codeRemovalDue: '2027-01-15T00:00:00.000Z', next: 'REMAINING_VEHICLES' });
  });

  it('FFG-LCY-011 순서대로만 — 남은 차량 집계 → 배포 완료율 기준 → 코드 참조 0건, 기한이 지나면 기한 초과로 드러난다', async () => {
    expect((await step({ step: 'CODE_REMOVED', analysisRef: 'SA-1', references: 0 }).expect(422)).body.error.message).toMatch(/앞 단계/);
    const s2 = (await step({ step: 'REMAINING_VEHICLES' }).expect(201)).body;
    expect(s2.steps.REMAINING_VEHICLES.data).toMatchObject({ onOldVersion: expect.any(Array), unreported: expect.any(Array) });
    expect((await step({ step: 'FINAL_STATE', swVersion: '1.2.2', completionRate: 80, requiredRate: 95, evidenceRef: 'OTA-CMP-77' }).expect(422)).body.error.message).toContain('80% < 기준 95%');
    await step({ step: 'FINAL_STATE', swVersion: '1.2.2', completionRate: 97, requiredRate: 95, evidenceRef: 'OTA-CMP-77' }).expect(201);
    const clock = b.get(Clock);
    clock.set(new Date('2027-01-16T00:00:00.000Z'));
    expect((await b.http().get('/api/flag-retirements').expect(200)).body.items[0]).toMatchObject({ retirementId: id, overdue: true });
    expect((await step({ step: 'CODE_REMOVED', analysisRef: 'SA-2', references: 3 }).expect(422)).body.error.message).toContain('참조 3건');
    expect((await step({ step: 'CODE_REMOVED', analysisRef: 'SA-3', references: 0 }).expect(201)).body.overdue).toBe(false);
  });

  it('FFG-LCY-011 Registry 퇴역 → 배포 정책 RETIRED·Flag ID 재사용 금지, 기록 보존으로 종료', async () => {
    const http = b.http;
    expect((await step({ step: 'REGISTRY_RETIRED' }).expect(201)).body.status).toBe('RETIRED');
    const pols = (await http().get(`/api/policies?flagKey=${FLAG}`).expect(200)).body.items;
    expect(pols.some((p: any) => p.status === 'DEPLOYED')).toBe(false);
    const reuse = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00024', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: FLAG, description: '은퇴한 ID 재사용 시도', safeDefault: false });
    expect(reuse.status).toBe(409);
    const closed = (await step({ step: 'RECORDS_RETAINED', markets: ['KR'], basis: 'Safety Case 보존 기간(13.7) — 감사·Gate 결정' }, REG).expect(201)).body;
    expect(closed).toMatchObject({ status: 'CLOSED', next: null });
    await step({ step: 'RECORDS_RETAINED', markets: ['KR'], basis: '중복' }, REG).expect(422);
  });
});
