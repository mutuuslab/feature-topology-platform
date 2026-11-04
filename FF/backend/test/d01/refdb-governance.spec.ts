// Feature DB 운영 규칙(2026-11-04 하네스 리뷰 후속, 30-95 §6.4·§8) — 작성 역할(감사 조회자 외 모두), 벤치마크 값은 감사·비산정 응답에 없음,
// 마지막 검토 의견이 보완·반대면 승인 막음, 검토자 ≠ 승인자(SOD-15, 계정 기준), 지정 ID 상한·번호 소진 409, 출처 정기 점검 기록,
// 새 컴포넌트 제안은 발행 때 분류 표에, 첫 기동 가져오기 감사(REFDB_SEED).
import { REF_MONEY_FIELDS } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MONEY_AUDIT_MASK } from '../../src/domains/d01-policy/refdb/read-view';
import { readSeedRecord, SEED_PUBLISHER } from '../../src/domains/d01-policy/refdb/refdb-seed';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { RefdbReviewAlertService } from '../../src/domains/d01-policy/refdb/review-alert.service';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const REVIEWER = actor('usr-approver', 'DOMAIN_REVIEWER');
const ADMIN = actor('usr-steward', 'REFDB_ADMIN');
const AT = '2026-11-04T09:00:00.000Z';
const BRAKE = { domain: 'Chassis & Vehicle Dynamics', cluster: 'Brake control', component: 'Brake control (ESC/ABS)' };

type AuditItem = { action: string; result: string; actorId: string; target: string; reason?: string; after?: any };

describe('Feature DB 운영 규칙', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  const http = () => ctx.http();
  beforeAll(async () => {
    ctx = await bootApp({ at: AT });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const audit = async (target: string): Promise<AuditItem[]> => {
    const b = (await http().get(`/api/audit?target=${encodeURIComponent(target)}`).set(ADMIN).expect(200)).body;
    return (b.items ?? b) as AuditItem[];
  };
  const modify = (refId: string, after: Record<string, unknown>, who: Record<string, string> = AUTHOR) => http().post('/api/refdb/changes').set(who).send({ kind: 'MODIFY', refId, after, reason: '근거 갱신' });
  const review = (id: string, opinion: string, who: Record<string, string> = REVIEWER) => http().post(`/api/refdb/changes/${id}/reviews`).set(who).send({ opinion, comment: '도메인 검토 의견' });
  const decide = (id: string, decision: 'APPROVE' | 'REJECT', who: Record<string, string> = ADMIN) => http().post(`/api/refdb/changes/${id}/decision`).set(who).send({ decision, reason: '검토 결과 반영' });

  it('변경 요청 작성은 감사 조회자를 뺀 사람 역할 모두 — 안전 담당도 쓸 수 있고 감사 조회자는 403', async () => {
    await modify('CH-BRK-012', { remark: 'FSM 요청 — 안전 근거 보완' }, actor('usr-safety', 'SAFETY_OFFICER')).expect(201);
    await modify('CH-BRK-013', { remark: '조회자 요청' }, actor('usr-aud', 'AUDITOR')).expect(403);
  });

  it('비산정 역할의 벤치마크 필드 수정은 403과 감사 DENIED, 관리자 수정의 감사에는 값 대신 자리 표시만 남는다', async () => {
    await modify('BC-BCM-004', { benchmarkEur: 1 }).expect(403);
    expect((await audit('BC-BCM-004')).some((a) => a.action === 'REFDB_CHANGE_CREATE' && a.result === 'DENIED' && a.actorId === 'usr-author')).toBe(true);

    const before = (await http().get('/api/refdb/refs/BC-BCM-001').set(ADMIN).expect(200)).body.ref.benchmarkEur;
    const c = (await modify('BC-BCM-001', { benchmarkEur: 987654, remark: '벤치마크 갱신' }, ADMIN).expect(201)).body;
    expect(c.after.benchmarkEur).toBe(987654); // 관리자 응답에는 값이 있다
    const items = await audit(c.changeId);
    const rec = items.find((a) => a.action === 'REFDB_CHANGE_CREATE' && a.result === 'ALLOWED')!;
    expect(rec.after.after.benchmarkEur).toBe(MONEY_AUDIT_MASK);
    expect(before).toBe(100000); // 엑셀 v1.3 값
    expect(rec.after.before.benchmarkEur).toBe(MONEY_AUDIT_MASK);
    const text = JSON.stringify(items);
    expect(text).not.toContain('987654');
    expect(text).not.toContain('100000');
  });

  it('추가 요청 응답은 조회와 같은 역할별 숨김 — 작성자에게는 벤치마크 키가 없고 관리자에게는 있다', async () => {
    const body = { ...BRAKE, nameEn: 'Brake pad wear estimation', nameKo: '브레이크 패드 마모 추정', tshirt: 'S', asilRep: 'QM', basisNote: '사내 실적 2건' };
    const r = (await http().post('/api/refdb/requests').set(AUTHOR).send(body).expect(201)).body;
    expect(REF_MONEY_FIELDS.every((k) => !(k in r.ref) && !(k in r.change.after))).toBe(true);
    const a = (await http().post('/api/refdb/requests').set(ADMIN).send({ ...body, nameEn: 'Brake pad wear alert', nameKo: '브레이크 패드 마모 알림' }).expect(201)).body;
    expect(REF_MONEY_FIELDS.every((k) => k in a.ref && k in a.change.after)).toBe(true);
  });

  it('검토 의견을 낸 사람은 그 요청을 승인·반려할 수 없다(403 SOD-15, 계정 기준) — 거부는 감사에, 문구에는 규칙 ID가 없다', async () => {
    const c = (await modify('CH-BRK-010', { remark: 'SOD-15 확인' }).expect(201)).body;
    await review(c.changeId, 'AGREE', actor('usr-both', 'DOMAIN_REVIEWER')).expect(201);
    for (const d of ['APPROVE', 'REJECT'] as const) {
      const r = await decide(c.changeId, d, actor('usr-both', 'REFDB_ADMIN')).expect(403);
      expect(r.body.error.code).toBe('SEPARATION_OF_DUTY');
      expect(r.body.error.details.rule).toBe('SOD-15');
      expect(r.body.error.message).toBe('이 요청에 검토 의견을 낸 사람은 승인·반려할 수 없습니다');
    }
    const denied = (await audit(c.changeId)).filter((a) => a.action === 'REFDB_CHANGE_DECIDE' && a.result === 'DENIED');
    expect(denied).toHaveLength(2);
    expect(denied[0].reason).toContain('SOD-15');
    expect((await decide(c.changeId, 'APPROVE').expect(201)).body.status).toBe('APPROVED'); // 다른 관리자는 승인한다
  });

  it('마지막 검토 의견이 반대면 승인을 막는다(422) — 반려는 할 수 있다', async () => {
    const c = (await modify('CH-BRK-011', { remark: '반대 의견 확인' }).expect(201)).body;
    await review(c.changeId, 'OPPOSE').expect(201);
    const r = await decide(c.changeId, 'APPROVE').expect(422);
    expect(r.body.error.details).toMatchObject({ code: 'REVIEW_NOT_AGREED', opinion: 'OPPOSE' });
    expect(r.body.error.message).toContain('반대');
    expect((await decide(c.changeId, 'REJECT').expect(201)).body.status).toBe('REJECTED');
  });

  it('추가 요청의 지정 ID는 같은 접두의 다음 번호까지만(400) — 다음 번호는 받는다', async () => {
    const add = (refId: string, nameEn: string) =>
      http()
        .post('/api/refdb/changes')
        .set(AUTHOR)
        .send({ kind: 'ADD', refId, after: { ...BRAKE, nameEn, nameKo: `${nameEn} 기능`, tshirt: 'S', asilRep: 'QM', sourceIds: ['S01'] }, reason: '새 기능' });
    const far = await add('CH-BRK-900', 'Brake far id').expect(400);
    expect(far.body.error.details.field).toBe('refId');
    const next = far.body.error.details.next as string;
    expect(next).toMatch(/^CH-BRK-\d{3}$/);
    expect(Number(next.slice(-3))).toBeLessThan(900);
    expect((await add(next, 'Brake next id').expect(201)).body.refId).toBe(next);
  });

  it('출처 정기 점검 기록 — 관리자만, 확인일·다음 점검일을 바꾸면 기한 목록에서 빠지고 출처마다 감사가 남는다', async () => {
    const svc = ctx.get(RefdbReviewAlertService);
    const clock = ctx.get(Clock);
    clock.set('2026-12-02T00:00:00.000Z');
    try {
      const due = svc.due().map((d) => d.sourceId);
      expect(due.length).toBeGreaterThan(0);
      const body = { sourceIds: due, nextReviewAt: '2027-12-01', note: '정기 점검 — 개정 없음' };
      await http().post('/api/refdb/sources/reviews').set(AUTHOR).send(body).expect(403);
      await http().post('/api/refdb/sources/reviews').set(ADMIN).send({ ...body, sourceIds: ['S99'] }).expect(404);
      await http().post('/api/refdb/sources/reviews').set(ADMIN).send({ ...body, checkedAt: '2026-12-02', nextReviewAt: '2026-11-01' }).expect(400);
      await http().post('/api/refdb/sources/reviews').set(ADMIN).send({ ...body, checkedAt: '2027-01-01', nextReviewAt: '2027-06-01' }).expect(400); // 확인일이 오늘 뒤
      const r = (await http().post('/api/refdb/sources/reviews').set(ADMIN).send(body).expect(201)).body;
      expect(r.items.map((s: { sourceId: string; checkedAt: string; nextReviewAt: string }) => [s.sourceId, s.checkedAt, s.nextReviewAt])).toEqual(due.map((id) => [id, '2026-12-02', '2027-12-01']));
      expect(svc.due()).toEqual([]);
      expect(svc.sweep()).toBe(0);
      const sources = (await http().get('/api/refdb/sources').expect(200)).body.items as { sourceId: string; nextReviewAt: string | null }[];
      expect(sources.find((s) => s.sourceId === due[0])!.nextReviewAt).toBe('2027-12-01');
      const a = (await audit(due[0])).find((x) => x.action === 'REFDB_SOURCE_REVIEW')!;
      expect(a).toMatchObject({ result: 'ALLOWED', actorId: 'usr-steward', reason: '정기 점검 — 개정 없음', after: { checkedAt: '2026-12-02', nextReviewAt: '2027-12-01' } });
    } finally {
      clock.set(AT);
    }
  });

  it('추가 요청이 제안한 새 컴포넌트는 승인 발행 때 분류 표에 생긴다 — 상세의 분류 경로가 채워진다', async () => {
    const r = (
      await http()
        .post('/api/refdb/requests')
        .set(AUTHOR)
        .send({ domain: BRAKE.domain, component: 'Brake by wire actuator', componentAbbr: 'BBW', cluster: 'Brake by wire', nameEn: 'Brake by wire pedal feel', nameKo: '전자식 브레이크 페달 감', tshirt: 'M', asilRep: 'QM', sourceIds: ['S01'] })
        .expect(201)
    ).body;
    expect(r.ref.refId).toBe('CH-BBW-001');
    expect(r.change.newComponent).toEqual({ component: 'Brake by wire actuator', abbr: 'BBW', cluster: 'Brake by wire' });
    await review(r.change.changeId, 'AGREE').expect(201);
    await decide(r.change.changeId, 'APPROVE').expect(201);
    const pub = (await http().post('/api/refdb/releases').set(ADMIN).send({ changeIds: [r.change.changeId] }).expect(201)).body;
    expect(pub.applied[0].taxonomy).toEqual(['CH:Brake by wire', 'CH/Brake by wire actuator']);
    const d = (await http().get('/api/refdb/refs/CH-BBW-001').expect(200)).body;
    expect(d.taxonomy.component).toMatchObject({ nodeId: 'CH/Brake by wire actuator', abbr: 'BBW', parentId: 'CH' });
    expect(d.taxonomy.cluster).toMatchObject({ nodeId: 'CH:Brake by wire', nameEn: 'Brake by wire' });
    // 다음 추가 요청은 이제 분류 표의 약어로 번호를 잇는다
    const next = (await http().post('/api/refdb/requests').set(AUTHOR).send({ domain: BRAKE.domain, component: 'Brake by wire actuator', nameEn: 'Brake by wire fallback', nameKo: '전자식 브레이크 비상 모드', tshirt: 'M', asilRep: 'QM', sourceIds: ['S01'] }).expect(201)).body;
    expect(next.ref.refId).toBe('CH-BBW-002');
  });

  it('첫 기동 가져오기는 감사 REFDB_SEED 한 건 — 행 수와 doc을 바꾼 Feature 버전 목록', async () => {
    const recs = (await audit('v1.3')).filter((a) => a.action === 'REFDB_SEED');
    expect(recs).toHaveLength(1);
    const seed = readSeedRecord(ctx.get(RefdbRepository))!;
    expect(recs[0]).toMatchObject({ actorId: SEED_PUBLISHER, result: 'ALLOWED' });
    expect(recs[0].after.counts.refs).toBe(seed.refs);
    expect(recs[0].after.linkedVersions).toHaveLength(seed.linkedVersions);
    expect(recs[0].after.linkedVersions[0]).toMatch(/^FEAT-\d{5}@\d+\.\d+\.\d+$/);
    expect(recs[0].after.missingVersions.some((v: string) => v.startsWith('FEAT-00022@'))).toBe(true);
  });

  it('일련번호를 999까지 다 쓴 접두는 500이 아니라 409 — 변경 요청·등록 화면 추가 요청 모두', async () => {
    const repo = ctx.get(RefdbRepository);
    const last = repo.getRef('CH-CVC-007')!;
    repo.insertRef({ ...last, refId: 'CH-CVC-999' }, AT);
    const component = last.component;
    const r = await http()
      .post('/api/refdb/changes')
      .set(AUTHOR)
      .send({ kind: 'ADD', after: { domain: BRAKE.domain, cluster: last.cluster, component, nameEn: 'CV extra', nameKo: '상용 추가', tshirt: 'S', asilRep: 'QM', sourceIds: ['S01'] }, reason: '새 기능' })
      .expect(409);
    expect(r.body.error.code).toBe('CONFLICT');
    expect(r.body.error.message).toContain('999');
    await http().post('/api/refdb/requests').set(AUTHOR).send({ domain: BRAKE.domain, component, nameEn: 'CV extra', nameKo: '상용 추가', tshirt: 'S', asilRep: 'QM', basisNote: '사내 실적' }).expect(409);
  });
});
