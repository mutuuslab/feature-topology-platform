// Feature DB 변경 요청(30-95 §8.2·§8.3·§8.5) — 작성(필드 차이·자동 점검) → 도메인 검토 → 승인·반려, 직무 분리(SOD-13·14),
// 승인 전 검토 필수, 발행 전 '발행 대기'는 기준 행에 반영되지 않음, 영향(이 행을 쓰는 시드 Feature·재계산 필요), 출처 정기 점검 알림(주기당 1회).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';
import { Clock } from '../../src/kernel/clock';
import { RefdbReviewAlertService } from '../../src/domains/d01-policy/refdb/review-alert.service';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const REVIEWER = actor('usr-approver', 'DOMAIN_REVIEWER');
const ADMIN = actor('usr-steward', 'REFDB_ADMIN');
const AT = '2026-11-04T09:00:00.000Z';

describe('Feature DB 변경 요청', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  const http = () => ctx.http();
  beforeAll(async () => {
    ctx = await bootApp({ at: AT });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const modify = (refId: string, after: Record<string, unknown>, who = AUTHOR, reason = '근거 갱신') => http().post('/api/refdb/changes').set(who).send({ kind: 'MODIFY', refId, after, reason });
  const review = (id: string, who = REVIEWER, opinion = 'AGREE') => http().post(`/api/refdb/changes/${id}/reviews`).set(who).send({ opinion, comment: '도메인 검토 의견' });
  const decide = (id: string, decision: 'APPROVE' | 'REJECT', who = ADMIN) => http().post(`/api/refdb/changes/${id}/decision`).set(who).send({ decision, reason: '검토 결과 반영' });

  it('수정 요청은 바뀐 필드만 전·후로 저장하고 자동 점검 결과를 남긴다 — 상태는 도메인 검토(REVIEW)', async () => {
    const r = await modify('AD-LON-002', { tshirt: 'XXL', nameKo: '적응형 순항 제어(ACC)', remark: 'AD-LON-001과 비교' }).expect(201);
    expect(r.body.changeId).toMatch(/^CR-2026-\d{3}$/);
    expect(r.body.status).toBe('REVIEW');
    expect(r.body.before).toEqual({ tshirt: 'XL', remark: expect.any(String) });
    expect(r.body.after).toEqual({ tshirt: 'XXL', remark: 'AD-LON-001과 비교' }); // 같은 값(nameKo)은 차이에 넣지 않는다
    expect(r.body.checks.map((c: { id: string }) => c.id)).toContain('REQUIRED_INFO');
    expect(r.body.awaitingPublish).toBe(false);

    const d = (await http().get(`/api/refdb/changes/${r.body.changeId}`).expect(200)).body;
    expect(d.diff).toEqual([
      { field: 'remark', before: expect.any(String), after: 'AD-LON-001과 비교' },
      { field: 'tshirt', before: 'XL', after: 'XXL' },
    ]);
    // 영향 — 시드 대응표로 AD-LON-002를 쓰는 Feature 6개, T-shirt 변경이라 재계산 필요
    expect(d.impact.features.map((f: { featureId: string }) => f.featureId)).toEqual(expect.arrayContaining(['FEAT-00005', 'FEAT-00084', 'FEAT-00145', 'FEAT-00150', 'FEAT-00183', 'FEAT-00185']));
    expect(d.impact.features.find((f: { featureId: string }) => f.featureId === 'FEAT-00005')).toMatchObject({ role: expect.any(String), name: expect.any(String), ownerId: 'ADAS기획팀' });
    expect(d.impact.recalcRequired).toBe(true);
    // The immutable cost baseline includes reference notes as well as numerical sizing.
    expect(d.impact.recalcFields).toEqual(['tshirt', 'remark']);
    expect(d.usedBy.length).toBe(d.impact.features.length);
  });

  it('필수 정보 누락은 제출을 막고(400), 나머지 실패는 보완 필요로만 남긴다', async () => {
    const bad = await http()
      .post('/api/refdb/changes')
      .set(AUTHOR)
      .send({ kind: 'ADD', after: { domain: 'Chassis & Vehicle Dynamics', cluster: 'Brake control', component: 'Brake control (ESC/ABS)', nameEn: 'Brake disc wiping', tshirt: 'S', asilRep: 'QM', sourceIds: ['S01'] }, reason: '새 기능' })
      .expect(400);
    expect(bad.body.error.details.checks.map((c: { id: string }) => c.id)).toEqual(['REQUIRED_INFO']);
    expect(bad.body.error.message).toContain('한글 기능명');

    const ok = await http()
      .post('/api/refdb/changes')
      .set(AUTHOR)
      .send({ kind: 'ADD', after: { domain: 'Chassis & Vehicle Dynamics', cluster: 'Brake control', component: 'Brake control (ESC/ABS)', nameEn: 'Brake disc wiping', nameKo: '브레이크 디스크 와이핑', tshirt: 'S', asilRep: 'QM', sourceIds: ['S01'] }, reason: '새 기능' })
      .expect(201);
    expect(ok.body.refId).toMatch(/^CH-BRK-\d{3}$/); // 같은 접두의 다음 번호
    expect(ok.body.before).toBeNull();
    const advisory = ok.body.checks.filter((c: { ok: boolean }) => !c.ok);
    expect(advisory.length).toBeGreaterThan(0);
    expect(advisory.every((c: { blocking: boolean }) => !c.blocking)).toBe(true); // 1차 출처 위치·규모 근거 … = 보완 필요
    // 행은 발행 때 만든다 — 등록 화면 검색에는 아직 없다
    await http().get(`/api/refdb/refs/${ok.body.refId}`).expect(404);
  });

  it('요청자는 자기 요청을 검토할 수 없다(403 SOD-14), 승인·반려할 수 없다(403 SOD-13) — 거부도 감사에 남는다', async () => {
    const mine = (await modify('CH-BRK-009', { remark: 'CH-BRK-006과 비교 — 검토자 요청' }, REVIEWER).expect(201)).body;
    const r = await review(mine.changeId, REVIEWER).expect(403);
    expect(r.body.error.code).toBe('SEPARATION_OF_DUTY');
    expect(r.body.error.details.rule).toBe('SOD-14');

    const own = (await modify('CH-BRK-008', { remark: '관리자 요청' }, ADMIN).expect(201)).body;
    await review(own.changeId).expect(201);
    const d = await decide(own.changeId, 'APPROVE', ADMIN).expect(403);
    expect(d.body.error.code).toBe('SEPARATION_OF_DUTY');
    expect(d.body.error.details.rule).toBe('SOD-13');
    const audit = (await http().get(`/api/audit?target=${own.changeId}`).set(ADMIN)).body;
    const items = (audit.items ?? audit) as { action: string; result: string }[];
    expect(items.some((a) => a.action === 'REFDB_CHANGE_DECIDE' && a.result === 'DENIED')).toBe(true);
  });

  it('검토 의견 없이는 승인할 수 없다 — 마지막 의견이 보완이면 막고, 동의로 바뀐 뒤 승인하면 발행 대기, 기준 행은 아직 그대로', async () => {
    const c = (await modify('CH-BRK-006', { nameKo: '경사로 밀림 방지(HSA)' }).expect(201)).body;
    const blocked = await decide(c.changeId, 'APPROVE').expect(422);
    expect(blocked.body.error.details.code).toBe('REVIEW_REQUIRED');
    await review(c.changeId, REVIEWER, 'REVISE').expect(201);
    const revise = await decide(c.changeId, 'APPROVE').expect(422); // 보완 의견이 마지막이면 승인하지 않는다(2026-11-04 결정)
    expect(revise.body.error.details).toMatchObject({ code: 'REVIEW_NOT_AGREED', opinion: 'REVISE' });
    await review(c.changeId, REVIEWER, 'AGREE').expect(201); // 같은 검토자가 의견을 바꾼다
    const approved = (await decide(c.changeId, 'APPROVE').expect(201)).body;
    expect(approved.status).toBe('APPROVED');
    expect(approved.awaitingPublish).toBe(true);
    expect(approved.decision).toMatchObject({ decision: 'APPROVE', decidedBy: 'usr-steward' });
    const ref = (await http().get('/api/refdb/refs/CH-BRK-006').expect(200)).body.ref;
    expect(ref.nameKo).not.toBe('경사로 밀림 방지(HSA)'); // 발행 전 — 등록 화면에 반영되지 않는다
    await review(c.changeId).expect(409); // 승인된 요청은 더 검토하지 않는다
  });

  it('검토는 도메인 검토자만, 같은 행에 진행 중 요청이 있으면 새 요청을 막는다(409)', async () => {
    const c = (await modify('BC-BCM-002', { remark: '첫 요청' }).expect(201)).body;
    await review(c.changeId, AUTHOR).expect(403);
    await modify('BC-BCM-002', { remark: '둘째 요청' }).expect(409);
    await modify('BC-BCM-003', { status: 'RETIRED' }).expect(400); // 폐기는 RETIRE 종류로
    await modify('BC-BCM-003', { benchmarkEur: 1 }).expect(403); // 벤치마크 필드는 산정 역할만
  });

  it('목록은 상태·종류·도메인·대상 행으로 거른다', async () => {
    const all = (await http().get('/api/refdb/changes').expect(200)).body;
    expect(all.total).toBeGreaterThanOrEqual(5);
    const approved = (await http().get('/api/refdb/changes?status=APPROVED').expect(200)).body.items;
    expect(approved.every((c: { status: string }) => c.status === 'APPROVED')).toBe(true);
    const adds = (await http().get('/api/refdb/changes?kind=ADD').expect(200)).body.items;
    expect(adds.length).toBeGreaterThan(0);
    expect(adds.every((c: { kind: string }) => c.kind === 'ADD')).toBe(true);
    const adas = (await http().get('/api/refdb/changes?domain=ADAS%20%26%20AD').expect(200)).body.items;
    expect(adas.map((c: { refId: string }) => c.refId)).toEqual(['AD-LON-002']);
    const one = (await http().get('/api/refdb/changes?refId=CH-BRK-006').expect(200)).body.items;
    expect(one).toHaveLength(1);
  });

  it('출처 정기 점검 — 다음 점검일이 지난 출처마다 관리자 알림을 주기당 한 번만', async () => {
    const svc = ctx.get(RefdbReviewAlertService);
    const clock = ctx.get(Clock);
    expect(svc.sweep()).toBe(0); // 2026-11-04 — 아직 기한 전
    clock.set('2026-12-02T00:00:00.000Z');
    const first = svc.sweep();
    expect(first).toBe(svc.due().length);
    expect(first).toBeGreaterThan(0);
    expect(svc.sweep()).toBe(0); // 같은 주기는 다시 알리지 않는다
    const ntf = (await http().get('/api/notifications').set(ADMIN).expect(200)).body.items as { title: string; eventType: string }[];
    const due = ntf.filter((n) => n.eventType === 'refdb.source.review-due');
    expect(due).toHaveLength(first);
    expect(due[0].title).toContain('출처 정기 점검');
    // 다음 기한(2027-01-01)이 지나면 그 출처들만 새로
    clock.set('2027-01-02T00:00:00.000Z');
    expect(svc.sweep()).toBe(svc.due().length - first);
    expect(svc.sweep()).toBe(0);
    clock.set(AT);
  });
});
