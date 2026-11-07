// 실제 연결 어댑터(IF_MODE_01/13/14=live) — 각 도구의 공개 REST API. 모의 어댑터와 같은 인터페이스(읽기·만들기·기대 개정 쓰기).
//   JIRA REST v3(Cloud, 기본)·v2(Data Center, JIRA_API=2): /rest/api/{3|2}/issue, 전이 /transitions, 댓글 /comment, 검색 /search/jql(v2 /search),
//     변경 이력 /changelog(v2 expand=changelog). v3 본문·댓글은 ADF. Epic 사용자 필드는 JIRA_FIELDS(80-50 §4.2·§4.6). 개정 = fields.updated(ms)
//   GitLab REST v4: MR GET /projects/:id/merge_requests/:iid, 댓글 /notes, commit status POST /projects/:id/statuses/:sha. 개정 = updated_at(ms)
//   codeBeamer REST v3: GET /api/v3/items/:id, 댓글 POST /api/v3/items/:id/comments. 개정 = item.version
// 인증·주소는 환경 변수(아래 cfg). 토큰은 로그·감사·Evidence에 남기지 않는다. 시간 제한 10초, 실패는 보낼 함이 재시도한다.
import { FEATURE_TRANSITIONS, JIRA_EPIC_STATUS, lifecycleOfEpicStatus, relationKindOf, WP_KINDS, WP_RELATIONS, wpKindOfTracker, type ExtKind, type ExtSystem, type Lifecycle, type WpKind, type WpRelationKind } from '@ff/contracts';
import { cbApproved, type AdapterMode, type ExtAdapter, type RecentIssue, type RemoteItem, type WpFetch, type WritePatch, type WriteResult } from './adapters';
import { adfText, decodeChildFields, decodeEpicFields, encodeEpicFields, epicFieldIdList } from './epic-fields';

interface Cfg {
  url: string;
  auth: string;
  project: string;
}

const env = (k: string) => (process.env[k] ?? '').trim();
const basic = (user: string, token: string) => `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
/** JIRA REST 판 — Cloud v3가 기본, Data Center는 JIRA_API=2 (80-50 §4.6). 차이는 이 어댑터 안에만 */
export const jiraApiVersion = (): 2 | 3 => (env('JIRA_API') === '2' ? 2 : 3);
const jira = (path: string) => `/rest/api/${jiraApiVersion()}${path}`;
/** 글자 → ADF(v3 본문·댓글). 빈 줄로 문단을 나눈다 */
const adf = (text: string) => ({ type: 'doc', version: 1, content: text.split('\n\n').map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })) });
const jiraText = (text: string) => (jiraApiVersion() === 3 ? adf(text) : text);
/** 이슈 유형 이름 ↔ 연계 종류 */
const JIRA_TYPE: Partial<Record<ExtKind, string>> = { EPIC: 'Epic', DEFECT: 'Bug', CHANGE_REQUEST: 'Change Request', STORY: 'Story', TASK: 'Task' };
const kindOfType = (type: string | undefined): ExtKind => (Object.entries(JIRA_TYPE).find(([, t]) => t === type)?.[0] as ExtKind | undefined) ?? 'CHANGE_REQUEST';

/**
 * Epic 상태 경로 — JIRA Epic 워크플로는 FF 수명주기와 같은 전이만 갖는다(80-50 §4.3). Epic이 몇 단계 뒤에 있으면
 * (예: 새 Epic은 Proposed, Feature는 DEVELOPING) FF 전이 순서대로 한 단계씩 간다. 둘 중 하나라도 Epic 상태가 아니면 null.
 */
export function epicStatusPath(from: string, to: string): string[] | null {
  const a = lifecycleOfEpicStatus(from);
  const b = lifecycleOfEpicStatus(to);
  if (!a || !b) return null;
  const prev = new Map<Lifecycle, Lifecycle | null>([[a, null]]);
  const queue: Lifecycle[] = [a];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === b) break;
    for (const t of FEATURE_TRANSITIONS) if (t.from === cur && !prev.has(t.to)) (prev.set(t.to, cur), queue.push(t.to));
  }
  if (!prev.has(b)) return null;
  const path: Lifecycle[] = [];
  for (let at: Lifecycle | null = b; at && at !== a; at = prev.get(at) ?? null) path.unshift(at);
  return path.map((l) => JIRA_EPIC_STATUS[l]);
}

/**
 * 외부 시스템에서 플랫폼 서비스 계정이 보이는 이름들 — 플랫폼이 쓴 변경이 webhook으로 되돌아오면(메아리) 이 이름으로 온다.
 * 설정한 이름(JIRA_USER·JIRA_SERVICE_ACCOUNT·CODEBEAMER_USER·GITLAB_SERVICE_ACCOUNT) + 처음 호출 때 묻는 자기 계정
 * (JIRA /myself의 accountId·name, GitLab /user의 username). JIRA Cloud webhook은 이메일이 아니라 accountId를 준다 —
 * 이걸 몰라 플랫폼 자신의 전이를 '매핑 없는 계정'으로 거부하던 결함(2026-11-05 모의 JIRA 계약 시험).
 */
const learned: Record<ExtSystem, Set<string>> = { JIRA: new Set(), GITLAB: new Set(), CODEBEAMER: new Set() };
export function isServiceAccount(system: ExtSystem, user: string): boolean {
  if (!user) return false;
  const configured = system === 'JIRA' ? [env('JIRA_USER'), env('JIRA_SERVICE_ACCOUNT')] : system === 'GITLAB' ? [env('GITLAB_SERVICE_ACCOUNT')] : [env('CODEBEAMER_USER')];
  return learned[system].has(user) || configured.some((x) => x && x === user);
}

export function liveConfig(system: ExtSystem): Cfg | { missing: string[] } {
  const need = (keys: string[]) => keys.filter((k) => !env(k));
  if (system === 'JIRA') {
    const missing = need(['JIRA_URL', 'JIRA_TOKEN']);
    if (missing.length) return { missing };
    // Cloud: 사용자 이메일 + API 토큰(Basic) · Data Center: 개인 접근 토큰(Bearer)
    return { url: env('JIRA_URL').replace(/\/$/, ''), auth: env('JIRA_USER') ? basic(env('JIRA_USER'), env('JIRA_TOKEN')) : `Bearer ${env('JIRA_TOKEN')}`, project: env('JIRA_CR_PROJECT') || 'FFCR' };
  }
  if (system === 'GITLAB') {
    const missing = need(['GITLAB_URL', 'GITLAB_TOKEN', 'GITLAB_PROJECT']);
    if (missing.length) return { missing };
    return { url: env('GITLAB_URL').replace(/\/$/, ''), auth: env('GITLAB_TOKEN'), project: env('GITLAB_PROJECT') };
  }
  const missing = need(['CODEBEAMER_URL', 'CODEBEAMER_USER', 'CODEBEAMER_TOKEN']);
  if (missing.length) return { missing };
  return { url: env('CODEBEAMER_URL').replace(/\/$/, ''), auth: basic(env('CODEBEAMER_USER'), env('CODEBEAMER_TOKEN')), project: env('CODEBEAMER_REQ_TRACKER') || '' };
}

export class LiveAdapter implements ExtAdapter {
  constructor(
    readonly system: ExtSystem,
    private readonly mode_: () => AdapterMode,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  mode() {
    return this.mode_();
  }

  private cfg(): Cfg {
    const c = liveConfig(this.system);
    if ('missing' in c) throw new Error(`${this.system} 실제 연결 설정이 없습니다 — ${c.missing.join('·')}를 설정하세요(모의로 돌리려면 IF_MODE를 mock으로).`);
    return c;
  }
  private whoAmI: Promise<void> | null = null;
  /** 서비스 계정의 외부 이름을 한 번 묻는다(실패하면 다음 호출 때 다시) — isServiceAccount */
  private learn(): Promise<void> {
    const me = this.system === 'JIRA' ? jira('/myself') : this.system === 'GITLAB' ? '/api/v4/user' : null;
    if (!me) return Promise.resolve();
    this.whoAmI ??= this.req<Record<string, unknown>>('GET', me, undefined, false)
      .then((r) => {
        if (r.status !== 200 || !r.data) throw new Error('who am i');
        for (const k of ['accountId', 'name', 'key', 'emailAddress', 'username']) if (typeof r.data[k] === 'string' && r.data[k]) learned[this.system].add(r.data[k] as string);
      })
      .catch(() => void (this.whoAmI = null));
    return this.whoAmI;
  }
  private async req<T>(method: string, path: string, body?: unknown, learn = true): Promise<{ status: number; data: T }> {
    const c = this.cfg();
    if (learn) await this.learn();
    // 본문: FormData면 multipart 그대로(codeBeamer 댓글), 아니면 JSON
    const form = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = { accept: 'application/json', ...(body !== undefined && !form ? { 'content-type': 'application/json' } : {}) };
    if (this.system === 'GITLAB') headers['private-token'] = c.auth;
    else headers.authorization = c.auth;
    let res = await this.fetchFn(`${c.url}${path}`, { method, headers, body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    // 호출 제한(codeBeamer 초당 3·분당 120, JIRA도 429) — Retry-After(초)만큼 쉬고 세 번까지 다시(80-51 §2)
    for (let n = 0; res.status === 429 && n < 3; n++) {
      const wait = Math.min(Number(res.headers.get('retry-after') ?? 1) || 1, 5) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      res = await this.fetchFn(`${c.url}${path}`, { method, headers, body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    }
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    if (res.status >= 400 && res.status !== 404) throw new Error(`${this.system} ${method} ${path.split('?')[0]} → ${res.status}`);
    return { status: res.status, data };
  }
  private gl(path: string) {
    return `/api/v4/projects/${encodeURIComponent(this.cfg().project)}${path}`;
  }

  // ── 읽기 ──
  async read(key: string): Promise<RemoteItem | null> {
    const c = this.cfg();
    if (this.system === 'JIRA') {
      const r = await this.req<any>('GET', jira(`/issue/${encodeURIComponent(key)}?fields=${[...JIRA_READ_FIELDS, ...epicFieldIdList()].join(',')}`));
      if (r.status === 404) return null;
      return jiraItem(c.url, r.data);
    }
    if (this.system === 'GITLAB') {
      const iid = key.split('!').pop();
      const r = await this.req<any>('GET', this.gl(`/merge_requests/${iid}`));
      if (r.status === 404) return null;
      const m = r.data;
      return { system: 'GITLAB', kind: 'MERGE_REQUEST', key, url: m.web_url, title: m.title, status: m.state, revision: Date.parse(m.updated_at), fields: { sha: m.merge_commit_sha ?? m.sha, sourceBranch: m.source_branch, targetBranch: m.target_branch } };
    }
    const id = key.replace(/^CB-/, '');
    const r = await this.req<any>('GET', `/api/v3/items/${id}`);
    if (r.status === 404) return null;
    const it = r.data;
    return { system: 'CODEBEAMER', kind: 'REQUIREMENT', key, url: `${c.url}/cb/issue/${id}`, title: it.name, status: it.status?.name ?? '', revision: Number(it.version), fields: {} };
  }

  /** codeBeamer cbQL — 요구 tracker에서 "Requirement ID" 필드가 같은 항목(필드 이름은 CODEBEAMER_REQ_ID_FIELD) */
  async findRequirement(reqId: string): Promise<RemoteItem | null> {
    if (this.system !== 'CODEBEAMER') return null;
    const field = env('CODEBEAMER_REQ_ID_FIELD') || 'Requirement ID';
    const tracker = this.cfg().project;
    const q = `${tracker ? `tracker.id = ${Number(tracker)} AND ` : ''}'${field.replace(/'/g, '')}' = '${reqId.replace(/'/g, '')}'`;
    const r = await this.req<{ items?: { id: number }[] }>('POST', '/api/v3/items/query', { queryString: q, page: 1, pageSize: 2 });
    const id = r.data?.items?.[0]?.id;
    return id ? this.read(`CB-${id}`) : null;
  }

  // ── 만들기(JIRA Epic·결함만 — 요구·MR은 각 도구에서 사람이 만든다) ──
  async create(kind: ExtKind, f: { title: string; body: string; status: string; fields?: Record<string, unknown> }): Promise<RemoteItem> {
    if (this.system !== 'JIRA') throw new Error(`${this.system}에는 플랫폼이 항목을 만들지 않습니다.`);
    const project = kind === 'EPIC' || kind === 'STORY' || kind === 'TASK' ? env('JIRA_EPIC_PROJECT') || 'FFE' : kind === 'DEFECT' ? env('JIRA_DEFECT_PROJECT') || 'FFD' : this.cfg().project;
    const issuetype = JIRA_TYPE[kind] ?? 'Change Request';
    const parentKey = f.fields?.parentKey ? String(f.fields.parentKey) : null;
    // Epic 하위: Cloud는 parent, Data Center는 Epic Link 사용자 필드(JIRA_FIELD_EPIC_LINK)
    const parent = parentKey ? (jiraApiVersion() === 2 && env('JIRA_FIELD_EPIC_LINK') ? { [env('JIRA_FIELD_EPIC_LINK')]: parentKey } : { parent: { key: parentKey } }) : {};
    const custom = { ...encodeEpicFields({ ...((f.fields?.epic ?? {}) as Record<string, unknown>), ...((f.fields?.child ?? {}) as Record<string, unknown>) }), ...((f.fields?.custom ?? {}) as Record<string, unknown>) };
    const r = await this.req<{ key: string }>('POST', jira('/issue'), { fields: { project: { key: project }, summary: f.title, description: jiraText(f.body), issuetype: { name: issuetype }, ...parent, ...custom } });
    // 새 이슈는 워크플로 첫 상태로 생긴다 — 이미 그 상태면 전이하지 않는다(자기 자신으로 가는 전이는 보통 없다)
    const made = (await this.read(r.data.key))!;
    if (!f.status || made.status.toLowerCase() === f.status.toLowerCase()) return made;
    // 만든 뒤 전이가 실패해도 만든 이슈를 돌려준다 — 던지면 플랫폼이 연결하지 못해 다음 재시도에서 같은 Epic을 또 만든다.
    // 상태 차이는 플랫폼이 연결한 뒤 거울 쓰기로 다시 맞춘다(2026-11-05 모의 서버 기동 점검에서 찾음)
    try {
      await this.transition(r.data.key, f.status);
    } catch {
      return made;
    }
    return (await this.read(r.data.key))!;
  }

  private async transition(key: string, status: string) {
    const base = jira(`/issue/${encodeURIComponent(key)}/transitions`);
    const step = async (to: string) => {
      const t = await this.req<{ transitions: { id: string; to: { name: string } }[] }>('GET', base);
      const hit = (t.data.transitions ?? []).find((x) => x.to?.name?.toLowerCase() === to.toLowerCase());
      if (hit) await this.req('POST', base, { transition: { id: hit.id } });
      return !!hit;
    };
    if (await step(status)) return;
    // 바로 가는 전이가 없으면 Epic 수명주기 경로를 따라간다(Story·Task·Bug는 In Progress를 거친다)
    const now = await this.read(key);
    const path = now ? (epicStatusPath(now.status, status) ?? (now.kind === 'EPIC' || now.kind === 'CHANGE_REQUEST' ? null : ['In Progress', status])) : null;
    const fail = (to: string) => new Error(`JIRA ${key}: '${to}'(으)로 가는 워크플로 전이가 없습니다 — JIRA 워크플로와 상태 매핑(JIRA_EPIC_STATUS·JIRA_CR_STATUS)을 맞추세요.`);
    if (!path || path.length < 2) throw fail(status);
    for (const to of path) if (!(await step(to))) throw fail(to);
  }

  // ── 쓰기(기대 개정이 다르면 충돌) ──
  async write(key: string, patch: WritePatch, expectedRevision: number | null): Promise<WriteResult> {
    if (expectedRevision !== null) {
      const now = await this.read(key);
      if (!now) throw new Error(`${this.system} ${key}이(가) 없습니다.`);
      if (now.revision !== expectedRevision) return { ok: false, conflict: now };
    }
    if (this.system === 'JIRA') {
      // 필드 먼저(제목·Epic 필드) — 전이 화면에 필수 필드가 있어도 값이 채워져 있게
      const fields = { ...(patch.title !== undefined ? { summary: patch.title } : {}), ...encodeEpicFields(patch.fields ?? {}), ...(patch.custom ?? {}) };
      const update = patch.labelsAdd?.length ? { update: { labels: patch.labelsAdd.map((add) => ({ add })) } } : {};
      if (Object.keys(fields).length || patch.labelsAdd?.length) await this.req('PUT', jira(`/issue/${encodeURIComponent(key)}`), { ...(Object.keys(fields).length ? { fields } : {}), ...update });
      if (patch.duplicateOf) await this.req('POST', jira('/issueLink'), { type: { name: 'Duplicate' }, inwardIssue: { key: patch.duplicateOf }, outwardIssue: { key } });
      if (patch.status) await this.transition(key, patch.status);
      if (patch.comment) await this.req('POST', jira(`/issue/${encodeURIComponent(key)}/comment`), { body: jiraText(patch.comment) });
    } else if (this.system === 'GITLAB') {
      const iid = key.split('!').pop();
      if (patch.append?.field === 'commitStatuses') {
        const v = patch.append.value as { name: string; state: string; description: string; sha?: string | null };
        const sha = v.sha ?? (await this.read(key))?.fields.sha;
        if (sha) await this.req('POST', this.gl(`/statuses/${sha}`), { state: v.state, name: v.name, description: v.description.slice(0, 255) });
      }
      if (patch.comment) await this.req('POST', this.gl(`/merge_requests/${iid}/notes`), { body: patch.comment });
    } else {
      const id = key.replace(/^CB-/, '');
      const text = patch.append?.field === 'verifications' ? verificationText(patch.append.value) : patch.comment;
      // codeBeamer 댓글은 multipart/form-data만 받는다(80-51 §2 — JSON이면 415)
      if (text) {
        const form = new FormData();
        form.set('comment', text);
        form.set('commentFormat', 'PlainText');
        await this.req('POST', `/api/v3/items/${id}/comments`, form);
      }
    }
    return { ok: true, item: (await this.read(key))! };
  }

  // ── codeBeamer 산출물(80-50 §5.8) ──
  private trackers: Promise<Map<WpKind, { id: number; props: Map<string, number> }>> | null = null;
  /** 트래커 8종과 사용자 칸 번호 — CODEBEAMER_TRACKERS(JSON 키 → 트래커 ID) 또는 프로젝트(CODEBEAMER_PROJECT)의 트래커 이름. 한 번 읽어 둔다 */
  private cbTrackers() {
    this.trackers ??= (async () => {
      const out = new Map<WpKind, { id: number; props: Map<string, number> }>();
      const ids = new Map<WpKind, number>();
      const raw = env('CODEBEAMER_TRACKERS');
      if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, number>)) if ((WP_KINDS as readonly string[]).includes(k)) ids.set(k as WpKind, Number(v));
      if (!ids.size) {
        const project = env('CODEBEAMER_PROJECT');
        if (!project) throw new Error('codeBeamer 산출물 트래커를 모릅니다 — CODEBEAMER_TRACKERS 또는 CODEBEAMER_PROJECT를 설정하세요.');
        const r = await this.req<{ id: number; name: string }[]>('GET', `/api/v3/projects/${encodeURIComponent(project)}/trackers`);
        for (const t of r.data ?? []) {
          const k = wpKindOfTracker(t.name);
          if (k) ids.set(k, t.id);
        }
      }
      for (const [k, id] of ids) {
        const r = await this.req<{ id: number; name: string; propertyName?: string }[]>('GET', `/api/v3/trackers/${id}/schema`);
        const props = new Map<string, number>();
        for (const f of r.data ?? []) {
          const n = /^customField\[(\d+)\]$/.exec(f.propertyName ?? '')?.[1];
          if (n) props.set(f.name, Number(n));
        }
        out.set(k, { id, props });
      }
      return out;
    })().catch((e) => {
      this.trackers = null;
      throw e;
    });
    return this.trackers;
  }

  async workProducts(q: { featureId: string; requirementIds: string[] }): Promise<WpFetch> {
    if (this.system !== 'CODEBEAMER') return { items: [], relations: [] };
    const c = this.cfg();
    const trackers = await this.cbTrackers();
    const kindOfTracker = new Map([...trackers].map(([k, t]) => [t.id, k]));
    const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
    type CbItem = { id: number; name: string; version: number; tracker: { id: number }; status?: { name?: string }; customFields?: { name: string; value: unknown }[] };
    const found = new Map<number, CbItem>();
    const query = async (q2: string) => {
      for (let page = 1; page < 50; page++) {
        const r = await this.req<{ items?: CbItem[]; total?: number }>('POST', '/api/v3/items/query', { queryString: q2, page, pageSize: 500 });
        for (const it of r.data?.items ?? []) found.set(it.id, it);
        if ((r.data?.items ?? []).length < 500) break;
      }
    };
    for (const [k, t] of trackers) {
      const ff = t.props.get('FF Feature ID');
      if (ff !== undefined) await query(`tracker.id = ${t.id} AND '${t.id}.customField[${ff}]' = ${quote(q.featureId)}`);
      const req = t.props.get('Requirement ID');
      if (k === 'SYS_REQ' && req !== undefined && q.requirementIds.length) await query(`tracker.id = ${t.id} AND '${t.id}.customField[${req}]' IN (${q.requirementIds.map(quote).join(', ')})`);
    }
    // 관계를 따라 FF Feature ID 칸이 없는 아래 항목도(세 단계까지)
    const relations: WpFetch['relations'] = [];
    const seenRel = new Set<string>();
    let frontier = [...found.keys()];
    for (let depth = 0; depth < 4 && frontier.length; depth++) {
      const r = await this.req<{ itemId: number; upstreamReferences?: R[]; downstreamReferences?: R[]; outgoingAssociations?: R[]; incomingAssociations?: R[] }[]>('POST', '/api/v3/items/relations', frontier);
      type R = { id: number; associationType?: { name?: string }; itemRevision: { id: number } };
      const next: number[] = [];
      for (const rel of r.data ?? []) {
        const pairs: [number, number, string | undefined][] = [
          ...(rel.upstreamReferences ?? []).map((x): [number, number, string | undefined] => [rel.itemId, x.itemRevision.id, undefined]),
          ...(rel.downstreamReferences ?? []).map((x): [number, number, string | undefined] => [x.itemRevision.id, rel.itemId, undefined]),
          ...(rel.outgoingAssociations ?? []).map((x): [number, number, string | undefined] => [rel.itemId, x.itemRevision.id, x.associationType?.name]),
          ...(rel.incomingAssociations ?? []).map((x): [number, number, string | undefined] => [x.itemRevision.id, rel.itemId, x.associationType?.name]),
        ];
        for (const [a, b, name] of pairs) {
          for (const id of [a, b]) if (!found.has(id)) {
            const it = await this.req<CbItem>('GET', `/api/v3/items/${id}`);
            if (it.status === 200 && kindOfTracker.has(it.data.tracker?.id)) (found.set(id, it.data), next.push(id));
          }
          const ka = kindOfTracker.get(found.get(a)?.tracker.id ?? -1);
          const kb = kindOfTracker.get(found.get(b)?.tracker.id ?? -1);
          if (!ka || !kb) continue;
          // 방향·이름 — 관계 이름이 FF 의미(CODEBEAMER_RELATIONS 기본)면 그대로, 아니면 종류 쌍으로. 거꾸로 걸린 관계는 뒤집는다
          const forward = relationKindOf(ka, kb);
          const back = relationKindOf(kb, ka);
          const [from, to, kind] = forward ? [a, b, forward] : back ? [b, a, back] : [a, b, null];
          const named = (WP_RELATIONS as readonly string[]).includes(name ?? '') ? (name as WpRelationKind) : null;
          const k2 = named ?? kind;
          if (!k2) continue;
          const id2 = `${from}>${to}>${k2}`;
          if (!seenRel.has(id2)) (seenRel.add(id2), relations.push({ from: `CB-${from}`, to: `CB-${to}`, kind: k2 }));
        }
      }
      frontier = next;
    }
    const cf = (it: CbItem, name: string) => (it.customFields ?? []).find((x) => x.name === name)?.value;
    return {
      items: [...found.values()].map((it) => {
        const status = it.status?.name ?? '';
        return { key: `CB-${it.id}`, kind: kindOfTracker.get(it.tracker.id)!, title: it.name, status, approved: cbApproved(status), version: Number(it.version), ffVersion: (cf(it, 'FF Version') as string | undefined) || null, allocationRationale: (cf(it, 'Allocation Rationale') as string | undefined) || null, obsolete: status === 'Obsolete', url: `${c.url}/cb/issue/${it.id}`.replace('/cb/cb/', '/cb/') };
      }),
      relations,
    };
  }

  /**
   * 증분 대사(80-50 §4.5) — 연계 프로젝트에서 최근 minutes분 안에 바뀐 이슈와 변경 이력. JQL 상대 시각(-Nm)이라 서버 시간대와 무관하다.
   * v3 /search/jql(nextPageToken) · v2 /search(startAt), 한 번에 100건. 이력은 v3 /changelog 마지막 쪽, v2 expand=changelog.
   */
  async recent(minutes: number): Promise<RecentIssue[]> {
    if (this.system !== 'JIRA') return [];
    const projects = [...new Set([env('JIRA_EPIC_PROJECT') || 'FFE', this.cfg().project, env('JIRA_DEFECT_PROJECT') || 'FFD'])];
    const jql = `project in (${projects.join(', ')}) AND updated >= "-${Math.max(1, Math.ceil(minutes))}m" ORDER BY updated ASC`;
    const fields = [...JIRA_READ_FIELDS, ...epicFieldIdList()];
    const issues: { key: string; fields: Record<string, any> }[] = [];
    if (jiraApiVersion() === 3) {
      let token: string | undefined;
      do {
        const r = await this.req<{ issues?: typeof issues; nextPageToken?: string }>('POST', jira('/search/jql'), { jql, maxResults: 100, fields, ...(token ? { nextPageToken: token } : {}) });
        issues.push(...(r.data?.issues ?? []));
        token = r.data?.nextPageToken;
      } while (token && issues.length < 5000);
    } else {
      for (let startAt = 0; startAt < 5000; startAt += 100) {
        const r = await this.req<{ issues?: typeof issues; total?: number }>('POST', jira('/search'), { jql, maxResults: 100, startAt, fields });
        issues.push(...(r.data?.issues ?? []));
        if ((r.data?.issues ?? []).length < 100) break;
      }
    }
    const out: RecentIssue[] = [];
    for (const issue of issues) {
      const histories = await this.histories(issue.key);
      out.push({ key: issue.key, revision: Date.parse(issue.fields?.updated), issue, histories, reporter: issue.fields?.reporter?.accountId ?? issue.fields?.reporter?.name ?? '' });
    }
    return out;
  }
  private async histories(key: string): Promise<RecentIssue['histories']> {
    type H = { author?: { accountId?: string; name?: string }; created: string; items?: RecentIssue['histories'][number]['items'] };
    const map = (h: H) => ({ author: h.author?.accountId ?? h.author?.name ?? '', created: Date.parse(h.created), items: (h.items ?? []).map((x) => ({ field: x.field, fromString: x.fromString ?? null, toString: x.toString ?? null })) });
    if (jiraApiVersion() === 2) {
      const r = await this.req<{ changelog?: { histories?: H[] } }>('GET', jira(`/issue/${encodeURIComponent(key)}?fields=updated&expand=changelog`));
      return (r.data?.changelog?.histories ?? []).map(map);
    }
    // 마지막 쪽(최근 100건)만 — 대사 창(20분) 안의 변경이면 충분하다
    const first = await this.req<{ total?: number; values?: H[] }>('GET', jira(`/issue/${encodeURIComponent(key)}/changelog?startAt=0&maxResults=100`));
    const total = first.data?.total ?? 0;
    if (total <= 100) return (first.data?.values ?? []).map(map);
    const last = await this.req<{ values?: H[] }>('GET', jira(`/issue/${encodeURIComponent(key)}/changelog?startAt=${total - 100}&maxResults=100`));
    return (last.data?.values ?? []).map(map);
  }
}

/** 이슈 조회에 함께 받는 기본 필드 */
const JIRA_READ_FIELDS = ['summary', 'status', 'issuetype', 'updated', 'parent', 'description', 'labels', 'reporter'];

/** JIRA 이슈 JSON → 연계 항목(Epic은 사용자 필드를 FF 키로) */
function jiraItem(base: string, issue: { key: string; fields: Record<string, any> }): RemoteItem {
  const f = issue.fields ?? {};
  const kind = kindOfType(f.issuetype?.name);
  return {
    system: 'JIRA',
    kind,
    key: issue.key,
    url: `${base}/browse/${issue.key}`,
    title: f.summary ?? '',
    status: f.status?.name ?? '',
    revision: Date.parse(f.updated),
    fields: { parentKey: f.parent?.key ?? null, description: adfText(f.description), ...(kind === 'EPIC' ? { epic: decodeEpicFields(f) } : { child: decodeChildFields(f) }) },
  };
}

/** codeBeamer 검증 결과 댓글 — 사람이 읽고, 기계가 다시 읽을 수 있게 한 줄 머리 */
const verificationText = (v: Record<string, unknown>) => `[Feature Platform] ${v.gate} ${v.status} — ${v.featureId}@${v.version}${v.evidenceRef ? ` · Evidence ${v.evidenceRef}` : ''}`;
