// 검토함 대기열·다음 담당자 알림(담당자 E2E W2 — P2-1·P2-3·P1-4·P2-7·P3-6).
//  · Baseline 확정 요청 목록은 계약의 상태 값(PENDING)으로만 묻는다 — 'REQUESTED'처럼 모르는 값은 0건이 아니라 400
//  · /api/work-queues — 정의 승인(PROPOSED·G1~G3 PASS, 작성자 포함)·Release Sign-off 대기·출시 가능·Gate 판정 대기, 요청 시각(since)이 찬다
//  · 알림 — Baseline 요청 → BOM 승인자, Feature DB 변경 요청 → 도메인 검토자·관리자, 보완 의견 → 요청자, Sign-off → 출시 담당·감사
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, confirmSafety, withRef } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const JUDGE = actor('usr-quality', 'GATE_JUDGE');
const APPROVER = actor('usr-approver', 'FEATURE_APPROVER');
const REVIEWER = actor('usr-approver', 'DOMAIN_REVIEWER');
const STEWARD = actor('usr-steward', 'BOM_APPROVER');
const ADMIN = actor('usr-steward', 'REFDB_ADMIN');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');
const VIEWER = actor('usr-viewer', 'AUDITOR');

describe('검토함 대기열·다음 담당자 알림 (W2)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  const http = () => b.http();
  const inbox = async (who: Record<string, string>) => (await http().get('/api/notifications?limit=500').set(who).expect(200)).body.items as any[];
  const judge = (id: string, ver: string, gate: string) => http().post(`/api/features/${id}/versions/${ver}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '판정 근거 확인', evidenceRef: `EV-${gate}-W2` }).then((r: any) => {
      if (r.status !== 201) throw new Error(`${gate} ${r.status} ${JSON.stringify(r.body)}`);
    });
  beforeAll(async () => {
    b = await bootApp({ at: '2026-11-05T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    delete process.env.FF_SCHEDULER;
    delete process.env.GLEO_MODE;
  });

  let created: { featureId: string; version: string };
  it('P2-3 정의 승인 대기 — PROPOSED에서 G1~G3이 PASS면 작성자·요청 시각과 함께 대기열에, 하나라도 비면 빠진다', async () => {
    const c = (await http().post('/api/features').set(AUTHOR).send(withRef({ name: 'W2 대기열 시험 Feature', description: '정의 승인 대기열', requirementIds: ['REQ-W2-001'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201)).body;
    created = { featureId: c.featureId, version: c.version };
    const has = async () => (await http().get('/api/work-queues').expect(200)).body.definitions.find((x: any) => x.featureId === c.featureId);
    await judge(c.featureId, c.version, 'G1');
    await confirmSafety(http, c.featureId, c.version);
    // G2 PASS는 서명된 HARA가 있어야 한다(분석 근거)
    await http().post(`/api/features/${c.featureId}/versions/${c.version}/analysis/hara`).set(actor('usr-safety', 'SAFETY_OFFICER')).send({ docId: 'HARA-W2-001', asil: 'QM', safetyGoals: [{ id: 'SG-01', text: '의도하지 않은 경고를 막는다', asil: 'QM' }], reason: 'HARA 검토' }).expect(201);
    await judge(c.featureId, c.version, 'G2');
    expect(await has()).toBeUndefined();
    await judge(c.featureId, c.version, 'G3');
    const d = await has();
    expect(d).toMatchObject({ featureId: c.featureId, version: c.version, lifecycle: 'PROPOSED', createdBy: 'usr-author' });
    expect(Date.parse(d.since)).toBe(Date.parse('2026-11-05T01:00:00.000Z')); // 마지막 판정(G3) 시각
    const q = (await http().get('/api/work-queues').expect(200)).body;
    // 판정 대기 Gate 목록에는 이 Feature의 PROPOSED 단계 Gate가 더는 없고, 확정한 안전 분류도 빠진다
    expect(q.gates.filter((g: any) => g.featureId === c.featureId)).toEqual([]);
    expect(q.classifications.filter((g: any) => g.featureId === c.featureId)).toEqual([]);
    expect(q.gates.length).toBeGreaterThan(0);
  });

  it('P2-1 Baseline 확정 요청 목록 — PENDING으로 묻고, 모르는 상태(REQUESTED)는 400 · 요청은 BOM 승인자에게 알림', async () => {
    await http().get('/api/baselines/requests?status=REQUESTED').expect(400);
    const { featureId, version } = created;
    await http().post(`/api/features/${featureId}/versions/${version}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '정의 승인' }).expect(200);
    const q = (await http().post('/api/baselines/requests').set(AUTHOR).send({ featureId, version, reason: '확정 요청' }).expect(201)).body;
    const pending = (await http().get('/api/baselines/requests?status=PENDING').expect(200)).body.items;
    expect(pending.map((r: any) => r.requestId)).toContain(q.requestId);
    const n = (await inbox(STEWARD)).find((x) => x.eventType === 'baseline.requested');
    expect(n).toMatchObject({ category: 'APPROVAL', link: `/baselines?request=${q.requestId}` });
    expect(n.fields[0].value).toBe(`${featureId} W2 대기열 시험 Feature ${version}`);
    expect((await inbox(AUTHOR)).some((x) => x.eventType === 'baseline.requested')).toBe(false);
  });

  it('P1-4 Release Sign-off 대기 → 서명하면 출시 가능으로 옮겨 가고, 출시 담당·감사에게 알림(서명자 본인 제외)', async () => {
    await confirmSafety(http, 'FEAT-00001', '2.2.0');
    await judge('FEAT-00001', '2.2.0', 'G8');
    await judge('FEAT-00001', '2.2.0', 'G9');
    let q = (await http().get('/api/work-queues').expect(200)).body;
    expect(q.signoffs.find((x: any) => x.featureId === 'FEAT-00001')).toMatchObject({ version: '2.2.0', stale: false });
    await http().post('/api/features/FEAT-00001/versions/2.2.0/release-signoff').set(AUTHOR).send({ reason: '출시 책임 확인 — G8·G9 근거 검토' }).expect(201);
    q = (await http().get('/api/work-queues').expect(200)).body;
    expect(q.signoffs.find((x: any) => x.featureId === 'FEAT-00001')).toBeUndefined();
    expect(q.releasable.find((x: any) => x.featureId === 'FEAT-00001')).toMatchObject({ signedBy: 'usr-author' });
    const n = (await inbox(RELEASE)).find((x) => x.eventType === 'release.signed');
    expect(n).toMatchObject({ category: 'APPROVAL', link: '/features/FEAT-00001/2.2.0' });
    // 맥락 Feature는 payload의 Version(집계 키 'FEAT@ver#release-signoff'를 나누면 틀린 Version)
    expect(n.fields[0].value).toMatch(/2\.2\.0$/);
    expect((await inbox(VIEWER)).some((x) => x.eventType === 'release.signed')).toBe(true);
    expect((await inbox(AUTHOR)).some((x) => x.eventType === 'release.signed')).toBe(false);
  });

  it('P2-7 Feature DB 변경 요청 → 도메인 검토자·관리자에게, 보완 의견 → 요청자에게', async () => {
    const c = (await http().post('/api/refdb/changes').set(AUTHOR).send({ kind: 'MODIFY', refId: 'AD-LON-002', after: { remark: 'W2 — 사내 별칭(SCC) 추가 요청' }, reason: '검색 별칭' }).expect(201)).body;
    expect((await inbox(REVIEWER)).find((x) => x.eventType === 'refdb.change.created' && x.aggregate === c.changeId)).toBeTruthy();
    expect((await inbox(ADMIN)).find((x) => x.eventType === 'refdb.change.created' && x.aggregate === c.changeId)).toBeTruthy();
    expect((await inbox(AUTHOR)).some((x) => x.eventType === 'refdb.change.created')).toBe(false);
    await http().post(`/api/refdb/changes/${c.changeId}/reviews`).set(REVIEWER).send({ opinion: 'REVISE', comment: '출처 근거를 보완하세요' }).expect(201);
    const n = (await inbox(AUTHOR)).find((x) => x.eventType === 'refdb.change.reviewed' && x.aggregate === c.changeId);
    expect(n).toMatchObject({ severity: 'WARNING', link: `/master/feature-db/changes/${c.changeId}` });
    expect((await inbox(ADMIN)).some((x) => x.eventType === 'refdb.change.reviewed' && x.aggregate === c.changeId)).toBe(false);
  });

  it('P2-4 Feature 상세 전이 미리 보기는 묻는 사람의 역할로 — 정의 승인자에게는 역할 막힘이 없다', async () => {
    const f = (await http().get('/api/features?latestOnly=true&lifecycle=PROPOSED').expect(200)).body.items[0];
    const asApprover = (await http().get(`/api/features/${f.featureId}/versions/${f.version}`).set(APPROVER).expect(200)).body;
    const approve = asApprover.transitions.find((t: any) => t.to === 'APPROVED');
    expect(approve.blockers.some((x: any) => x.code === 'ROLE')).toBe(false);
    const asAuthor = (await http().get(`/api/features/${f.featureId}/versions/${f.version}`).set(AUTHOR).expect(200)).body;
    expect(asAuthor.transitions.find((t: any) => t.to === 'APPROVED').blockers.some((x: any) => x.code === 'ROLE')).toBe(true);
  });
});
