// 시연 데이터 엔진 — 정적 공개 사이트의 쓰기를 이 브라우저 안에서 서버처럼 처리한다(설계 docs/20-architecture/20-61-browser-simulator.md).
//  · 쓰기: 경로 이름별 핸들러(registerSimHandler). 역할(routes.ts roles)·본문(zod)을 서버와 같은 규칙으로 먼저 본다.
//    핸들러가 바꾼 것은 끝난 뒤 한 번에 반영(트랜잭션), 규칙 위반은 서버와 같은 오류 봉투 → ApiError
//  · 읽기: 스냅샷 위에 오버레이를 덮는다(registerSimView — ID 기준 교체·목록 앞 추가·건수) 또는 계산(registerSimReader)
//  · 감사·알림·이벤트: 쓰기마다 감사(시연 해시 체인), NOTIFICATION_RULES로 알림 수신자 계산, 이벤트는 이벤트 버스로 흘러 SSE처럼 화면이 새로 읽는다
import {
  accountOf,
  canonicalJson,
  NOTIFICATION_RULES,
  receives,
  ROLE_LABEL,
  ROUTES,
  routeUrl,
  snapshotFile,
  type Role,
  type RouteDef,
} from '@ff/contracts';
import type { ZodTypeAny } from 'zod';
import { errors as E } from '../../copy/errors';
import { actorFor } from '../actor';
import { ApiError, gateDenied, toApiError, VIEW_ROLES, type CallOptions } from '../client';
import { localDataChanged, publishLocalEvents, refreshLocalSubscribers, type PlatformEvent } from '../shared-event-source';
import { applyQuerySpec, baseQuery, QUERY_SPECS } from './list-filter';
import { clearOverlay, emptyOverlay, loadOverlay, saveOverlay } from './store';
import type {
  SimActor,
  SimAudit,
  SimAuditInput,
  SimHandler,
  SimNotification,
  SimNotifyContext,
  SimOverlay,
  SimReadContext,
  SimReader,
  SimRequest,
  SimTask,
  SimTaskHandler,
  SimView,
  SimWriteContext,
} from './types';

// ─── 등록소 ───────────────────────────────────────────────
const handlers = new Map<string, SimHandler>();
/** 요청 본문 검증기 — 화면 묶음의 경로 표는 본문 스키마를 뺀다(tools/browser-routes) → 핸들러가 contracts 스키마를 함께 등록한다 */
const bodies = new Map<string, ZodTypeAny>();
const readers = new Map<string, SimReader>();
const views = new Map<string, SimView>();
const tasks = new Map<string, SimTaskHandler>();
const BY_NAME = new Map<string, RouteDef>(ROUTES.map((r) => [r.name, r]));

/** 쓰기 경로(routes.ts name) 핸들러 — 응답 본문을 돌려주거나 ctx.fail로 서버와 같은 오류. body는 그 경로의 contracts 스키마(서버 ZodPipe와 같은 검증) */
export function registerSimHandler(name: string, fn: SimHandler, opts: { body?: ZodTypeAny } = {}) {
  const r = BY_NAME.get(name);
  if (!r || r.method === 'GET') throw new Error(`시연 핸들러: 쓰기 경로가 아닙니다 — ${name}`);
  handlers.set(name, fn);
  if (opts.body) bodies.set(name, opts.body);
}
/** 계산 읽기 — undefined를 돌려주면 스냅샷 + 오버레이(뷰)로 넘어간다 */
export function registerSimReader(name: string, fn: SimReader) {
  readers.set(name, fn);
}
/** 스냅샷 목록·상세에 컬렉션 오버레이를 덮는다 */
export function registerSimView(name: string, view: SimView) {
  views.set(name, view);
}
/** ctx.later(ms, kind, args)로 예약하는 작업 */
export function registerSimTask(kind: string, fn: SimTaskHandler) {
  tasks.set(kind, fn);
}
/** 이벤트 구독(서버 events.stream 구독과 같다) — 같은 쓰기 안에서 이어 실행되고 함께 반영된다. 'publication.'처럼 점으로 끝나면 접두어 */
export type SimListener = (ctx: SimWriteContext, event: PlatformEvent) => void | Promise<void>;
const listeners: { types: string[]; fn: SimListener }[] = [];
export function registerSimListener(types: string[], fn: SimListener) {
  listeners.push({ types, fn });
}
const listens = (types: string[], type: string) => types.some((t) => t === type || (t.endsWith('.') && type.startsWith(t)));
export const simHandled = (name: string) => handlers.has(name);

/** 흐름별 핸들러 모듈 — 입구(index.ts)가 지연 import 목록을 건다. 처음 쓸 때 한 번(병렬) 불러 등록하고, 실패하면 다음 요청에서 다시 */
let handlerLoader: (() => Promise<unknown>) | null = null;
let handlersLoaded: Promise<unknown> | null = null;
export function setSimHandlerLoader(fn: () => Promise<unknown>) {
  handlerLoader = fn;
  handlersLoaded = null;
}
/** 핸들러·뷰·구독이 모두 등록될 때까지 — 쓰기·덮어 읽기 전에 */
export function simReady(): Promise<unknown> {
  if (!handlerLoader) return Promise.resolve();
  handlersLoaded ??= handlerLoader().catch((e) => {
    handlersLoaded = null;
    throw e;
  });
  return handlersLoaded;
}

// ─── 오류(서버 kernel/errors.ts STATUS와 같은 표) ─────────────
const STATUS: Record<string, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SEPARATION_OF_DUTY: 403,
  CONFLICT: 409,
  IMMUTABLE: 409,
  GUARD_FAILED: 422,
  PRECONDITION_FAILED: 412,
  REFDB_LINK_REQUIRED: 400,
  REFDB_DUPLICATE_IN_SCOPE: 409,
  INTERNAL: 500,
};
export class SimError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code] ?? 400;
  }
}
const asApiError = (e: SimError): ApiError => toApiError({ status: e.status, headers: new Headers() }, { error: { code: e.code, message: e.message, details: e.details } });

// ─── 상태 ─────────────────────────────────────────────────
let overlay: SimOverlay | null = null;
let ready: Promise<SimOverlay> | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** 쓰기·예약 작업을 한 줄로(서버 트랜잭션처럼 섞이지 않게) */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

/** 시험·개발용 — 등록 안 된 쓰기 목록 */
declare global {
  interface Window {
    __simUnhandled?: { name: string; at: string; params: Record<string, string>; body: unknown }[];
  }
}

const snapCache = new Map<string, Promise<any | null>>();
async function fetchSnapshot(url: string): Promise<any | null> {
  let p = snapCache.get(url);
  if (!p) {
    p = (async () => {
      let res: Response;
      try {
        res = await fetch(import.meta.env.BASE_URL + snapshotFile(url));
      } catch {
        return null;
      }
      // 접속 게이트 쿠키 만료(401 게이트 표식) — 로그인으로 옮기고 오류(빈 스냅샷으로 보지 않는다)
      const gate = await gateDenied(res);
      if (gate) throw gate;
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      try {
        return await res.json();
      } catch {
        return null;
      }
    })();
    snapCache.set(url, p);
    p.catch(() => snapCache.delete(url));
  }
  const v = await p;
  return v === null ? null : structuredClone(v);
}

const urlOf = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as Record<string, string>);
const queryOf = (url: string): Record<string, string> => Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? ''));

/** 스냅샷 판 — 감사 체인 끝(배포 때 스냅샷을 새로 찍으면 달라진다) */
async function versionKey(): Promise<string> {
  const c = await fetchSnapshot(urlOf('auditChain'));
  return c ? `${c.head ?? ''}@${c.checkedAt ?? ''}@${c.verified ?? ''}` : 'none';
}

async function ensure(): Promise<SimOverlay> {
  await simReady();
  if (overlay) return overlay;
  ready ??= (async () => {
    const o = await loadOverlay(await versionKey());
    overlay = o;
    for (const t of o.tasks) schedule(t);
    return o;
  })();
  return ready;
}

/** 이벤트·감사·알림 순번의 출발점(스냅샷 끝) — 한 번만 */
async function seed(o: SimOverlay) {
  if (o.seq.event !== undefined) return;
  const [ev, au, ntf, chain] = await Promise.all([
    fetchSnapshot(urlOf('events', {}, { limit: 500, recent: '1' })),
    fetchSnapshot(urlOf('audit', {}, { limit: 500 })),
    fetchSnapshot(urlOf('notifications', {}, { limit: 200 })),
    fetchSnapshot(urlOf('auditChain')),
  ]);
  const maxOf = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
  o.seq.event = maxOf((ev?.items ?? []).map((e: any) => Number(e.seq) || 0));
  o.seq.audit = maxOf((au?.items ?? []).map((a: any) => Number(a.id) || 0));
  o.seq.NTF = maxOf((ntf?.items ?? []).map((n: any) => Number(/(\d+)$/.exec(n.notificationId ?? '')?.[1] ?? 0)));
  o.chain = { head: chain?.head ?? null, count: 0 };
}

// ─── 행위자 ───────────────────────────────────────────────
/** 서버 RolesGuard와 같은 규칙 — 경로가 허용하는 역할 중 이 사람이 맡은 것(화면이 고른 actorRole 먼저) */
export function simActor(route: RouteDef, opts: Pick<CallOptions, 'role' | 'actorRole'>): SimActor {
  const persona = opts.role ?? 'viewer';
  const allowed = opts.actorRole && route.roles?.includes(opts.actorRole) ? [opts.actorRole, ...route.roles] : (route.roles ?? (route.method === 'GET' ? VIEW_ROLES[route.name] : undefined));
  const a = actorFor(persona, allowed);
  return { id: a.id, role: a.role, persona };
}
const SYSTEM: SimActor = { id: 'system', role: 'SYSTEM' as Role, persona: 'system' };

// ─── 읽기 ─────────────────────────────────────────────────
function readContext(o: SimOverlay, req: SimRequest, actor: SimActor): SimReadContext {
  return {
    req,
    actor,
    overlay: o,
    now: () => new Date(),
    snapshot: (name, params, query) => fetchSnapshot(name ? urlOf(name, params, query) : req.url),
    read: (name, params = {}, query = {}) => readRoute(o, requestOf(name, params, query, undefined), actor),
    get: (c, id) => o.entities[c]?.[id],
    list: (c) => Object.values(o.entities[c] ?? {}),
  };
}

function requestOf(name: string, params: Record<string, string>, query: Record<string, unknown>, body: unknown): SimRequest {
  const route = BY_NAME.get(name);
  if (!route) throw new Error(`알 수 없는 API: ${name}`);
  const url = urlOf(name, params, query);
  return { name, route, url, params, query: queryOf(url), body };
}

/** 스냅샷에도 오버레이에도 없음 — 정적 클라이언트와 같은 404 */
const notFound = () => new ApiError(404, 'NOT_FOUND', E.notInSnapshot);

async function readRoute(o: SimOverlay, req: SimRequest, actor: SimActor): Promise<any> {
  const ctx = readContext(o, req, actor);
  const reader = readers.get(req.name);
  if (reader) {
    const r = await reader(ctx);
    if (r !== undefined) return r;
  }
  let base = await fetchSnapshot(req.url);
  // 감사 검색(대상 앞부분·행위·결과)은 스냅샷이 첫 쪽(500건)만 있다 — 그 쪽을 같은 조건으로 걸러 바탕으로 쓴다
  if (!base && req.name === 'audit' && !req.query.cursor) {
    const page = await fetchSnapshot(urlOf('audit', {}, { limit: 500 }));
    const q = req.query;
    if (page)
      base = {
        ...page,
        nextCursor: null,
        items: (page.items ?? []).filter(
          (a: SimAudit) => (!q.target || a.target === q.target) && (!q.actorId || a.actorId === q.actorId) && (!q.result || a.result === q.result) && (!q.targetPrefix || a.target.startsWith(q.targetPrefix)) && (!q.action || a.action === q.action),
        ),
      };
  }
  // 필터를 고른 질의의 스냅샷이 없다 — 같은 경로의 기본 목록(필터 키를 뺀 질의)을 오버레이까지 덮어 읽고 서버 규칙으로 거른다(list-filter.ts)
  if (!base) {
    const spec = QUERY_SPECS[req.name];
    const bq = spec && baseQuery(spec, req.query);
    if (spec && bq) return applyQuerySpec(spec, await readRoute(o, requestOf(req.name, req.params, bq, undefined), actor), req.query);
  }
  const merged = mergeRead(o, req, actor, base, ctx);
  if (merged === null || merged === undefined) throw notFound();
  return merged;
}

/** 스냅샷 + 오버레이 — 등록된 뷰, 그리고 공통(이벤트·감사·체인·알림) */
function mergeRead(o: SimOverlay, req: SimRequest, actor: SimActor, base: any, ctx: SimReadContext): any {
  const view = views.get(req.name);
  if (view) return applyView(view, o, req, base, ctx);
  switch (req.name) {
    case 'events':
      return base && mergeEvents(o, req.query, base);
    case 'audit':
      return base && mergeAudit(o, req.query, base);
    case 'auditChain':
      return base && (o.chain.count ? { ...base, verified: (base.verified ?? 0) + o.chain.count, head: o.chain.head ?? base.head, checkedAt: new Date().toISOString() } : base);
    case 'notifications':
      return mergeNotifications(o, req.query, actor, base);
    default:
      return base;
  }
}

/** 뷰 — 상세는 오버레이 엔터티가 있으면 그것(스냅샷 상세 위에), 목록은 ID 기준 교체 + 새 항목 앞에 + 건수 */
export function applyView(view: SimView, o: SimOverlay, req: SimRequest, base: any, ctx: SimReadContext): any {
  const coll = o.entities[view.collection] ?? {};
  const show = (e: any) => (view.project ? view.project(e, ctx) : e);
  if (view.detailParam) {
    const id = req.params[view.detailParam];
    const e = id !== undefined ? coll[id] : undefined;
    if (!e) return base;
    return show(base && typeof base === 'object' ? { ...base, ...e } : e);
  }
  const key = view.listKey ?? 'items';
  const items: any[] = Array.isArray(base?.[key]) ? base[key] : base ? [] : [];
  const pass = (e: any) => !view.filter || view.filter(e, req.query);
  const seen = new Set<string>();
  const replaced: any[] = [];
  let dropped = 0;
  for (const it of items) {
    const id = String(it?.[view.idKey]);
    seen.add(id);
    const e = coll[id];
    if (!e) {
      replaced.push(it);
      continue;
    }
    if (pass(e)) replaced.push(show({ ...it, ...e }));
    else dropped++;
  }
  // 새로 만든 것과, 스냅샷 목록(질의 결과)에 없던 바뀐 엔터티 중 이제 질의에 맞는 것
  const fresh = (o.created[view.collection] ?? []).filter((id) => !seen.has(id) && coll[id] && pass(coll[id]));
  const moved = Object.keys(coll).filter((id) => !seen.has(id) && !fresh.includes(id) && pass(coll[id]));
  const added = [...fresh, ...moved].map((id) => show(coll[id]));
  const out = { ...(base ?? {}), [key]: [...added, ...replaced] };
  for (const k of ['total', 'count']) if (typeof base?.[k] === 'number') out[k] = base[k] + added.length - dropped;
  return out;
}

function mergeEvents(o: SimOverlay, q: Record<string, string>, base: any) {
  const mine = o.events.filter((e) => (!q.type || e.type === q.type || e.type.startsWith(q.type)) && (!q.aggregate || e.aggregate === q.aggregate) && (!q.after || e.seq > Number(q.after)));
  if (!mine.length) return base;
  const limit = Number(q.limit) || 100;
  const items = [...(base.items ?? []), ...mine];
  if (q.recent) return { ...base, items: items.slice(-limit) };
  // 앞쪽 쪽(커서)은 스냅샷 그대로 — 새 이벤트는 마지막 쪽에만
  return base.nextCursor ? base : { ...base, items: items.slice(0, Math.max(limit, (base.items ?? []).length + mine.length)) };
}

function mergeAudit(o: SimOverlay, q: Record<string, string>, base: any) {
  if (q.cursor) return base;
  const mine = o.audit.filter(
    (a) =>
      (!q.target || a.target === q.target) &&
      (!q.actorId || a.actorId === q.actorId) &&
      (!q.result || a.result === q.result) &&
      (!q.targetPrefix || a.target.startsWith(q.targetPrefix)) &&
      (!q.action || a.action === q.action),
  );
  if (!mine.length) return base;
  const limit = Number(q.limit) || 100;
  return { ...base, items: [...mine.map(({ prevHash: _p, hash: _h, ...a }) => a), ...(base.items ?? [])].slice(0, limit) };
}

function mergeNotifications(o: SimOverlay, q: Record<string, string>, actor: SimActor, base: any) {
  const account = accountOf(actor.id, actor.role);
  const read = new Set(o.reads[account.id] ?? []);
  const at = new Date().toISOString();
  // '모두 읽음'(범주별) — 쪽 밖의 스냅샷 알림까지 읽은 것으로 본다
  const all: { all?: boolean; categories?: string[] } = o.data.ntfReadAll?.[account.id] ?? {};
  const allRead = (category: string) => !!all.all || !!all.categories?.includes(category);
  const readAt = (n: { notificationId: string; category?: string; readAt?: string | null }, fromBase = false) =>
    n.readAt ?? (read.has(n.notificationId) || (fromBase && allRead(n.category ?? '')) ? at : null);
  const simIds = new Set(o.notifications.map((n) => n.notificationId));
  const mine = o.notifications.filter((n) => receives(n, account)).map((n) => ({ ...n, readAt: readAt(n) }));
  const baseItems: any[] = (base?.items ?? []).map((n: any) => ({ ...n, readAt: readAt(n, true) }));
  // 스냅샷에서 안 읽음이던 것 중 이 브라우저에서 읽은 것 — 쪽 밖의 알림도 빼도록 읽을 때 범주를 적어 둔다(handlers/notifications)
  const cats: Record<string, string> = o.data.ntfCategory ?? {};
  const byCategory: Record<string, number> = { ...(base?.byCategory ?? {}) };
  let baseRead = 0;
  for (const c of Object.keys(byCategory)) if (allRead(c)) byCategory[c] = 0;
  for (const id of read) {
    if (simIds.has(id) || !cats[id] || allRead(cats[id]) || (q.category && cats[id] !== q.category)) continue;
    baseRead++;
    if (byCategory[cats[id]] !== undefined) byCategory[cats[id]] = Math.max(0, byCategory[cats[id]] - 1);
  }
  const simUnread = mine.filter((n) => !n.readAt && (!q.category || n.category === q.category));
  for (const n of mine) if (!n.readAt && (!q.category || n.category === q.category)) byCategory[n.category] = (byCategory[n.category] ?? 0) + 1;
  const baseUnread = all.all || (q.category && allRead(q.category)) ? 0 : Math.max(0, (base?.unread ?? 0) - baseRead - Object.entries(base?.byCategory ?? {}).filter(([c]) => !q.category && allRead(c)).reduce((a, [, n]) => a + Number(n), 0));
  const unread = baseUnread + simUnread.length;
  const pass = (n: any) => (q.unread !== 'true' || !n.readAt) && (!q.category || n.category === q.category);
  const limit = Number(q.limit) || 100;
  const items = [...mine, ...baseItems].filter(pass).slice(0, limit);
  return { ...(base ?? {}), items, unread, byCategory };
}

// ─── 쓰기 ─────────────────────────────────────────────────
interface Staged {
  entities: { c: string; id: string; e: any; created: boolean }[];
  audit: SimAudit[];
  failAudit: SimAudit[];
  events: PlatformEvent[];
  notifications: SimNotification[];
  tasks: SimTask[];
  reads: { account: string; id: string }[];
  data: Record<string, any>;
  seq: Record<string, number>;
  /** 구독자 실행 대기(registerSimListener) */
  hooks?: (() => unknown)[];
}

function writeContext(o: SimOverlay, req: SimRequest, actor: SimActor, st: Staged): SimWriteContext {
  const base = readContext(o, req, actor);
  const now = new Date();
  const iso = () => new Date().toISOString();
  const nextSeq = (k: string) => (st.seq[k] = (st.seq[k] ?? o.seq[k] ?? 0) + 1);
  const auditRow = (a: SimAuditInput, result: SimAudit['result'], seqKey = 'audit'): SimAudit => ({
    id: nextSeq(seqKey),
    at: iso(),
    actorId: a.actorId ?? actor.id,
    actorRole: a.actorRole ?? actor.role,
    action: a.action,
    target: a.target,
    result,
    reason: a.reason ?? null,
    before: a.before ?? null,
    after: a.after ?? null,
    correlationId: crypto.randomUUID(),
    componentId: a.componentId ?? null,
  });
  const ctx: SimWriteContext = {
    ...base,
    now: () => now,
    iso,
    get: (c, id) => {
      const s = [...st.entities].reverse().find((x) => x.c === c && x.id === id);
      return s ? s.e : o.entities[c]?.[id];
    },
    list: (c) => {
      const m = new Map(Object.entries(o.entities[c] ?? {}));
      for (const s of st.entities) if (s.c === c) m.set(s.id, s.e);
      return [...m.values()];
    },
    put: (c, id, e, opts) => void st.entities.push({ c, id, e: structuredClone(e), created: !!opts?.created }),
    state: (key, init) => (st.data[key] ??= structuredClone(o.data[key] ?? init())),
    nextId: (prefix, existing, width = 5) => {
      const k = `id:${prefix}`;
      const top = existing.reduce((m, id) => Math.max(m, Number(new RegExp(`^${prefix}-(\\d+)$`).exec(id)?.[1] ?? 0)), 0);
      const n = Math.max(st.seq[k] ?? o.seq[k] ?? 0, top) + 1;
      st.seq[k] = n;
      return `${prefix}-${String(n).padStart(width, '0')}`;
    },
    audit: (a) => void st.audit.push(auditRow(a, a.result ?? 'ALLOWED')),
    emit: (type, aggregate, payload, opts = {}) => {
      const e: PlatformEvent = { seq: nextSeq('event'), id: crypto.randomUUID(), type, at: iso(), aggregate, componentId: opts.componentId ?? null, payload: { ...payload } };
      st.events.push(e);
      const rule = NOTIFICATION_RULES[type];
      if (rule) {
        const n = opts.notify ?? {};
        const kill = n.kill ?? (rule.needs.includes('kill') ? ctx.get('kill', String(payload.killId ?? aggregate)) : null);
        try {
          const draft = rule.build({ event: { seq: e.seq, type, at: e.at, aggregate, payload: e.payload as Record<string, any> }, feature: n.feature ?? null, policy: (n.policy as any) ?? null, kill: (kill as any) ?? null, refChange: (n.refChange as any) ?? null });
          if (draft) st.notifications.push({ ...draft, notificationId: `NTF-${String(nextSeq('NTF')).padStart(5, '0')}`, eventSeq: e.seq, eventType: type, aggregate, createdAt: e.at } as SimNotification);
        } catch {
          /* 맥락이 모자라면 알림 없이 이벤트만(서버도 규칙이 null이면 알림 없음) */
        }
      }
      for (const l of listeners) if (listens(l.types, type)) (st.hooks ??= []).push(() => l.fn(ctx, e));
      return e;
    },
    later: (ms, kind, args) => void st.tasks.push({ id: crypto.randomUUID(), at: Date.now() + ms, kind, args: structuredClone(args) }),
    markRead: (ids) => void st.reads.push(...ids.map((id) => ({ account: accountOf(actor.id, actor.role).id, id }))),
    fail: (code, message, details, failAudit) => {
      if (failAudit) st.failAudit.push(auditRow({ action: failAudit.action, target: failAudit.target, reason: failAudit.reason, componentId: failAudit.componentId ?? null }, failAudit.result ?? 'FAILED', 'audit'));
      throw new SimError(code, message, details);
    },
  };
  staged.set(ctx, { o, st });
  return ctx;
}

/** 쓰기 맥락 → 그 반영(트랜잭션) — simInvoke가 같은 반영 안에서 다른 핸들러를 부를 때 쓴다 */
const staged = new WeakMap<SimWriteContext, { o: SimOverlay; st: Staged }>();

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 반영 — 감사 해시 체인(시연용으로 이어서), 저장, 그 뒤 이벤트를 버스로 */
async function commit(o: SimOverlay, st: Staged, audits: SimAudit[]) {
  for (const s of st.entities) {
    (o.entities[s.c] ??= {})[s.id] = s.e;
    if (s.created) o.created[s.c] = [s.id, ...(o.created[s.c] ?? []).filter((x) => x !== s.id)];
  }
  Object.assign(o.data, st.data);
  Object.assign(o.seq, st.seq);
  for (const a of audits) {
    a.prevHash = o.chain.head ?? '';
    a.hash = await sha256(`${a.prevHash}\n${canonicalJson({ at: a.at, actorId: a.actorId, actorRole: a.actorRole, action: a.action, target: a.target, result: a.result, reason: a.reason, before: a.before, after: a.after, correlationId: a.correlationId, componentId: a.componentId })}`);
    o.chain = { head: a.hash, count: o.chain.count + 1 };
  }
  o.audit = [...[...audits].reverse(), ...o.audit];
  o.events = [...o.events, ...st.events];
  o.notifications = [...[...st.notifications].reverse(), ...o.notifications];
  o.tasks = [...o.tasks, ...st.tasks];
  for (const r of st.reads) o.reads[r.account] = [...new Set([...(o.reads[r.account] ?? []), r.id])];
  await saveOverlay(o);
  for (const t of st.tasks) schedule(t);
  if (st.events.length) publishLocalEvents(st.events);
  localDataChanged();
}

const emptyStaged = (): Staged => ({ entities: [], audit: [], failAudit: [], events: [], notifications: [], tasks: [], reads: [], data: {}, seq: {} });

async function run(o: SimOverlay, req: SimRequest, actor: SimActor, fn: (ctx: SimWriteContext) => unknown): Promise<unknown> {
  await seed(o);
  const st = emptyStaged();
  const ctx = writeContext(o, req, actor, st);
  try {
    const out = await fn(ctx);
    // 구독자 — 구독자가 낸 이벤트의 구독자까지 같은 반영에
    while (st.hooks?.length) await st.hooks.shift()!();
    await commit(o, st, [...st.failAudit, ...st.audit]);
    return out === undefined ? null : structuredClone(out);
  } catch (e) {
    // 거부도 기록한다(서버 audit.failed는 트랜잭션 밖) — 바뀐 것은 버리고 실패 감사만 남긴다
    if (st.failAudit.length) await commit(o, { ...emptyStaged(), seq: { audit: st.seq.audit ?? o.seq.audit } }, st.failAudit);
    throw e;
  }
}

/** 등록 안 된 쓰기 — 화면이 깨지지 않게 '처리됨'으로 받고 감사·개발 목록에 남긴다(핸들러가 자기 대상이 아닐 때도 이것으로) */
export function simUnhandled(ctx: SimWriteContext) {
  const { req } = ctx;
  const target = Object.values(req.params)[0] ?? req.route.path;
  ctx.audit({ action: req.name, target, after: req.body ?? null, componentId: req.route.component });
  if (typeof window !== 'undefined') (window.__simUnhandled ??= []).push({ name: req.name, at: ctx.iso(), params: req.params, body: req.body });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  return { ...body, ...req.params, ok: true, status: 'ACCEPTED', processedAt: ctx.iso() };
}

async function write(o: SimOverlay, req: SimRequest, actor: SimActor): Promise<unknown> {
  const { route } = req;
  return serial(async () => {
    await seed(o);
    // 역할 — 서버 RolesGuard(거부는 감사 DENIED)
    if (route.roles && !route.public && !route.roles.includes(actor.role)) {
      await run(o, req, actor, (ctx) => {
        ctx.audit({ action: req.name, target: req.url, reason: `역할 ${ROLE_LABEL[actor.role] ?? actor.role}은(는) 허용되지 않음 (허용: ${route.roles!.map((x) => ROLE_LABEL[x]).join(', ')})`, result: 'DENIED', componentId: route.component });
      });
      throw new SimError('FORBIDDEN', `${ROLE_LABEL[actor.role] ?? actor.role} 역할로는 이 작업을 할 수 없습니다.`, { allowed: route.roles });
    }
    // 본문 — 서버 ZodPipe
    const schema = route.body ?? bodies.get(req.name);
    if (schema) {
      const r = schema.safeParse(req.body ?? {});
      if (!r.success) throw new SimError('VALIDATION', '입력값을 확인하세요.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      req = { ...req, body: r.data };
    }
    const h = handlers.get(req.name);
    return run(o, req, actor, h ?? simUnhandled);
  });
}

// ─── 예약 작업 ─────────────────────────────────────────────
function schedule(t: SimTask) {
  if (timers.has(t.id)) return;
  timers.set(
    t.id,
    setTimeout(() => {
      timers.delete(t.id);
      void serial(async () => {
        const o = overlay;
        if (!o || !o.tasks.some((x) => x.id === t.id)) return;
        o.tasks = o.tasks.filter((x) => x.id !== t.id);
        const fn = tasks.get(t.kind);
        const req = requestOf('events', {}, {}, null);
        try {
          await run(o, req, SYSTEM, (ctx) => fn?.(ctx, t.args));
        } catch {
          await saveOverlay(o);
        }
      });
    }, Math.max(0, t.at - Date.now())),
  );
}

// ─── 입구 ─────────────────────────────────────────────────
/** API 클라이언트(정적 모드)가 부른다 — 쓰기는 핸들러, 읽기는 스냅샷 + 오버레이 */
export async function simCall<T>(route: RouteDef, url: string, opts: CallOptions): Promise<T> {
  const o = await ensure();
  const req: SimRequest = { name: route.name, route, url, params: opts.params ?? {}, query: queryOf(url), body: opts.body };
  const actor = simActor(route, opts);
  try {
    return (route.method === 'GET' ? await readRoute(o, req, actor) : await write(o, req, actor)) as T;
  } catch (e) {
    if (e instanceof SimError) throw asApiError(e);
    throw e;
  }
}

/** '시연 데이터 초기화' — 이 브라우저의 바뀐 것을 모두 버리고 처음(스냅샷) 상태로 */
export async function resetSim(): Promise<void> {
  await serial(async () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    const version = overlay?.version ?? (await versionKey());
    await clearOverlay();
    overlay = emptyOverlay(version);
    ready = Promise.resolve(overlay);
  });
  refreshLocalSubscribers();
}

/** 시험용 — 모듈 상태를 비운다(저장소는 그대로) */
export function __resetSimForTest() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  overlay = null;
  ready = null;
  snapCache.clear();
  queue = Promise.resolve();
}
export const __overlayForTest = () => overlay;

/**
 * 같은 반영(트랜잭션) 안에서 다른 경로의 쓰기 핸들러를 다른 행위자로 부른다 — 서버 서비스가 다른 서비스를 부르는 것과 같다
 * (예: 외부 연계 수신이 매핑된 사람으로 Lifecycle 전이·정책 승인). 역할 확인(RolesGuard)은 하지 않고 본문은 경로 규칙으로 검사한다.
 * 실패하면 그 호출이 쌓은 것만 되돌리고(서버 내부 트랜잭션 롤백) 실패 감사는 남긴 채 오류를 다시 던진다. 등록 안 된 경로는 NOT_IMPLEMENTED
 */
export async function simInvoke<T = unknown>(ctx: SimWriteContext, name: string, opts: { params?: Record<string, string>; body?: unknown; actor: SimActor }): Promise<T> {
  const s = staged.get(ctx);
  const h = handlers.get(name);
  if (!s || !h) throw new SimError('NOT_IMPLEMENTED', `${name}은(는) 시연 엔진에서 처리하지 않습니다.`);
  let req = requestOf(name, opts.params ?? {}, {}, opts.body);
  const schema = req.route.body ?? bodies.get(name);
  if (schema) {
    const r = schema.safeParse(req.body ?? {});
    if (!r.success) throw new SimError('VALIDATION', '입력값을 확인하세요.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    req = { ...req, body: r.data };
  }
  const { o, st } = s;
  const mark = { entities: st.entities.length, audit: st.audit.length, events: st.events.length, notifications: st.notifications.length, tasks: st.tasks.length, reads: st.reads.length, hooks: st.hooks?.length ?? 0, data: structuredClone(st.data) };
  try {
    const out = await h(writeContext(o, req, opts.actor, st));
    return (out === undefined ? null : out) as T;
  } catch (e) {
    st.entities.length = mark.entities;
    st.audit.length = mark.audit;
    st.events.length = mark.events;
    st.notifications.length = mark.notifications;
    st.tasks.length = mark.tasks;
    st.reads.length = mark.reads;
    if (st.hooks) st.hooks.length = mark.hooks;
    for (const k of Object.keys(st.data)) delete st.data[k];
    Object.assign(st.data, mark.data);
    throw e;
  }
}
