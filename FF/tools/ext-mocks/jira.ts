// JIRA 모의 서버(80-50 §6, D-ALM-16) — Jira Cloud REST v3 모양(+ Data Center v2 별칭). 실서버 자리에 서서 FF live 어댑터가 HTTP로 붙는다.
//   npm run mock:jira [-- --port 9131]   환경: FF_WEBHOOK_URL(FF 받는 주소, 기본 http://127.0.0.1:9101/api/webhooks/jira),
//   JIRA_WEBHOOK_SECRET(서명 비밀값 — FF와 같아야 함), MOCK_USERS('사용자:토큰,…'), FF_MOCK_DATA_DIR(상태 파일 폴더)
// 이슈 유형별 워크플로를 강제한다 — Epic은 FF 수명주기와 같은 전이만(§4.3), CR은 FF CR 상태, Story·Task·Bug는 To Do → In Progress → Done.
// 변경마다 webhook(X-Hub-Signature sha256 HMAC · X-Atlassian-Webhook-Identifier). 시험 조작은 /_mock/*(인증 없음).
// 실서버와 다른 점은 FIDELITY.md에 적는다.
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF } from '../lib.ts';
import { isMain, jiraTime, json, route, serve, store, users, type MockServer, type Req, type Res, type Route } from './http.ts';

const require = createRequire(import.meta.url);
const C = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../../contracts/src/index');

type Env = Record<string, string | undefined>;

export interface Comment {
  id: string;
  body: string;
  author: string;
  created: number;
}
export interface Issue {
  id: string;
  key: string;
  project: string;
  type: string;
  status: string;
  summary: string;
  description: string;
  parent: string | null;
  labels: string[];
  assignee: string | null;
  reporter: string;
  custom: Record<string, unknown>;
  created: number;
  updated: number;
  comments: Comment[];
}
export interface Link {
  id: string;
  type: string;
  inward: string;
  outward: string;
}
export interface JiraState {
  nextId: number;
  counters: Record<string, number>;
  issues: Record<string, Issue>;
  links: Link[];
  dropNext: number;
  deliveries: { id: string; event: string; key: string; at: number; status: number | string }[];
}

/** 사용자 필드 — 이름과 ID(실서버는 관리자가 만든다, FF는 JIRA_FIELDS·JIRA_FIELD_*로 대응) */
export const CUSTOM_FIELDS: { id: string; name: string; schema: string }[] = [
  { id: 'customfield_10010', name: 'FF Country', schema: 'string' },
  { id: 'customfield_10011', name: 'FF Vehicle Model', schema: 'string' },
  { id: 'customfield_10012', name: 'FF Trim', schema: 'string' },
  { id: 'customfield_10013', name: 'ASIL', schema: 'option' },
  { id: 'customfield_10014', name: 'FF Owner Team', schema: 'string' },
  { id: 'customfield_10015', name: 'FF Feature DB', schema: 'array' },
  { id: 'customfield_10016', name: 'FF Feature ID', schema: 'string' },
  { id: 'customfield_10017', name: 'FF Working Version', schema: 'string' },
  { id: 'customfield_10018', name: 'FF Release Version', schema: 'string' },
  { id: 'customfield_10019', name: 'FF Gates', schema: 'string' },
  { id: 'customfield_10020', name: 'FF Work Products', schema: 'string' },
  { id: 'customfield_10021', name: 'FF Link', schema: 'url' },
];
const FIELD_BY_NAME = new Map(CUSTOM_FIELDS.map((f) => [f.name.toLowerCase(), f.id]));

/** 이슈 유형별 워크플로 — [상태 목록, 전이(from→to)] */
export function workflows(env: Env = process.env): Record<string, { statuses: string[]; transitions: [string, string][] }> {
  const epicMap = C.parseJiraStatusMap('EPIC', env.JIRA_EPIC_STATUS);
  const epic: Record<string, string> = { ...C.JIRA_EPIC_STATUS_DEFAULT, ...('map' in epicMap ? epicMap.map : {}) };
  const crMap = C.parseJiraStatusMap('CR', env.JIRA_CR_STATUS);
  const cr: Record<string, string> = { ...C.JIRA_CR_STATUS_DEFAULT, ...('map' in crMap ? crMap.map : {}) };
  const simple = { statuses: ['To Do', 'In Progress', 'Done'], transitions: [['To Do', 'In Progress'], ['In Progress', 'Done'], ['In Progress', 'To Do'], ['Done', 'To Do']] as [string, string][] };
  // 결함은 Open에서 시작한다(FF 긴급 차단 결함이 'Open'으로 만든다 — ext:check가 이 상태를 확인)
  const bug = { statuses: ['Open', 'In Progress', 'Resolved', 'Closed'], transitions: [['Open', 'In Progress'], ['In Progress', 'Resolved'], ['Resolved', 'Closed'], ['Resolved', 'Open'], ['Closed', 'Open']] as [string, string][] };
  const crStatuses = [...new Set(Object.values(cr))];
  return {
    Epic: { statuses: [...new Set(Object.values(epic))], transitions: C.FEATURE_TRANSITIONS.map((t) => [epic[t.from], epic[t.to]] as [string, string]) },
    // CR 상태는 FF CR 표의 순서대로 앞으로만 + 반려(같은 표에 있으면). 실서버는 관리자가 워크플로를 만든다
    'Change Request': { statuses: crStatuses, transitions: crStatuses.flatMap((a) => crStatuses.filter((b) => b !== a).map((b) => [a, b] as [string, string])) },
    Story: simple,
    Task: simple,
    Bug: bug,
  };
}

/** 프로젝트 — FF 기본 키(FFE Epic·FFCR 변경요청·FFD 결함) + JIRA_*_PROJECT + JIRA_MOCK_PROJECTS('키,키'). 없는 프로젝트에는 만들 수 없다 */
export function projects(env: Env = process.env): string[] {
  const keys = ['FFE', 'FFCR', 'FFD', 'FFX', env.JIRA_EPIC_PROJECT, env.JIRA_CR_PROJECT, env.JIRA_DEFECT_PROJECT, ...(env.JIRA_MOCK_PROJECTS ?? '').split(',')];
  return [...new Set(keys.map((k) => k?.trim()).filter((k): k is string => !!k))];
}

const adf = (text: string) => ({ type: 'doc', version: 1, content: text.split('\n\n').map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })) });
/** ADF → 글자(문단은 빈 줄) — 실서버의 ADF는 더 풍부하지만 FF는 글자만 쓴다 */
export function adfText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  const node = v as { type?: string; text?: string; content?: unknown[] };
  if (node.type === 'text') return node.text ?? '';
  const parts = (node.content ?? []).map(adfText);
  return node.type === 'doc' ? parts.join('\n\n') : parts.join('');
}

function issueJson(i: Issue, base: string, v: 2 | 3, wanted?: Set<string>) {
  const fields: Record<string, unknown> = {
    summary: i.summary,
    description: v === 3 ? adf(i.description) : i.description,
    issuetype: { name: i.type, subtask: false },
    status: { name: i.status, statusCategory: { key: i.status === 'Done' || i.status === 'Closed' ? 'done' : i.status === 'To Do' || i.status === 'Proposed' ? 'new' : 'indeterminate' } },
    project: { key: i.project },
    parent: i.parent ? { key: i.parent } : null,
    labels: i.labels,
    assignee: i.assignee ? { accountId: i.assignee, displayName: i.assignee } : null,
    reporter: { accountId: i.reporter, displayName: i.reporter },
    created: jiraTime(i.created),
    updated: jiraTime(i.updated),
    comment: { total: i.comments.length, comments: i.comments.map((c) => commentJson(c, v)) },
    ...i.custom,
  };
  const pick = wanted && !wanted.has('*all') ? Object.fromEntries(Object.entries(fields).filter(([k]) => wanted.has(k))) : fields;
  return { id: i.id, key: i.key, self: `${base}/rest/api/${v}/issue/${i.id}`, fields: pick };
}
const commentJson = (c: Comment, v: 2 | 3) => ({ id: c.id, body: v === 3 ? adf(c.body) : c.body, author: { accountId: c.author, displayName: c.author }, created: jiraTime(c.created), updated: jiraTime(c.created) });

/** JQL 일부 — AND로 묶은 절: project = / in (…), issuetype = / in (…), key = / in (…), parent = X, labels = x, status = x,
 *  updated >= "-20m" | "yyyy-MM-dd HH:mm", "사용자 필드 이름" = v, cf[10016] = v, ORDER BY updated|created ASC|DESC */
export function jql(q: string, now = Date.now()): { test: (i: Issue) => boolean; order: (a: Issue, b: Issue) => number } {
  const [where, orderBy] = q.split(/\s+ORDER\s+BY\s+/i);
  const clauses = (where ?? '').trim() ? where.split(/\s+AND\s+/i) : [];
  const unq = (s: string) => s.trim().replace(/^["']|["']$/g, '');
  const list = (s: string) => s.replace(/^\(|\)$/g, '').split(',').map(unq);
  const tests = clauses.map((cl) => {
    const m = /^\s*("[^"]+"|cf\[\d+\]|\w+)\s*(=|!=|>=|<=|>|<|in|not in)\s*(.+?)\s*$/i.exec(cl);
    if (!m) throw Object.assign(new Error(`JQL을 읽을 수 없습니다: ${cl}`), { status: 400 });
    const [, rawField, rawOp, rawValue] = m;
    const op = rawOp.toLowerCase();
    const field = unq(rawField).toLowerCase();
    const values = op.includes('in') ? list(rawValue) : [unq(rawValue)];
    const get = (i: Issue): unknown => {
      if (field === 'project') return i.project;
      if (field === 'issuetype' || field === 'type') return i.type;
      if (field === 'key' || field === 'issuekey') return i.key;
      if (field === 'parent') return i.parent;
      if (field === 'status') return i.status;
      if (field === 'labels') return i.labels;
      if (field === 'updated') return i.updated;
      if (field === 'created') return i.created;
      const cf = /^cf\[(\d+)\]$/.exec(field)?.[1];
      const id = cf ? `customfield_${cf}` : FIELD_BY_NAME.get(field);
      if (!id) throw Object.assign(new Error(`JQL 필드를 모릅니다: ${rawField}`), { status: 400 });
      return i.custom[id];
    };
    if (field === 'updated' || field === 'created') {
      const rel = /^-(\d+)([mhdw])$/.exec(values[0]);
      const t = rel ? now - Number(rel[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2] as 'm'] : Date.parse(values[0].replace(' ', 'T'));
      if (!Number.isFinite(t)) throw Object.assign(new Error(`JQL 날짜를 읽을 수 없습니다: ${values[0]}`), { status: 400 });
      return (i: Issue) => {
        const x = get(i) as number;
        return op === '>=' ? x >= t : op === '>' ? x > t : op === '<=' ? x <= t : op === '<' ? x < t : x === t;
      };
    }
    return (i: Issue) => {
      const x = get(i);
      const hit = Array.isArray(x) ? x.some((v) => values.includes(String(v))) : x != null && values.some((v) => v.toLowerCase() === String(x).toLowerCase());
      return op === '!=' || op === 'not in' ? !hit : hit;
    };
  });
  const [ofield = 'created', odir = 'ASC'] = (orderBy ?? '').trim().split(/\s+/);
  const key = ofield.toLowerCase() === 'updated' ? 'updated' : 'created';
  const sign = odir.toUpperCase() === 'DESC' ? -1 : 1;
  return { test: (i) => tests.every((t) => t(i)), order: (a, b) => sign * (a[key] - b[key] || Number(a.id) - Number(b.id)) };
}

const ERROR = (status: number, message: string) => ({ errorMessages: [message], errors: {}, status });

export interface JiraMockOptions {
  port?: number;
  env?: Env;
  /** 시각 — 시험이 고정 */
  now?: () => number;
  /** webhook 보내기(시험이 가로챈다). 기본은 fetch */
  deliver?: (url: string, headers: Record<string, string>, body: string) => Promise<number>;
}

export async function startJiraMock(o: JiraMockOptions = {}): Promise<MockServer & { state: () => JiraState; flush: () => Promise<void> }> {
  const env = o.env ?? process.env;
  const now = o.now ?? Date.now;
  const db = store<JiraState>('jira', () => ({ nextId: 10000, counters: {}, issues: {}, links: [], dropNext: 0, deliveries: [] }), env);
  const flows = workflows(env);
  const projectKeys = projects(env);
  const projectJson = (key: string) => ({ id: String(10000 + projectKeys.indexOf(key)), key, name: `${key} project`, issueTypes: Object.keys(flows).map((name, i) => ({ id: String(i + 1), name, subtask: false })) });
  const accounts = users(env, { 'ff-sync@example.com': 'jira-mock-token', 'kim.author': 'kim-token' });
  const pending: Promise<unknown>[] = [];
  let base = '';
  const deliver =
    o.deliver ??
    (async (url: string, headers: Record<string, string>, body: string) => {
      const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
      return r.status;
    });

  const S = () => db.get();
  const save = () => db.save();
  const find = (keyOrId: string): Issue | undefined => S().issues[keyOrId] ?? Object.values(S().issues).find((i) => i.id === keyOrId);
  const must = (keyOrId: string): Issue => {
    const i = find(keyOrId);
    if (!i) throw Object.assign(new Error('Issue does not exist or you do not have permission to see it.'), { status: 404 });
    return i;
  };

  function webhook(event: string, i: Issue, user: string, extra: Record<string, unknown> = {}) {
    const url = env.FF_WEBHOOK_URL ?? 'http://127.0.0.1:9101/api/webhooks/jira';
    const secret = env.JIRA_WEBHOOK_SECRET ?? '';
    const id = randomUUID();
    const entry = { id, event, key: i.key, at: now(), status: 'dropped' as number | string };
    S().deliveries = [...S().deliveries, entry].slice(-200);
    if (S().dropNext > 0) {
      S().dropNext--;
      return;
    }
    if (!secret || env.JIRA_MOCK_WEBHOOK === 'off') {
      entry.status = 'off';
      return;
    }
    const body = JSON.stringify({ timestamp: now(), webhookEvent: event, issue_event_type_name: event.replace('jira:', ''), user: { accountId: user, displayName: user }, issue: issueJson(i, base, 2), ...extra });
    const headers = { 'content-type': 'application/json', 'x-hub-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`, 'x-atlassian-webhook-identifier': id };
    pending.push(
      deliver(url, headers, body)
        .then((s) => (entry.status = s))
        .catch((e) => (entry.status = `error: ${e instanceof Error ? e.message : String(e)}`))
        .finally(save),
    );
  }

  function create(fields: Record<string, any>, user: string, v: 2 | 3): Issue {
    const project = String(fields.project?.key ?? fields.project?.id ?? '');
    const type = String(fields.issuetype?.name ?? '');
    if (!projectKeys.includes(project)) throw Object.assign(new Error('project: Specify a valid project ID or key'), { status: 400 });
    const flow = flows[type];
    if (!flow) throw Object.assign(new Error(`issuetype: Specify a valid issue type (${Object.keys(flows).join(', ')})`), { status: 400 });
    if (!fields.summary) throw Object.assign(new Error('summary: You must specify a summary of the issue.'), { status: 400 });
    // Data Center는 Epic 하위를 Epic Link 사용자 필드로 — 같은 값으로 받는다
    const parent = fields.parent?.key ?? fields.parent?.id ?? null;
    if (parent && !find(String(parent))) throw Object.assign(new Error(`parent: Issue ${parent} does not exist`), { status: 400 });
    const n = (S().counters[project] ?? 0) + 1;
    S().counters[project] = n;
    const t = now();
    const custom = Object.fromEntries(Object.entries(fields).filter(([k]) => k.startsWith('customfield_')));
    const i: Issue = {
      id: String(S().nextId++),
      key: `${project}-${n}`,
      project,
      type,
      status: flow.statuses[0],
      summary: String(fields.summary),
      description: v === 3 ? adfText(fields.description) : String(fields.description ?? ''),
      parent: parent ? find(String(parent))!.key : null,
      labels: Array.isArray(fields.labels) ? fields.labels.map(String) : [],
      assignee: fields.assignee?.accountId ?? fields.assignee?.name ?? null,
      reporter: user,
      custom,
      created: t,
      updated: t,
      comments: [],
    };
    S().issues[i.key] = i;
    webhook('jira:issue_created', i, user);
    return i;
  }

  function update(i: Issue, fields: Record<string, any>, user: string, v: 2 | 3) {
    const items: { field: string; fromString: string | null; toString: string | null }[] = [];
    const setF = (field: string, from: unknown, to: unknown, apply: () => void) => {
      if (JSON.stringify(from) === JSON.stringify(to)) return;
      apply();
      items.push({ field, fromString: from == null ? null : String(from), toString: to == null ? null : String(to) });
    };
    for (const [k, val] of Object.entries(fields)) {
      if (k === 'summary') setF('summary', i.summary, val, () => (i.summary = String(val)));
      else if (k === 'description') {
        const text = v === 3 ? adfText(val) : String(val ?? '');
        setF('description', i.description, text, () => (i.description = text));
      } else if (k === 'labels') setF('labels', i.labels.join(' '), (val as string[]).join(' '), () => (i.labels = (val as string[]).map(String)));
      else if (k === 'assignee') setF('assignee', i.assignee, val?.accountId ?? null, () => (i.assignee = val?.accountId ?? null));
      else if (k === 'parent') setF('parent', i.parent, val?.key ?? null, () => (i.parent = val?.key ?? null));
      else if (k.startsWith('customfield_')) setF(CUSTOM_FIELDS.find((f) => f.id === k)?.name ?? k, i.custom[k] ?? null, val, () => (i.custom[k] = val));
      else throw Object.assign(new Error(`Field '${k}' cannot be set. It is not on the appropriate screen, or unknown.`), { status: 400 });
    }
    if (!items.length) return;
    i.updated = Math.max(now(), i.updated + 1);
    webhook('jira:issue_updated', i, user, { changelog: { id: randomUUID(), items } });
  }

  function transitions(i: Issue) {
    return flows[i.type].transitions
      .filter(([from]) => from === i.status)
      .map(([, to]) => ({ id: String(flows[i.type].statuses.indexOf(to) + 11), name: to, to: { name: to }, hasScreen: false, isAvailable: true }));
  }

  function transition(i: Issue, id: string, user: string) {
    const t = transitions(i).find((x) => x.id === id || x.name === id);
    if (!t) throw Object.assign(new Error(`Transition id '${id}' is not valid for this issue.`), { status: 400 });
    const from = i.status;
    i.status = t.to.name;
    i.updated = Math.max(now(), i.updated + 1);
    webhook('jira:issue_updated', i, user, { changelog: { id: randomUUID(), items: [{ field: 'status', fromString: from, toString: i.status }] } });
  }

  function comment(i: Issue, body: unknown, user: string, v: 2 | 3): Comment {
    const c: Comment = { id: String(S().nextId++), body: v === 3 ? adfText(body) : String(body ?? ''), author: user, created: now() };
    i.comments.push(c);
    webhook('comment_created', i, user, { comment: commentJson(c, 2) });
    return c;
  }

  const wrap =
    (fn: (r: Req) => Res) =>
    (r: Req): Res => {
      try {
        const out = fn(r);
        save();
        return out;
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500;
        return json(status, ERROR(status, e instanceof Error ? e.message : String(e)));
      }
    };

  const api = (v: 2 | 3): Route[] => {
    const p = `/rest/api/${v}`;
    const search = (r: Req): Res => {
      const q = r.body ?? Object.fromEntries(r.query);
      const max = Math.min(Number(q.maxResults ?? 50) || 50, 100);
      const fields = q.fields ? new Set(String(Array.isArray(q.fields) ? q.fields.join(',') : q.fields).split(',').map((s) => s.trim())) : undefined;
      const { test, order } = jql(String(q.jql ?? ''), now());
      const all = Object.values(S().issues).filter(test).sort(order);
      // v3 /search/jql은 nextPageToken, v2 /search는 startAt
      const start = v === 3 ? Number(q.nextPageToken ? Buffer.from(String(q.nextPageToken), 'base64url').toString() : 0) : Number(q.startAt ?? 0);
      const page = all.slice(start, start + max).map((i) => issueJson(i, base, v, fields));
      const next = start + max < all.length ? Buffer.from(String(start + max)).toString('base64url') : undefined;
      return json(200, v === 3 ? { issues: page, nextPageToken: next, isLast: !next } : { startAt: start, maxResults: max, total: all.length, issues: page });
    };
    return [
      route('GET', `${p}/myself`, wrap((r) => json(200, { accountId: r.user, displayName: r.user, active: true }))),
      route('GET', `${p}/field`, wrap(() => json(200, [{ id: 'summary', name: 'Summary', custom: false }, { id: 'description', name: 'Description', custom: false }, { id: 'status', name: 'Status', custom: false }, { id: 'parent', name: 'Parent', custom: false }, ...CUSTOM_FIELDS.map((f) => ({ id: f.id, name: f.name, custom: true, schema: { type: f.schema, custom: `com.atlassian.jira.plugin.system.customfieldtypes:${f.schema}` } }))]))),
      route('GET', `${p}/project`, wrap(() => json(200, projectKeys.map(projectJson)))),
      route('GET', `${p}/project/:key`, wrap((r) => (projectKeys.includes(r.params.key) ? json(200, projectJson(r.params.key)) : json(404, ERROR(404, `No project could be found with key '${r.params.key}'.`))))),
      route('GET', `${p}/project/:key/statuses`, wrap(() => json(200, Object.entries(flows).map(([name, f]) => ({ name, statuses: f.statuses.map((s, i) => ({ id: String(i + 1), name: s })) }))))),
      route('POST', `${p}/issue`, wrap((r) => {
        const i = create(r.body?.fields ?? {}, r.user, v);
        return json(201, { id: i.id, key: i.key, self: `${base}${p}/issue/${i.id}` });
      })),
      route('GET', `${p}/issue/:key`, wrap((r) => json(200, issueJson(must(r.params.key), base, v, r.query.get('fields') ? new Set(r.query.get('fields')!.split(',')) : undefined)))),
      route('PUT', `${p}/issue/:key`, wrap((r) => (update(must(r.params.key), r.body?.fields ?? {}, r.user, v), json(204)))),
      route('DELETE', `${p}/issue/:key`, wrap((r) => {
        const i = must(r.params.key);
        delete S().issues[i.key];
        webhook('jira:issue_deleted', i, r.user);
        return json(204);
      })),
      route('GET', `${p}/issue/:key/transitions`, wrap((r) => json(200, { transitions: transitions(must(r.params.key)) }))),
      route('POST', `${p}/issue/:key/transitions`, wrap((r) => (transition(must(r.params.key), String(r.body?.transition?.id ?? r.body?.transition?.name ?? ''), r.user), json(204)))),
      route('GET', `${p}/issue/:key/comment`, wrap((r) => {
        const cs = must(r.params.key).comments.map((c) => commentJson(c, v));
        return json(200, { startAt: 0, maxResults: cs.length, total: cs.length, comments: cs });
      })),
      route('POST', `${p}/issue/:key/comment`, wrap((r) => json(201, commentJson(comment(must(r.params.key), r.body?.body, r.user, v), v)))),
      route('POST', `${p}/issueLink`, wrap((r) => {
        const inward = must(String(r.body?.inwardIssue?.key ?? '')).key;
        const outward = must(String(r.body?.outwardIssue?.key ?? '')).key;
        S().links.push({ id: String(S().nextId++), type: String(r.body?.type?.name ?? 'Relates'), inward, outward });
        return json(201);
      })),
      route('GET', `${p}/issue/:key/remotelink`, wrap(() => json(200, []))),
      ...(v === 3 ? [route('GET', `${p}/search/jql`, wrap(search)), route('POST', `${p}/search/jql`, wrap(search))] : [route('GET', `${p}/search`, wrap(search)), route('POST', `${p}/search`, wrap(search))]),
    ];
  };

  // 시험 조작 — 사람이 JIRA 화면에서 한 일처럼(같은 코드·같은 webhook)
  const mock: Route[] = [
    route('POST', '/_mock/reset', wrap(() => (db.reset(), json(200, { ok: true })))),
    route('GET', '/_mock/state', wrap(() => json(200, S()))),
    route('POST', '/_mock/drop-next-webhook', wrap((r) => ((S().dropNext += Number(r.body?.count ?? 1)), json(200, { dropNext: S().dropNext })))),
    route('POST', '/_mock/seed', wrap((r) => {
      const made = (r.body?.issues ?? []).map((x: { fields: Record<string, unknown>; as?: string; status?: string }) => {
        const i = create(x.fields, x.as ?? 'kim.author', 2);
        if (x.status && x.status !== i.status) i.status = x.status;
        return i.key;
      });
      return json(200, { keys: made });
    })),
    route('POST', '/_mock/act', wrap((r) => {
      const b = r.body ?? {};
      const user = String(b.as ?? 'kim.author');
      const i = must(String(b.key));
      if (b.fields) update(i, b.fields, user, 2);
      if (b.transition) transition(i, String(b.transition), user);
      if (b.comment) comment(i, b.comment, user, 2);
      return json(200, issueJson(i, base, 2));
    })),
  ];

  const s = await serve({
    name: 'jira',
    port: o.port ?? Number(env.JIRA_MOCK_PORT ?? 9131),
    routes: [...api(3), ...api(2), ...mock],
    accounts,
    open: (path) => path.startsWith('/_mock/'),
    error: (status, message) => ERROR(status, message),
  });
  base = s.url;
  return {
    ...s,
    state: S,
    flush: async () => {
      while (pending.length) await pending.shift();
    },
  };
}

if (isMain(import.meta.url)) {
  const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || undefined;
  const s = await startJiraMock({ port: process.argv.includes('--port') ? port : undefined });
  console.log(`mock:jira ${s.url} — 계정 ${Object.keys(users(process.env, { 'ff-sync@example.com': 'jira-mock-token' })).join(', ')} · webhook → ${process.env.FF_WEBHOOK_URL ?? 'http://127.0.0.1:9101/api/webhooks/jira'}${process.env.JIRA_WEBHOOK_SECRET ? '' : ' (JIRA_WEBHOOK_SECRET 없음 — 보내지 않음)'}`);
}
