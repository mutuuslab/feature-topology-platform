// 검토 포털 협의 요청(W5, 담당자 개선 P5-1·P5-2) — 실제 협의 건(대상·요청 부서·기한·상태), 포털 부서의 동의·보완·반대 의견,
// 요청 부서 화면(from 필터)과 감사(CONSULT_OPINION)에 보인다. 데모 시드는 포털 부서마다 업무 절차 협의 활동에 묶인 건이 있다(빈 요청함 없음).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';
import { ConsultService, consultBasisProblem, DEMO_CONSULT_SPECS, demoConsultations } from '../../src/workflows/consult.service';

const VIEWER = actor('usr-viewer', 'AUDITOR'); // 포털 부서 담당(플랫폼 역할 없음 → 조회 계정)
const FSM = actor('usr-quality', 'SAFETY_OFFICER');
const REG = actor('usr-steward', 'REGULATORY_OWNER');

describe('검토 포털 협의 요청', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  const http = () => ctx.http();
  beforeAll(async () => {
    ctx = await bootApp({ at: '2026-11-05T09:00:00.000Z' });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('데모 시드 — 구매·법무·개인정보보호 요청함마다 의견 대기 건이 있고, 대기 → 기한 순으로 온다', async () => {
    for (const to of ['DEP-PUR', 'DEP-LEG', 'DEP-DPO']) {
      const r = (await http().get(`/api/consultations?to=${to}`).expect(200)).body;
      expect(r.open, to).toBeGreaterThanOrEqual(2);
      expect(r.items.length, to).toBeGreaterThanOrEqual(3);
      const first = r.items[0];
      expect(first).toMatchObject({ toDept: to, status: 'OPEN' });
      expect(first.summary.length).toBeGreaterThan(4);
      expect(first.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof first.daysLeft).toBe('number');
      expect(first.fromName).not.toMatch(/^DEP-/); // 부서 이름(코드 아님)
      const open = r.items.filter((c: { status: string }) => c.status === 'OPEN').map((c: { dueAt: string }) => c.dueAt);
      expect(open).toEqual([...open].sort());
    }
  });

  it('데모 포털 담당(조회 계정 하나)이 받은 의견 대기 건은 모두 의견을 낼 수 있다 — 요청자가 같은 계정이 아니다', async () => {
    // 회귀(e2e에서 발견): 포털 부서가 보낸 시드 요청의 요청자가 usr-viewer라, 받은 포털 부서(같은 계정)가 '자기 요청'으로 막혔다
    const open = (await http().get('/api/consultations?status=OPEN').expect(200)).body.items.filter((c: { toDept: string }) => ['DEP-PUR', 'DEP-LEG', 'DEP-DPO'].includes(c.toDept));
    expect(open.length).toBeGreaterThan(0);
    for (const c of open) expect(c.requestedBy, c.consultId).not.toBe('usr-viewer');
  });

  it('구매 요청함에는 협력사 변경 영향 건이 협력사 이관 화면 링크와 함께 있다(P5-2)', async () => {
    const r = (await http().get('/api/consultations?to=DEP-PUR&status=OPEN').expect(200)).body;
    const supplier = r.items.filter((c: { targetKind: string }) => c.targetKind === 'SUPPLIER_PACKAGE');
    expect(supplier.length).toBeGreaterThanOrEqual(2);
    expect(supplier[0].link).toMatch(/^\/supplier\/portal\?supplier=/);
  });

  it('시드 건은 모두 업무 절차의 협의 활동에 맞는다 — 받는 부서는 협의·통보, 요청 부서는 수행·책임', () => {
    for (const s of DEMO_CONSULT_SPECS) expect(consultBasisProblem(s.activityId, s.fromDept, s.toDept), `${s.activityId} ${s.fromDept}→${s.toDept}`).toBeNull();
    const seeded = demoConsultations('2026-11-05T09:00:00.000Z');
    expect(new Set(seeded.map((c) => c.consultId)).size).toBe(seeded.length);
    expect(new Set(seeded.map((c) => c.toDept))).toEqual(new Set(['DEP-PUR', 'DEP-LEG', 'DEP-DPO']));
  });

  it('법무가 보완 의견을 남기면 요청 부서 목록과 감사에 보인다', async () => {
    const item = (await http().get('/api/consultations?to=DEP-LEG&status=OPEN').expect(200)).body.items.find((c: { fromDept: string }) => c.fromDept === 'DEP-HOM');
    expect(item).toBeTruthy();
    const after = (await http().post(`/api/consultations/${item.consultId}/opinions`).set(VIEWER).send({ department: 'DEP-LEG', opinion: 'REVISE', memo: '고지 문구에 속도 범위를 넣어 주세요' }).expect(201)).body;
    expect(after).toMatchObject({ status: 'ANSWERED', opinions: [expect.objectContaining({ opinion: 'REVISE', by: 'usr-viewer', department: 'DEP-LEG' })] });
    // 요청 부서(법규인증팀) 화면 — 보낸 협의에 의견이 보인다
    const sent = (await http().get('/api/consultations?from=DEP-HOM').expect(200)).body.items.find((c: { consultId: string }) => c.consultId === item.consultId);
    expect(sent.opinions.at(-1)).toMatchObject({ opinion: 'REVISE', memo: '고지 문구에 속도 범위를 넣어 주세요' });
    const audit = (await http().get(`/api/audit?target=${item.consultId}`).expect(200)).body.items;
    expect(audit[0]).toMatchObject({ action: 'CONSULT_OPINION', result: 'ALLOWED', actorId: 'usr-viewer', after: expect.objectContaining({ opinion: 'REVISE' }) });
  });

  it('받은 부서가 아니면 403 + 감사 DENIED, 요청자 본인은 의견을 낼 수 없다', async () => {
    const item = (await http().get('/api/consultations?to=DEP-DPO&status=OPEN').expect(200)).body.items[0];
    const r = await http().post(`/api/consultations/${item.consultId}/opinions`).set(VIEWER).send({ department: 'DEP-PUR', opinion: 'AGREE', memo: '동의합니다' }).expect(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    const denied = (await http().get(`/api/audit?target=${item.consultId}&result=DENIED`).expect(200)).body.items;
    expect(denied[0]).toMatchObject({ action: 'CONSULT_OPINION', result: 'DENIED' });
    const self = actor(item.requestedBy, 'SAFETY_OFFICER');
    expect((await http().post(`/api/consultations/${item.consultId}/opinions`).set(self).send({ department: 'DEP-DPO', opinion: 'AGREE', memo: '동의합니다' }).expect(403)).body.error.code).toBe('SEPARATION_OF_DUTY');
  });

  it('협의 요청 만들기 — 업무 절차 근거 확인, 기한은 오늘 이후, 포털 부서끼리도 요청한다', async () => {
    const body = { toDept: 'DEP-PUR', fromDept: 'DEP-FS', activityId: 'FPW.2-A01', targetKind: 'SUPPLIER_PACKAGE', targetId: 'ART-BPRE-2-1.1.0', targetName: '배터리 예열 서비스 SW 1.1.0', summary: '배터리 예열 SW 변경 영향 의견', checks: ['계약 범위'], link: '/supplier/portal?supplier=Tier1-G', dueAt: '2026-11-12' };
    const c = (await http().post('/api/consultations').set(FSM).send(body).expect(201)).body;
    expect(c).toMatchObject({ status: 'OPEN', toDept: 'DEP-PUR', fromDept: 'DEP-FS', requestedBy: 'usr-quality', activityName: expect.any(String) });
    expect(c.consultId).toMatch(/^CON-2026-\d{3}$/);
    expect((await http().get(`/api/audit?target=${c.consultId}`).expect(200)).body.items[0]).toMatchObject({ action: 'CONSULT_REQUEST', result: 'ALLOWED' });
    // 이 활동은 개인정보보호팀에 협의하지 않는다
    expect((await http().post('/api/consultations').set(FSM).send({ ...body, toDept: 'DEP-DPO' }).expect(400)).body.error.message).toMatch(/협의하는 활동이 아닙니다/);
    // 법규인증팀은 이 활동의 수행·책임 부서가 아니다
    await http().post('/api/consultations').set(REG).send({ ...body, fromDept: 'DEP-HOM' }).expect(400);
    await http().post('/api/consultations').set(FSM).send({ ...body, dueAt: '2026-11-01' }).expect(400);
    // 포털 부서끼리도 요청한다 — 법무(조회 계정)가 구매에 오픈소스 계약 조항을 묻는다(그 활동의 수행 부서)
    const leg = (await http().post('/api/consultations').set(VIEWER).send({ ...body, fromDept: 'DEP-LEG', activityId: 'FPW.11-A06' }).expect(201)).body;
    expect(leg).toMatchObject({ fromDept: 'DEP-LEG', fromName: '법무팀' });
    // 신원 없는 쓰기는 401
    await http().post('/api/consultations').send(body).expect(401);
  });

  it('SSO 부서 신원이 확인되지 않으면 본문에 받은 부서를 써도 의견을 기록할 수 없다', () => {
    const service = ctx.app.get(ConsultService);
    const item = service.list({ to: 'DEP-DPO', status: 'OPEN' }).items[0];
    const before = service.detail(item.consultId).consultation.opinions.length;
    const previous = process.env.FF_AUTH;
    process.env.FF_AUTH = 'oidc';
    try {
      expect(() => service.answer(
        { id: 'oidc:unmapped-auditor', role: 'AUDITOR', roles: ['AUDITOR'], correlationId: 'consult-department-test' },
        item.consultId, { department: item.toDept, opinion: 'AGREE', memo: '본문으로 부서를 주장합니다' },
      )).toThrow(/부서 신원/);
      expect(service.detail(item.consultId).consultation.opinions).toHaveLength(before);
    } finally {
      if (previous === undefined) delete process.env.FF_AUTH;
      else process.env.FF_AUTH = previous;
    }
  });

  it('한 건 조회 — 대상·살펴볼 것·근거 활동 이름, 없는 번호는 404', async () => {
    const id = (await http().get('/api/consultations?to=DEP-PUR').expect(200)).body.items[0].consultId;
    const d = (await http().get(`/api/consultations/${id}`).expect(200)).body.consultation;
    expect(d.checks.length).toBeGreaterThan(0);
    expect(d.activityName).toBeTruthy();
    await http().get('/api/consultations/CON-2026-999').expect(404);
  });
});
