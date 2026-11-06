// 실제 연결 어댑터(JIRA REST v2 · GitLab REST v4 · codeBeamer REST v3) — 실서버 대신 요청을 기록하고 정해진 응답을 돌려주는 가짜 fetch로
// 경로·인증 헤더·본문 모양, 기대 개정 충돌, 워크플로 전이 찾기, 설정 누락 안내를 확인한다.
import { afterEach, describe, expect, it } from 'vitest';
import { ExtPartialWriteError } from '../../src/domains/d05-ext/api-gateway/ext-sync/adapters';
import { epicStatusPath, isServiceAccount, LiveAdapter } from '../../src/domains/d05-ext/api-gateway/ext-sync/live-adapters';

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
const ENV = ['JIRA_URL', 'JIRA_USER', 'JIRA_TOKEN', 'JIRA_EPIC_PROJECT', 'JIRA_CR_PROJECT', 'JIRA_SERVICE_ACCOUNT', 'GITLAB_URL', 'GITLAB_TOKEN', 'GITLAB_PROJECT', 'CODEBEAMER_URL', 'CODEBEAMER_USER', 'CODEBEAMER_TOKEN'];
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
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example/', JIRA_USER: 'svc-ff@corp.example', JIRA_TOKEN: 't0k' });
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
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example', JIRA_TOKEN: 'pat', JIRA_EPIC_PROJECT: 'FFE' });
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
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example', JIRA_TOKEN: 'pat', JIRA_EPIC_PROJECT: 'FFE' });
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

  // 회귀(2026-11-06 하네스 리뷰): 경로 중간에서 막히면 앞 단계 전이로 개정이 바뀌었는데 만들기는 만든 직후(낡은) 모습을,
  // 쓰기는 그냥 오류를 돌려줬다. 보낼 함은 낡은 개정을 기대값으로 다시 쓰다가 자기 전이를 '외부 변경'으로 보고 충돌을 열었다.
  it('JIRA Epic — 경로 중간에서 막히면 지금 모습(상태·개정)을 돌려주고, 쓰기는 일부 반영 오류에 지금 모습을 싣는다', async () => {
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example', JIRA_TOKEN: 'pat', JIRA_EPIC_PROJECT: 'FFE' });
    const flow: Record<string, string[]> = { Proposed: ['Approved'], Approved: [] };
    let status = 'Proposed';
    let rev = 0;
    const updated = () => new Date(Date.parse('2026-11-06T01:00:00.000Z') + rev * 1000).toISOString().replace('Z', '+0000');
    const f = fake((m, url, body) => {
      if (m === 'POST' && url.endsWith('/rest/api/2/issue')) return { status: 201, body: { key: 'FFE-12' } };
      if (m === 'GET' && url.includes('/rest/api/2/issue/FFE-12?')) return { status: 200, body: { key: 'FFE-12', fields: { summary: 'x', status: { name: status }, issuetype: { name: 'Epic' }, updated: updated() } } };
      if (m === 'GET' && url.endsWith('/transitions')) return { status: 200, body: { transitions: (flow[status] ?? []).map((to, i) => ({ id: String(21 + i), to: { name: to } })) } };
      if (m === 'POST' && url.endsWith('/transitions')) {
        status = flow[status][Number(body.transition.id) - 21];
        rev++;
        return { status: 204, body: {} };
      }
      return undefined;
    });
    const a = new LiveAdapter('JIRA', () => 'live', f.fn);
    const made = await a.create('EPIC', { title: 'x', body: '', status: 'In Progress' });
    expect(made).toMatchObject({ key: 'FFE-12', status: 'Approved' });
    // 돌려준 개정으로 다시 쓰면 충돌이 아니라 전이 없음(진짜 원인)으로 실패해야 한다
    await expect(a.write('FFE-12', { status: 'In Progress' }, made.revision)).rejects.toThrow(/'In Progress'\(으\)로 가는 워크플로 전이가 없습니다/);
    // 쓰기 중간에 막힘 — 한 단계는 갔다
    status = 'Proposed';
    rev = 10;
    const before = (await a.read('FFE-12'))!;
    const err = await a.write('FFE-12', { status: 'In Progress' }, before.revision).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtPartialWriteError);
    expect((err as ExtPartialWriteError).item).toMatchObject({ status: 'Approved', revision: before.revision + 1000 });
    // 아무 단계도 못 갔으면 일반 오류(일부 반영 아님)
    flow.Approved = [];
    await expect(a.write('FFE-12', { status: 'In Progress' }, null).catch((e: unknown) => e instanceof ExtPartialWriteError)).resolves.toBe(false);
  });

  // 회귀(2026-11-06 하네스 리뷰): 수명주기 경로 우회는 Epic 전용인데 CR에도 적용됐다. CR과 Epic은 'Approved'·'Closed' 이름을 같이 써서
  // 승인된 CR을 닫으려다 바로 가는 전이가 없으면 Epic 경로(In Progress → In Verification …)로 CR을 옮기기 시작했다
  it('JIRA CR — 바로 가는 전이가 없으면 Epic 수명주기 경로로 우회하지 않고 아무 전이도 하지 않는다', async () => {
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example', JIRA_TOKEN: 'pat', JIRA_CR_PROJECT: 'FFCR' });
    const flow: Record<string, string[]> = { Approved: ['In Progress'], 'In Progress': ['Done'] };
    let status = 'Approved';
    const f = fake((m, url, body) => {
      if (m === 'GET' && url.includes('/rest/api/2/issue/FFCR-3?')) return { status: 200, body: { key: 'FFCR-3', fields: { summary: 'x', status: { name: status }, issuetype: { name: 'Change Request' }, updated: '2026-11-06T01:00:00.000+0000' } } };
      if (m === 'GET' && url.endsWith('/transitions')) return { status: 200, body: { transitions: (flow[status] ?? []).map((to, i) => ({ id: String(21 + i), to: { name: to } })) } };
      if (m === 'POST' && url.endsWith('/transitions')) {
        status = flow[status][Number(body.transition.id) - 21];
        return { status: 204, body: {} };
      }
      return undefined;
    });
    const a = new LiveAdapter('JIRA', () => 'live', f.fn);
    await expect(a.write('FFCR-3', { status: 'Closed' }, null)).rejects.toThrow(/'Closed'\(으\)로 가는 워크플로 전이가 없습니다/);
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(status).toBe('Approved');
  });

  // 회귀(2026-11-06 하네스 리뷰): 자기 계정 묻기(/user)가 권한 없음(403)이면 요청마다 다시 물어 외부 서버에 실패 호출을 쌓았다
  it('GitLab — 자기 계정 묻기가 권한 없음이면 다시 묻지 않는다(요청마다 /user 403을 쌓지 않음)', async () => {
    Object.assign(process.env, { GITLAB_URL: 'https://gitlab.corp.example', GITLAB_TOKEN: 'glpat-x', GITLAB_PROJECT: 'vehicle/feature-sw' });
    const f = fake((m, url) => {
      if (m === 'GET' && url.endsWith('/api/v4/user')) return { status: 403, body: { message: '403 Forbidden - insufficient_scope' } };
      if (m === 'GET' && url.includes('/merge_requests/7')) return { status: 200, body: { iid: 7, title: 'x', state: 'merged', updated_at: '2026-11-06T01:00:00.000Z', sha: 'abc' } };
      return undefined;
    });
    const a = new LiveAdapter('GITLAB', () => 'live', f.fn);
    await a.read('vehicle/feature-sw!7');
    await a.read('vehicle/feature-sw!7');
    await a.read('vehicle/feature-sw!7');
    expect(f.calls.filter((c) => c.url.endsWith('/api/v4/user'))).toHaveLength(1);
  });

  // 회귀(2026-11-05, 80-50 A1 모의 JIRA 계약 시험): JIRA Cloud webhook은 서비스 계정을 이메일이 아니라 accountId로 보낸다.
  // 설정 이름만 알던 플랫폼은 자기 변경의 메아리를 '매핑 없는 계정'으로 거부했다 — 처음 호출 때 /myself로 자기 계정을 배운다.
  it('JIRA — 서비스 계정은 설정 이름과 첫 호출 때 /myself로 배운 accountId로 알아본다(한 번만 묻는다)', async () => {
    Object.assign(process.env, { JIRA_URL: 'https://jira.corp.example', JIRA_USER: 'svc-ff@corp.example', JIRA_TOKEN: 'pat' });
    expect(isServiceAccount('JIRA', 'svc-ff@corp.example')).toBe(true);
    expect(isServiceAccount('JIRA', '557058:ff-sync')).toBe(false);
    const f = fake((m, url) => {
      if (m === 'GET' && url.endsWith('/rest/api/2/myself')) return { status: 200, body: { accountId: '557058:ff-sync', emailAddress: 'svc-ff@corp.example' } };
      if (m === 'GET' && url.includes('/rest/api/2/issue/FFE-9?')) return { status: 200, body: { key: 'FFE-9', fields: { summary: 'x', status: { name: 'Proposed' }, issuetype: { name: 'Epic' }, updated: '2026-11-05T01:00:00.000+0000' } } };
      return undefined;
    });
    const a = new LiveAdapter('JIRA', () => 'live', f.fn);
    await a.read('FFE-9');
    await a.read('FFE-9');
    expect(isServiceAccount('JIRA', '557058:ff-sync')).toBe(true);
    expect(isServiceAccount('JIRA', 'kim.author')).toBe(false);
    expect(isServiceAccount('JIRA', '')).toBe(false);
    expect(f.calls.filter((c) => c.url.endsWith('/myself'))).toHaveLength(1);
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
