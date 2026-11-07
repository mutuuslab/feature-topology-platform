// 독립 모의 서버(80-50 §6) — 실서버 모양(80-51)을 지키는지: 인증·오류 본문·워크플로·검색·webhook 서명·호출 제한·version·suspect·multipart 댓글.
// 시각은 고정(now 주입), 포트는 0(임의), 상태 파일은 임시 폴더.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { cbql, fieldId, startCodebeamerMock, trackerId, TRACKERS, type Item } from './codebeamer.ts';
import { adfText, jql, startJiraMock, type Issue } from './jira.ts';

const dir = mkdtempSync(join(tmpdir(), 'ff-ext-mocks-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const T0 = Date.UTC(2026, 10, 5, 1, 0, 0);
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

describe('JIRA 모의', () => {
  const sent: { headers: Record<string, string>; body: string }[] = [];
  let t = T0;
  const env = { FF_MOCK_DATA_DIR: join(dir, 'jira'), FF_MOCK_FRESH: '1', JIRA_WEBHOOK_SECRET: 'jira-secret', FF_WEBHOOK_URL: 'http://ff.invalid/api/webhooks/jira' };
  const boot = startJiraMock({ port: 0, env, now: () => t, deliver: async (_url, headers, body) => (sent.push({ headers, body }), 202) });
  after(async () => (await boot).close());
  const call = async (method: string, path: string, body?: unknown, auth = basic('ff-sync@example.com', 'jira-mock-token')) => {
    const s = await boot;
    const r = await fetch(`${s.url}${path}`, { method, headers: { authorization: auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };

  it('인증 — 없거나 틀리면 401, Basic·Bearer는 통과', async () => {
    assert.equal((await call('GET', '/rest/api/3/myself', undefined, '')).status, 401);
    assert.equal((await call('GET', '/rest/api/3/myself', undefined, basic('ff-sync@example.com', 'wrong'))).status, 401);
    assert.equal((await call('GET', '/rest/api/3/myself')).body.accountId, 'ff-sync@example.com');
    assert.equal((await call('GET', '/rest/api/2/myself', undefined, 'Bearer kim-token')).body.accountId, 'kim.author');
  });

  it('Epic 생성 — 첫 상태는 Proposed, ADF 설명은 글자로, 서명된 webhook이 간다', async () => {
    const r = await call('POST', '/rest/api/3/issue', { fields: { project: { key: 'FFX' }, issuetype: { name: 'Epic' }, summary: '후석 승객 알림', description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '첫 문단' }] }] }, customfield_10016: 'FEAT-BC-0001' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.key, 'FFX-1');
    const got = await call('GET', '/rest/api/2/issue/FFX-1');
    assert.equal(got.body.fields.status.name, 'Proposed');
    assert.equal(got.body.fields.description, '첫 문단');
    assert.match(got.body.fields.created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+0000$/);
    await (await boot).flush();
    const w = sent.at(-1)!;
    assert.equal(w.headers['x-hub-signature'], `sha256=${createHmac('sha256', 'jira-secret').update(w.body).digest('hex')}`);
    assert.ok(w.headers['x-atlassian-webhook-identifier']);
    const payload = JSON.parse(w.body);
    assert.equal(payload.webhookEvent, 'jira:issue_created');
    assert.equal(payload.issue.key, 'FFX-1');
    assert.equal(payload.issue.fields.issuetype.name, 'Epic');
  });

  it('Epic 워크플로 — FF 수명주기 전이만 허용(Proposed → In Progress는 거부)', async () => {
    const tr = await call('GET', '/rest/api/3/issue/FFX-1/transitions');
    assert.deepEqual(tr.body.transitions.map((x: { name: string }) => x.name), ['Approved']);
    const bad = await call('POST', '/rest/api/3/issue/FFX-1/transitions', { transition: { name: 'In Progress' } });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.body).sort(), ['errorMessages', 'errors', 'status']);
    t += 60_000;
    assert.equal((await call('POST', '/rest/api/3/issue/FFX-1/transitions', { transition: { id: tr.body.transitions[0].id } })).status, 204);
    assert.equal((await call('GET', '/rest/api/3/issue/FFX-1')).body.fields.status.name, 'Approved');
    await (await boot).flush();
    const payload = JSON.parse(sent.at(-1)!.body);
    assert.deepEqual(payload.changelog.items, [{ field: 'status', fromString: 'Proposed', toString: 'Approved' }]);
  });

  it('Epic = Feature — 새 Version이면 Proposed로 돌아가는 전이, 변경 이력은 v3 /changelog·v2 expand=changelog', async () => {
    const tr = await call('GET', '/rest/api/3/issue/FFX-1/transitions');
    assert.deepEqual(tr.body.transitions.map((x: { name: string }) => x.name).sort(), ['In Progress', 'Proposed']);
    const log = await call('GET', '/rest/api/3/issue/FFX-1/changelog');
    assert.equal(log.body.total, 1);
    assert.equal(log.body.values[0].author.accountId, 'ff-sync@example.com');
    assert.deepEqual(log.body.values[0].items.map((x: { field: string; fromString: string; toString: string }) => [x.field, x.fromString, x.toString]), [['status', 'Proposed', 'Approved']]);
    const v2 = await call('GET', '/rest/api/2/issue/FFX-1?expand=changelog');
    assert.equal(v2.body.changelog.histories[0].id, log.body.values[0].id);
    assert.equal((await call('GET', '/rest/api/2/issue/FFX-1')).body.changelog, undefined);
  });

  it('검색 — v3 search/jql(nextPageToken)·v2 search(startAt), 사용자 필드 이름 절', async () => {
    for (let n = 0; n < 3; n++) await call('POST', '/rest/api/3/issue', { fields: { project: { key: 'FFX' }, issuetype: { name: 'Story' }, summary: `S${n}`, parent: { key: 'FFX-1' } } });
    const p1 = await call('POST', '/rest/api/3/search/jql', { jql: 'project = FFX AND parent = FFX-1 ORDER BY created ASC', maxResults: 2, fields: ['summary'] });
    assert.deepEqual(p1.body.issues.map((i: { key: string }) => i.key), ['FFX-2', 'FFX-3']);
    assert.deepEqual(Object.keys(p1.body.issues[0].fields), ['summary']);
    const p2 = await call('POST', '/rest/api/3/search/jql', { jql: 'project = FFX AND parent = FFX-1 ORDER BY created ASC', maxResults: 2, nextPageToken: p1.body.nextPageToken });
    assert.deepEqual(p2.body.issues.map((i: { key: string }) => i.key), ['FFX-4']);
    assert.equal(p2.body.isLast, true);
    const v2 = await call('GET', `/rest/api/2/search?jql=${encodeURIComponent('"FF Feature ID" = FEAT-BC-0001')}`);
    assert.equal(v2.body.total, 1);
    assert.equal((await call('GET', `/rest/api/3/search/jql?jql=${encodeURIComponent('nonsense')}`)).status, 400);
  });

  it('사람 편집·webhook 유실 — /_mock/act는 같은 webhook, drop-next-webhook은 보내지 않고 기록만', async () => {
    const before = sent.length;
    await call('POST', '/_mock/drop-next-webhook', {}, '');
    t += 60_000;
    await call('POST', '/_mock/act', { key: 'FFX-1', as: 'kim.author', fields: { summary: '후석 승객 알림(개정)' } }, '');
    await (await boot).flush();
    assert.equal(sent.length, before);
    const s = await boot;
    assert.equal(s.state().deliveries.at(-1)!.status, 'dropped');
    await call('POST', '/_mock/act', { key: 'FFX-1', comment: '검토 의견' }, '');
    await s.flush();
    assert.equal(JSON.parse(sent.at(-1)!.body).webhookEvent, 'comment_created');
  });

  it('JQL·ADF 단위', () => {
    const at = (updated: number) => ({ id: '1', key: 'A-1', project: 'A', type: 'Epic', status: 'Approved', summary: '', description: '', parent: null, labels: ['x'], assignee: null, reporter: 'u', custom: { customfield_10013: 'B' }, created: 0, updated, comments: [] }) as Issue;
    assert.ok(jql('updated >= "-20m" AND labels = x AND ASIL = B', T0).test(at(T0 - 60_000)));
    assert.ok(!jql('updated >= "-20m"', T0).test(at(T0 - 3_600_000)));
    assert.ok(jql('cf[10013] in (A, B) AND status != Closed', T0).test(at(0)));
    assert.equal(adfText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] }), 'ab\n\nc');
  });
});

describe('codeBeamer 모의', () => {
  let t = T0;
  const sent: { headers: Record<string, string>; body: string }[] = [];
  const env = { FF_MOCK_DATA_DIR: join(dir, 'cb'), FF_MOCK_FRESH: '1', CB_MOCK_THROTTLE: 'off' };
  const boot = startCodebeamerMock({ port: 0, env, now: () => t, deliver: async (_u, headers, body) => (sent.push({ headers, body }), 200) });
  after(async () => (await boot).close());
  const call = async (method: string, path: string, body?: unknown, auth = basic('ff-sync', 'cb-mock-token'), type = 'application/json') => {
    const s = await boot;
    const r = await fetch(`${s.url}${path}`, { method, headers: { authorization: auth, 'content-type': type }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
  };
  const SYS = trackerId('SYS_REQ');
  const SWR = trackerId('SW_REQ');

  it('경로·인증·오류 본문 — /cb/api/v3와 /api/v3 둘 다, 오류는 {message, resourceUri}', async () => {
    assert.equal((await call('GET', '/cb/api/v3/projects', undefined, '')).status, 401);
    const p = await call('GET', '/cb/api/v3/projects/52/trackers');
    assert.equal(p.body.length, TRACKERS.length);
    assert.equal((await call('GET', '/api/v3/projects/52/trackers', undefined, 'Bearer lee-token')).body.length, 8);
    const miss = await call('GET', '/cb/api/v3/items/999999');
    assert.equal(miss.status, 404);
    assert.deepEqual(Object.keys(miss.body).sort(), ['message', 'resourceUri']);
  });

  it('스키마 — 공통 필드의 ID가 트래커마다 다르고, customField[n]으로 찾는다', async () => {
    const a = (await call('GET', `/cb/api/v3/trackers/${SYS}/schema`)).body.find((f: { name: string }) => f.name === 'FF Feature ID');
    const b = (await call('GET', `/cb/api/v3/trackers/${SWR}/schema`)).body.find((f: { name: string }) => f.name === 'FF Feature ID');
    assert.notEqual(a.id, b.id);
    assert.equal(a.propertyName, `customField[${a.id - 10000}]`);
    const made = await call('POST', `/cb/api/v3/trackers/${SYS}/items`, { name: '승객 감지 시 알림', customFields: [{ fieldId: a.id, value: 'FEAT-BC-0001' }] });
    assert.equal(made.body.version, 1);
    assert.equal(made.body.status.name, 'Draft');
    assert.match(made.body.modifiedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/);
    const q = await call('POST', '/cb/api/v3/items/query', { page: 1, pageSize: 500, queryString: `tracker.id IN (${SYS}, ${SWR}) AND '${SYS}.customField[${a.id - 10000}]' = 'FEAT-BC-0001'` });
    assert.equal(q.body.total, 1);
    assert.equal((await call('POST', '/api/v3/items/query', { queryString: `tracker.id = ${SYS} AND 'FF Feature ID' = 'FEAT-BC-0001'` })).body.total, 1);
    assert.equal((await call('POST', '/cb/api/v3/items/query', { queryString: `'x' = 1 OR 'y' = 2` })).status, 400);
  });

  it('승인 워크플로 — 상태 필드 7로만, Draft → Approved 직행은 거부, version·이력·이전 version 조회', async () => {
    const id = (await call('POST', '/cb/api/v3/items/query', { queryString: `tracker.id = ${SYS}` })).body.items[0].id;
    const to = (name: string) => call('PUT', `/cb/api/v3/items/${id}/fields`, { fieldValues: [{ fieldId: 7, type: 'ChoiceFieldValue', values: [{ id: { Draft: 1, 'In Review': 2, Approved: 3 }[name], type: 'ChoiceOptionReference' }] }] });
    assert.equal((await to('Approved')).status, 400);
    t += 5000;
    await to('In Review');
    t += 5000;
    const ok = await to('Approved');
    assert.equal(ok.body.status.name, 'Approved');
    assert.equal(ok.body.version, 3);
    const h = await call('GET', `/cb/api/v3/items/${id}/history`);
    assert.deepEqual(h.body.versions.at(-1).changes, [{ field: 'Status', oldValue: 'In Review', newValue: 'Approved' }]);
    assert.equal((await call('GET', `/cb/api/v3/items/${id}?version=1`)).body.status.name, 'Draft');
    const since = new Date(T0 + 7000).toISOString().replace('T', ' ').slice(0, 19);
    assert.equal((await call('POST', '/cb/api/v3/items/query', { queryString: `tracker.id = ${SYS} AND modifiedAt >= '${since}'` })).body.total, 1);
  });

  it('suspect — 위 항목이 바뀌면 관계가 의심 상태, 관계 응답에는 없고 hasSuspectedLink로만 보인다', async () => {
    const sw = (await call('POST', `/cb/api/v3/trackers/${SWR}/items`, { name: 'SW 알림 요구' })).body.id;
    const sys = (await call('POST', '/cb/api/v3/items/query', { queryString: `tracker.id = ${SYS}` })).body.items[0].id;
    const types = (await call('GET', '/cb/api/v3/associations/types')).body;
    const derived = types.find((x: { name: string }) => x.name === 'derived');
    assert.equal((await call('POST', '/cb/api/v3/associations', { from: { id: sw }, to: { id: sys }, type: { id: derived.id }, propagatingSuspects: true })).status, 200);
    const suspects = async () => (await call('POST', '/cb/api/v3/items/query', { queryString: `tracker.id IN (${SYS}, ${SWR}) AND hasSuspectedLink = 'true'` })).body.items.map((i: { id: number }) => i.id).sort();
    assert.deepEqual(await suspects(), []);
    t += 5000;
    await call('POST', '/_mock/act', { id: sys, fields: { Description: '감지 범위 2열로 확대' } }, '');
    assert.deepEqual(await suspects(), [sw, sys].sort());
    const rel = (await call('POST', '/cb/api/v3/items/relations', { itemIds: [sw] })).body[0];
    assert.equal(rel.outgoingAssociations[0].itemRevision.id, sys);
    assert.ok(!JSON.stringify(rel).includes('suspect'));
    await call('POST', '/_mock/act', { id: sw, clearSuspect: 'all' }, '');
    assert.deepEqual(await suspects(), []);
  });

  it('댓글 — JSON 본문은 415, multipart/form-data만 받는다', async () => {
    const id = (await call('POST', '/cb/api/v3/items/query', { queryString: `tracker.id = ${SYS}` })).body.items[0].id;
    assert.equal((await call('POST', `/cb/api/v3/items/${id}/comments`, { comment: 'x', commentFormat: 'PlainText' })).status, 415);
    const form = new FormData();
    form.set('comment', 'G2 판정: PASS');
    form.set('commentFormat', 'PlainText');
    const s = await boot;
    const r = await fetch(`${s.url}/cb/api/v3/items/${id}/comments`, { method: 'POST', headers: { authorization: basic('ff-sync', 'cb-mock-token') }, body: form });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', `/cb/api/v3/items/${id}/comments`)).body[0].comment, 'G2 판정: PASS');
  });

  it('webhook — 기본은 보내지 않는다(실서버와 같음)', async () => {
    await (await boot).flush();
    assert.equal(sent.length, 0);
  });

  it('호출 제한 — 같은 초 4번째는 429 + Retry-After·retryAfterSecond, /_mock/*는 제한 밖', async () => {
    const s = await startCodebeamerMock({ port: 0, env: { FF_MOCK_DATA_DIR: join(dir, 'cb-limit'), FF_MOCK_FRESH: '1' }, now: () => T0 });
    try {
      const get = () => fetch(`${s.url}/cb/api/v3/projects`, { headers: { authorization: basic('ff-sync', 'cb-mock-token') } });
      for (let n = 0; n < 3; n++) assert.equal((await get()).status, 200);
      const r = await get();
      assert.equal(r.status, 429);
      assert.equal(r.headers.get('retry-after'), '1');
      assert.equal((await r.json()).retryAfterSecond, 1);
      assert.equal((await fetch(`${s.url}/_mock/state`)).status, 200);
    } finally {
      await s.close();
    }
  });

  it('사내 리스너 흉내(CB_MOCK_WEBHOOK=on) — X-CB-Signature·X-CB-Delivery', async () => {
    const got: { headers: Record<string, string>; body: string }[] = [];
    const s = await startCodebeamerMock({ port: 0, env: { FF_MOCK_DATA_DIR: join(dir, 'cb-hook'), FF_MOCK_FRESH: '1', CB_MOCK_THROTTLE: 'off', CB_MOCK_WEBHOOK: 'on', CODEBEAMER_WEBHOOK_SECRET: 'cb-secret' }, now: () => T0, deliver: async (_u, headers, body) => (got.push({ headers, body }), 202) });
    try {
      await fetch(`${s.url}/cb/api/v3/trackers/${SYS}/items`, { method: 'POST', headers: { authorization: basic('ff-sync', 'cb-mock-token'), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
      await s.flush();
      assert.equal(got[0].headers['x-cb-signature'], `sha256=${createHmac('sha256', 'cb-secret').update(got[0].body).digest('hex')}`);
      assert.ok(got[0].headers['x-cb-delivery']);
      assert.equal(JSON.parse(got[0].body).event, 'ITEM_CREATED');
    } finally {
      await s.close();
    }
  });

  it('cbQL 단위', () => {
    const item = { id: 7, tracker: SYS, custom: { [String(fieldId(SYS, 'ASIL'))]: 'B' }, modifiedAt: T0, createdAt: T0 } as unknown as Item;
    const ctx = { now: T0, statusName: () => 'Approved', relations: [] };
    assert.ok(cbql(`'ASIL' IN ('B', 'C') AND status = 'Approved' AND '52.${SYS}.status' = 'Approved' AND modifiedAt >= '-2d'`, ctx).test(item));
    assert.ok(!cbql(`'52.${SYS + 1}.status' = 'Approved'`, ctx).test(item));
    assert.ok(cbql(`modifiedAt >= '2026-11-05 01:00:00'`, ctx).test(item));
    assert.ok(!cbql(`modifiedAt > '2026-11-05 01:00:00'`, ctx).test(item));
  });
});
