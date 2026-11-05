// codeBeamer 모의 서버(80-50 §5·§6, D-ALM-16) — codeBeamer REST v3 모양(80-51 §1·§2). 실서버 자리에 서서 FF live 어댑터가 HTTP로 붙는다.
//   npm run mock:codebeamer [-- --port 9132]   경로는 /cb/api/v3/…(실서버)과 /api/v3/…(지금 FF 어댑터) 둘 다.
//   환경: MOCK_USERS('사용자:토큰,…'), FF_MOCK_DATA_DIR, CODEBEAMER_APPROVED_STATUS(기본 Approved), CB_MOCK_THROTTLE=off,
//         CB_MOCK_WEBHOOK=on(사내 리스너 플러그인 흉내일 때만 — 실서버는 바깥으로 webhook을 보내지 않는다) + FF_CB_WEBHOOK_URL · CODEBEAMER_WEBHOOK_SECRET
// 트래커 8종(§5.1)·승인 워크플로(§5.2)를 강제하고, 항목 version·이력·관계 suspect를 실서버처럼 다룬다. 실서버와 다른 점은 FIDELITY.md.
import { createHmac, randomUUID } from 'node:crypto';
import { cbTime, isMain, json, route, serve, store, throttle, users, type MockServer, type Req, type Res, type Route } from './http.ts';

type Env = Record<string, string | undefined>;

/** §5.1 트래커 8종 — 키, 실서버 명명 방식의 이름 */
export const TRACKERS: { key: string; name: string; keyName: string }[] = [
  { key: 'SYS_REQ', name: '[SYS.2]System Requirements Specification', keyName: 'SYSRS' },
  { key: 'SYS_ARCH', name: '[SYS.3]System Architectural Design', keyName: 'SYSAD' },
  { key: 'SW_REQ', name: '[SWE.1]Software Requirements Specification', keyName: 'SWRS' },
  { key: 'SW_ARCH', name: '[SWE.2]Software Architectural Design', keyName: 'SWAD' },
  { key: 'SW_DD', name: '[SWE.3]Software Detailed Design', keyName: 'SWDD' },
  { key: 'SAFETY_REQ', name: '[FSR/TSR]Functional & Technical Safety Requirements', keyName: 'FSRTSR' },
  { key: 'CS_REQ', name: '[CS]Cybersecurity Requirements', keyName: 'CSR' },
  { key: 'TEST_SPEC', name: '[TEST]Test Specification', keyName: 'TEST' },
];
export const PROJECT = { id: 52, name: 'Vehicle Feature Engineering' };
export const trackerId = (key: string) => 4100 + TRACKERS.findIndex((t) => t.key === key);

/** 공통 사용자 필드(§5.1). 실서버처럼 트래커마다 필드 ID가 다르다 — customField[n]의 n = 필드 ID - 10000 */
export const CUSTOM = ['FF Feature ID', 'FF Version', 'ASIL', 'Verification Method', 'Owner', 'Allocation Rationale', 'Requirement ID'] as const;
export const fieldId = (tracker: number, name: string) => 10000 + (tracker - 4100) * 3 + CUSTOM.indexOf(name as (typeof CUSTOM)[number]);
const BASE_FIELDS = [
  { id: 0, name: 'ID', type: 'IntegerField' },
  { id: 3, name: 'Summary', type: 'TextField' },
  { id: 7, name: 'Status', type: 'OptionChoiceField' },
  { id: 74, name: 'Modified at', type: 'DateField' },
  { id: 80, name: 'Description', type: 'WikiTextField' },
];

/** §5.2 워크플로 — Draft → In Review → Approved, Approved → Draft(개정), * → Obsolete */
export function statuses(env: Env = process.env) {
  const approved = env.CODEBEAMER_APPROVED_STATUS?.trim() || 'Approved';
  const list = [
    { id: 1, name: 'Draft' },
    { id: 2, name: 'In Review' },
    { id: 3, name: approved },
    { id: 4, name: 'Obsolete' },
  ];
  const allowed: [number, number][] = [[1, 2], [2, 3], [2, 1], [3, 1], [1, 4], [2, 4], [3, 4]];
  return { list, allowed, byName: (n: string) => list.find((s) => s.name.toLowerCase() === n.toLowerCase()) };
}

/** 연관 유형 — 1~3은 실서버 기본(80-51 §2), 나머지는 FF 의미(CODEBEAMER_RELATIONS 기본값)에 맞춘 가정 */
export const ASSOCIATION_TYPES = [
  { id: 1, name: 'depends' },
  { id: 2, name: 'parent' },
  { id: 3, name: 'child' },
  { id: 4, name: 'related' },
  { id: 5, name: 'derived' },
  { id: 6, name: 'allocated' },
  { id: 7, name: 'refines' },
  { id: 8, name: 'verifies' },
];

export interface Snapshot {
  version: number;
  name: string;
  description: string;
  statusId: number;
  custom: Record<string, string>;
  modifiedAt: number;
  modifiedBy: string;
}
export interface Item extends Snapshot {
  id: number;
  tracker: number;
  createdAt: number;
  createdBy: string;
  history: { version: number; modifiedAt: number; modifiedBy: string; changes: { field: string; oldValue: unknown; newValue: unknown }[] }[];
  snapshots: Snapshot[];
  comments: { id: number; comment: string; commentFormat: string; createdAt: number; createdBy: string }[];
}
export interface Relation {
  id: number;
  /** association(연관) 또는 reference(참조 필드 — from 항목이 to를 가리킨다) */
  kind: 'association' | 'reference';
  type: string;
  from: number;
  to: number;
  propagatingSuspects: boolean;
  biDirectionalPropagation: boolean;
  suspect: boolean;
}
export interface CbState {
  nextId: number;
  items: Record<string, Item>;
  relations: Relation[];
  deliveries: { id: string; event: string; item: number; at: number; status: number | string }[];
}

const ERR = (message: string, path: string) => ({ message, resourceUri: path });
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

/** cbQL 일부(80-51 §2) — AND로 묶은 절: tracker.id / project.id / item.id = · IN (…), '{t}.customField[n]' = v, '필드 이름' = v,
 *  '{p}.{t}.status' = v · status = v, modifiedAt|submittedAt >= 'yyyy-MM-dd HH:mm:ss' | '-2d', hasSuspectedLink = 'true',
 *  referenceToId = n, referenceFromId = n, ORDER BY id|modifiedAt [ASC|DESC]. OR·LIKE·BETWEEN·EXISTS는 받지 않는다(FIDELITY.md) */
export function cbql(q: string, ctx: { now: number; statusName: (i: Item) => string; relations: Relation[] }): { test: (i: Item) => boolean; order: (a: Item, b: Item) => number } {
  const [where, orderBy] = q.split(/\s+ORDER\s+BY\s+/i);
  if (/\s+OR\s+/i.test(where)) throw fail(400, 'cbQL: OR is not supported by this mock');
  const clauses = where.trim() ? where.split(/\s+AND\s+/i) : [];
  const unq = (s: string) => s.trim().replace(/^'|'$/g, '').replace(/''/g, "'");
  const tests = clauses.map((cl) => {
    const m = /^\s*('(?:[^']|'')+'|[\w.]+)\s*(=|!=|>=|<=|>|<|IN|NOT IN)\s*(.+?)\s*$/i.exec(cl);
    if (!m) throw fail(400, `cbQL: cannot parse "${cl}"`);
    const field = unq(m[1]);
    const op = m[2].toUpperCase();
    const values = op.includes('IN') ? m[3].replace(/^\(|\)$/g, '').split(',').map(unq) : [unq(m[3])];
    const lower = field.toLowerCase();
    if (lower === 'modifiedat' || lower === 'submittedat' || lower === 'createdat') {
      const rel = /^-(\d+)([mhd])$/.exec(values[0]);
      // 실서버 시각은 시간대 표기가 없다 — 모의 서버는 UTC로 읽는다
      const t = rel ? ctx.now - Number(rel[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as 'm'] : Date.parse(`${values[0].replace(' ', 'T')}Z`);
      if (!Number.isFinite(t)) throw fail(400, `cbQL: bad date "${values[0]}"`);
      const get = (i: Item) => (lower === 'modifiedat' ? i.modifiedAt : i.createdAt);
      // 실서버 비교는 초 단위
      const sec = (x: number) => Math.floor(x / 1000);
      return (i: Item) => {
        const x = sec(get(i));
        const y = sec(t);
        return op === '>=' ? x >= y : op === '>' ? x > y : op === '<=' ? x <= y : op === '<' ? x < y : x === y;
      };
    }
    let get: (i: Item) => unknown;
    if (lower === 'tracker.id') get = (i) => i.tracker;
    else if (lower === 'project.id') get = () => PROJECT.id;
    else if (lower === 'item.id' || lower === 'id') get = (i) => i.id;
    else if (lower === 'status' || /^\d+\.\d+\.status$/.test(lower)) {
      const t = /^\d+\.(\d+)\.status$/.exec(lower)?.[1];
      get = (i) => (t && Number(t) !== i.tracker ? undefined : ctx.statusName(i));
    } else if (lower === 'hassuspectedlink') get = (i) => String(ctx.relations.some((r) => r.suspect && (r.from === i.id || r.to === i.id)));
    else if (lower === 'referencetoid') get = (i) => ctx.relations.filter((r) => r.from === i.id).map((r) => r.to);
    else if (lower === 'referencefromid') get = (i) => ctx.relations.filter((r) => r.to === i.id).map((r) => r.from);
    else {
      const cf = /^(\d+)\.customfield\[(\d+)\]$/.exec(lower);
      if (cf) get = (i) => (Number(cf[1]) === i.tracker ? i.custom[String(10000 + Number(cf[2]))] : undefined);
      else {
        const name = CUSTOM.find((c) => c.toLowerCase() === lower);
        if (!name) throw fail(400, `cbQL: unknown field "${field}"`);
        get = (i) => i.custom[String(fieldId(i.tracker, name))];
      }
    }
    return (i: Item) => {
      const x = get(i);
      const hit = Array.isArray(x) ? x.some((v) => values.includes(String(v))) : x !== undefined && x !== null && values.some((v) => v.toLowerCase() === String(x).toLowerCase());
      return op === '!=' || op === 'NOT IN' ? !hit : hit;
    };
  });
  const [ofield = 'id', odir = 'ASC'] = (orderBy ?? '').trim().split(/\s+/);
  const sign = odir.toUpperCase() === 'DESC' ? -1 : 1;
  const key = ofield.toLowerCase() === 'modifiedat' ? 'modifiedAt' : 'id';
  return { test: (i) => tests.every((t) => t(i)), order: (a, b) => sign * (a[key] - b[key] || a.id - b.id) };
}

export interface CbMockOptions {
  port?: number;
  env?: Env;
  now?: () => number;
  deliver?: (url: string, headers: Record<string, string>, body: string) => Promise<number>;
}

export async function startCodebeamerMock(o: CbMockOptions = {}): Promise<MockServer & { state: () => CbState; flush: () => Promise<void> }> {
  const env = o.env ?? process.env;
  const now = o.now ?? Date.now;
  const st = statuses(env);
  const db = store<CbState>('codebeamer', () => ({ nextId: 1000, items: {}, relations: [], deliveries: [] }), env);
  const accounts = users(env, { 'ff-sync': 'cb-mock-token', 'lee.engineer': 'lee-token' });
  const limiter = env.CB_MOCK_THROTTLE === 'off' ? null : throttle(3, 120);
  const pending: Promise<unknown>[] = [];
  const deliver =
    o.deliver ??
    (async (url: string, headers: Record<string, string>, body: string) => (await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })).status);

  const S = () => db.get();
  const save = () => db.save();
  const must = (id: string | number): Item => {
    const i = S().items[String(id)];
    if (!i) throw fail(404, `Tracker item is not found: ${id}`);
    return i;
  };
  const trackerOf = (id: number) => {
    const t = TRACKERS[id - 4100];
    if (!t) throw fail(404, `Tracker is not found: ${id}`);
    return t;
  };
  const statusName = (i: Item) => st.list.find((s) => s.id === i.statusId)?.name ?? 'Unset';
  const ref = (i: Item) => ({ id: i.id, name: i.name, type: 'TrackerItemReference' });

  function itemJson(i: Item | (Snapshot & { id: number; tracker: number; createdAt: number; createdBy: string })) {
    const t = trackerOf(i.tracker);
    return {
      id: i.id,
      name: i.name,
      description: i.description,
      descriptionFormat: 'PlainText',
      version: i.version,
      tracker: { id: i.tracker, name: t.name, type: 'TrackerReference' },
      status: { id: i.statusId, name: st.list.find((s) => s.id === i.statusId)?.name, type: 'ChoiceOptionReference' },
      createdAt: cbTime(i.createdAt),
      createdBy: { name: i.createdBy, type: 'UserReference' },
      modifiedAt: cbTime(i.modifiedAt),
      modifiedBy: { name: i.modifiedBy, type: 'UserReference' },
      customFields: Object.entries(i.custom).map(([fid, value]) => ({ fieldId: Number(fid), name: CUSTOM[(Number(fid) - 10000) - (i.tracker - 4100) * 3], value, type: 'TextFieldValue' })),
    };
  }

  function relationsOf(i: Item) {
    const rev = (id: number) => ({ id, version: must(id).version });
    const rel = (r: Relation, other: number) => ({ id: r.id, type: r.kind === 'reference' ? 'TrackerItemReference' : 'OutgoingTrackerItemAssociation', associationType: r.kind === 'association' ? { name: r.type } : undefined, itemRevision: rev(other) });
    const mine = S().relations;
    return {
      itemId: i.id,
      upstreamReferences: mine.filter((r) => r.kind === 'reference' && r.from === i.id).map((r) => rel(r, r.to)),
      downstreamReferences: mine.filter((r) => r.kind === 'reference' && r.to === i.id).map((r) => rel(r, r.from)),
      outgoingAssociations: mine.filter((r) => r.kind === 'association' && r.from === i.id).map((r) => rel(r, r.to)),
      incomingAssociations: mine.filter((r) => r.kind === 'association' && r.to === i.id).map((r) => ({ ...rel(r, r.from), type: 'IncomingTrackerItemAssociation' })),
    };
  }

  function webhook(event: 'ITEM_CREATED' | 'ITEM_UPDATED', i: Item) {
    if (env.CB_MOCK_WEBHOOK !== 'on') return;
    const id = randomUUID();
    const entry = { id, event, item: i.id, at: now(), status: 'pending' as number | string };
    S().deliveries = [...S().deliveries, entry].slice(-200);
    const body = JSON.stringify({ event, item: itemJson(i) });
    const sig = `sha256=${createHmac('sha256', env.CODEBEAMER_WEBHOOK_SECRET ?? '').update(body).digest('hex')}`;
    pending.push(
      deliver(env.FF_CB_WEBHOOK_URL ?? 'http://127.0.0.1:9101/api/webhooks/codebeamer', { 'content-type': 'application/json', 'x-cb-signature': sig, 'x-cb-delivery': id }, body)
        .then((s) => (entry.status = s))
        .catch((e) => (entry.status = `error: ${e instanceof Error ? e.message : String(e)}`))
        .finally(save),
    );
  }

  /** 바뀐 필드 기록 → version·modifiedAt 올림 → 이 항목을 위로 둔 관계를 suspect로(propagatingSuspects) */
  function change(i: Item, user: string, apply: Partial<Snapshot>) {
    const changes: Item['history'][number]['changes'] = [];
    const diff = (field: string, a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b) && changes.push({ field, oldValue: a, newValue: b });
    if (apply.name !== undefined) diff('Summary', i.name, apply.name);
    if (apply.description !== undefined) diff('Description', i.description, apply.description);
    if (apply.statusId !== undefined) diff('Status', statusName(i), st.list.find((s) => s.id === apply.statusId)?.name);
    if (apply.custom) for (const [k, v] of Object.entries(apply.custom)) diff(CUSTOM[Number(k) - 10000 - (i.tracker - 4100) * 3] ?? k, i.custom[k] ?? null, v);
    if (!changes.length) return;
    Object.assign(i, { ...apply, custom: apply.custom ? { ...i.custom, ...apply.custom } : i.custom });
    i.version++;
    // 실서버 시각은 초 단위로 보이므로 같은 초 안의 두 변경도 version으로 구별된다
    i.modifiedAt = Math.max(now(), i.modifiedAt + 1);
    i.modifiedBy = user;
    i.history.push({ version: i.version, modifiedAt: i.modifiedAt, modifiedBy: user, changes });
    i.snapshots.push(snap(i));
    for (const r of S().relations) if (r.propagatingSuspects && (r.to === i.id || (r.biDirectionalPropagation && r.from === i.id))) r.suspect = true;
    webhook('ITEM_UPDATED', i);
  }
  const snap = (i: Item): Snapshot => ({ version: i.version, name: i.name, description: i.description, statusId: i.statusId, custom: { ...i.custom }, modifiedAt: i.modifiedAt, modifiedBy: i.modifiedBy });

  /** 필드 값 목록 → 바꿀 내용. 상태(7)는 워크플로 검사 */
  function fieldValues(i: Item, values: any[]): Partial<Snapshot> {
    const out: Partial<Snapshot> = {};
    for (const v of values ?? []) {
      const id = Number(v.fieldId);
      if (id === 3) out.name = String(v.value ?? '');
      else if (id === 80) out.description = String(v.value ?? '');
      else if (id === 7) {
        const target = v.values?.[0]?.id != null ? st.list.find((s) => s.id === Number(v.values[0].id)) : st.byName(String(v.values?.[0]?.name ?? v.value ?? ''));
        if (!target) throw fail(400, `Unknown status option: ${JSON.stringify(v.values ?? v.value)}`);
        if (target.id !== i.statusId && !st.allowed.some(([a, b]) => a === i.statusId && b === target.id)) throw fail(400, `Transition from '${statusName(i)}' to '${target.name}' is not allowed by the workflow`);
        out.statusId = target.id;
      } else if (id >= 10000) {
        if (CUSTOM[id - 10000 - (i.tracker - 4100) * 3] === undefined) throw fail(400, `Field ${id} is not defined in tracker ${i.tracker}`);
        out.custom = { ...(out.custom ?? {}), [String(id)]: String(v.value ?? '') };
      } else throw fail(400, `Field ${id} is read-only`);
    }
    return out;
  }

  function create(tracker: number, body: any, user: string): Item {
    trackerOf(tracker);
    if (!body?.name) throw fail(400, 'name: must not be blank');
    const t = now();
    const i: Item = { id: S().nextId++, tracker, version: 1, name: String(body.name), description: String(body.description ?? ''), statusId: 1, custom: {}, createdAt: t, createdBy: user, modifiedAt: t, modifiedBy: user, history: [], snapshots: [], comments: [] };
    for (const v of body.customFields ?? []) {
      const id = Number(v.fieldId);
      if (CUSTOM[id - 10000 - (tracker - 4100) * 3] === undefined) throw fail(400, `Field ${id} is not defined in tracker ${tracker}`);
      i.custom[String(id)] = String(v.value ?? '');
    }
    i.history.push({ version: 1, modifiedAt: t, modifiedBy: user, changes: [] });
    i.snapshots.push(snap(i));
    S().items[String(i.id)] = i;
    webhook('ITEM_CREATED', i);
    return i;
  }

  function relate(from: number, to: number, kind: Relation['kind'], type: string, o2: { propagatingSuspects?: boolean; biDirectionalPropagation?: boolean } = {}): Relation {
    must(from);
    must(to);
    const r: Relation = { id: S().nextId++, kind, type, from, to, propagatingSuspects: o2.propagatingSuspects ?? true, biDirectionalPropagation: o2.biDirectionalPropagation ?? false, suspect: false };
    S().relations.push(r);
    return r;
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
        return json(status, ERR(e instanceof Error ? e.message : String(e), r.path));
      }
    };

  const api = (p: string): Route[] => {
    const query = (r: Req): Res => {
      const q = r.body ?? Object.fromEntries(r.query);
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const size = Math.min(Math.max(1, Number(q.pageSize ?? 25) || 25), 500);
      const { test, order } = cbql(String(q.queryString ?? ''), { now: now(), statusName, relations: S().relations });
      const all = Object.values(S().items).filter(test).sort(order);
      return json(200, { page, pageSize: size, total: all.length, items: all.slice((page - 1) * size, page * size).map(itemJson) });
    };
    const schema = (id: number) =>
      [
        ...BASE_FIELDS,
        ...CUSTOM.map((name) => ({ id: fieldId(id, name), name, type: name === 'ASIL' ? 'OptionChoiceField' : 'TextField', ...(name === 'ASIL' ? { options: ['QM', 'A', 'B', 'C', 'D'].map((n, k) => ({ id: k + 1, name: n })), multipleValues: false } : {}), propertyName: `customField[${fieldId(id, name) - 10000}]` })),
      ].map((f) => (f.id === 7 ? { ...f, options: st.list } : f));
    return [
      route('GET', `${p}/projects`, wrap(() => json(200, [{ ...PROJECT, type: 'ProjectReference' }]))),
      route('GET', `${p}/projects/:id`, wrap((r) => (Number(r.params.id) === PROJECT.id ? json(200, { ...PROJECT, type: 'Project' }) : json(404, ERR(`Project is not found: ${r.params.id}`, r.path))))),
      route('GET', `${p}/projects/:id/trackers`, wrap(() => json(200, TRACKERS.map((t) => ({ id: trackerId(t.key), name: t.name, type: 'TrackerReference' }))))),
      route('GET', `${p}/trackers/types`, wrap(() => json(200, [{ id: 5, name: 'Requirement' }, { id: 9, name: 'Test Case' }]))),
      route('GET', `${p}/trackers/:id`, wrap((r) => {
        const id = Number(r.params.id);
        const t = trackerOf(id);
        return json(200, { id, name: t.name, keyName: t.keyName, version: 1, type: { id: t.key === 'TEST_SPEC' ? 9 : 5, name: t.key === 'TEST_SPEC' ? 'Test Case' : 'Requirement' }, project: { id: PROJECT.id, name: PROJECT.name, type: 'ProjectReference' }, usingWorkflow: true });
      })),
      route('GET', `${p}/trackers/:id/fields`, wrap((r) => (trackerOf(Number(r.params.id)), json(200, schema(Number(r.params.id)).map(({ id, name, type }) => ({ id, name, type: 'FieldReference', fieldType: type })))))),
      route('GET', `${p}/trackers/:id/fields/:fieldId`, wrap((r) => {
        const f = schema(Number(r.params.id)).find((x) => x.id === Number(r.params.fieldId));
        return f ? json(200, f) : json(404, ERR(`Field is not found: ${r.params.fieldId}`, r.path));
      })),
      route('GET', `${p}/trackers/:id/schema`, wrap((r) => (trackerOf(Number(r.params.id)), json(200, schema(Number(r.params.id)))))),
      route('GET', `${p}/trackers/:id/transitions`, wrap((r) => {
        trackerOf(Number(r.params.id));
        const from = r.query.get('fromStatusId');
        return json(200, st.allowed.filter(([a]) => !from || a === Number(from)).map(([a, b]) => ({ id: a * 10 + b, name: `${st.list[a - 1].name} → ${st.list[b - 1].name}`, fromStatus: st.list[a - 1], toStatus: st.list[b - 1] })));
      })),
      route('GET', `${p}/trackers/:id/items`, wrap((r) => {
        const id = Number(r.params.id);
        trackerOf(id);
        const page = Math.max(1, Number(r.query.get('page') ?? 1));
        const size = Math.min(500, Math.max(1, Number(r.query.get('pageSize') ?? 25)));
        const all = Object.values(S().items).filter((i) => i.tracker === id).sort((a, b) => a.id - b.id);
        return json(200, { page, pageSize: size, total: all.length, itemRefs: all.slice((page - 1) * size, page * size).map(ref) });
      })),
      route('POST', `${p}/trackers/:id/items`, wrap((r) => json(200, itemJson(create(Number(r.params.id), r.body, r.user))))),
      route('GET', `${p}/items/query`, wrap(query)),
      route('POST', `${p}/items/query`, wrap(query)),
      route('POST', `${p}/items/relations`, wrap((r) => {
        const ids: unknown[] = Array.isArray(r.body) ? r.body : (r.body?.itemIds ?? []);
        return json(200, ids.map((id) => relationsOf(must(String(id)))));
      })),
      route('GET', `${p}/items/:id`, wrap((r) => {
        const i = must(r.params.id);
        const v = r.query.get('version');
        if (!v) return json(200, itemJson(i));
        const s = i.snapshots.find((x) => x.version === Number(v));
        if (!s) throw fail(404, `Version ${v} of item ${i.id} is not found`);
        return json(200, itemJson({ ...s, id: i.id, tracker: i.tracker, createdAt: i.createdAt, createdBy: i.createdBy }));
      })),
      // 전체 교체 — 빠진 사용자 필드는 지운다(실서버와 같음)
      route('PUT', `${p}/items/:id`, wrap((r) => {
        const i = must(r.params.id);
        const custom = Object.fromEntries(Object.keys(i.custom).map((k) => [k, '']));
        for (const v of r.body?.customFields ?? []) custom[String(v.fieldId)] = String(v.value ?? '');
        const apply = fieldValues(i, Object.entries(custom).map(([fid, value]) => ({ fieldId: Number(fid), value })));
        change(i, r.user, { name: String(r.body?.name ?? ''), description: String(r.body?.description ?? ''), ...apply });
        return json(200, itemJson(i));
      })),
      route('PUT', `${p}/items/:id/fields`, wrap((r) => {
        const i = must(r.params.id);
        change(i, r.user, fieldValues(i, r.body?.fieldValues));
        return json(200, itemJson(i));
      })),
      route('DELETE', `${p}/items/:id`, wrap((r) => {
        const i = must(r.params.id);
        delete S().items[String(i.id)];
        S().relations = S().relations.filter((x) => x.from !== i.id && x.to !== i.id);
        return json(200, itemJson(i));
      })),
      route('GET', `${p}/items/:id/relations`, wrap((r) => json(200, relationsOf(must(r.params.id))))),
      route('GET', `${p}/items/:id/transitions`, wrap((r) => {
        const i = must(r.params.id);
        return json(200, st.allowed.filter(([a]) => a === i.statusId).map(([a, b]) => ({ id: a * 10 + b, name: st.list[b - 1].name, fromStatus: st.list[a - 1], toStatus: st.list[b - 1] })));
      })),
      route('GET', `${p}/items/:id/history`, wrap((r) => {
        const i = must(r.params.id);
        return json(200, { versions: i.history.map((h) => ({ itemRevision: { id: i.id, version: h.version }, modifiedAt: cbTime(h.modifiedAt), modifiedBy: { name: h.modifiedBy }, changes: h.changes })) });
      })),
      route('GET', `${p}/items/:id/comments`, wrap((r) => json(200, must(r.params.id).comments.map((c) => ({ id: c.id, comment: c.comment, commentFormat: c.commentFormat, createdAt: cbTime(c.createdAt), createdBy: { name: c.createdBy } }))))),
      // 실서버는 multipart/form-data만 받는다(80-51 §2) — JSON 본문은 415
      route('POST', `${p}/items/:id/comments`, wrap((r) => {
        const i = must(r.params.id);
        if (!String(r.headers['content-type'] ?? '').startsWith('multipart/form-data')) return json(415, ERR('Content type must be multipart/form-data', r.path));
        if (!r.form.comment) throw fail(400, 'comment: must not be blank');
        const c = { id: S().nextId++, comment: r.form.comment, commentFormat: r.form.commentFormat || 'PlainText', createdAt: now(), createdBy: r.user };
        i.comments.push(c);
        return json(200, { id: c.id, comment: c.comment, commentFormat: c.commentFormat, createdAt: cbTime(c.createdAt), createdBy: { name: c.createdBy } });
      })),
      route('GET', `${p}/associations/types`, wrap(() => json(200, ASSOCIATION_TYPES))),
      route('POST', `${p}/associations`, wrap((r) => {
        const b = r.body ?? {};
        const type = ASSOCIATION_TYPES.find((t) => t.id === Number(b.type?.id) || t.name === b.type?.name);
        if (!type) throw fail(400, `Unknown association type: ${JSON.stringify(b.type)}`);
        const a = relate(Number(b.from?.id), Number(b.to?.id), 'association', type.name, b);
        return json(200, { id: a.id, from: { id: a.from }, to: { id: a.to }, type, propagatingSuspects: a.propagatingSuspects, biDirectionalPropagation: a.biDirectionalPropagation });
      })),
      route('GET', `${p}/associations/:id`, wrap((r) => {
        const a = S().relations.find((x) => x.kind === 'association' && x.id === Number(r.params.id));
        if (!a) throw fail(404, `Association is not found: ${r.params.id}`);
        return json(200, { id: a.id, from: { id: a.from }, to: { id: a.to }, type: ASSOCIATION_TYPES.find((t) => t.name === a.type), propagatingSuspects: a.propagatingSuspects, biDirectionalPropagation: a.biDirectionalPropagation });
      })),
      route('DELETE', `${p}/associations/:id`, wrap((r) => {
        S().relations = S().relations.filter((x) => !(x.kind === 'association' && x.id === Number(r.params.id)));
        return json(200, {});
      })),
    ];
  };

  // 시험 조작 — 사람이 codeBeamer 화면에서 한 일처럼(같은 코드 경로: version·이력·suspect)
  const mock: Route[] = [
    route('POST', '/_mock/reset', wrap(() => (db.reset(), json(200, { ok: true })))),
    route('GET', '/_mock/state', wrap(() => json(200, S()))),
    /** { items: [{ ref, tracker: 'SYS_REQ', name, fields: {'FF Feature ID': …}, status, as }], relations: [{ from: ref, to: ref, kind, type }] } → { ids: { ref: id } } */
    route('POST', '/_mock/seed', wrap((r) => {
      const ids: Record<string, number> = {};
      for (const x of r.body?.items ?? []) {
        const tid = trackerId(String(x.tracker));
        if (tid < 4100) throw fail(400, `Unknown tracker key: ${x.tracker}`);
        const i = create(tid, { name: x.name, description: x.description, customFields: Object.entries(x.fields ?? {}).map(([n, value]) => ({ fieldId: fieldId(tid, n), value })) }, String(x.as ?? 'lee.engineer'));
        // 시드는 워크플로를 건너뛰어 바로 원하는 상태로(이력 한 줄)
        if (x.status) {
          const s = st.byName(String(x.status));
          if (!s) throw fail(400, `Unknown status: ${x.status}`);
          i.statusId = s.id;
          i.snapshots = [snap(i)];
        }
        if (x.ref) ids[String(x.ref)] = i.id;
      }
      const resolve = (v: unknown) => ids[String(v)] ?? Number(v);
      for (const x of r.body?.relations ?? []) relate(resolve(x.from), resolve(x.to), x.kind === 'reference' ? 'reference' : 'association', String(x.type ?? 'related'), x);
      return json(200, { ids });
    })),
    /** { id, as, fields: {'Summary'|'Description'|사용자 필드 이름: 값}, status, clearSuspect: relationId | 'all' } */
    route('POST', '/_mock/act', wrap((r) => {
      const b = r.body ?? {};
      const i = must(String(b.id));
      const user = String(b.as ?? 'lee.engineer');
      const values: any[] = Object.entries(b.fields ?? {}).map(([n, value]) => (n === 'Summary' ? { fieldId: 3, value } : n === 'Description' ? { fieldId: 80, value } : { fieldId: fieldId(i.tracker, n), value }));
      if (b.status) values.push({ fieldId: 7, values: [{ name: b.status }] });
      if (values.length) change(i, user, fieldValues(i, values));
      if (b.clearSuspect != null) for (const x of S().relations) if ((b.clearSuspect === 'all' && (x.from === i.id || x.to === i.id)) || x.id === Number(b.clearSuspect)) x.suspect = false;
      return json(200, { item: itemJson(i), relations: relationsOf(i) });
    })),
  ];

  const s = await serve({
    name: 'codebeamer',
    port: o.port ?? Number(env.CODEBEAMER_MOCK_PORT ?? 9132),
    routes: [...api('/cb/api/v3'), ...api('/api/v3'), ...mock],
    accounts,
    open: (path) => path.startsWith('/_mock/'),
    limit: limiter ? () => limiter(now()) : undefined,
    error: (_status, message, path) => ERR(message, path),
  });
  return {
    ...s,
    state: S,
    flush: async () => {
      while (pending.length) await pending.shift();
    },
  };
}

if (isMain(import.meta.url)) {
  const at = process.argv.indexOf('--port');
  const s = await startCodebeamerMock({ port: at > 0 ? Number(process.argv[at + 1]) : undefined });
  console.log(`mock:codebeamer ${s.url}/cb/api/v3 — 프로젝트 ${PROJECT.id} · 트래커 ${TRACKERS.length}종(${trackerId('SYS_REQ')}~${trackerId('TEST_SPEC')}) · 호출 제한 ${process.env.CB_MOCK_THROTTLE === 'off' ? '끔' : '초당 3·분당 120'} · webhook ${process.env.CB_MOCK_WEBHOOK === 'on' ? '켬' : '없음(실서버와 같음)'}`);
}
