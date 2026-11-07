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
import { actor, bootApp, confirmSafety, nextRefId, signG7, withRef } from '../helpers';

// 모의 서버는 tools(Node 타입 스트리핑, .ts 경로 import) — 백엔드 타입 검사(commonjs)에 끌려 들어오지 않게 실행 때 읽고 쓰는 모양만 적는다
interface MockServer {
  url: string;
  close: () => Promise<void>;
  flush: () => Promise<void>;
}
type Deliver = (url: string, headers: Record<string, string>, body: string) => Promise<number>;
interface JiraMock extends MockServer {
  state: () => { issues: Record<string, { type: string; status: string; summary: string; parent: string | null; comments: { body: string }[]; custom: Record<string, unknown> }> };
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
const LIVE_ENV = ['IF_MODE_14', 'IF_MODE_01', 'JIRA_FIELDS', 'CODEBEAMER_PROJECT', 'FF_ALM_WP_GATE', 'JIRA_URL', 'JIRA_USER', 'JIRA_TOKEN', 'JIRA_WEBHOOK_SECRET', 'JIRA_EPIC_PROJECT', 'JIRA_CR_PROJECT', 'JIRA_DEFECT_PROJECT', 'JIRA_FIELD_COUNTRY', 'JIRA_FIELD_VEHICLE_MODEL', 'JIRA_FIELD_TRIM', 'JIRA_FIELD_ASIL', 'JIRA_FIELD_OWNER', 'JIRA_FIELD_FEATURE_DB', 'CODEBEAMER_URL', 'CODEBEAMER_USER', 'CODEBEAMER_TOKEN', 'CODEBEAMER_WEBHOOK_SECRET', 'CODEBEAMER_REQ_TRACKER', 'FF_EXT_SYNC_SEED'];

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
      // 80-50 A2 — 읽기 전용 칸(Feature ID·작업 중·출시 버전·게이트·산출물·링크)은 JIRA_FIELDS 표로(옛 변수와 함께 써도 된다)
      JIRA_FIELDS: JSON.stringify({ featureId: 'customfield_10016', workingVersion: 'customfield_10017', releaseVersion: 'customfield_10018', gates: 'customfield_10019', workProducts: 'customfield_10020', functionId: 'customfield_10022', workProduct: 'customfield_10023', incidentId: 'customfield_10024' }),
      CODEBEAMER_URL: `${cb.url}/cb`,
      CODEBEAMER_USER: 'ff-sync',
      CODEBEAMER_TOKEN: 'cb-mock-token',
      CODEBEAMER_WEBHOOK_SECRET: SECRET.CB,
      CODEBEAMER_REQ_TRACKER: String(trackerId('SYS_REQ')),
      // 80-50 A4 — 산출물 8종 트래커는 프로젝트 트래커 이름으로 찾는다
      CODEBEAMER_PROJECT: '52',
      // 앞 시험들은 게이트 흐름만 본다 — 산출물 게이트(live 기본 enforce)는 마지막 시험에서 켠다
      FF_ALM_WP_GATE: 'warn',
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
    // Epic = Feature(80-50 A2) — 제목 [FF] 이름 — 범위, Feature ID는 사용자 필드
    expect(await issue(epicKey)).toMatchObject({ type: 'Epic', status: 'Proposed', summary: '[FF] 계약 시험 Feature — KR/NX4 PE/Premium' });
    expect(t.epic).toMatchObject({ status: 'Proposed', syncState: 'SYNCED', url: `${jira.url}/browse/${epicKey}` });
    // FF가 쓴 Epic 사용자 필드(REST v3 본문, 필드 ID는 설정 표)
    expect((await issue(epicKey)).custom).toMatchObject({ customfield_10010: 'KR', customfield_10011: 'NX4 PE', customfield_10012: 'Premium', customfield_10013: { value: 'QM' }, customfield_10016: featureId, customfield_10017: '0.1.0', customfield_10018: null });
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

  // 80-50 A2 — 필드 주인: 범위는 JIRA에서 바꿀 수 없다(되돌림·댓글)
  it('JIRA에서 Epic 국가 칸을 바꾸면 플랫폼이 되돌리고 사유 댓글', async () => {
    await fetch(`${jira.url}/_mock/act`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: epicKey, as: 'kim.author', fields: { customfield_10010: 'US' } }) });
    await settle();
    const it = await issue(epicKey);
    expect(it.custom.customfield_10010).toBe('KR');
    expect(it.comments.at(-1)?.body).toContain('국가은(는) 바꿀 수 없습니다');
    expect((await inbox()).find((r) => r.key === epicKey && r.externalUser === 'kim.author' && /필드 변경 거부/.test(r.summary))).toMatchObject({ outcome: 'REJECTED' });
  });

  // 80-50 A2 §4.5 — 웹훅이 유실된 변경은 증분 대사가 JQL·변경 이력으로 찾아 같은 가드로
  it('웹훅 유실 → 증분 대사(search/jql·changelog)가 변경한 사람의 요청으로 받아 거부·되돌림', async () => {
    await fetch(`${jira.url}/_mock/drop-next-webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await fetch(`${jira.url}/_mock/act`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: epicKey, as: 'kim.author', transition: 'In Verification' }) });
    await jira.flush();
    expect((await issue(epicKey)).status).toBe('In Verification');
    const run = (await http().post('/api/integrations/sync/reconcile').set(INTEGRATOR).send({ system: 'JIRA', kind: 'INCREMENTAL' }).expect(200)).body;
    expect(run).toMatchObject({ kind: 'INCREMENTAL', errors: 0 });
    expect(run.applied).toBeGreaterThanOrEqual(1);
    await settle();
    expect((await issue(epicKey)).status).toBe('In Progress');
    const rows = (await inbox()).filter((r: any) => r.key === epicKey && r.externalUser === 'kim.author');
    expect(rows.some((r: any) => r.outcome === 'REJECTED' && r.deliveryId.startsWith('reconcile:'))).toBe(true);
  });

  // 80-50 A2 §4.4 — JIRA에서 FF 앱 필드를 채운 Epic → PROPOSED Feature 등록, 새 Version이면 Epic이 Proposed로 돌아간다
  it('JIRA Epic(범위·Feature DB 필드) → Feature 등록 · 새 Version → 같은 Epic이 작업 중 버전(Proposed)', async () => {
    const created = await fetch(`${jira.url}/rest/api/3/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from('kim.author:kim-token').toString('base64')}` },
      body: JSON.stringify({ fields: { project: { key: 'FFE' }, issuetype: { name: 'Epic' }, summary: '계약 시험 JIRA 출발', description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'JIRA에서 시작한 Feature' }] }] }, customfield_10010: 'KR', customfield_10011: 'NX4 PE', customfield_10012: 'Premium', customfield_10013: { value: 'QM' }, customfield_10014: 'ADAS상품기획팀', customfield_10015: [nextRefId('QM')] } }),
    });
    const key = ((await created.json()) as { key: string }).key;
    await settle();
    const row = (await inbox()).find((r) => r.key === key && r.externalUser === 'kim.author');
    expect(row).toMatchObject({ outcome: 'APPLIED', summary: expect.stringMatching(/자동 등록\(PROPOSED\)/) });
    const fid = /→ (FEAT-\d{5})@/.exec(row!.summary)![1];
    expect((await issue(key)).summary).toBe('[FF] 계약 시험 JIRA 출발 — KR/NX4 PE/Premium');
    expect((await issue(key)).custom.customfield_10016).toBe(fid);
    // 출시까지 가지 않아도 새 Version은 만들 수 있다 — 승인 전 Version은 초안 수정이지만, 여기서는 앞 Feature(DEVELOPING)의 새 Version으로 본다
    const v = (await http().post(`/api/features/${featureId}/versions`).set(AUTHOR).send({ baseVersion: '0.1.0', bump: 'minor', reason: '개선', changes: {} }).expect(201)).body.feature.version;
    await settle();
    expect((await issue(epicKey)).status).toBe('Proposed');
    expect((await issue(epicKey)).custom.customfield_10017).toBe(v);
    expect((await trace(v)).epic.key).toBe(epicKey);
  });

  // 80-50 A3 — Story = 기능 분해: 양쪽에서 시작, 기능 ID는 FF가 매기고 Story 칸에 적는다
  it('Story ↔ 기능 — FF 초안 기능은 Epic 아래 Story로, JIRA에서 만든 Story는 기능 분해 초안에 더하고 기능 ID를 적는다', async () => {
    const ver = (await trace('0.2.0')).version;
    await http().patch(`/api/features/${featureId}/versions/${ver}`).set(AUTHOR).send({ functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }, { label: '정차 판정' }] }).expect(200);
    await settle();
    const all = jira.state().issues;
    const story = Object.values(all).find((i) => i.type === 'Story' && i.summary === '정차 판정')!;
    expect(story).toMatchObject({ parent: epicKey, custom: { customfield_10022: expect.stringMatching(/^FUNC-\d{6}$/) } });
    // JIRA에서 작성자가 Story를 만든다(FF 칸 비움)
    const made = await fetch(`${jira.url}/rest/api/3/issue`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from('kim.author:kim-token').toString('base64')}` }, body: JSON.stringify({ fields: { project: { key: 'FFE' }, issuetype: { name: 'Story' }, summary: '홀드 해제 조건', parent: { key: epicKey } } }) });
    const sk = ((await made.json()) as { key: string }).key;
    await settle();
    const f = (await http().get(`/api/features/${featureId}/versions/${ver}`).expect(200)).body.feature;
    const fn = f.functions.find((x: any) => x.label === '홀드 해제 조건');
    expect(fn?.functionId).toMatch(/^FUNC-\d{6}$/);
    expect(jira.state().issues[sk].custom.customfield_10022).toBe(fn.functionId);
    expect(jira.state().issues[sk].comments.at(-1)?.body).toContain(fn.functionId);
  });

  // 80-50 A3 — 현장 문제: 운영 인시던트(주의) → Feature Epic 아래 Bug(FF Incident 칸)
  it('운영 인시던트 → JIRA Bug(Epic 아래, 인시던트 칸) — 결함 프로젝트', async () => {
    const inc = (await http().post('/api/incidents').set(actor('usr-operator', 'OPERATOR')).send({ source: 'DEALER', vin: null, featureId, category: 'NO_ACTIVATION', severity: 'CRITICAL', summary: '대리점 보고 — 작동하지 않음' }).expect(201)).body;
    await settle();
    const bug = Object.values(jira.state().issues).find((i) => i.type === 'Bug' && i.custom.customfield_10024 === inc.incidentId);
    expect(bug).toMatchObject({ parent: epicKey, status: 'Open', summary: expect.stringContaining('작동하지 않음') });
  });

  // 80-50 A4 — codeBeamer 산출물: 트래커 이름·스키마로 칸 번호를 찾고 cbQL(FF Feature ID·요구 ID)·items/relations로 모은다
  it('codeBeamer 산출물 수집(cbQL·관계) → 완결성·누락, 미완결 종류는 JIRA Task(Epic 아래)', async () => {
    const ver = '0.2.0';
    const seeded = await fetch(`${cb.url}/_mock/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { ref: 'sw', tracker: 'SW_REQ', name: '정차 판정 SW 요구', fields: { 'FF Feature ID': featureId }, status: 'Approved' },
          { ref: 'arch', tracker: 'SYS_ARCH', name: '정차 판정 시스템 아키텍처', fields: { 'FF Feature ID': featureId }, status: 'In Review' },
          { ref: 'test', tracker: 'TEST_SPEC', name: '정차 판정 시험', fields: { 'FF Feature ID': featureId }, status: 'Approved' },
        ],
        relations: [
          { from: 'sw', to: reqItem, kind: 'association', type: 'derived' },
          { from: 'arch', to: reqItem, kind: 'association', type: 'allocated' },
          { from: 'test', to: reqItem, kind: 'association', type: 'verifies' },
          { from: 'test', to: 'sw', kind: 'association', type: 'verifies' },
        ],
      }),
    });
    const ids = ((await seeded.json()) as { ids: Record<string, number> }).ids;
    const v = (await http().post(`/api/alm/features/${featureId}/${ver}/work-products/refresh`).set(INTEGRATOR).send({}).expect(200)).body;
    expect(v.items.map((i: any) => i.key).sort()).toEqual([`CB-${reqItem}`, `CB-${ids.sw}`, `CB-${ids.arch}`, `CB-${ids.test}`].sort());
    expect(v.items.find((i: any) => i.key === `CB-${reqItem}`)).toMatchObject({ kind: 'SYS_REQ', approved: true, url: `${cb.url}/cb/issue/${reqItem}` });
    const row = (k: string) => v.result.kinds.find((x: any) => x.kind === k);
    expect(row('SYS_REQ')).toMatchObject({ required: true, passed: true });
    expect(row('SYS_ARCH')).toMatchObject({ approved: 0, passed: false });
    expect(row('SW_REQ')).toMatchObject({ passed: false });
    expect(v.result.problems.map((p: any) => p.rule)).toEqual(expect.arrayContaining(['WP-1', 'WP-3']));
    await settle();
    const tasks = Object.values(jira.state().issues).filter((i) => i.type === 'Task' && i.parent === epicKey);
    expect(tasks.map((t) => t.summary)).toEqual(expect.arrayContaining([`[산출물] SYS.3 시스템 아키텍처 — ${ver}`, `[산출물] SWE.2 SW 아키텍처 — ${ver}`]));
    expect(tasks.find((t) => t.summary.includes('SYS.3'))!.custom.customfield_10023).toBe('SYS_ARCH');
    expect((await issue(epicKey)).custom.customfield_10020).toMatch(/^산출물 \d+\/\d+ 완결/);
  });

  // 80-50 A5 — live 기본 enforce: 필수 산출물 없으면 G2 PASS 막힘 → codeBeamer에서 채우면 통과(판정 증거) →
  //   승인 뒤 바뀐 요구는 재판정 요청 + codeBeamer 댓글(multipart), codeBeamer 의심 표시(hasSuspectedLink)와 대조, 다시 판정하면 닫힘
  it('산출물 게이트(enforce) — 막힘 → 채우면 G2 PASS → 승인 뒤 변경은 재판정 요청·codeBeamer 댓글 → 재판정으로 닫힘', async () => {
    delete process.env.FF_ALM_WP_GATE;
    const f = await http().post('/api/features').set(AUTHOR).send(withRef({ name: '계약 시험 산출물 게이트', description: 'A5', requirementIds: ['REQ-CT-0501'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201);
    const id = f.body.featureId;
    await confirmSafety(http, id, '0.1.0');
    const judge = (gate: string) => http().post(`/api/features/${id}/versions/0.1.0/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${gate}` });
    expect((await judge('G1')).status).toBe(201);
    await http().post(`/api/alm/features/${id}/0.1.0/work-products/refresh`).set(INTEGRATOR).send({}).expect(200);
    const blocked = await judge('G2');
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body.error.details)).toContain('시스템 요구 승인 항목 0건');
    const seeded = await fetch(`${cb.url}/_mock/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { ref: 'sys', tracker: 'SYS_REQ', name: '게이트 시험 시스템 요구', fields: { 'FF Feature ID': id, 'Requirement ID': 'REQ-CT-0501' }, status: 'Approved' },
          { ref: 'cs', tracker: 'CS_REQ', name: '정책 위·변조 방지', fields: { 'FF Feature ID': id }, status: 'Approved' },
          { ref: 'sw', tracker: 'SW_REQ', name: '게이트 시험 SW 요구', fields: { 'FF Feature ID': id }, status: 'Approved' },
        ],
        relations: [
          { from: 'sw', to: 'sys', kind: 'association', type: 'derived' },
          { from: 'sw', to: 'cs', kind: 'association', type: 'allocated' },
        ],
      }),
    });
    const ids = ((await seeded.json()) as { ids: Record<string, number> }).ids;
    await http().post(`/api/alm/features/${id}/0.1.0/work-products/refresh`).set(INTEGRATOR).send({}).expect(200);
    const g2 = await judge('G2');
    expect(g2.status).toBe(201);
    // 승인 뒤 시스템 요구 개정(codeBeamer 화면에서 사람이) — 아래 관계가 codeBeamer에서도 의심 표시
    await fetch(`${cb.url}/_mock/act`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ids.sys, as: 'lee.engineer', fields: { Description: '감지 거리 개정' } }) });
    const v = (await http().post(`/api/alm/features/${id}/0.1.0/work-products/refresh`).set(INTEGRATOR).send({}).expect(200)).body;
    expect(v.changes[0]).toMatchObject({ itemKey: `CB-${ids.sys}`, fromVersion: 1, toVersion: 2 });
    expect(v.items.find((i: any) => i.key === `CB-${ids.sw}`)).toMatchObject({ suspect: true, cbSuspected: true });
    expect(v.rejudge).toEqual([expect.objectContaining({ gate: 'G2', status: 'OPEN', itemKey: `CB-${ids.sys}` })]);
    await settle();
    const comments = cb.state().items[String(ids.sys)].comments;
    expect(comments.some((c) => /승인 뒤 변경\(v1 → v2\).*G2 재판정 요청/.test(c.comment) && c.createdBy === 'ff-sync')).toBe(true);
    expect((await judge('G2')).status).toBe(201);
    const after = (await http().get(`/api/alm/rejudge?featureId=${id}`).expect(200)).body.items;
    expect(after[0]).toMatchObject({ status: 'RESOLVED', resolvedBy: 'choi.judge' });
    // HTTP 왕복이 많아(두 모의 서버 + 플랫폼) 전체 시험 부하에서는 기본 20초를 넘는다
  }, 60_000);
});
