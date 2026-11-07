// 실제 연결 어댑터(JIRA REST v2 · GitLab REST v4 · codeBeamer REST v3) — 실서버 대신 요청을 기록하고 정해진 응답을 돌려주는 가짜 fetch로
// 경로·인증 헤더·본문 모양, 기대 개정 충돌, 워크플로 전이 찾기, 설정 누락 안내를 확인한다.
import { afterEach, describe, expect, it } from 'vitest';
import { epicStatusPath, LiveAdapter } from '../../src/domains/d05-ext/api-gateway/ext-sync/live-adapters';

type Route = (method: string, url: string, body: any) => { status: number; body: unknown } | undefined;
const fake = (route: Route) => {
  const calls: { method: string; url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    // FormData(codeBeamer 댓글 multipart)는 필드 객체로 기록한다
    const body = init.body instanceof FormData ? { form: Object.fromEntries(init.body.entries()) } : init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? 'GET', url, headers: init.headers as Record<string, string>, body });
    const r = route(init.method ?? 'GET', url, body) ?? { status: 404, body: {} };
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
};
const ENV = ['JIRA_URL', 'JIRA_USER', 'JIRA_TOKEN', 'JIRA_EPIC_PROJECT', 'JIRA_API', 'JIRA_FIELDS', 'IF_MODE_14', 'JIRA_CR_PROJECT', 'JIRA_DEFECT_PROJECT', 'GITLAB_URL', 'GITLAB_TOKEN', 'GITLAB_PROJECT', 'CODEBEAMER_URL', 'CODEBEAMER_USER', 'CODEBEAMER_TOKEN'];
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

describe('실제 연결 어댑터', () => {
  it('설정이 없으면 무엇을 설정할지 알려 준다(호출하지 않음)', async () => {
    const f = fake(() => undefined);
    const a = new LiveAdapter('JIRA', () => 'live', f.fn);
    await expect(a.read('FFE-1')).rejects.toThrow(/JIRA_URL·JIRA_TOKEN/);
    expect(f.calls).toHaveLength(0);
  });

  it('JIRA — Basic 인증, 상태는 워크플로 전이로, 기대 개정이 다르면 쓰지 않고 충돌', async () => {
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example/', JIRA_USER: 'svc-ff@corp.example', JIRA_TOKEN: 't0k', JIRA_API: '2' });
    let updated = '2026-10-18T01:00:00.000+0000';
    let status = 'Released';
    const f = fake((m, url, body) => {
      if (m === 'GET' && url.includes('/rest/api/2/issue/FFE-7?')) return { status: 200, body: { key: 'FFE-7', fields: { summary: 'FEAT-00002@1.5.0', status: { name: status }, issuetype: { name: 'Epic' }, updated } } };
      if (m === 'GET' && url.endsWith('/rest/api/2/issue/FFE-7/transitions')) return { status: 200, body: { transitions: [{ id: '31', to: { name: 'Deprecated' } }, { id: '41', to: { name: 'Closed' } }] } };
      if (m === 'POST' && url.endsWith('/transitions')) {
        status = body.transition.id === '31' ? 'Deprecated' : 'Closed';
        updated = '2026-10-18T02:00:00.000+0000';
        return { status: 204, body: {} };
      }
      if (m === 'POST' && url.endsWith('/comment')) return { status: 201, body: {} };
      return undefined;
    });
    const a = new LiveAdapter('JIRA', () => 'live', f.fn);
    const r = await a.read('FFE-7');
    expect(r).toMatchObject({ kind: 'EPIC', status: 'Released', url: 'https://jira.corp.example/browse/FFE-7', revision: Date.parse('2026-10-18T01:00:00.000+0000') });
    expect(f.calls[0].headers.authorization).toBe(`Basic ${Buffer.from('svc-ff@corp.example:t0k').toString('base64')}`);
    const stale = await a.write('FFE-7', { status: 'Deprecated' }, r!.revision - 1);
    expect(stale.ok).toBe(false);
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false);
    const w = await a.write('FFE-7', { status: 'Deprecated', comment: '플랫폼 Lifecycle RELEASED → DEPRECATED' }, r!.revision);
    expect(w).toMatchObject({ ok: true, item: { status: 'Deprecated' } });
    expect(f.calls.find((c) => c.url.endsWith('/transitions') && c.method === 'POST')!.body).toEqual({ transition: { id: '31' } });
    expect(f.calls.find((c) => c.url.endsWith('/comment'))!.body).toEqual({ body: '플랫폼 Lifecycle RELEASED → DEPRECATED' });
    await expect(a.write('FFE-7', { status: 'In Verification' }, null)).rejects.toThrow(/워크플로 전이가 없습니다/);
  });

  it('JIRA 만들기 — 새 이슈가 이미 원하는 첫 상태면 전이하지 않는다(자기 전이가 없어 만들기가 실패하던 결함)', async () => {
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example', JIRA_TOKEN: 'pat', JIRA_EPIC_PROJECT: 'FFE', JIRA_API: '2' });
    let status = 'Proposed';
    const f = fake((m, url, body) => {
      if (m === 'POST' && url.endsWith('/rest/api/2/issue')) return { status: 201, body: { key: 'FFE-9' } };
      if (m === 'GET' && url.includes('/rest/api/2/issue/FFE-9?')) return { status: 200, body: { key: 'FFE-9', fields: { summary: 'FEAT-00030@1.0.0', status: { name: status }, issuetype: { name: 'Epic' }, updated: '2026-10-24T01:00:00.000+0000' } } };
      // 워크플로: Proposed에서 갈 수 있는 곳은 Approved뿐(자기 자신 없음)
      if (m === 'GET' && url.endsWith('/rest/api/2/issue/FFE-9/transitions')) return { status: 200, body: { transitions: [{ id: '11', to: { name: 'Approved' } }] } };
      if (m === 'POST' && url.endsWith('/transitions')) {
        status = body.transition.id === '11' ? 'Approved' : status;
        return { status: 204, body: {} };
      }
      return undefined;
    });
    const a = new LiveAdapter('JIRA', () => 'live', f.fn);
    expect(await a.create('EPIC', { title: 'FEAT-00030@1.0.0', body: '', status: 'Proposed' })).toMatchObject({ key: 'FFE-9', status: 'Proposed' });
    expect(f.calls.some((c) => c.url.includes('/transitions'))).toBe(false);
    expect(f.calls[0].headers.authorization).toBe('Bearer pat');
    // 다른 상태를 원하면 전이한다
    status = 'Proposed';
    expect(await a.create('EPIC', { title: 'FEAT-00030@1.0.0', body: '', status: 'Approved' })).toMatchObject({ status: 'Approved' });
  });

  // 회귀(2026-11-05, 80-50 A1 모의 JIRA): Epic 워크플로는 FF 수명주기 전이만 있어 새 Epic(Proposed)을 In Progress로 한 번에 옮길 수 없다.
  // 전이를 한 번만 찾던 어댑터는 실패했고, 만든 뒤 실패하면 연결 전에 던져 다음 재시도가 Epic을 또 만들었다.
  it('JIRA Epic — 바로 가는 전이가 없으면 FF 수명주기 경로대로 한 단계씩, 끝내 못 가면 만든 Epic은 그대로 돌려준다', async () => {
    expect(epicStatusPath('Proposed', 'In Progress')).toEqual(['Approved', 'In Progress']);
    expect(epicStatusPath('In Verification', 'In Progress')).toEqual(['In Progress']);
    expect(epicStatusPath('Proposed', 'Rolled Back')).toBeNull();
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example', JIRA_TOKEN: 'pat', JIRA_EPIC_PROJECT: 'FFE', JIRA_API: '2' });
    const flow: Record<string, string[]> = { Proposed: ['Approved'], Approved: ['In Progress'], 'In Progress': ['In Verification'] };
    let status = 'Proposed';
    let made = 0;
    const f = fake((m, url, body) => {
      if (m === 'POST' && url.endsWith('/rest/api/2/issue')) return (made++, { status: 201, body: { key: 'FFE-11' } });
      if (m === 'GET' && url.includes('/rest/api/2/issue/FFE-11?')) return { status: 200, body: { key: 'FFE-11', fields: { summary: 'x', status: { name: status }, issuetype: { name: 'Epic' }, updated: '2026-11-05T01:00:00.000+0000' } } };
      if (m === 'GET' && url.endsWith('/transitions')) return { status: 200, body: { transitions: (flow[status] ?? []).map((to, i) => ({ id: String(21 + i), to: { name: to } })) } };
      if (m === 'POST' && url.endsWith('/transitions')) {
        status = flow[status][Number(body.transition.id) - 21];
        return { status: 204, body: {} };
      }
      return undefined;
    });
    const a = new LiveAdapter('JIRA', () => 'live', f.fn);
    expect(await a.create('EPIC', { title: 'x', body: '', status: 'In Progress' })).toMatchObject({ key: 'FFE-11', status: 'In Progress' });
    expect(f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/transitions')).map((c) => c.body.transition.id)).toEqual(['21', '21']);
    // 갈 수 없는 상태(워크플로가 다름) — 만들기는 던지지 않고 만든 이슈를 돌려준다(한 번만 만듦)
    status = 'Proposed';
    flow.Proposed = [];
    expect(await a.create('EPIC', { title: 'x', body: '', status: 'In Progress' })).toMatchObject({ key: 'FFE-11', status: 'Proposed' });
    expect(made).toBe(2);
    await expect(a.write('FFE-11', { status: 'In Progress' }, null)).rejects.toThrow(/'Approved'\(으\)로 가는 워크플로 전이가 없습니다/);
  });

  // 80-50 A2 §4.6 — Cloud v3 기본: ADF 본문·댓글, Epic 사용자 필드는 JIRA_FIELDS로, 증분 대사는 search/jql + changelog
  it('JIRA v3(기본) — ADF·Epic 사용자 필드 읽고 쓰기·Epic 하위는 parent·증분 대사 검색과 변경 이력', async () => {
    Object.assign(process.env, { IF_MODE_14: 'live', JIRA_URL: 'https://acme.atlassian.net', JIRA_USER: 'svc@acme.example', JIRA_TOKEN: 'api', JIRA_EPIC_PROJECT: 'FFE', JIRA_CR_PROJECT: 'FFCR', JIRA_DEFECT_PROJECT: 'FFD', JIRA_FIELDS: JSON.stringify({ country: 'customfield_10010', asil: 'customfield_10013', featureDb: 'customfield_10015', featureId: 'customfield_10016', workingVersion: 'customfield_10017' }) });
    const issue = { key: 'FFE-3', fields: { summary: '[FF] 오토 홀드 — KR/NX4 PE/Premium', status: { name: 'Proposed' }, issuetype: { name: 'Epic' }, updated: '2026-11-07T01:00:00.000+0000', description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '목표' }] }] }, customfield_10010: 'KR', customfield_10013: { value: 'B' }, customfield_10015: ['CH-BRK-009', 'CH-BRK-006'], customfield_10016: 'FEAT-00012', customfield_10017: null, reporter: { accountId: 'acc-kim' } } };
    const f = fake((m, url, body) => {
      if (m === 'GET' && url.includes('/rest/api/3/issue/FFE-3?fields=')) return { status: 200, body: issue };
      if (m === 'PUT' && url.endsWith('/rest/api/3/issue/FFE-3')) return { status: 204, body: {} };
      if (m === 'POST' && url.endsWith('/rest/api/3/issue/FFE-3/comment')) return { status: 201, body: {} };
      if (m === 'POST' && url.endsWith('/rest/api/3/issue')) return { status: 201, body: { key: 'FFE-3' } };
      if (m === 'POST' && url.endsWith('/rest/api/3/search/jql')) return { status: 200, body: body.nextPageToken ? { issues: [], isLast: true } : { issues: [issue], nextPageToken: 'p2' } };
      if (m === 'GET' && url.includes('/rest/api/3/issue/FFE-3/changelog')) return { status: 200, body: { total: 1, values: [{ author: { accountId: 'acc-kim' }, created: '2026-11-07T01:00:00.000+0000', items: [{ field: 'status', fromString: 'Approved', toString: 'Proposed' }] }] } };
      if (m === 'GET' && url.endsWith('/rest/api/3/myself')) return { status: 200, body: { accountId: 'acc-svc' } };
      return undefined;
    });
    const a = new LiveAdapter('JIRA', () => 'live', f.fn);
    const r = await a.read('FFE-3');
    expect(r).toMatchObject({ kind: 'EPIC', fields: { description: '목표', epic: { country: 'KR', asil: 'B', featureDb: ['CH-BRK-009', 'CH-BRK-006'], featureId: 'FEAT-00012', workingVersion: null } } });
    expect(f.calls.find((c) => c.url.includes('/issue/FFE-3?'))!.url).toContain('customfield_10015');
    await a.write('FFE-3', { title: '[FF] 오토 홀드 2 — KR/NX4 PE/Premium', fields: { workingVersion: '1.3.0', asil: 'C', featureDb: ['CH-BRK-009'] }, comment: '플랫폼 값으로 되돌립니다.' }, null);
    expect(f.calls.find((c) => c.method === 'PUT')!.body).toEqual({ fields: { summary: '[FF] 오토 홀드 2 — KR/NX4 PE/Premium', customfield_10017: '1.3.0', customfield_10013: { value: 'C' }, customfield_10015: ['CH-BRK-009'] } });
    expect(f.calls.find((c) => c.url.endsWith('/comment'))!.body).toEqual({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '플랫폼 값으로 되돌립니다.' }] }] } });
    await a.create('DEFECT', { title: '현장 문제', body: '첫 줄\n\n둘째 문단', status: 'Proposed', fields: { parentKey: 'FFE-3', epic: { featureId: 'FEAT-00012' } } });
    const made = f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/rest/api/3/issue'))!.body.fields;
    expect(made).toMatchObject({ project: { key: 'FFD' }, issuetype: { name: 'Bug' }, parent: { key: 'FFE-3' }, customfield_10016: 'FEAT-00012', description: { type: 'doc' } });
    expect(made.description.content).toHaveLength(2);
    const recent = await a.recent(20);
    const search = f.calls.filter((c) => c.url.endsWith('/search/jql'));
    expect(search[0].body).toMatchObject({ jql: 'project in (FFE, FFCR, FFD) AND updated >= "-20m" ORDER BY updated ASC', maxResults: 100 });
    expect(search).toHaveLength(2);
    expect(recent).toEqual([{ key: 'FFE-3', revision: Date.parse(issue.fields.updated), issue, reporter: 'acc-kim', histories: [{ author: 'acc-kim', created: Date.parse('2026-11-07T01:00:00.000+0000'), items: [{ field: 'status', fromString: 'Approved', toString: 'Proposed' }] }] }]);
  });

  it('GitLab — PRIVATE-TOKEN, MR 읽기, commit status는 병합 커밋 SHA에', async () => {
    Object.assign(process.env, { GITLAB_URL: 'https://gitlab.corp.example', GITLAB_TOKEN: 'glpat-x', GITLAB_PROJECT: 'vehicle/feature-sw' });
    const f = fake((m, url) => {
      if (m === 'GET' && url.endsWith('/api/v4/projects/vehicle%2Ffeature-sw/merge_requests/12')) return { status: 200, body: { iid: 12, title: 'fix(FEAT-00022@1.0.0)', state: 'merged', web_url: 'https://gitlab.corp.example/vehicle/feature-sw/-/merge_requests/12', updated_at: '2026-10-18T03:00:00Z', merge_commit_sha: 'abc1234def', source_branch: 'fix/radar', target_branch: 'main' } };
      if (m === 'POST' && url.includes('/statuses/abc1234def')) return { status: 201, body: {} };
      return undefined;
    });
    const a = new LiveAdapter('GITLAB', () => 'live', f.fn);
    const w = await a.write('vehicle/feature-sw!12', { append: { field: 'commitStatuses', value: { name: 'ff/gate-G5', state: 'success', description: 'Feature Platform G5 PASS' } } }, null);
    expect(w.ok).toBe(true);
    const post = f.calls.find((c) => c.method === 'POST')!;
    expect(post.headers['private-token']).toBe('glpat-x');
    expect(post.body).toEqual({ state: 'success', name: 'ff/gate-G5', description: 'Feature Platform G5 PASS' });
  });

  it('codeBeamer — 개정 = item.version, 검증 결과는 댓글 한 줄', async () => {
    Object.assign(process.env, { CODEBEAMER_URL: 'https://cb.corp.example', CODEBEAMER_USER: 'ff', CODEBEAMER_TOKEN: 'pw' });
    const f = fake((m, url) => {
      if (m === 'GET' && url.endsWith('/api/v3/items/10001')) return { status: 200, body: { id: 10001, name: '감지 거리', status: { name: 'Approved' }, version: 4 } };
      if (m === 'POST' && url.endsWith('/api/v3/items/10001/comments')) return { status: 201, body: {} };
      if (m === 'POST' && url.endsWith('/api/v3/items/query')) return { status: 200, body: { items: [{ id: 10001 }] } };
      return undefined;
    });
    const a = new LiveAdapter('CODEBEAMER', () => 'live', f.fn);
    expect(await a.read('CB-10001')).toMatchObject({ revision: 4, status: 'Approved', url: 'https://cb.corp.example/cb/issue/10001' });
    expect(await a.read('CB-99')).toBeNull();
    // 요구 ID로 찾기 — cbQL
    expect(await a.findRequirement('REQ-CARE-0001')).toMatchObject({ key: 'CB-10001' });
    expect(f.calls.find((c) => c.url.endsWith('/items/query'))!.body.queryString).toBe("'Requirement ID' = 'REQ-CARE-0001'");
    await a.write('CB-10001', { append: { field: 'verifications', value: { gate: 'G2', status: 'PASS', featureId: 'FEAT-00022', version: '1.0.0', evidenceRef: 'GR-1' } } }, null);
    // 실서버는 댓글을 multipart/form-data로만 받는다(80-51 §2) — JSON content-type을 붙이지 않는다
    const posted = f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/comments'))!;
    expect(posted.body).toEqual({ form: { comment: '[Feature Platform] G2 PASS — FEAT-00022@1.0.0 · Evidence GR-1', commentFormat: 'PlainText' } });
    expect(posted.headers['content-type']).toBeUndefined();
  });
});
