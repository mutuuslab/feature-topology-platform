// Feature DB 버전 발행(30-95 §8.2·§6.4) — 발행 대기 요청을 묶어 v1.4·v1.5…(자동 증가), 기준 행에 차이 적용, 전체 정규화 해시(결정적),
// ref_release 추가만(DELETE·UPDATE 막힘), 요청 중 추가 행 → 활성(근거 메모만이면 검토 필요), 반려된 추가 요청 → 폐기 + 사유 + 연결 Feature Owner 알림.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FeatureRefRow } from '@ff/contracts';
import { actor, bootApp } from '../helpers';
import { DB, type Db } from '../../src/kernel/db';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { nextReleaseId, refdbHash } from '../../src/domains/d01-policy/refdb/release-hash';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const REVIEWER = actor('usr-approver', 'DOMAIN_REVIEWER');
const ADMIN = actor('usr-steward', 'REFDB_ADMIN');

describe('Feature DB 버전 발행', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  const http = () => ctx.http();
  beforeAll(async () => {
    ctx = await bootApp({ at: '2026-11-04T09:00:00.000Z' });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  /** 작성 → 검토 → 승인(또는 반려) */
  async function approved(body: Record<string, unknown>, decision: 'APPROVE' | 'REJECT' = 'APPROVE') {
    const c = (await http().post('/api/refdb/changes').set(AUTHOR).send(body).expect(201)).body;
    await http().post(`/api/refdb/changes/${c.changeId}/reviews`).set(REVIEWER).send({ opinion: 'AGREE', comment: '검토 동의' }).expect(201);
    await http().post(`/api/refdb/changes/${c.changeId}/decision`).set(ADMIN).send({ decision, reason: decision === 'APPROVE' ? '승인합니다' : '기존 행과 중복' }).expect(201);
    return c.changeId as string;
  }
  async function reviewDecide(changeId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    await http().post(`/api/refdb/changes/${changeId}/reviews`).set(REVIEWER).send({ opinion: decision === 'APPROVE' ? 'AGREE' : 'OPPOSE', comment: '검토 의견' }).expect(201);
    await http().post(`/api/refdb/changes/${changeId}/decision`).set(ADMIN).send({ decision, reason }).expect(201);
  }
  const publish = (body: Record<string, unknown> = {}) => http().post('/api/refdb/releases').set(ADMIN).send(body);

  it('발행할 승인 요청이 없으면 409, 발행은 Feature DB 관리자만', async () => {
    await publish().expect(409);
    await http().post('/api/refdb/releases').set(AUTHOR).send({}).expect(403);
  });

  it('v1.3 다음은 v1.4 — 수정 차이를 기준 행에 적용하고 정규화 해시를 남긴다, 다음 발행은 v1.5', async () => {
    const id = await approved({ kind: 'MODIFY', refId: 'CH-BRK-009', after: { nameKo: '오토 홀드(AVH)', tshirt: 'M' }, reason: '명칭 정리' });
    const r = (await publish({ note: '명칭 정리 묶음' }).expect(201)).body;
    expect(r.release).toMatchObject({ release: 'v1.4', publishedBy: 'usr-steward', changeIds: [id], note: '명칭 정리 묶음' });
    expect(r.release.hash).toMatch(/^[0-9a-f]{64}$/);
    const ref = (await http().get('/api/refdb/refs/CH-BRK-009').expect(200)).body.ref;
    expect(ref).toMatchObject({ nameKo: '오토 홀드(AVH)', tshirt: 'M' });
    // 변경 요청은 발행됨 + 묶인 버전 — 화면이 refId·PUBLISHED로 'v1.4에서 바뀜'을 찾는다
    const pub = (await http().get('/api/refdb/changes?refId=CH-BRK-009&status=PUBLISHED').expect(200)).body.items;
    expect(pub).toEqual([expect.objectContaining({ changeId: id, status: 'PUBLISHED', release: 'v1.4', awaitingPublish: false })]);

    const repo = ctx.get(RefdbRepository);
    expect(r.release.hash).toBe(refdbHash(repo.listRefs()));
    await approved({ kind: 'DEPRECATE', refId: 'CH-BRK-017', after: { replacedBy: 'CH-BRK-009' }, reason: '대체 행으로 통합' });
    const r2 = (await publish().expect(201)).body;
    expect(r2.release.release).toBe('v1.5');
    expect((await http().get('/api/refdb/refs/CH-BRK-017').expect(200)).body.ref).toMatchObject({ status: 'DEPRECATED', replacedBy: 'CH-BRK-009' });
    const rels = (await http().get('/api/refdb/releases').expect(200)).body.items.map((x: { release: string }) => x.release);
    expect(rels).toEqual(['v1.3', 'v1.4', 'v1.5']);
  });

  it('해시는 결정적이다 — 행 순서·키 순서와 무관, 요청 중 행은 넣지 않는다', () => {
    const rows = ctx.get(RefdbRepository).listRefs();
    const shuffled = [...rows].reverse().map((r) => Object.fromEntries(Object.entries(r).reverse()) as FeatureRefRow);
    expect(refdbHash(shuffled)).toBe(refdbHash(rows));
    const pending = { ...rows[0], refId: 'ZZ-ZZZ-999', status: 'PENDING' } as FeatureRefRow;
    expect(refdbHash([...rows, pending])).toBe(refdbHash(rows));
    expect(refdbHash([{ ...rows[0], nameKo: rows[0].nameKo + '!' }, ...rows.slice(1)])).not.toBe(refdbHash(rows));
    expect(['v1.3', 'v1.9', undefined].map(nextReleaseId)).toEqual(['v1.4', 'v1.10', 'v1.0']);
  });

  it('발행 이력은 추가만 — DELETE·UPDATE는 DB가 막는다', () => {
    const db = ctx.get<Db>(DB);
    expect(() => db.run("DELETE FROM ref_release WHERE release_id = 'v1.4'")).toThrow(/추가만/);
    expect(() => db.run("UPDATE ref_release SET hash = 'x' WHERE release_id = 'v1.4'")).toThrow(/추가만/);
  });

  it('등록 화면 추가 요청(요청 중 행)은 발행 때 활성 — 근거 메모만이면 검토 필요', async () => {
    const add = (body: Record<string, unknown>) =>
      http()
        .post('/api/refdb/requests')
        .set(AUTHOR)
        .send({ domain: 'Chassis & Vehicle Dynamics', component: 'Brake control (ESC/ABS)', nameEn: 'Brake test mode', nameKo: '제동 시험 모드', tshirt: 'S', asilRep: 'QM', ...body })
        .expect(201);
    const withSource = (await add({ sourceIds: ['S01'] })).body;
    const memoOnly = (await add({ nameEn: 'Brake drying', nameKo: '브레이크 건조', basisNote: '사내 실적 과제 2025-BRK' })).body;
    expect(withSource.ref.status).toBe('PENDING');
    await reviewDecide(withSource.change.changeId, 'APPROVE', '근거 확인');
    await reviewDecide(memoOnly.change.changeId, 'APPROVE', '근거 메모로 우선 승인');
    // 발행 전 — 여전히 요청 중
    expect((await http().get(`/api/refdb/refs/${withSource.ref.refId}`).expect(200)).body.ref.status).toBe('PENDING');
    const r = (await publish().expect(201)).body;
    expect(r.release.release).toBe('v1.6');
    const a = (await http().get(`/api/refdb/refs/${withSource.ref.refId}`).expect(200)).body.ref;
    const b = (await http().get(`/api/refdb/refs/${memoOnly.ref.refId}`).expect(200)).body.ref;
    expect(a).toMatchObject({ status: 'ACTIVE', registeredIn: 'v1.6' });
    expect(b).toMatchObject({ status: 'REVIEW', registeredIn: 'v1.6' });
    expect(a.adminMemo).toContain(withSource.change.changeId);
  });

  it('반려된 추가 요청은 발행 때 폐기(RETIRED) + 사유, 연결한 Feature Owner에게 화면 알림', async () => {
    const req = (
      await http()
        .post('/api/refdb/requests')
        .set(AUTHOR)
        .send({ domain: 'ADAS & AD', component: 'Longitudinal control', nameEn: 'Stop and go plus', nameKo: '정체 구간 주행 보조 플러스', tshirt: 'M', asilRep: 'B', sourceIds: ['S01'] })
        .expect(201)
    ).body;
    const refId = req.ref.refId as string;
    // 요청자가 이 행을 대표로 Feature를 등록했다고 본다(연결 색인) — 시드 Feature FEAT-00005(ADAS기획팀)
    const repo = ctx.get(RefdbRepository);
    const db = ctx.get<Db>(DB);
    const version = db.get<{ version: string }>("SELECT version FROM feature_version WHERE feature_id = 'FEAT-00005' ORDER BY version DESC LIMIT 1")!.version;
    db.tx(() => repo.replaceLinks('FEAT-00005', version, [{ refId, role: 'PRIMARY', refVersion: 'v1.6' }]));
    await reviewDecide(req.change.changeId, 'REJECT', 'AD-LON-002와 범위가 같음');
    // 반려만으로는 아직 요청 중 — 발행이 정리한다
    expect(repo.statusOf(refId)).toBe('PENDING');
    const r = (await publish().expect(201)).body;
    expect(r.retired).toEqual([{ changeId: req.change.changeId, refId, features: [{ featureId: 'FEAT-00005', version }] }]);
    expect(r.release.changeIds).toContain(req.change.changeId);
    const ref = (await http().get(`/api/refdb/refs/${refId}`).expect(200)).body.ref;
    expect(ref.status).toBe('RETIRED');
    expect(ref.adminMemo).toContain('AD-LON-002와 범위가 같음');
    const ch = (await http().get(`/api/refdb/changes/${req.change.changeId}`).expect(200)).body.change;
    expect(ch).toMatchObject({ status: 'REJECTED', release: r.release.release });
    // 알림 — 수신자는 Feature Owner 팀, 발행자 본인은 뺀다
    const n = db.get<{ doc: string }>("SELECT doc FROM notification WHERE json_extract(doc, '$.eventType') = 'refdb.ref.rejected' ORDER BY event_seq DESC LIMIT 1");
    expect(n).toBeDefined();
    const doc = JSON.parse(n!.doc);
    expect(doc.recipients).toEqual([{ kind: 'team', team: 'ADAS기획팀' }]);
    expect(doc.link).toBe(`/features/FEAT-00005/${version}`);
    const inbox = (await http().get('/api/notifications').set(AUTHOR).expect(200)).body.items as { eventType: string; title: string }[];
    expect(inbox.some((x) => x.eventType === 'refdb.ref.rejected' && x.title.includes(refId))).toBe(true);
    // 폐기한 ID는 다시 쓰지 않는다
    const again = (await http().post('/api/refdb/requests').set(AUTHOR).send({ domain: 'ADAS & AD', component: 'Longitudinal control', nameEn: 'Stop and go plus 2', nameKo: '정체 구간 보조 2', tshirt: 'M', asilRep: 'B', sourceIds: ['S01'] }).expect(201)).body;
    expect(again.ref.refId).not.toBe(refId);
  });

  it('발행 때 요청의 전 값이 지금 값과 다르면 막는다(409) — 되돌리기가 정확하게', async () => {
    const id = await approved({ kind: 'MODIFY', refId: 'BC-BCM-001', after: { remark: '발행 경합 시험' }, reason: '비고 갱신' });
    const repo = ctx.get(RefdbRepository);
    const db = ctx.get<Db>(DB);
    const cur = repo.getRef('BC-BCM-001')!;
    db.tx(() => repo.updateRef({ ...cur, remark: '다른 경로로 바뀐 값' }, '2026-11-04T10:00:00.000Z'));
    const r = await publish({ changeIds: [id] }).expect(409);
    expect(r.body.error.details.fields).toEqual(['remark']);
    db.tx(() => repo.updateRef(cur, '2026-11-04T10:00:00.000Z'));
    await publish({ changeIds: [id] }).expect(201);
  });
});
