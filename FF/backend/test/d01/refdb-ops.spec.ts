// Feature DB 운영·감사 보강(W5, 담당자 개선 P1-8·P5-3~P5-7·P5-10) — 사내 용어·연결 Feature 이름 검색, 승인됨·발행 대기 표시,
// 발행 미리 보기(폐기·알림·품질 변화·메모 기본값), 출처 점검 결과(개정 → 영향 행), 변경 요청 감사 이력, 감사 앞부분 검색·행위 필터·체인 검증 시각.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const REVIEWER = actor('usr-approver', 'DOMAIN_REVIEWER');
const ADMIN = actor('usr-steward', 'REFDB_ADMIN');
const ATTR = { swStack: 'Application', lifecycle: 'Commodity', techStack: 'Automotive' };

describe('Feature DB 운영·감사 보강', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  const http = () => ctx.http();
  beforeAll(async () => {
    ctx = await bootApp({ at: '2026-11-05T09:00:00.000Z' });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const ids = (body: { items: { refId: string }[] }) => body.items.map((r) => r.refId);
  const add = (body: Record<string, unknown>) =>
    http()
      .post('/api/refdb/requests')
      .set(AUTHOR)
      .send({ domain: 'Body & Comfort', component: 'Access and locking', tshirt: 'S', asilRep: 'QM', sourceIds: ['S01'], ...body })
      .expect(201);
  const review = (id: string, opinion = 'AGREE') => http().post(`/api/refdb/changes/${id}/reviews`).set(REVIEWER).send({ opinion, comment: '검토 의견' }).expect(201);
  const decide = (id: string, decision: 'APPROVE' | 'REJECT') => http().post(`/api/refdb/changes/${id}/decision`).set(ADMIN).send({ decision, reason: decision === 'APPROVE' ? '근거 확인' : '기존 행과 중복' }).expect(201);

  it('검색 — 사내 용어 SCC와 연결 Feature 이름 스마트 크루즈가 AD-LON-002를 찾는다(P1-8)', async () => {
    // 회귀: 'SCC'·'스마트 크루즈'로 0건이었다(엑셀 용어집에 없고, 기준 행 이름은 '적응형 순항 제어(ACC)')
    expect(ids((await http().get('/api/refdb/refs?q=SCC').expect(200)).body)).toContain('AD-LON-002');
    expect(ids((await http().get(`/api/refdb/refs?q=${encodeURIComponent('스마트 크루즈')}`).expect(200)).body)).toContain('AD-LON-002');
    expect(ids((await http().get(`/api/refdb/refs?q=${encodeURIComponent('스마트크루즈컨트롤')}`).expect(200)).body)).toContain('AD-LON-002');
    // 출처 필터 — 개정된 출처를 쓰는 행만
    const s = (await http().get('/api/refdb/refs?source=S01&limit=200').expect(200)).body;
    expect(s.total).toBeGreaterThan(0);
    expect(s.items.every((r: { sourceIds: string[] }) => r.sourceIds.includes('S01'))).toBe(true);
  });

  it('승인됐지만 발행 전인 요청 중 행은 "승인됨 · 다음 발행 대기"(P5-3)', async () => {
    const r = (await add({ nameEn: 'Key fob battery notice', nameKo: '스마트키 배터리 안내', ...ATTR })).body;
    expect((await http().get(`/api/refdb/refs/${r.ref.refId}`).expect(200)).body.awaitingPublish).toBeNull();
    await review(r.change.changeId);
    await decide(r.change.changeId, 'APPROVE');
    const d = (await http().get(`/api/refdb/refs/${r.ref.refId}`).expect(200)).body;
    expect(d.ref.status).toBe('PENDING');
    expect(d.awaitingPublish).toMatchObject({ changeId: r.change.changeId, label: '승인됨 · 다음 발행 대기' });
  });

  it('발행 미리 보기 — 승인 요청·반려로 폐기될 요청 중 행·알림 받을 Owner·품질 변화·메모 기본값, 아무것도 쓰지 않는다(P5-4)', async () => {
    const rej = (await add({ nameEn: 'Duplicate welcome light', nameKo: '중복 웰컴 라이트', ...ATTR })).body;
    await review(rej.change.changeId, 'OPPOSE');
    await decide(rej.change.changeId, 'REJECT');
    const noAttr = (await add({ nameEn: 'Door ajar chime', nameKo: '문 열림 알림음' })).body;
    await review(noAttr.change.changeId);
    await decide(noAttr.change.changeId, 'APPROVE');
    const before = (await http().get('/api/refdb/quality').expect(200)).body;
    const p = (await http().get('/api/refdb/releases/preview').expect(200)).body;
    expect(p.release).toBe('v1.4');
    // 회귀: 발행 칸은 승인 수만 보였다 — 반려 → 폐기 요청도 같이 묶인다
    expect(p.total).toBe(p.approved.length + p.retiring.length);
    expect(p.retiring).toEqual([expect.objectContaining({ changeId: rej.change.changeId, refId: rej.ref.refId, reason: '기존 행과 중복' })]);
    expect(p.approved.find((a: { changeId: string }) => a.changeId === noAttr.change.changeId)).toMatchObject({ status: 'REVIEW', decidedBy: 'usr-steward' });
    expect(p.quality.before).toMatchObject({ pending: before.pending, published: before.published, awaitingPublish: before.awaitingPublish });
    expect(p.quality.after.pending).toBe(before.pending - p.total);
    expect(p.quality.after.awaitingPublish).toBe(0);
    expect(p.quality.after.attrMissing).toBe(before.attrMissing + 1);
    expect(p.memo).toContain('v1.4');
    expect(p.memo).toContain(rej.change.changeId);
    expect(Array.isArray(p.notify)).toBe(true);
    // 미리 보기는 쓰지 않는다
    expect((await http().get('/api/refdb/quality').expect(200)).body.awaitingPublish).toBe(before.awaitingPublish);
    expect((await http().get('/api/refdb/releases').expect(200)).body.items.at(-1).release).toBe('v1.3');
  });

  it('품질 지표 — 발행본 행 수(요청 중 제외)·요청 중·속성 미입력(P5-7·P5-8)', async () => {
    const q = (await http().get('/api/refdb/quality').expect(200)).body;
    expect(q.published + q.pending).toBe(q.total);
    expect(q.pending).toBe(q.byStatus.PENDING);
    expect(q.attrMissing).toBe(0); // v1.3 행은 모두 채워져 있다 — 위의 속성 없는 요청은 아직 발행 전
  });

  it('변경 요청 감사 이력 — 추가 요청·검토·결정·발행이 한 패널에, 결정·발행자 요약(P5-6)', async () => {
    const r = (await add({ nameEn: 'Seat memory recall', nameKo: '시트 위치 기억 불러오기', ...ATTR })).body;
    const id = r.change.changeId as string;
    await review(id);
    await decide(id, 'APPROVE');
    const pub = (await http().post('/api/refdb/releases').set(ADMIN).send({ note: '감사 이력 시험 발행' }).expect(201)).body;
    const t = (await http().get(`/api/refdb/changes/${id}/audit`).expect(200)).body;
    expect(t.items.map((e: { stage: string }) => e.stage)).toEqual(['REQUEST', 'REVIEW', 'DECIDE', 'PUBLISH']);
    expect(t.items.map((e: { action: string }) => e.action)).toEqual(['REFDB_ADD_REQUEST', 'REFDB_CHANGE_REVIEW', 'REFDB_CHANGE_DECIDE', 'REFDB_RELEASE_PUBLISH']);
    expect(t.decision).toMatchObject({ decision: 'APPROVE', decidedBy: 'usr-steward' });
    expect(t.release).toMatchObject({ release: pub.release.release, publishedBy: 'usr-steward', note: '감사 이력 시험 발행' });
    // 금액 값은 감사에 남기지 않는다(추가 요청 행은 자리 표시)
    expect(JSON.stringify(t.items)).not.toMatch(/"benchmarkEur":\d/);
    await http().get('/api/refdb/changes/CR-2026-999/audit').expect(404);
  });

  it('감사 검색 — 대상 앞부분·행위 필터, 체인 검증 시각(P5-6·P5-10)', async () => {
    const pre = (await http().get('/api/audit?targetPrefix=CR-2026&limit=500').expect(200)).body.items;
    expect(pre.length).toBeGreaterThan(0);
    expect(pre.every((e: { target: string }) => e.target.startsWith('CR-2026'))).toBe(true);
    const dec = (await http().get('/api/audit?action=REFDB_CHANGE_DECIDE&limit=500').expect(200)).body.items;
    expect(dec.length).toBeGreaterThan(0);
    expect(dec.every((e: { action: string }) => e.action === 'REFDB_CHANGE_DECIDE')).toBe(true);
    // %·_는 글자 그대로(LIKE 와일드카드가 아니다)
    expect((await http().get('/api/audit?targetPrefix=%25').expect(200)).body.items).toEqual([]);
    const chain = (await http().get('/api/audit/chain').expect(200)).body;
    expect(chain).toMatchObject({ ok: true, anchors: expect.objectContaining({ configured: expect.any(Boolean) }) });
    expect(chain.checkedAt).toBe('2026-11-05T09:00:00.000Z');
  });

  it('출처 — 다음 점검일 없는 출처 수, 점검 결과 개정 있음이면 그 출처를 쓰는 행을 돌려준다(P5-5)', async () => {
    const s = (await http().get('/api/refdb/sources').expect(200)).body;
    // 회귀: 다음 점검일이 없는 출처는 기한 알림에 걸리지 않는데 화면 경고가 없었다
    expect(s.noNextReview).toBe(s.items.filter((x: { nextReviewAt: string | null }) => !x.nextReviewAt).length);
    expect(s.noNextReview).toBeGreaterThan(0);
    const used = s.items.find((x: { usedBy: number }) => x.usedBy > 0);
    const r = (await http().post('/api/refdb/sources/reviews').set(ADMIN).send({ sourceIds: [used.sourceId], nextReviewAt: '2027-11-05', note: '개정판 확인', result: 'REVISED' }).expect(201)).body;
    expect(r.items[0]).toMatchObject({ sourceId: used.sourceId, lastResult: 'REVISED', nextReviewAt: '2027-11-05' });
    expect(r.affected[0].refIds.length).toBe(used.usedBy);
    const audit = (await http().get(`/api/audit?target=${used.sourceId}&action=REFDB_SOURCE_REVIEW`).expect(200)).body.items[0];
    expect(audit.after).toMatchObject({ result: 'REVISED' });
    // 결과를 비우면 변경 없음 — 영향 행 없음
    const n = (await http().post('/api/refdb/sources/reviews').set(ADMIN).send({ sourceIds: [used.sourceId], nextReviewAt: '2027-12-01', note: '변경 없음 확인' }).expect(201)).body;
    expect(n.items[0].lastResult).toBe('NO_CHANGE');
    expect(n.affected[0].refIds).toEqual([]);
  });
});
