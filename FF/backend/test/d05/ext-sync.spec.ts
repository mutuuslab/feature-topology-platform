// GitLab · JIRA · codeBeamer 양방향 연계 — 모의 외부 시스템으로 방향별 흐름을 끝까지 본다.
//   보내기: 플랫폼 Lifecycle·게이트·정책 → Epic 상태·CR 상태·요구 검증 결과·MR commit status
//   받기: JIRA Epic·CR 변경 → 가드를 탄 요청(반영/거부·되돌림), codeBeamer 요구 개정 → G2 재검토, GitLab MR 병합·파이프라인 → 변경 기록
//   안전장치: 서명 위조 401, 같은 webhook 두 번 → 한 번만, 매핑 없는 외부 계정 거부, 바깥이 몰래 바뀌면 충돌 → 사람이 고름
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExtAdapters } from '../../src/domains/d05-ext/api-gateway/ext-sync/adapters';
import { ExtSyncRepo } from '../../src/domains/d05-ext/api-gateway/ext-sync/ext-sync.repo';
import { DB } from '../../src/kernel/db';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { actor, bootApp, confirmSafety, nextRefId, signG7, withRef } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');
const INTEGRATOR = actor('usr-integrator', 'IMPLEMENTER');

describe('양방향 연계 — GitLab · JIRA · codeBeamer (모의)', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => {
    ({ app, http, get } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
  });
  afterAll(() => app.close());

  const trace = async (id: string, ver: string) => (await http().get(`/api/integrations/sync/features/${id}/${ver}`).expect(200)).body;
  const epicOf = async (id: string, ver: string) => (await trace(id, ver)).epic;
  const mockItem = async (system: string, key: string) => (await http().get(`/api/integrations/mock/${system}/items`).expect(200)).body.items.find((x: any) => x.key === key);
  const act = (system: string, body: Record<string, unknown>) => http().post(`/api/integrations/mock/${system}/act`).set(AUTHOR).send(body).expect(200);
  const drain = () => http().post('/api/integrations/sync/drain').set(INTEGRATOR).send({}).expect(200);
  const lifecycleOf = async (id: string, ver: string) => (await http().get(`/api/features/${id}/versions/${ver}`).expect(200)).body.feature.lifecycle;

  it('초기 상태: Feature 버전마다 요구(codeBeamer)·Epic(JIRA), 개발 이후는 병합된 MR·파이프라인, 정책마다 CR', async () => {
    const t = await trace('FEAT-00001', '2.1.0');
    expect(t.epic).toMatchObject({ system: 'JIRA', kind: 'EPIC', status: 'In Verification', syncState: 'SYNCED', url: expect.stringMatching(/\/browse\/FFE-\d+$/) });
    expect(t.requirements.length).toBeGreaterThan(0);
    expect(t.requirements[0]).toMatchObject({ system: 'CODEBEAMER', status: 'Approved', url: expect.stringMatching(/\/cb\/issue\/\d+$/) });
    expect(t.mergeRequests[0]).toMatchObject({ system: 'GITLAB', status: 'merged', extra: { pipeline: { status: 'success' } } });
    const s = (await http().get('/api/integrations/sync').expect(200)).body;
    expect(s.items.map((x: any) => [x.system, x.ifId, x.mode])).toEqual([['CODEBEAMER', 'IF-01', 'mock'], ['JIRA', 'IF-14', 'mock'], ['GITLAB', 'IF-13', 'mock']]);
    expect(s.ownership.find((o: any) => o.fact === 'Feature Lifecycle').owner).toBe('PLATFORM');
    // Registry 목록용 한 번 조회 — Feature 버전별 Epic과 플랫폼 Lifecycle 기준 상태
    const epics = (await http().get('/api/integrations/sync/epics').expect(200)).body.items;
    expect(epics.find((e: any) => e.feature === 'FEAT-00001@2.1.0')).toMatchObject({ key: t.epic.key, status: 'In Verification', expected: 'In Verification', syncState: 'SYNCED' });
    const crs = (await http().get('/api/integrations/sync/change-requests').expect(200)).body.items;
    expect(crs.length).toBeGreaterThan(0);
    expect(crs[0].policies[0]).toMatchObject({ policyId: expect.stringMatching(/^POL-/) });
  });

  // Epic = Feature(80-50 §4.1) — 작업 중 버전이 없으면 가장 높은 출시 버전(1.6.0)의 상태를 따른다
  it('JIRA → 플랫폼: 출시 담당이 Epic을 Deprecated로 바꾸면 Epic이 따르는 버전의 Lifecycle 전이 요청으로 반영된다', async () => {
    const epic = await epicOf('FEAT-00002', '1.5.0');
    expect((await trace('FEAT-00002', '1.5.0')).epicVersion).toBe('1.6.0');
    const r = (await act('jira', { key: epic.key, action: 'TRANSITION', status: 'Deprecated', externalUser: 'park.release' })).body;
    expect(r.result).toMatchObject({ outcome: 'APPLIED', summary: expect.stringContaining('RELEASED → DEPRECATED') });
    expect(await lifecycleOf('FEAT-00002', '1.6.0')).toBe('DEPRECATED');
    expect(await lifecycleOf('FEAT-00002', '1.5.0')).toBe('RELEASED');
    const audit = (await http().get('/api/audit?target=FEAT-00002@1.6.0').expect(200)).body.items;
    expect(audit.some((a: any) => a.action === 'FEATURE_TRANSITION RELEASED→DEPRECATED' && a.actorId === 'usr-coordinator')).toBe(true);
    // 메아리: 플랫폼 거울 쓰기는 상태가 같아 댓글만
    expect((await mockItem('jira', epic.key)).status).toBe('Deprecated');
  });

  it.each(['jira', 'codebeamer'])('%s 의견은 공유 원장에 저장되고 webhook·수신함을 거치며 상태·G2를 바꾸지 않는다', async (system) => {
    const beforeTrace = await trace('FEAT-00001', '2.1.0');
    const linked = system === 'jira' ? beforeTrace.epic : beforeTrace.requirements[0];
    const before = await mockItem(system, linked.key);
    const externalUser = system === 'jira' ? 'choi.quality' : 'seo.safety';
    const comment = `${system} 요구 추적 검토 완료`;
    const response = (await act(system, { key: linked.key, action: 'COMMENT', comment: `  ${comment}  `, externalUser })).body;
    expect(response.item.comments.at(-1)).toMatchObject({ by: externalUser, text: comment });
    expect(response.item).toMatchObject({ status: before.status, title: before.title, body: before.body, revision: before.revision + 1 });
    expect(response.result).toMatchObject({ key: linked.key, externalUser, outcome: 'IGNORED', duplicate: false });
    const persisted = await mockItem(system, linked.key);
    expect(persisted.comments).toEqual(response.item.comments);
    const afterTrace = await trace('FEAT-00001', '2.1.0');
    expect(afterTrace.lifecycle).toBe(beforeTrace.lifecycle);
    expect(afterTrace.stale).toEqual(beforeTrace.stale);
    expect(system === 'jira' ? afterTrace.epic.revision : afterTrace.requirements.find((r: any) => r.key === linked.key).revision).toBe(system === 'jira' ? Date.parse(persisted.updatedAt) : persisted.revision);
    const inbox = (await http().get('/api/integrations/sync/inbox').expect(200)).body.items;
    expect(inbox.some((r: any) => r.deliveryId === response.result.deliveryId && r.key === linked.key)).toBe(true);
  });

  it('비어 있거나 초과·혼합·알 수 없는 의견 요청은 원장과 개정 번호를 바꾸기 전에 거부한다', async () => {
    const key = (await epicOf('FEAT-00001', '2.1.0')).key;
    const before = await mockItem('jira', key);
    for (const body of [{}, { comment: '' }, { comment: '   ' }, { comment: 'x'.repeat(2001) }, { comment: '의견', status: 'Approved' }, { comment: '의견', unknown: true }]) {
      await http().post('/api/integrations/mock/jira/act').set(AUTHOR).send({ key, action: 'COMMENT', externalUser: 'kim.author', ...body }).expect(400);
      expect(await mockItem('jira', key)).toEqual(before);
    }
  });

  it('JIRA → 플랫폼 거부: 권한 없는 사람·게이트 미충족이면 Epic을 되돌리고 사유를 댓글로', async () => {
    const epic = await epicOf('FEAT-00013', '0.3.0');
    const byAuthor = (await act('jira', { key: epic.key, action: 'TRANSITION', status: 'Approved', externalUser: 'kim.author' })).body;
    expect(byAuthor.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('권한') });
    let it = await mockItem('jira', epic.key);
    expect(it.status).toBe('Proposed');
    expect(it.comments.at(-1)).toMatchObject({ by: 'feature-platform', text: expect.stringContaining('되돌립니다') });
    const byApprover = (await act('jira', { key: epic.key, action: 'TRANSITION', status: 'Approved', externalUser: 'lee.approver' })).body;
    expect(byApprover.result.outcome).toBe('REJECTED');
    expect(byApprover.result.summary).toMatch(/G[123]/);
    it = await mockItem('jira', epic.key);
    expect(it.status).toBe('Proposed');
    expect(await lifecycleOf('FEAT-00013', '0.3.0')).toBe('PROPOSED');
    const ev = (await http().get('/api/events?type=ext.change.rejected').expect(200)).body.items;
    expect(ev.length).toBeGreaterThanOrEqual(2);
  });

  it('매핑 없는 외부 계정은 받지 않는다(직무 분리를 외부로 우회하지 못함)', async () => {
    const epic = await epicOf('FEAT-00004', '4.1.0');
    const r = (await act('jira', { key: epic.key, action: 'TRANSITION', status: 'Deprecated', externalUser: 'stranger' })).body;
    expect(r.result.outcome).toBe('UNMAPPED');
    expect(await lifecycleOf('FEAT-00004', '4.1.0')).toBe('RELEASED');
    expect((await mockItem('jira', epic.key)).status).toBe('Released');
  });

  it('webhook 서명이 틀리면 401, 같은 delivery는 한 번만 처리', async () => {
    const epic = await epicOf('FEAT-00004', '4.1.0');
    const body = { webhookEvent: 'jira:issue_updated', user: { accountId: 'park.release' }, issue: { key: epic.key, fields: { summary: 'x', issuetype: { name: 'Epic' }, status: { name: 'Deprecated' }, updated: '2026-10-12T02:00:00.000Z' } } };
    await http().post('/api/webhooks/jira').set({ 'x-hub-signature': 'sha256=forged', 'x-atlassian-webhook-identifier': 'd-1' }).send(body).expect(401);
    expect(await lifecycleOf('FEAT-00004', '4.1.0')).toBe('RELEASED');
    // GitLab: 토큰
    await http().post('/api/webhooks/gitlab').set({ 'x-gitlab-token': 'nope' }).send({ object_kind: 'push' }).expect(401);
    const ok1 = await http().post('/api/webhooks/gitlab').set({ 'x-gitlab-token': 'ff-mock-gitlab-token', 'x-gitlab-event-uuid': 'same-1' }).send({ object_kind: 'push' }).expect(202);
    const ok2 = await http().post('/api/webhooks/gitlab').set({ 'x-gitlab-token': 'ff-mock-gitlab-token', 'x-gitlab-event-uuid': 'same-1' }).send({ object_kind: 'push' }).expect(202);
    expect(ok1.body).toMatchObject({ outcome: 'IGNORED', duplicate: false });
    expect(ok2.body.duplicate).toBe(true);
  });

  it('플랫폼 → JIRA: 플랫폼에서 전이하면 댓글이 따라가고, Epic 상태는 Epic이 따르는 버전 상태', async () => {
    // 옛 버전 4.0.1을 내려도 Epic은 4.1.0(가장 높은 출시 버전) 상태 그대로 — 버전은 댓글로 남는다
    await http().post('/api/features/FEAT-00004/versions/4.0.1/transitions').set(RELEASE).send({ to: 'DEPRECATED', reason: '후속 버전으로 대체' }).expect(200);
    await drain();
    const epic = await epicOf('FEAT-00004', '4.0.1');
    expect(epic.key).toBe((await epicOf('FEAT-00004', '4.1.0')).key);
    const it = await mockItem('jira', epic.key);
    expect(it.status).toBe('Released');
    expect(it.comments.at(-1).text).toContain('4.0.1 RELEASED → DEPRECATED');
    expect(epic.syncState).toBe('SYNCED');
  });

  it('충돌: 바깥에서 몰래 바뀐(webhook 유실) Epic은 덮어쓰지 않고 충돌로 — 플랫폼 값을 고르면 다시 보낸다', async () => {
    const epic = await epicOf('FEAT-00004', '4.1.0');
    await act('jira', { key: epic.key, action: 'TRANSITION', status: 'Closed', externalUser: 'park.release', deliver: false });
    await http().post('/api/features/FEAT-00004/versions/4.1.0/transitions').set(RELEASE).send({ to: 'DEPRECATED', reason: '단종' }).expect(200);
    await drain();
    const open = (await http().get('/api/integrations/sync/conflicts?status=OPEN').expect(200)).body.items;
    const c = open.find((x: any) => x.key === epic.key);
    expect(c).toMatchObject({ system: 'JIRA', field: 'status', platformValue: 'Deprecated', externalValue: 'Closed' });
    expect((await epicOf('FEAT-00004', '4.1.0')).syncState).toBe('CONFLICT');
    expect((await mockItem('jira', epic.key)).status).toBe('Closed');
    await http().post(`/api/integrations/sync/conflicts/${c.conflictId}/resolve`).set(AUTHOR).send({ choose: 'PLATFORM', reason: 'x' }).expect(403);
    const r = await http().post(`/api/integrations/sync/conflicts/${c.conflictId}/resolve`).set(INTEGRATOR).send({ choose: 'PLATFORM', reason: '플랫폼 Lifecycle이 기준' }).expect(200);
    expect(r.body.conflict).toMatchObject({ status: 'RESOLVED', resolution: { choose: 'PLATFORM', by: 'usr-integrator' } });
    expect((await mockItem('jira', epic.key)).status).toBe('Deprecated');
    expect((await epicOf('FEAT-00004', '4.1.0')).syncState).toBe('SYNCED');
  });


  // 회귀(2026-11-05, 80-50 A1 모의 서버 기동 점검): 상태 거울 쓰기가 실패하면(워크플로 전이 없음 등) run()의 catch를 빠져나가
  // 주기 drain이 거부되고 처리되지 않은 거부로 백엔드 프로세스가 죽었다(return this.mirrorStatus(...)에 await가 없었음).
  it('거울 쓰기가 외부 오류로 실패해도 drain은 끝나고 작업은 재시도로 남는다(프로세스가 죽지 않음)', async () => {
    const epics = (await http().get('/api/integrations/sync/epics').expect(200)).body.items;
    const target = epics.find((e: any) => e.status === 'Released' && e.expected === 'Released' && !/^FEAT-0000[24]@/.test(e.feature));
    expect(target).toBeTruthy();
    const [id, ver] = target.feature.split('@');
    const jira = app.get(ExtAdapters).of('JIRA');
    const spy = vi.spyOn(jira, 'write').mockRejectedValueOnce(new Error("JIRA: 'Deprecated'(으)로 가는 워크플로 전이가 없습니다"));
    try {
      await http().post(`/api/features/${id}/versions/${ver}/transitions`).set(RELEASE).send({ to: 'DEPRECATED', reason: '후속 버전으로 대체' }).expect(200);
      const r = (await drain()).body;
      expect(r.failed).toBeGreaterThanOrEqual(1);
      const jobs = (await http().get('/api/integrations/sync/outbox?system=jira').expect(200)).body.items;
      expect(JSON.stringify(jobs)).toContain('워크플로 전이가 없습니다');
    } finally {
      spy.mockRestore();
    }
  });

  describe('Epic = Feature (80-50 A2) — 필드 주인·새 Version·대사', () => {
    const signed = (body: unknown) => {
      const raw = JSON.stringify(body);
      return http().post('/api/webhooks/jira').set({ 'content-type': 'application/json', 'x-hub-signature': `sha256=${createHmac('sha256', 'ff-mock-jira-secret').update(raw).digest('hex')}`, 'x-atlassian-webhook-identifier': `t-${Math.random()}` }).send(raw);
    };
    const reconcile = (kind: 'INCREMENTAL' | 'FULL') => http().post('/api/integrations/sync/reconcile').set(INTEGRATOR).send({ system: 'JIRA', kind }).expect(200);

    it('초기 상태: Feature마다 Epic 하나가 모든 버전에 연결되고 제목·범위·버전·게이트 칸을 FF가 쓴다', async () => {
      const a = await epicOf('FEAT-00001', '2.1.0');
      const b = await epicOf('FEAT-00001', '2.2.0');
      expect(a.key).toBe(b.key);
      const it = await mockItem('jira', a.key);
      expect(it.title).toMatch(/^\[FF\] .+ — .+\/.+\/.+$/);
      expect(it.fields.epic).toMatchObject({ featureId: 'FEAT-00001', workingVersion: '2.2.0', country: expect.any(String) });
      expect(it.fields.epic.gates).toMatch(/^G1 /);
      const epics = (await http().get('/api/integrations/sync/epics').expect(200)).body.items;
      expect(new Set(epics.filter((e: any) => e.feature.startsWith('FEAT-00001@')).map((e: any) => e.key)).size).toBe(1);
    });

    it('새 Version을 만들면 같은 Epic에 연결되고 Epic이 그 버전(Proposed)을 따른다 — 사람이 Proposed로 옮기면 되돌림', async () => {
      const before = await epicOf('FEAT-00022', '1.0.0');
      const v = (await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', bump: 'minor', reason: '개선', changes: {} }).expect(201)).body.feature.version;
      await drain();
      const after = await epicOf('FEAT-00022', v);
      expect(after.key).toBe(before.key);
      const it = await mockItem('jira', after.key);
      expect(it.status).toBe('Proposed');
      expect(it.fields.epic).toMatchObject({ workingVersion: v, releaseVersion: '1.0.0' });
      // 출시만 있는 Feature에서 사람이 Epic을 Proposed로 — FF 전이가 아니므로 거부(새 Version은 플랫폼에서)
      const rel = await epicOf('FEAT-00004', '4.1.0');
      const r = (await act('jira', { key: rel.key, action: 'TRANSITION', status: 'Proposed', externalUser: 'park.release' })).body;
      expect(r.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('새 Version은 플랫폼에서') });
      expect((await mockItem('jira', rel.key)).status).not.toBe('Proposed');
    });

    it('범위(국가)·읽기 전용 칸을 JIRA에서 바꾸면 되돌리고 사유 댓글', async () => {
      const epic = await epicOf('FEAT-00022', '1.0.0');
      const r = (await act('jira', { key: epic.key, action: 'EDIT', scope: { country: 'US' }, externalUser: 'kim.author' })).body;
      expect(r.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('국가') });
      let it = await mockItem('jira', epic.key);
      expect(it.fields.epic.country).toBe('KR');
      expect(it.comments.at(-1)).toMatchObject({ by: 'feature-platform', text: expect.stringContaining('새 Feature로 등록') });
      // 읽기 전용 칸 — 실제 JIRA webhook 모양(사용자 필드 ID)
      const cur = await mockItem('jira', epic.key);
      const res = await signed({ webhookEvent: 'jira:issue_updated', user: { accountId: 'kim.author' }, issue: { key: epic.key, fields: { summary: cur.title, issuetype: { name: 'Epic' }, status: { name: cur.status }, updated: new Date(Date.parse(cur.updatedAt) + 1000).toISOString(), ffReleaseVersion: '9.9.9' } } }).expect(202);
      expect(res.body).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('출시 버전') });
      await drain();
      it = await mockItem('jira', epic.key);
      expect(it.fields.epic.releaseVersion).toBe('1.0.0');
    });

    it('이름·담당 — 작업 중 버전이 PROPOSED면 초안 수정 요청(작성 권한), 아니면 되돌림 · ASIL은 기능안전 담당이 고른다', async () => {
      const epic = await epicOf('FEAT-00013', '0.3.0');
      const it = await mockItem('jira', epic.key);
      const renamed = it.title.replace(/^\[FF\] (.+?) — /, '[FF] $1 개정 — ');
      const r = (await act('jira', { key: epic.key, action: 'EDIT', title: renamed, scope: { ownerId: '샤시상품기획팀' }, externalUser: 'kim.author' })).body;
      expect(r.result).toMatchObject({ outcome: 'APPLIED', summary: expect.stringContaining('초안 0.3.0 수정') });
      const f = (await http().get('/api/features/FEAT-00013/versions/0.3.0').expect(200)).body.feature;
      expect(f.name).toMatch(/ 개정$/);
      expect(f.ownerId).toBe('샤시상품기획팀');
      // 출시된 Feature의 이름은 바꿀 수 없다(새 Version)
      const rel = await epicOf('FEAT-00004', '4.1.0');
      const relItem = await mockItem('jira', rel.key);
      const r2 = (await act('jira', { key: rel.key, action: 'EDIT', title: relItem.title.replace(' — ', ' 2 — '), externalUser: 'kim.author' })).body;
      expect(r2.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('새 Version') });
      await drain();
      expect((await mockItem('jira', rel.key)).title).toBe(relItem.title);
      // ASIL — 충돌(사람이 고름), 외부 값은 기능안전 담당만
      const r3 = (await act('jira', { key: epic.key, action: 'EDIT', scope: { asil: 'D' }, externalUser: 'kim.author' })).body;
      expect(r3.result).toMatchObject({ outcome: 'APPLIED', summary: expect.stringContaining('기능안전 담당 확인 대기') });
      const c = (await http().get('/api/integrations/sync/conflicts?status=OPEN').expect(200)).body.items.find((x: any) => x.key === epic.key && x.field === 'asil');
      expect(c).toMatchObject({ externalValue: 'D' });
      await http().post(`/api/integrations/sync/conflicts/${c.conflictId}/resolve`).set(INTEGRATOR).send({ choose: 'EXTERNAL', reason: '변경 요청' }).expect(403);
      await http().post(`/api/integrations/sync/conflicts/${c.conflictId}/resolve`).set(actor('seo.safety', 'SAFETY_OFFICER')).send({ choose: 'PLATFORM', reason: 'HARA 결과 유지' }).expect(200);
      await drain();
      expect((await mockItem('jira', epic.key)).fields.epic.asil).toBe(f.asil);
    });

    it('웹훅을 놓친 변경은 증분 대사가 같은 가드로 받는다 — 실행 기록이 남는다', async () => {
      const epic = await epicOf('FEAT-00002', '1.6.0');
      // 1.6.0은 앞 시험에서 DEPRECATED — 출시 담당이 JIRA에서 Closed로(웹훅 유실)
      await act('jira', { key: epic.key, action: 'TRANSITION', status: 'Closed', externalUser: 'park.release', deliver: false });
      expect(await lifecycleOf('FEAT-00002', '1.6.0')).toBe('DEPRECATED');
      const run = (await reconcile('INCREMENTAL')).body;
      expect(run).toMatchObject({ kind: 'INCREMENTAL', system: 'JIRA', errors: 0 });
      expect(run.applied).toBeGreaterThanOrEqual(1);
      expect(await lifecycleOf('FEAT-00002', '1.6.0')).toBe('RETIRED');
      const inbox = (await http().get('/api/integrations/sync/inbox?system=jira').expect(200)).body.items;
      expect(inbox.find((x: any) => x.key === epic.key && x.deliveryId.startsWith('reconcile:'))).toMatchObject({ outcome: 'APPLIED', externalUser: 'park.release' });
      // 한 번 더 — 바뀐 것 없음
      expect((await reconcile('INCREMENTAL')).body.applied).toBe(0);
      const runs = (await http().get('/api/integrations/sync/reconcile-runs').expect(200)).body.items;
      expect(runs[0]).toMatchObject({ kind: 'INCREMENTAL', finishedAt: expect.any(String) });
    });

    it('전체 대사 — Epic이 없는 Feature는 만들고, 옛 버전별 Epic은 Feature Epic 하나로 합친다', async () => {
      const store = app.get(ExtAdapters).store;
      // 옛 방식: FEAT-00001 2.1.0에만 따로 연결된 Epic(버전마다 Epic이던 때)
      const legacy = store.create('JIRA', 'EPIC', { title: 'FEAT-00001@2.1.0 옛 Epic', status: 'In Verification', by: 'kim.author' });
      const db = app.get(ExtSyncRepo);
      db.putItem({ system: 'JIRA', kind: 'EPIC', key: legacy.key, url: `https://jira.ff.example/browse/${legacy.key}`, title: legacy.title, status: legacy.status, revision: Date.parse(legacy.updatedAt), syncState: 'SYNCED', syncedAt: null, stale: false, extra: {} });
      db.link('JIRA', legacy.key, 'FEATURE', 'FEAT-00001@2.1.0', 'seed');
      const keep = (await epicOf('FEAT-00001', '2.2.0')).key;
      // Epic 없는 Feature — 연결을 끊어 흉내(live로 처음 붙일 때)
      const lonely = (await epicOf('FEAT-00013', '0.3.0')).key;
      get<any>(DB).run("DELETE FROM ext_link WHERE system = 'JIRA' AND ext_key = ?", lonely);
      const run = (await reconcile('FULL')).body;
      expect(run).toMatchObject({ kind: 'FULL', errors: 0 });
      expect(run.notes.join('\n')).toContain(`이전 Epic ${legacy.key} → ${keep}`);
      expect(run.notes.join('\n')).toContain('FEAT-00013 Epic 만들기');
      expect((await epicOf('FEAT-00001', '2.1.0')).key).toBe(keep);
      const old = await mockItem('jira', legacy.key);
      expect(old.fields).toMatchObject({ labels: ['ff-legacy-epic'], duplicateOf: keep });
      expect(old.comments.at(-1).text).toContain(`${keep}(으)로 합쳤습니다`);
      const made = await epicOf('FEAT-00013', '0.3.0');
      expect(made.key).not.toBe(lonely);
      expect((await mockItem('jira', made.key)).fields.epic.featureId).toBe('FEAT-00013');
    });
  });

  describe('새 Feature 한 건으로 — 요구 연결·CR ↔ 정책 승인·요구 개정·MR 병합', () => {
    let fid: string;
    let pid: string;
    let crKey: string;
    let reqKey: string;
    it('Feature 등록 → 요구 ID를 codeBeamer에서 찾아 연결, 없는 ID는 실패로 남는다(요구 존재 확인)', async () => {
      const known = (await trace('FEAT-00022', '1.0.0')).requirements[0];
      reqKey = known.key;
      const f = await http().post('/api/features').set(AUTHOR).send(withRef({ name: '연계 시험 Feature', description: 'CR', requirementIds: [known.extra.reqId, 'REQ-EXT-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201);
      fid = f.body.featureId;
      await drain();
      const t = await trace(fid, '0.1.0');
      expect(t.epic).toMatchObject({ status: 'Proposed', url: expect.stringContaining('/browse/FFE-') });
      expect(t.requirements.map((r: any) => r.key)).toEqual([reqKey]);
      expect(t.missingRequirements).toEqual(['REQ-EXT-1']);
      const jobs = (await http().get('/api/integrations/sync/outbox?system=codebeamer').expect(200)).body.items;
      expect(jobs.some((j: any) => j.job.op === 'REQ_LINK' && j.job.featureId === fid && /REQ-EXT-1/.test(j.error ?? ''))).toBe(true);
    });

    it('플랫폼 승인 → Epic In Progress(자동 개발 착수), 정책 작성 → CR(본문에 정책 ID) 자동 연결 → 검증 GO → CR In Review', async () => {
      await http().patch(`/api/features/${fid}/versions/0.1.0`).set(AUTHOR).send({ functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] }).expect(200);
      await confirmSafety(http, fid, '0.1.0');
      for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
      await http().post(`/api/features/${fid}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
      await signG7(http, fid, '0.1.0'); // G7 — SM·CSM 두 사람 서명(P3-3)
      for (const g of ['G4', 'G5', 'G6', 'G7']) await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
      await drain();
      expect((await epicOf(fid, '0.1.0')).status).toBe('In Progress');
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: fid, featureVersion: '0.1.0', controlPoint: 'Flag', flagKey: `care_${fid.slice(5)}_flag`, description: '시험 Flag', safeDefault: false, enabled: true }).expect(201);
      pid = c.body.policyId;
      const cr = (await http().post('/api/integrations/mock/jira/items').set(AUTHOR).send({ kind: 'CHANGE_REQUEST', title: `Flag 신설 ${fid}`, body: `정책 ${pid} 신설 요청`, externalUser: 'kim.author' }).expect(201)).body;
      crKey = cr.item.key;
      expect((await http().get(`/api/policies/${pid}/ext-links`).expect(200)).body.items.map((l: any) => l.key)).toEqual([crKey]);
      const v = await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200);
      expect(v.body.run.decision).toBe('GO');
      await drain();
      expect((await mockItem('jira', crKey)).status).toBe('In Review');
    });

    it('작성자가 JIRA에서 CR을 승인하면 거부(승인 권한 없음) → CR 되돌림', async () => {
      const r = (await act('jira', { key: crKey, action: 'TRANSITION', status: 'Approved', externalUser: 'kim.author' })).body;
      expect(r.result.outcome).toBe('REJECTED');
      expect((await mockItem('jira', crKey)).status).toBe('In Review');
      expect((await http().get(`/api/policies/${pid}`).expect(200)).body.policy.status).toBe('VALIDATED');
    });

    it('승인자가 JIRA에서 CR을 승인하면 플랫폼 정책 승인 — 승인자 기록은 매핑된 플랫폼 계정', async () => {
      const r = (await act('jira', { key: crKey, action: 'TRANSITION', status: 'Approved', externalUser: 'lee.approver' })).body;
      expect(r.result).toMatchObject({ outcome: 'APPLIED', summary: expect.stringContaining(`정책 ${pid} 승인`) });
      const p = (await http().get(`/api/policies/${pid}`).expect(200)).body.policy;
      expect(p).toMatchObject({ status: 'APPROVED', approvedBy: 'usr-approver' });
      const list = (await http().get('/api/integrations/sync/change-requests').expect(200)).body.items.find((x: any) => x.key === crKey);
      expect(list.policies[0]).toMatchObject({ policyId: pid, status: 'APPROVED', expectedCrStatus: 'Approved' });
    });

    it('사람이 정책에 CR을 직접 연결 — JIRA에 없는 CR이면 거부', async () => {
      await http().post(`/api/policies/${pid}/change-request`).set(AUTHOR).send({ crKey: 'FFCR-9999' }).expect(422);
      const links = (await http().post(`/api/policies/${pid}/change-request`).set(AUTHOR).send({ crKey }).expect(200)).body.items;
      expect(links.map((l: any) => l.key)).toEqual([crKey]);
    });

    it('codeBeamer → 플랫폼: 요구가 개정되면 연결 Feature에 G2 재검토 표시, G2를 다시 판정하면 내려가고 검증 결과가 codeBeamer에 남는다', async () => {
      const r = (await act('codebeamer', { key: reqKey, action: 'EDIT', title: '감지 거리 요구 (개정)', body: '감지 거리 150 m → 180 m', externalUser: 'jung.req' })).body;
      expect(r.result).toMatchObject({ outcome: 'APPLIED', summary: expect.stringContaining('G2 재검토') });
      expect((await trace(fid, '0.1.0')).stale).toEqual([reqKey]);
      // 같은 요구를 쓰는 다른 Feature에도 표시
      expect((await trace('FEAT-00022', '1.0.0')).stale).toEqual([reqKey]);
      await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: 'G2', inputResult: 'PASS', rationale: '개정 요구 재검토', evidenceRef: 'EV-G2-R2' }).expect(201);
      await drain();
      expect((await trace(fid, '0.1.0')).stale).toEqual([]);
      const it = await mockItem('codebeamer', reqKey);
      expect(it.fields.verifications.at(-1)).toMatchObject({ gate: 'G2', status: 'PASS', featureId: fid, version: '0.1.0' });
    });

    it('GitLab → 플랫폼: MR(본문에 Feature·SW 참조) 병합 → 파이프라인 성공 → 변경 기록, 게이트 결과는 MR commit status로', async () => {
      const cres = await http().post('/api/integrations/mock/gitlab/items').set(AUTHOR).send({ kind: 'MERGE_REQUEST', title: `fix(${fid}@0.1.0): 레이더 편향 보정 ${crKey}`, body: '원인 분석 반영 SW-CARE-SDIST-APP@1.2.1', externalUser: 'han.dev' });
      expect(cres.status).toBe(201);
      const created = cres.body;
      const key = created.item.key;
      expect(created.result).toMatchObject({ outcome: 'APPLIED', summary: expect.stringContaining(`${fid}@0.1.0`) });
      await act('gitlab', { key, action: 'MERGE', externalUser: 'han.dev' });
      // 커버리지를 보고하지 않은 파이프라인 → 변경 기록에 근거가 없어 G5가 막힌다(FFG-CODE-030 — GitLab 결과가 게이트에 그대로 걸림)
      const bare = (await act('gitlab', { key, action: 'PIPELINE', status: 'success', externalUser: 'han.dev' })).body;
      expect(bare.result.summary).toMatch(/변경 기록 CHG-GL-\d+ r1/);
      const blocked = await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: 'G5', inputResult: 'PASS', rationale: 'SW 검증', evidenceRef: 'EV-G5b' }).expect(422);
      expect(blocked.body.error.message).toContain('커버리지');
      const pl = (await act('gitlab', { key, action: 'PIPELINE', status: 'success', coverage: 86.4, externalUser: 'han.dev' })).body;
      expect(pl.result.summary).toMatch(/변경 기록 CHG-GL-\d+ r2/);
      const recs = (await http().get('/api/change-records').expect(200)).body.items;
      expect(recs.some((x: any) => /^CHG-GL-/.test(x.changeId) && x.swId === 'SW-CARE-SDIST-APP')).toBe(true);
      await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: 'G5', inputResult: 'PASS', rationale: 'SW 검증', evidenceRef: 'EV-G5c' }).expect(201);
      await drain();
      const mr = await mockItem('gitlab', key);
      expect(mr.fields.commitStatuses.some((s: any) => s.name === 'ff/gate-G5' && s.state === 'success')).toBe(true);
      const t = await trace(fid, '0.1.0');
      expect(t.mergeRequests.map((m: any) => m.key)).toContain(key);
      expect(t.pipelines.length).toBe(2);
    });
  });

  // 사용자 결정(2026-10-23): Lifecycle은 플랫폼·JIRA 양쪽에서 관리하고, JIRA에서 Epic을 만들면 Feature를 자동으로 만든다.
  describe('JIRA Epic 생성 → PROPOSED Feature 자동 등록', () => {
    // 범위 + 기준 기능 ID(30-95 §7) — 만들 때마다 다른 대표 기준 행(같은 범위 같은 대표 행은 JIRA에서 확인할 수 없어 거부된다)
    const BASE = { country: 'KR', vehicleModel: 'NE1', trim: 'Prestige', asil: 'B', ownerId: '주행보조개발팀' };
    const scope = (refIds: string[] = [nextRefId('B')]) => ({ ...BASE, refIds });
    const createEpic = async (body: Record<string, unknown>) => (await http().post('/api/integrations/mock/jira/items').set(AUTHOR).send({ kind: 'EPIC', ...body }).expect(201)).body;
    const featuresNamed = async (name: string) => (await http().get(`/api/features?q=${encodeURIComponent(name)}`).expect(200)).body.items.filter((x: any) => x.name === name);

    it('작성 권한이 있는 사람이 범위(국가·차종·트림·ASIL·담당 조직)를 채워 Epic을 만들면 PROPOSED 0.1.0이 등록되고 Epic과 연결된다', async () => {
      const primary = nextRefId('B');
      const included = nextRefId('B');
      const r = await createEpic({ title: '차선 변경 보조 고속도로 확장', body: '고속도로 진출입로까지 차선 변경 보조 확장', externalUser: 'kim.author', scope: scope([primary, included]) });
      expect(r.result).toMatchObject({ outcome: 'APPLIED', summary: expect.stringMatching(/FEAT-\d{5}@0\.1\.0 자동 등록/) });
      const [f] = await featuresNamed('차선 변경 보조 고속도로 확장');
      expect(f).toMatchObject({ version: '0.1.0', lifecycle: 'PROPOSED', country: 'KR', vehicleModel: 'NE1', trim: 'Prestige', asil: 'B', ownerId: '주행보조개발팀' });
      // 모의 Epic 본문의 기준 기능 필드(첫 값이 대표)로 연결된다 — 라벨 폴백은 모의·데모에서만(실제 연결은 필드만, 80-50 §4)
      const detail = (await http().get(`/api/features/${f.featureId}/versions/0.1.0`).expect(200)).body.feature;
      expect(detail.featureRefs).toEqual([
        { refId: primary, role: 'PRIMARY', refVersion: 'v1.3' },
        { refId: included, role: 'INCLUDED', refVersion: 'v1.3' },
      ]);
      await drain();
      const t = await trace(f.featureId, '0.1.0');
      expect(t.epic).toMatchObject({ key: r.item.key, status: 'Proposed', syncState: 'SYNCED' });
      const it = await mockItem('jira', r.item.key);
      expect(it.comments.some((c: any) => c.by === 'feature-platform' && c.text.includes(`${f.featureId}@0.1.0`))).toBe(true);
      const audit = (await http().get(`/api/audit?target=${f.featureId}@0.1.0`).expect(200)).body.items;
      expect(audit.some((a: any) => a.action === 'FEATURE_CREATE' && a.actorId === 'usr-author')).toBe(true);
      // 이후 Lifecycle은 양쪽에서 — 플랫폼 상태와 같은 Epic이 하나만 있다(EPIC_MIRROR가 새 Epic을 또 만들지 않음)
      expect((await mockItem('jira', r.item.key)).fields.featureId ?? f.featureId).toBe(f.featureId);
      const epics = (await http().get('/api/integrations/mock/jira/items').expect(200)).body.items.filter((x: any) => x.kind === 'EPIC' && x.title.includes('차선 변경 보조 고속도로 확장'));
      expect(epics).toHaveLength(1);
    });

    it('범위 값이 빠지면 등록하지 않고 빠진 항목을 Epic 댓글로 — 채우면 그때 등록한다', async () => {
      const r = await createEpic({ title: '주차 경로 기억 확장', body: '', externalUser: 'kim.author', scope: { country: 'KR', vehicleModel: 'NE1' } });
      expect(r.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('트림') });
      expect(await featuresNamed('주차 경로 기억 확장')).toHaveLength(0);
      await drain();
      const it = await mockItem('jira', r.item.key);
      expect(it.comments.at(-1)).toMatchObject({ by: 'feature-platform', text: expect.stringMatching(/트림.*ASIL.*담당 조직/) });
      const fixed = (await act('jira', { key: r.item.key, action: 'EDIT', externalUser: 'kim.author', scope: { trim: 'Exclusive', asil: 'QM', ownerId: '주차개발팀', refIds: [nextRefId('QM')] } })).body;
      expect(fixed.result).toMatchObject({ outcome: 'APPLIED' });
      const [f] = await featuresNamed('주차 경로 기억 확장');
      expect(f).toMatchObject({ lifecycle: 'PROPOSED', trim: 'Exclusive', asil: 'QM' });
    });

    it('작성 권한이 없거나 매핑되지 않은 계정의 Epic으로는 Feature를 만들지 않는다', async () => {
      const byApprover = await createEpic({ title: '승인자가 만든 Epic', externalUser: 'lee.approver', scope: scope() });
      expect(byApprover.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('권한') });
      const byStranger = await createEpic({ title: '외부인이 만든 Epic', externalUser: 'stranger', scope: scope() });
      expect(byStranger.result.outcome).toBe('UNMAPPED');
      expect(await featuresNamed('승인자가 만든 Epic')).toHaveLength(0);
      expect(await featuresNamed('외부인이 만든 Epic')).toHaveLength(0);
    });

    it('같은 범위에 이름이 비슷한 Feature가 있으면 새로 만들지 않고 기존 Feature를 댓글로 알려 준다', async () => {
      const first = await createEpic({ title: '야간 보행자 경고', externalUser: 'kim.author', scope: scope() });
      expect(first.result.outcome).toBe('APPLIED');
      const r = await createEpic({ title: '야간 보행자 경고', externalUser: 'kim.author', scope: scope() });
      expect(r.result, JSON.stringify(r.result)).toMatchObject({ outcome: 'REJECTED', summary: expect.stringMatching(/FEAT-\d{5}/) });
      expect(await featuresNamed('야간 보행자 경고')).toHaveLength(1);
    });

    // 30-95 §7 — 기준 기능 ID 없음·없는 ID·폐기 행은 거부(REJECTED + 댓글), 요청 중 행은 JIRA에서 만들 수 없다
    const HINT = 'Feature DB 기준 기능을 골라 주세요';
    const lastComment = async (key: string) => {
      await drain();
      return (await mockItem('jira', key)).comments.at(-1);
    };

    it('기준 기능 ID(FF 앱 필드, 모의는 라벨도)가 없으면 등록하지 않고 FF 패널에서 고르라는 댓글 — 넣으면 그때 등록한다', async () => {
      const r = await createEpic({ title: '후측방 경고 확장', externalUser: 'kim.author', scope: BASE });
      expect(r.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining(HINT) });
      expect(await featuresNamed('후측방 경고 확장')).toHaveLength(0);
      expect(await lastComment(r.item.key)).toMatchObject({ by: 'feature-platform', text: expect.stringContaining(HINT) });
      const fixed = (await act('jira', { key: r.item.key, action: 'EDIT', externalUser: 'kim.author', scope: { refIds: [nextRefId('B')] } })).body;
      expect(fixed.result).toMatchObject({ outcome: 'APPLIED' });
      expect(await featuresNamed('후측방 경고 확장')).toHaveLength(1);
    });

    it('Feature DB에 없는 기준 기능 ID·폐기(RETIRED) 행이면 등록하지 않고 댓글로 알린다', async () => {
      const unknown = await createEpic({ title: '없는 기준 행 Epic', externalUser: 'kim.author', scope: scope(['CH-BRK-999']) });
      expect(unknown.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringMatching(/CH-BRK-999.*Feature DB에 없|Feature DB에 없.*CH-BRK-999/) });
      expect(await lastComment(unknown.item.key)).toMatchObject({ text: expect.stringContaining(HINT) });
      const repo = get<RefdbRepository>(RefdbRepository);
      const retiredId = nextRefId('B');
      repo.updateRef({ ...repo.getRef(retiredId)!, status: 'RETIRED' }, '2026-10-12T01:00:00.000Z');
      const retired = await createEpic({ title: '폐기 행 Epic', externalUser: 'kim.author', scope: scope([retiredId]) });
      expect(retired.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('폐기') });
      expect(await lastComment(retired.item.key)).toMatchObject({ text: expect.stringContaining(HINT) });
      expect(await featuresNamed('없는 기준 행 Epic')).toHaveLength(0);
      expect(await featuresNamed('폐기 행 Epic')).toHaveLength(0);
    });

    it('요청 중(PENDING) 기준 행은 JIRA에서 연결해 등록할 수 없다 — 사람이 등록 화면에서', async () => {
      const req = await http()
        .post('/api/refdb/requests')
        .set(AUTHOR)
        .send({ domain: 'Chassis & Vehicle Dynamics', component: 'BRK', nameEn: 'Hill descent assist plus', nameKo: '경사로 저속 주행 보조 확장', tshirt: 'S', asilRep: 'B', basisNote: '사내 기획서' })
        .expect(201);
      const r = await createEpic({ title: '요청 중 행 Epic', externalUser: 'kim.author', scope: scope([req.body.ref.refId]) });
      expect(r.result).toMatchObject({ outcome: 'REJECTED', summary: expect.stringContaining('요청 중') });
      expect(await featuresNamed('요청 중 행 Epic')).toHaveLength(0);
    });

    it('본문에 FEAT-xxxxx@버전이 있으면 새로 만들지 않고 그 Feature에 연결한다', async () => {
      const r = await createEpic({ title: '기존 Feature 추적용 Epic', body: '대상 FEAT-00013@0.3.0', externalUser: 'kim.author', scope: scope() });
      expect(r.result.outcome).not.toBe('REJECTED');
      expect(await featuresNamed('기존 Feature 추적용 Epic')).toHaveLength(0);
      const t = await trace('FEAT-00013', '0.3.0');
      expect((await http().get(`/api/integrations/sync/features/FEAT-00013/0.3.0`).expect(200)).body.epic).toBeTruthy();
      expect(t.featureId).toBe('FEAT-00013');
    });
  });
});
