// 외부 연계 연결 점검(ext-check) — 가짜 fetch로: 성공·인증 실패·못 맞춘 상태·토큰 비출력·GET만 보냄. 네트워크 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldCandidates, getOnly, proposeStatusMap, runCheck, type Env } from './ext-check.ts';

const TOKEN = 'jira-pat-SECRET-7f3a';
const GL_TOKEN = 'glpat-SECRET-9b1c';
const CB_TOKEN = 'cb-SECRET-pw-55';
const WH = 'webhook-SECRET-0042';

type Route = (url: string) => { status: number; body: unknown } | undefined;
function fake(route: Route) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body });
    const r = route(url) ?? { status: 404, body: { errorMessages: ['not found'] } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const J = 'https://jira.corp.example';
const epicStatuses = ['Idea', 'Approved', 'In Progress', 'In Verification', 'Released', 'Deprecated', 'Closed'];
const crStatuses = ['Open', 'In Review', 'Approved', 'Deployed', 'Rolled Back', 'Rejected', 'Closed'];
const FIELDS = [
  { id: 'summary', name: 'Summary', custom: false },
  { id: 'customfield_10101', name: 'Country', custom: true },
  { id: 'customfield_10102', name: 'Vehicle Model', custom: true },
  { id: 'customfield_10103', name: 'Trim', custom: true },
  { id: 'customfield_10140', name: 'Trim Level', custom: true },
  { id: 'customfield_10104', name: 'ASIL', custom: true },
  { id: 'customfield_10105', name: 'Owner Team', custom: true },
  { id: 'customfield_10106', name: 'Owner Org', custom: true },
];
function jira(opts: { authStatus?: number; epic?: string[]; cr?: string[] } = {}): Route {
  return (url) => {
    if (url === `${J}/rest/api/2/myself`) return opts.authStatus ? { status: opts.authStatus, body: {} } : { status: 200, body: { name: 'svc-ff', displayName: 'Feature Platform 연동' } };
    if (url === `${J}/rest/api/2/project/FFP`) return { status: 200, body: { key: 'FFP', name: 'Feature Platform', issueTypes: [{ name: 'Epic' }, { name: 'Change Request' }, { name: 'Bug' }] } };
    if (url === `${J}/rest/api/2/project/FFP/statuses`)
      return {
        status: 200,
        body: [
          { name: 'Epic', statuses: (opts.epic ?? epicStatuses).map((name) => ({ name })) },
          { name: 'Change Request', statuses: (opts.cr ?? crStatuses).map((name) => ({ name })) },
          { name: 'Bug', statuses: [{ name: 'Open' }, { name: 'Done' }] },
        ],
      };
    if (url === `${J}/rest/api/2/field`) return { status: 200, body: FIELDS };
    return undefined;
  };
}
const baseEnv = (): Env => ({ JIRA_URL: `${J}/`, JIRA_TOKEN: TOKEN, JIRA_WEBHOOK_SECRET: WH });

test('성공 — 인증·프로젝트·상태 제안·필드 후보·붙여넣을 환경 변수, 토큰은 없음', async () => {
  const f = fake(jira());
  const r = await runCheck(baseEnv(), f.fn, { jiraProject: 'FFP' });
  assert.match(r.output, /✓ 연결·인증 https:\/\/jira\.corp\.example → Feature Platform 연동 \(svc-ff, Bearer\)/);
  assert.match(r.output, /이슈 유형 'Change Request' 있음/);
  assert.match(r.output, /PROPOSED +'Proposed' 없음 → 제안 'Idea'/);
  assert.match(r.output, /JIRA_EPIC_STATUS='\{"PROPOSED":"Idea"\}'/);
  assert.doesNotMatch(r.output, /JIRA_CR_STATUS=/, 'CR 상태가 기본과 같으면 덮어쓰기 줄이 없다');
  assert.match(r.output, /JIRA_EPIC_PROJECT=FFP\nJIRA_CR_PROJECT=FFP\nJIRA_DEFECT_PROJECT=FFP/);
  assert.match(r.output, /JIRA_FIELD_COUNTRY=customfield_10101/);
  assert.match(r.output, /JIRA_FIELD_TRIM=customfield_10103/, '이름이 정확히 같은 후보 하나는 제안');
  assert.match(r.output, /# JIRA_FIELD_OWNER=  ← 후보: customfield_10105 "Owner Team", customfield_10106 "Owner Org"/);
  assert.match(r.output, /# IF_MODE_14=live  ← 위 점검에 ✕가 없으면 켭니다/);
  // 담당 조직 후보가 둘이라 아직 준비 안 됨
  assert.equal(r.exitCode, 1);
  const all = await runCheck({ ...baseEnv(), JIRA_FIELD_OWNER: 'customfield_10105' }, fake(jira()).fn, { jiraProject: 'FFP' });
  assert.equal(all.exitCode, 0, all.output);
  assert.match(all.output, /✓ 점검한 연계에 막는 문제 없음/);
});

test('인증 실패 — 401은 ✕와 안내, 이후 호출 없음, 종료 코드 1', async () => {
  const f = fake(jira({ authStatus: 401 }));
  const r = await runCheck(baseEnv(), f.fn, { jiraProject: 'FFP' });
  assert.match(r.output, /✕ 연결·인증 https:\/\/jira\.corp\.example — 인증 실패 \(401\)/);
  assert.equal(f.calls.length, 1);
  assert.equal(r.exitCode, 1);
});

test('못 맞춘 상태 — 워크플로에 없는 플랫폼 상태는 ✕와 붙여넣기 안내', async () => {
  const r = await runCheck({ ...baseEnv(), JIRA_FIELD_OWNER: 'customfield_10105' }, fake(jira({ epic: ['To Do', 'In Progress', 'Done'] })).fn, { jiraProject: 'FFP' });
  assert.match(r.output, /✕ +DEPRECATED +'Deprecated' 없음 — 맞출 상태를 못 찾음/);
  assert.match(r.output, /# JIRA_EPIC_STATUS 못 맞춤: .*DEPRECATED/);
  assert.equal(r.exitCode, 1);
  // 제안은 한 JIRA 상태를 두 플랫폼 상태에 주지 않는다
  const m = proposeStatusMap(['PROPOSED', 'APPROVED'], { PROPOSED: 'Proposed', APPROVED: 'Approved' }, { PROPOSED: ['open'], APPROVED: ['open'] }, ['Open']);
  assert.deepEqual(m.map((x) => x.found), ['Open', null]);
});

test('live인데 필수 변수가 빠지면 이름을 말하고 실패', async () => {
  const r = await runCheck({ ...baseEnv(), IF_MODE_14: 'live', JIRA_WEBHOOK_SECRET: '' }, fake(jira()).fn, { jiraProject: 'FFP' });
  assert.match(r.output, /IF_MODE_14=live인데 필수 변수 없음: JIRA_EPIC_PROJECT, JIRA_CR_PROJECT, JIRA_DEFECT_PROJECT, JIRA_WEBHOOK_SECRET/);
  assert.match(r.output, /✕ JIRA_WEBHOOK_SECRET 없음/);
  assert.equal(r.exitCode, 1);
});

test('토큰·비밀값은 어떤 출력에도 없다 — 서버가 오류 문구에 되돌려 보내도 가린다', async () => {
  const env: Env = {
    ...baseEnv(),
    JIRA_USER: 'svc-ff@corp.example',
    GITLAB_URL: 'https://gitlab.corp.example',
    GITLAB_TOKEN: GL_TOKEN,
    GITLAB_PROJECT: 'vehicle/feature-sw',
    CODEBEAMER_URL: 'https://cb.corp.example/cb',
    CODEBEAMER_USER: 'ff',
    CODEBEAMER_TOKEN: CB_TOKEN,
  };
  const echo = (async (url: string) => {
    throw new Error(`connect failed ${url} token=${TOKEN} ${GL_TOKEN} ${CB_TOKEN} ${WH}`);
  }) as unknown as typeof fetch;
  const r = await runCheck(env, echo, { jiraProject: 'FFP' });
  for (const s of [TOKEN, GL_TOKEN, CB_TOKEN, WH]) assert.ok(!r.output.includes(s), s);
  assert.match(r.output, /연결 안 됨/);
  const ok = await runCheck({ ...env, GITLAB_URL: '' }, fake(jira()).fn, { jiraProject: 'FFP' });
  for (const s of [TOKEN, WH]) assert.ok(!ok.output.includes(s), s);
  assert.match(ok.output, /# JIRA_TOKEN — 이미 설정됨\(값은 출력하지 않음\)/);
  assert.match(ok.output, /\(svc-ff, Basic\)/);
});

test('GET만 — 모든 호출이 GET·본문 없음, 다른 메서드는 보내기 전에 막는다', async () => {
  const f = fake((url) => {
    if (url.startsWith('https://gitlab.corp.example/api/v4/user')) return { status: 200, body: { username: 'ff-bot', name: 'FF Bot' } };
    if (url.includes('/api/v4/projects/vehicle%2Ffeature-sw')) return { status: 200, body: { path_with_namespace: 'vehicle/feature-sw', permissions: { project_access: { access_level: 30 } } } };
    if (url === 'https://cb.corp.example/cb/api/v3/projects') return { status: 200, body: [{ id: 1 }] };
    if (url === 'https://cb.corp.example/cb/api/v3/trackers/4711') return { status: 200, body: { name: 'System Requirements' } };
    if (url === 'https://cb.corp.example/cb/api/v3/trackers/4711/fields') return { status: 200, body: [{ name: 'Requirement ID' }] };
    return jira()(url);
  });
  const env: Env = { ...baseEnv(), GITLAB_URL: 'https://gitlab.corp.example', GITLAB_TOKEN: GL_TOKEN, GITLAB_PROJECT: 'vehicle/feature-sw', CODEBEAMER_URL: 'https://cb.corp.example/cb', CODEBEAMER_USER: 'ff', CODEBEAMER_TOKEN: CB_TOKEN, CODEBEAMER_REQ_TRACKER: '4711' };
  const r = await runCheck(env, f.fn, { jiraProject: 'FFP' });
  assert.ok(f.calls.length >= 10);
  for (const c of f.calls) {
    assert.equal(c.method, 'GET', c.url);
    assert.equal(c.body, undefined, c.url);
  }
  assert.equal(f.calls.find((c) => c.url.includes('gitlab'))!.headers['private-token'], GL_TOKEN);
  assert.match(r.output, /✓ 요구 ID 필드 'Requirement ID' 있음/);
  assert.match(r.output, /✓ 프로젝트 vehicle\/feature-sw/);
  const guarded = getOnly(f.fn);
  await assert.rejects(async () => guarded('https://jira.corp.example/rest/api/2/issue', { method: 'POST', body: '{}' }), /GET만/);
  await assert.rejects(async () => guarded('https://jira.corp.example/rest/api/2/issue/X', { method: 'PUT' }), /GET만/);
  assert.ok(!f.calls.some((c) => c.method !== 'GET'));
});

test('필드 후보 — 사용자 정의 필드만, 이름이 같으면 앞', () => {
  assert.deepEqual(fieldCandidates('trim', FIELDS).map((x) => x.id), ['customfield_10103', 'customfield_10140']);
  assert.deepEqual(fieldCandidates('asil', [{ id: 'asil', name: 'ASIL', custom: false }]), []);
});
