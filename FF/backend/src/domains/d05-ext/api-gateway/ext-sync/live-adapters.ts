// 실제 연결 어댑터(IF_MODE_01/13/14=live) — 각 도구의 공개 REST API. 모의 어댑터와 같은 인터페이스(읽기·만들기·기대 개정 쓰기).
//   JIRA REST v2(Cloud·Data Center): GET/POST /rest/api/2/issue, 전이 /transitions, 댓글 /comment. 개정 = fields.updated(ms)
//   GitLab REST v4: MR GET /projects/:id/merge_requests/:iid, 댓글 /notes, commit status POST /projects/:id/statuses/:sha. 개정 = updated_at(ms)
//   codeBeamer REST v3: GET /api/v3/items/:id, 댓글 POST /api/v3/items/:id/comments. 개정 = item.version
// 인증·주소는 환경 변수(아래 cfg). 토큰은 로그·감사·Evidence에 남기지 않는다. 시간 제한 10초, 실패는 보낼 함이 재시도한다.
import type { ExtKind, ExtSystem } from '@ff/contracts';
import type { AdapterMode, ExtAdapter, RemoteItem, WritePatch, WriteResult } from './adapters';

interface Cfg {
  url: string;
  auth: string;
  project: string;
}

const env = (k: string) => (process.env[k] ?? '').trim();
const basic = (user: string, token: string) => `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;

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
  private async req<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const c = this.cfg();
    const headers: Record<string, string> = { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
    if (this.system === 'GITLAB') headers['private-token'] = c.auth;
    else headers.authorization = c.auth;
    const res = await this.fetchFn(`${c.url}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
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
      const r = await this.req<any>('GET', `/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,status,issuetype,updated,parent`);
      if (r.status === 404) return null;
      const f = r.data.fields;
      const type = f.issuetype?.name;
      const kind: ExtKind = type === 'Epic' ? 'EPIC' : type === 'Bug' ? 'DEFECT' : 'CHANGE_REQUEST';
      return { system: 'JIRA', kind, key, url: `${c.url}/browse/${key}`, title: f.summary ?? '', status: f.status?.name ?? '', revision: Date.parse(f.updated), fields: { parentKey: f.parent?.key ?? null } };
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
    const project = kind === 'EPIC' ? env('JIRA_EPIC_PROJECT') || 'FFE' : kind === 'DEFECT' ? env('JIRA_DEFECT_PROJECT') || 'FFD' : this.cfg().project;
    const issuetype = kind === 'EPIC' ? 'Epic' : kind === 'DEFECT' ? 'Bug' : 'Change Request';
    const parent = f.fields?.parentKey ? { parent: { key: f.fields.parentKey } } : {};
    const r = await this.req<{ key: string }>('POST', '/rest/api/2/issue', { fields: { project: { key: project }, summary: f.title, description: f.body, issuetype: { name: issuetype }, ...parent } });
    // 새 이슈는 워크플로 첫 상태로 생긴다 — 이미 그 상태면 전이하지 않는다(자기 자신으로 가는 전이는 보통 없다)
    const made = (await this.read(r.data.key))!;
    if (!f.status || made.status.toLowerCase() === f.status.toLowerCase()) return made;
    await this.transition(r.data.key, f.status);
    return (await this.read(r.data.key))!;
  }

  private async transition(key: string, status: string) {
    const t = await this.req<{ transitions: { id: string; to: { name: string } }[] }>('GET', `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`);
    const hit = (t.data.transitions ?? []).find((x) => x.to?.name?.toLowerCase() === status.toLowerCase());
    if (!hit) throw new Error(`JIRA ${key}: '${status}'(으)로 가는 워크플로 전이가 없습니다 — JIRA 워크플로와 상태 매핑(JIRA_EPIC_STATUS·JIRA_CR_STATUS)을 맞추세요.`);
    await this.req('POST', `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: hit.id } });
  }

  // ── 쓰기(기대 개정이 다르면 충돌) ──
  async write(key: string, patch: WritePatch, expectedRevision: number | null): Promise<WriteResult> {
    if (expectedRevision !== null) {
      const now = await this.read(key);
      if (!now) throw new Error(`${this.system} ${key}이(가) 없습니다.`);
      if (now.revision !== expectedRevision) return { ok: false, conflict: now };
    }
    if (this.system === 'JIRA') {
      if (patch.status) await this.transition(key, patch.status);
      if (patch.comment) await this.req('POST', `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, { body: patch.comment });
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
      if (text) await this.req('POST', `/api/v3/items/${id}/comments`, { comment: text, commentFormat: 'PlainText' });
    }
    return { ok: true, item: (await this.read(key))! };
  }
}

/** codeBeamer 검증 결과 댓글 — 사람이 읽고, 기계가 다시 읽을 수 있게 한 줄 머리 */
const verificationText = (v: Record<string, unknown>) => `[Feature Platform] ${v.gate} ${v.status} — ${v.featureId}@${v.version}${v.evidenceRef ? ` · Evidence ${v.evidenceRef}` : ''}`;
