// 실제 연결 계약 시험(80-50 §6 ext:contract) — 독립 모의 JIRA·codeBeamer(tools/ext-mocks)를 임의 포트로 띄우고
// 플랫폼을 IF_MODE_14·01=live로 붙여 HTTP로 끝까지 본다. 프로세스 내 모의(mock-ext.store)가 아니라 실서버 모양의 REST·webhook이다.
//   생성(Epic Proposed·요구 연결) → 승인·개발 착수(Epic이 워크플로를 한 단계씩) → G2 판정 댓글(multipart) →
//   플랫폼 자신의 변경 메아리(서비스 계정 accountId)는 무시 → 권한 없는 사람이 JIRA에서 옮기면 되돌림
// 2026-11-05 모의 서버 기동 점검에서 찾은 결함들의 회귀: 거울 쓰기 실패로 프로세스 종료·한 단계 전이·서비스 계정 메아리 거부·JSON 댓글 415.
import { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, confirmSafety, signG7, withRef } from '../helpers';

// 모의 서버는 tools(Node 타입 스트리핑, .ts 경로 import) — 백엔드 타입 검사(commonjs)에 끌려 들어오지 않게 실행 때 읽고 쓰는 모양만 적는다
interface MockServer {
  url: string;
  close: () => Promise<void>;
  flush: () => Promise<void>;
}
type Deliver = (url: string, headers: Record<string, string>, body: string) => Promise<number>;
interface JiraMock extends MockServer {
  state: () => { issues: Record<string, { type: string; status: string; summary: string; comments: { body: string }[] }> };
}
interface CbMock extends MockServer {
  state: () => { items: Record<string, { comments: { comment: string; createdBy: string }[] }> };
}
const MOCKS = resolve(__dirname, '../../../tools/ext-mocks');
const load = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(MOCKS, name)).href);

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const INTEGRATOR = actor('usr-integrator', 'IMPLEMENTER');

const SECRET = { JIRA: 'contract-jira-webhook-secret-0001', CB: 'contract-cb-webhook-secret-0001' };
const LIVE_ENV = ['IF_MODE_14', 'IF_MODE_01', 'JIRA_URL', 'JIRA_USER', 'JIRA_TOKEN', 'JIRA_WEBHOOK_SECRET', 'JIRA_EPIC_PROJECT', 'JIRA_CR_PROJECT', 'JIRA_DEFECT_PROJECT', 'JIRA_FIELD_COUNTRY', 'JIRA_FIELD_VEHICLE_MODEL', 'JIRA_FIELD_TRIM', 'JIRA_FIELD_ASIL', 'JIRA_FIELD_OWNER', 'JIRA_FIELD_FEATURE_DB', 'CODEBEAMER_URL', 'CODEBEAMER_USER', 'CODEBEAMER_TOKEN', 'CODEBEAMER_WEBHOOK_SECRET', 'CODEBEAMER_REQ_TRACKER', 'FF_EXT_SYNC_SEED'];

describe('실제 연결 계약 — 플랫폼 live ↔ 독립 모의 JIRA·codeBeamer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-ext-contract-'));
  let app: INestApplication;
  let http: () => any;
  let jira: JiraMock;
  let cb: CbMock;
  let trackerId: (key: string) => number;
  let featureId = '';
  let epicKey = '';
  let reqItem = 0;

  beforeAll(async () => {
    const mockEnv = { FF_MOCK_DATA_DIR: dir, FF_MOCK_FRESH: '1', JIRA_WEBHOOK_SECRET: SECRET.JIRA, CB_MOCK_THROTTLE: 'off' };
    // 모의 JIRA webhook → 플랫폼 webhook 수신(서명 원문 그대로). 플랫폼은 포트를 열지 않으므로 supertest로 전달한다
    const J = await load('jira.ts');
    const CB = await load('codebeamer.ts');
    trackerId = CB.trackerId;
    const deliver: Deliver = async (_url, headers, body) => (await http().post('/api/webhooks/jira').set(headers).send(body)).status;
    jira = await J.startJiraMock({ port: 0, env: mockEnv, deliver });
    cb = await CB.startCodebeamerMock({ port: 0, env: mockEnv });
    Object.assign(process.env, {
      IF_MODE_14: 'live',
      IF_MODE_01: 'live',
      JIRA_URL: jira.url,
      JIRA_USER: 'ff-sync@example.com',
      JIRA_TOKEN: 'jira-mock-token',
      JIRA_WEBHOOK_SECRET: SECRET.JIRA,
      JIRA_EPIC_PROJECT: 'FFE',
      JIRA_CR_PROJECT: 'FFCR',
      JIRA_DEFECT_PROJECT: 'FFD',
      JIRA_FIELD_COUNTRY: 'customfield_10010',
      JIRA_FIELD_VEHICLE_MODEL: 'customfield_10011',
      JIRA_FIELD_TRIM: 'customfield_10012',
      JIRA_FIELD_ASIL: 'customfield_10013',
      JIRA_FIELD_OWNER: 'customfield_10014',
      JIRA_FIELD_FEATURE_DB: 'customfield_10015',
      CODEBEAMER_URL: `${cb.url}/cb`,
      CODEBEAMER_USER: 'ff-sync',
      CODEBEAMER_TOKEN: 'cb-mock-token',
      CODEBEAMER_WEBHOOK_SECRET: SECRET.CB,
      CODEBEAMER_REQ_TRACKER: String(trackerId('SYS_REQ')),
      // 운영처럼 프로세스 내 예시 항목을 넣지 않는다 — 외부 항목은 모의 서버에만 있다
      FF_EXT_SYNC_SEED: '0',
    });
    ({ app, http } = await bootApp({ at: '2026-11-05T01:00:00.000Z' }));
    const seeded = await fetch(`${cb.url}/_mock/seed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ ref: 'r1', tracker: 'SYS_REQ', name: '후석 승객 감지 알림', fields: { 'Requirement ID': 'REQ-CT-0001' }, status: 'Approved' }] }) });
    reqItem = ((await seeded.json()) as { ids: Record<string, number> }).ids.r1;
  });
  afterAll(async () => {
    await app?.close();
    await jira?.close();
    await cb?.close();
    for (const k of LIVE_ENV) delete process.env[k];
    rmSync(dir, { recursive: true, force: true });
  });

  /** 보낼 함 비우기 → 모의 JIRA가 보낸 webhook을 플랫폼이 다 받을 때까지 */
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await http().post('/api/integrations/sync/drain').set(INTEGRATOR).send({}).expect(200);
      await jira.flush();
    }
  };
  const issue = async (key: string) => jira.state().issues[key];
  const trace = async (ver: string) => (await http().get(`/api/integrations/sync/features/${featureId}/${ver}`).expect(200)).body;
  const inbox = async () => (await http().get('/api/integrations/sync/inbox').expect(200)).body.items as { key: string; outcome: string; externalUser: string; summary: string }[];

  it('Feature 등록 → 모의 JIRA에 Epic(Proposed)·모의 codeBeamer 요구 연결, 없는 요구 ID는 실패로 남는다', async () => {
    const f = await http().post('/api/features').set(AUTHOR).send(withRef({ name: '계약 시험 Feature', description: '실제 연결 계약', requirementIds: ['REQ-CT-0001', 'REQ-CT-404'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201);
    featureId = f.body.featureId;
    await settle();
    const t = await trace('0.1.0');
    epicKey = t.epic.key;
    expect(epicKey).toMatch(/^FFE-\d+$/);
    expect(await issue(epicKey)).toMatchObject({ type: 'Epic', status: 'Proposed', summary: expect.stringContaining(featureId) });
    expect(t.epic).toMatchObject({ status: 'Proposed', syncState: 'SYNCED', url: `${jira.url}/browse/${epicKey}` });
    expect(t.requirements.map((r: any) => r.key)).toEqual([`CB-${reqItem}`]);
    expect(t.missingRequirements).toEqual(['REQ-CT-404']);
    // 만들기 webhook은 플랫폼 서비스 계정의 메아리 — 거부·매핑 없음으로 남지 않는다
    const mine = (await inbox()).filter((r) => r.key === epicKey);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.outcome === 'IGNORED')).toBe(true);
  });

  it('승인·개발 착수 → Epic이 FF 수명주기 경로대로 In Progress, 중간 상태 메아리도 거부하지 않는다 · G2 판정은 codeBeamer 댓글(multipart)', async () => {
    await http().patch(`/api/features/${featureId}/versions/0.1.0`).set(AUTHOR).send({ functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] }).expect(200);
    await confirmSafety(http, featureId, '0.1.0');
    for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/${featureId}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
    await http().post(`/api/features/${featureId}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
    await signG7(http, featureId, '0.1.0');
    for (const g of ['G4', 'G5', 'G6', 'G7']) await http().post(`/api/features/${featureId}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
    await settle();
    expect((await issue(epicKey)).status).toBe('In Progress');
    expect((await trace('0.1.0')).epic).toMatchObject({ status: 'In Progress', syncState: 'SYNCED' });
    const bad = (await inbox()).filter((r) => r.key === epicKey && r.outcome !== 'IGNORED');
    expect(bad).toEqual([]);
    const comments = cb.state().items[String(reqItem)].comments;
    expect(comments.some((c) => /G2 PASS/.test(c.comment) && c.createdBy === 'ff-sync')).toBe(true);
    const failed = (await http().get('/api/integrations/sync/outbox?system=codebeamer&status=FAILED').expect(200)).body.items;
    expect(failed.filter((j: any) => j.job.op === 'VERIFICATION')).toEqual([]);
  });

  it('권한 없는 사람이 JIRA에서 Epic을 옮기면 플랫폼이 거부하고 워크플로를 따라 되돌린다(사유 댓글)', async () => {
    // kim.author는 작성자 — 검증 완료(VERIFIED) 전이 권한이 없다
    await fetch(`${jira.url}/_mock/act`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: epicKey, as: 'kim.author', transition: 'In Verification' }) });
    await settle();
    const rows = (await inbox()).filter((r) => r.key === epicKey && r.externalUser === 'kim.author');
    expect(rows.at(-1)).toMatchObject({ outcome: 'REJECTED' });
    const it = await issue(epicKey);
    expect(it.status).toBe('In Progress');
    expect(it.comments.at(-1)?.body).toContain('플랫폼이 이 상태 변경을 받지 않았습니다');
    expect((await trace('0.1.0')).lifecycle).toBe('DEVELOPING');
  });
});
