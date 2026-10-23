// 외부 연계 연결 점검 (npm run ext:check) — GitLab(IF-13)·JIRA(IF-14)·codeBeamer(IF-01)을 live로 바꾸기 전에 읽기 전용으로 확인한다.
//   node tools/ext-check.ts [--env-file <경로>] [--jira-project <키>]
// URL·토큰(+프로젝트 키)만 넣고 돌리면: 연결·인증, 프로젝트·이슈 유형, 워크플로 상태 ↔ 플랫폼 상태(제안 매핑·못 맞춘 것),
// Epic 적용 범위 사용자 정의 필드 후보 ID, 붙여넣을 환경 변수 묶음을 출력한다.
// 규칙: GET만 보낸다(getOnly가 다른 메서드·본문을 막는다) · 토큰·비밀값은 어떤 줄에도 찍지 않는다(마지막에 한 번 더 가린다).
// 종료 코드: 점검한 시스템(URL이 있거나 IF_MODE_xx=live)에 ✕가 하나라도 있으면 1. 필수 표는 contracts EXT_LIVE_ENV(백엔드 시작 검사와 같음).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { FF } from './lib.ts';

const require = createRequire(import.meta.url);
type Contracts = typeof import('../contracts/src/index');
const C = require(join(FF, 'contracts', 'dist', 'index.js')) as Contracts;

export type Env = Record<string, string | undefined>;
type Level = 'PASS' | 'WARN' | 'FAIL';
interface Line {
  level: Level | 'INFO';
  text: string;
}
interface SystemReport {
  system: 'JIRA' | 'GITLAB' | 'CODEBEAMER';
  lines: Line[];
  env: string[];
}

// ───────── GET만 ─────────
/** GET 이외의 메서드나 본문이 있으면 보내기 전에 던진다 — 이 도구는 외부 시스템에 아무것도 쓰지 않는다 */
export function getOnly(fetchFn: typeof fetch): typeof fetch {
  return ((url: string | URL | Request, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' || init.body != null) throw new Error(`ext-check는 GET만 보냅니다 (${method} 차단)`);
    return fetchFn(url, { ...init, method: 'GET' });
  }) as typeof fetch;
}

interface Got {
  status: number;
  data: any;
  error?: string;
}
async function get(f: typeof fetch, url: string, headers: Record<string, string>): Promise<Got> {
  try {
    const res = await f(url, { method: 'GET', headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: null, error: (e as Error).message };
  }
}

const v = (env: Env, k: string) => (env[k] ?? '').trim();
const base = (u: string) => u.replace(/\/+$/, '');
/** 주소에 사용자·비밀번호가 들어 있어도 출력하지 않는다 */
function shown(u: string): string {
  try {
    const x = new URL(u);
    x.username = '';
    x.password = '';
    return base(x.toString());
  } catch {
    return '(주소 형식 아님)';
  }
}
const basic = (user: string, token: string) => `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
const ifOf = (s: SystemReport['system']) => C.EXT_SYSTEM_IF[s].slice(3);
const isLive = (env: Env, s: SystemReport['system']) => v(env, `IF_MODE_${ifOf(s)}`) === 'live';

function httpFail(what: string, r: Got, authHint: string): Line {
  if (r.status === 0) return { level: 'FAIL', text: `${what} — 연결 안 됨 (${r.error ?? '응답 없음'}) · 주소·사내망·프록시 확인` };
  if (r.status === 401 || r.status === 403) return { level: 'FAIL', text: `${what} — 인증 실패 (${r.status}) · ${authHint}` };
  return { level: 'FAIL', text: `${what} — 응답 ${r.status}` };
}

// ───────── 상태 매핑 ─────────
const EPIC_HINTS: Record<string, string[]> = {
  PROPOSED: ['proposed', 'idea', 'backlog', 'new', 'open', 'to do'],
  APPROVED: ['approved', 'selected for development', 'ready for development', 'ready'],
  DEVELOPING: ['in progress', 'in development', 'development', 'implementing'],
  VERIFIED: ['in verification', 'verification', 'verified', 'in test', 'testing', 'qa'],
  RELEASED: ['released', 'release', 'done'],
  DEPRECATED: ['deprecated', 'sunset'],
  RETIRED: ['closed', 'retired', 'archived'],
};
const CR_HINTS: Record<string, string[]> = {
  OPEN: ['open', 'new', 'to do', 'backlog'],
  IN_REVIEW: ['in review', 'review', 'under review', 'reviewing'],
  APPROVED: ['approved', 'accepted'],
  DEPLOYED: ['deployed', 'released', 'done'],
  ROLLED_BACK: ['rolled back', 'rollback', 'reverted'],
  REJECTED: ['rejected', 'declined', "won't do"],
  CLOSED: ['closed', 'resolved', 'done'],
};

export interface StatusMatch {
  state: string;
  configured: string;
  found: string | null;
  how: 'configured' | 'proposed' | 'none';
}
/** 지금 설정된 이름이 워크플로에 있으면 그대로, 없으면 이름 힌트로 아직 안 쓴 상태를 제안, 그래도 없으면 못 맞춤 */
export function proposeStatusMap(states: readonly string[], configured: Record<string, string>, hints: Record<string, string[]>, discovered: string[]): StatusMatch[] {
  const used = new Set<string>();
  const low = (s: string) => s.trim().toLowerCase();
  const out: StatusMatch[] = states.map((state) => {
    const hit = discovered.find((d) => low(d) === low(configured[state]));
    if (hit) used.add(hit);
    return { state, configured: configured[state], found: hit ?? null, how: hit ? 'configured' : 'none' };
  });
  for (const pass of ['exact', 'contains'] as const) {
    for (const m of out) {
      if (m.found) continue;
      for (const h of hints[m.state] ?? []) {
        const hit = discovered.find((d) => !used.has(d) && (pass === 'exact' ? low(d) === h : low(d).includes(h)));
        if (hit) {
          used.add(hit);
          Object.assign(m, { found: hit, how: 'proposed' });
          break;
        }
      }
    }
  }
  return out;
}

// ───────── 필드 후보 ─────────
const FIELD_HINTS: Record<string, string[]> = {
  country: ['country', '국가', 'market'],
  vehicleModel: ['vehicle model', '차종', 'car model', 'model'],
  trim: ['trim', '트림', 'grade'],
  asil: ['asil'],
  ownerId: ['owner', '담당', 'organization', '조직', 'team'],
};
const FIELD_ENV: Record<string, string> = { country: 'JIRA_FIELD_COUNTRY', vehicleModel: 'JIRA_FIELD_VEHICLE_MODEL', trim: 'JIRA_FIELD_TRIM', asil: 'JIRA_FIELD_ASIL', ownerId: 'JIRA_FIELD_OWNER' };
export interface JiraField {
  id: string;
  name: string;
  custom?: boolean;
}
/** 사용자 정의 필드 중 이름이 힌트와 같으면 3점, 포함하면 1점 — 점수 순 */
export function fieldCandidates(field: string, fields: JiraField[]): JiraField[] {
  const score = (f: JiraField) => Math.max(0, ...(FIELD_HINTS[field] ?? []).map((h) => (f.name.trim().toLowerCase() === h ? 3 : f.name.toLowerCase().includes(h) ? 1 : 0)));
  return fields
    .filter((f) => (f.custom ?? f.id.startsWith('customfield_')) && score(f) > 0)
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
    .map((f) => ({ ...f, score: score(f) }) as JiraField & { score: number });
}

// ───────── JIRA ─────────
async function checkJira(env: Env, f: typeof fetch, opts: { jiraProject?: string }): Promise<SystemReport> {
  const r: SystemReport = { system: 'JIRA', lines: [], env: [] };
  const url = base(v(env, 'JIRA_URL'));
  const token = v(env, 'JIRA_TOKEN');
  const user = v(env, 'JIRA_USER');
  r.env.push(`JIRA_URL=${url ? shown(url) : ''}`);
  if (user) r.env.push(`JIRA_USER=${user}`);
  r.env.push(token ? '# JIRA_TOKEN — 이미 설정됨(값은 출력하지 않음)' : '# JIRA_TOKEN=  ← API 토큰(Cloud) 또는 개인 접근 토큰(Data Center)');
  if (!url || !token) {
    r.lines.push({ level: 'FAIL', text: `JIRA_URL·JIRA_TOKEN이 필요합니다 (없음: ${[!url && 'JIRA_URL', !token && 'JIRA_TOKEN'].filter(Boolean).join(', ')})` });
    return r;
  }
  const h = { authorization: user ? basic(user, token) : `Bearer ${token}` };
  const authHint = user ? 'Cloud는 JIRA_USER=이메일 + API 토큰' : 'Data Center는 개인 접근 토큰(Bearer), Cloud면 JIRA_USER(이메일)도 넣으세요';
  const me = await get(f, `${url}/rest/api/2/myself`, h);
  if (me.status !== 200) {
    r.lines.push(httpFail(`연결·인증 ${shown(url)}`, me, authHint));
    return r;
  }
  r.lines.push({ level: 'PASS', text: `연결·인증 ${shown(url)} → ${me.data?.displayName ?? '?'} (${me.data?.name ?? me.data?.accountId ?? '?'}, ${user ? 'Basic' : 'Bearer'})` });

  // 프로젝트·이슈 유형
  const roles = [
    { env: 'JIRA_EPIC_PROJECT', type: C.JIRA_ISSUE_TYPE.EPIC, label: 'Epic' },
    { env: 'JIRA_CR_PROJECT', type: C.JIRA_ISSUE_TYPE.CHANGE_REQUEST, label: '변경요청(CR)' },
    { env: 'JIRA_DEFECT_PROJECT', type: C.JIRA_ISSUE_TYPE.DEFECT, label: '결함' },
  ] as const;
  const keyOf = (k: string) => v(env, k) || (opts.jiraProject ?? '').trim();
  const projects = new Map<string, Got>();
  for (const role of roles) {
    const key = keyOf(role.env);
    r.env.push(key ? `${role.env}=${key}` : `# ${role.env}=  ← ${role.label} 프로젝트 키`);
    if (!key) {
      r.lines.push({ level: 'FAIL', text: `${role.label} 프로젝트 키 없음 — ${role.env} 또는 --jira-project <키>` });
      continue;
    }
    if (!projects.has(key)) projects.set(key, await get(f, `${url}/rest/api/2/project/${encodeURIComponent(key)}`, h));
    const p = projects.get(key)!;
    if (p.status !== 200) {
      r.lines.push(p.status === 404 ? { level: 'FAIL', text: `프로젝트 ${key}(${role.label}) 없음 또는 볼 권한 없음` } : httpFail(`프로젝트 ${key}`, p, authHint));
      continue;
    }
    const types: string[] = (p.data?.issueTypes ?? []).map((t: { name: string }) => t.name);
    r.lines.push(
      types.some((t) => t.toLowerCase() === role.type.toLowerCase())
        ? { level: 'PASS', text: `프로젝트 ${key} "${p.data?.name ?? ''}" — 이슈 유형 '${role.type}' 있음(${role.label})` }
        : { level: 'FAIL', text: `프로젝트 ${key}에 이슈 유형 '${role.type}'가 없음(${role.label}) — 있는 유형: ${types.join(', ') || '없음'}` },
    );
  }
  if (roles.some((x) => !keyOf(x.env))) {
    const list = await get(f, `${url}/rest/api/2/project`, h);
    if (list.status === 200 && Array.isArray(list.data)) r.lines.push({ level: 'INFO', text: `볼 수 있는 프로젝트: ${list.data.slice(0, 20).map((p: { key: string; name: string }) => `${p.key}(${p.name})`).join(', ') || '없음'}` });
  }

  // 워크플로 상태 ↔ 플랫폼 상태
  for (const kind of ['EPIC', 'CR'] as const) {
    const envKey = kind === 'EPIC' ? 'JIRA_EPIC_STATUS' : 'JIRA_CR_STATUS';
    const parsed = C.parseJiraStatusMap(kind, env[envKey]);
    if ('error' in parsed) {
      r.lines.push({ level: 'FAIL', text: parsed.error });
      continue;
    }
    const defaults: Record<string, string> = kind === 'EPIC' ? { ...C.JIRA_EPIC_STATUS_DEFAULT } : { ...C.JIRA_CR_STATUS_DEFAULT };
    const configured = { ...defaults, ...parsed.map };
    const key = keyOf(kind === 'EPIC' ? 'JIRA_EPIC_PROJECT' : 'JIRA_CR_PROJECT');
    const type = kind === 'EPIC' ? C.JIRA_ISSUE_TYPE.EPIC : C.JIRA_ISSUE_TYPE.CHANGE_REQUEST;
    if (!key || projects.get(key)?.status !== 200) continue;
    const st = await get(f, `${url}/rest/api/2/project/${encodeURIComponent(key)}/statuses`, h);
    if (st.status !== 200 || !Array.isArray(st.data)) {
      r.lines.push(httpFail(`상태 목록 ${key}`, st, authHint));
      continue;
    }
    const discovered: string[] = (st.data.find((t: { name: string }) => t.name.toLowerCase() === type.toLowerCase())?.statuses ?? []).map((s: { name: string }) => s.name);
    const states = kind === 'EPIC' ? C.LIFECYCLE : C.JIRA_CR_STATES;
    const matches = proposeStatusMap(states, configured, kind === 'EPIC' ? EPIC_HINTS : CR_HINTS, discovered);
    const title = kind === 'EPIC' ? 'Lifecycle ↔ Epic 상태' : 'CR 상태';
    r.lines.push({ level: 'INFO', text: `${title} (${key} / ${type}) — JIRA 상태: ${discovered.join(', ') || '없음'}` });
    for (const m of matches) {
      if (m.how === 'configured') r.lines.push({ level: 'PASS', text: `  ${m.state.padEnd(11)} '${m.found}'` });
      else if (m.how === 'proposed') r.lines.push({ level: 'WARN', text: `  ${m.state.padEnd(11)} '${m.configured}' 없음 → 제안 '${m.found}' (확인 후 붙여넣기)` });
      else r.lines.push({ level: 'FAIL', text: `  ${m.state.padEnd(11)} '${m.configured}' 없음 — 맞출 상태를 못 찾음 (워크플로에 상태를 더하거나 ${envKey}에 직접 지정)` });
    }
    const want = Object.fromEntries(matches.filter((m) => m.found && m.found !== defaults[m.state]).map((m) => [m.state, m.found]));
    const unmapped = matches.filter((m) => !m.found).map((m) => m.state);
    if (Object.keys(want).length) r.env.push(`${envKey}='${JSON.stringify(want)}'`);
    if (unmapped.length) r.env.push(`# ${envKey} 못 맞춤: ${unmapped.join(', ')} ← JIRA 상태 이름을 골라 위 JSON에 더하세요`);
  }
  // 결함 첫 상태 — 긴급 차단 결함은 'Open'으로 만든다(코드 고정)
  const dKey = keyOf('JIRA_DEFECT_PROJECT');
  if (dKey && projects.get(dKey)?.status === 200) {
    const st = await get(f, `${url}/rest/api/2/project/${encodeURIComponent(dKey)}/statuses`, h);
    const names: string[] = (Array.isArray(st.data) ? (st.data.find((t: { name: string }) => t.name.toLowerCase() === C.JIRA_ISSUE_TYPE.DEFECT.toLowerCase())?.statuses ?? []) : []).map((s: { name: string }) => s.name);
    if (st.status === 200 && !names.some((n) => n.toLowerCase() === 'open')) r.lines.push({ level: 'WARN', text: `결함(${dKey} / Bug) 워크플로에 'Open'이 없음 — 긴급 차단 결함 만들기가 'Open' 전이에서 실패합니다(있는 상태: ${names.join(', ') || '없음'})` });
  }

  // Epic 적용 범위 필드
  const autocreate = v(env, 'FF_EPIC_AUTOCREATE') !== 'off';
  const fl = await get(f, `${url}/rest/api/2/field`, h);
  if (fl.status !== 200 || !Array.isArray(fl.data)) r.lines.push(httpFail('필드 목록', fl, authHint));
  else {
    const fields = fl.data as JiraField[];
    r.lines.push({ level: 'INFO', text: `Epic 적용 범위 필드 (Feature 자동 등록${autocreate ? '' : ' — FF_EPIC_AUTOCREATE=off라 필수 아님'})` });
    const miss: Level = autocreate ? 'FAIL' : 'WARN';
    for (const field of C.EPIC_SCOPE_FIELDS) {
      const envKey = FIELD_ENV[field];
      const label = `  ${C.EPIC_SCOPE_LABEL[field]}(${field})`.padEnd(22);
      const set = v(env, envKey);
      if (set) {
        const hit = fields.find((x) => x.id === set);
        r.lines.push(hit ? { level: 'PASS', text: `${label} ${set} "${hit.name}"` } : { level: 'FAIL', text: `${label} ${envKey}=${set} — 이 JIRA에 없는 필드 ID` });
        r.env.push(`${envKey}=${set}`);
        continue;
      }
      const cand = fieldCandidates(field, fields) as (JiraField & { score: number })[];
      const top = cand.filter((c) => c.score === cand[0]?.score);
      const list = cand.slice(0, 5).map((c) => `${c.id} "${c.name}"`).join(', ');
      if (cand.length && top.length === 1 && cand[0].score === 3) {
        r.lines.push({ level: 'WARN', text: `${label} 제안 ${cand[0].id} "${cand[0].name}" (확인 후 붙여넣기)` });
        r.env.push(`${envKey}=${cand[0].id}`);
      } else if (cand.length) {
        r.lines.push({ level: miss, text: `${label} 후보 ${cand.length}개 — 골라 넣으세요: ${list}` });
        r.env.push(`# ${envKey}=  ← 후보: ${list}`);
      } else {
        r.lines.push({ level: miss, text: `${label} 후보 없음 — Epic 화면의 사용자 정의 필드 ID(customfield_…)를 넣으세요` });
        r.env.push(`# ${envKey}=  ← 후보 없음`);
      }
    }
  }
  secretLine(r, env, 'JIRA_WEBHOOK_SECRET', 'JIRA webhook 설정의 비밀값과 같은 값(직접 정함)');
  return r;
}

function secretLine(r: SystemReport, env: Env, key: string, what: string) {
  const live = isLive(env, r.system);
  if (v(env, key)) {
    r.lines.push({ level: 'PASS', text: `${key} 설정됨` });
    r.env.push(`# ${key} — 이미 설정됨(값은 출력하지 않음)`);
  } else {
    r.lines.push({ level: live ? 'FAIL' : 'WARN', text: `${key} 없음 — ${what}. 없으면 live로 시작하지 않습니다` });
    r.env.push(`# ${key}=  ← ${what}`);
  }
}

// ───────── GitLab ─────────
async function checkGitlab(env: Env, f: typeof fetch): Promise<SystemReport> {
  const r: SystemReport = { system: 'GITLAB', lines: [], env: [] };
  const url = base(v(env, 'GITLAB_URL'));
  const token = v(env, 'GITLAB_TOKEN');
  const project = v(env, 'GITLAB_PROJECT');
  r.env.push(`GITLAB_URL=${url ? shown(url) : ''}`, token ? '# GITLAB_TOKEN — 이미 설정됨(값은 출력하지 않음)' : '# GITLAB_TOKEN=  ← api 범위 접근 토큰');
  if (!url || !token) {
    r.lines.push({ level: 'FAIL', text: `GITLAB_URL·GITLAB_TOKEN이 필요합니다 (없음: ${[!url && 'GITLAB_URL', !token && 'GITLAB_TOKEN'].filter(Boolean).join(', ')})` });
    return r;
  }
  const h = { 'private-token': token };
  const hint = 'api 범위 토큰(PRIVATE-TOKEN)인지, 만료되지 않았는지 확인';
  const me = await get(f, `${url}/api/v4/user`, h);
  if (me.status !== 200) {
    r.lines.push(httpFail(`연결·인증 ${shown(url)}`, me, hint));
    return r;
  }
  r.lines.push({ level: 'PASS', text: `연결·인증 ${shown(url)} → ${me.data?.name ?? '?'} (@${me.data?.username ?? '?'})` });
  if (!project) {
    r.lines.push({ level: 'FAIL', text: 'GITLAB_PROJECT 없음 — 그룹/이름 경로 또는 숫자 ID' });
    r.env.push('# GITLAB_PROJECT=  ← 그룹/이름');
    const list = await get(f, `${url}/api/v4/projects?membership=true&simple=true&per_page=20`, h);
    if (list.status === 200 && Array.isArray(list.data)) r.lines.push({ level: 'INFO', text: `참여 중인 프로젝트: ${list.data.map((p: { path_with_namespace: string }) => p.path_with_namespace).join(', ') || '없음'}` });
  } else {
    r.env.push(`GITLAB_PROJECT=${project}`);
    const p = await get(f, `${url}/api/v4/projects/${encodeURIComponent(project)}`, h);
    if (p.status !== 200) r.lines.push(p.status === 404 ? { level: 'FAIL', text: `프로젝트 ${project} 없음 또는 볼 권한 없음` } : httpFail(`프로젝트 ${project}`, p, hint));
    else {
      const level = Math.max(p.data?.permissions?.project_access?.access_level ?? 0, p.data?.permissions?.group_access?.access_level ?? 0);
      r.lines.push({ level: 'PASS', text: `프로젝트 ${p.data?.path_with_namespace ?? project}` });
      if (level < 30) r.lines.push({ level: 'WARN', text: `권한 수준 ${level || '알 수 없음'} — MR 댓글·commit status 쓰기에 Developer(30) 이상이 필요합니다` });
    }
  }
  secretLine(r, env, 'GITLAB_WEBHOOK_TOKEN', 'GitLab webhook 설정의 Secret token과 같은 값(직접 정함)');
  return r;
}

// ───────── codeBeamer ─────────
async function checkCodebeamer(env: Env, f: typeof fetch): Promise<SystemReport> {
  const r: SystemReport = { system: 'CODEBEAMER', lines: [], env: [] };
  const url = base(v(env, 'CODEBEAMER_URL'));
  const user = v(env, 'CODEBEAMER_USER');
  const token = v(env, 'CODEBEAMER_TOKEN');
  r.env.push(`CODEBEAMER_URL=${url ? shown(url) : ''}`, `CODEBEAMER_USER=${user}`, token ? '# CODEBEAMER_TOKEN — 이미 설정됨(값은 출력하지 않음)' : '# CODEBEAMER_TOKEN=  ← 비밀번호 또는 토큰');
  const missing = [!url && 'CODEBEAMER_URL', !user && 'CODEBEAMER_USER', !token && 'CODEBEAMER_TOKEN'].filter(Boolean);
  if (missing.length) {
    r.lines.push({ level: 'FAIL', text: `CODEBEAMER_URL·USER·TOKEN이 필요합니다 (없음: ${missing.join(', ')})` });
    return r;
  }
  const h = { authorization: basic(user, token) };
  const hint = 'CODEBEAMER_USER·CODEBEAMER_TOKEN(Basic) 확인';
  // 실제 연결 어댑터와 같은 REST v3(<CODEBEAMER_URL>/api/v3/…)
  const pr = await get(f, `${url}/api/v3/projects`, h);
  if (pr.status !== 200) {
    r.lines.push(pr.status === 404 ? { level: 'FAIL', text: `REST v3 경로 없음 (${shown(url)}/api/v3) — CODEBEAMER_URL이 /api 바로 앞까지인지(예: …/cb) 확인` } : httpFail(`연결·인증 ${shown(url)}`, pr, hint));
    return r;
  }
  r.lines.push({ level: 'PASS', text: `연결·인증 ${shown(url)} → ${user} · 볼 수 있는 프로젝트 ${Array.isArray(pr.data) ? pr.data.length : '?'}개` });
  const tracker = v(env, 'CODEBEAMER_REQ_TRACKER');
  const fieldName = v(env, 'CODEBEAMER_REQ_ID_FIELD') || 'Requirement ID';
  if (!tracker) {
    r.lines.push({ level: 'WARN', text: 'CODEBEAMER_REQ_TRACKER 없음 — 요구 ID를 모든 tracker에서 찾습니다(느릴 수 있음)' });
    r.env.push('# CODEBEAMER_REQ_TRACKER=  ← 요구사항 tracker ID(숫자)');
  } else {
    r.env.push(`CODEBEAMER_REQ_TRACKER=${tracker}`);
    const t = await get(f, `${url}/api/v3/trackers/${encodeURIComponent(tracker)}`, h);
    if (t.status !== 200) r.lines.push(t.status === 404 ? { level: 'FAIL', text: `tracker ${tracker} 없음 또는 볼 권한 없음` } : httpFail(`tracker ${tracker}`, t, hint));
    else {
      r.lines.push({ level: 'PASS', text: `요구 tracker ${tracker} "${t.data?.name ?? ''}"` });
      const fs = await get(f, `${url}/api/v3/trackers/${encodeURIComponent(tracker)}/fields`, h);
      const names: string[] = Array.isArray(fs.data) ? fs.data.map((x: { name: string }) => x.name) : [];
      if (fs.status === 200) r.lines.push(names.some((n) => n.toLowerCase() === fieldName.toLowerCase()) ? { level: 'PASS', text: `요구 ID 필드 '${fieldName}' 있음` } : { level: 'FAIL', text: `요구 ID 필드 '${fieldName}' 없음 — CODEBEAMER_REQ_ID_FIELD에 필드 이름을 넣으세요 (있는 필드: ${names.slice(0, 15).join(', ')})` });
    }
  }
  if (v(env, 'CODEBEAMER_REQ_ID_FIELD')) r.env.push(`CODEBEAMER_REQ_ID_FIELD=${fieldName}`);
  secretLine(r, env, 'CODEBEAMER_WEBHOOK_SECRET', 'codeBeamer webhook 설정의 HMAC 비밀값과 같은 값(직접 정함)');
  return r;
}

// ───────── 실행 ─────────
const SYSTEMS = [
  { system: 'JIRA', url: 'JIRA_URL', run: checkJira },
  { system: 'GITLAB', url: 'GITLAB_URL', run: checkGitlab },
  { system: 'CODEBEAMER', url: 'CODEBEAMER_URL', run: checkCodebeamer },
] as const;

/** 출력에 들어간 비밀값을 가린다(혹시 응답·오류 문구에 섞여도) */
export function redact(text: string, env: Env): string {
  const secrets = Object.values(C.EXT_LIVE_ENV)
    .flat()
    .filter((e) => e.secret)
    .map((e) => v(env, e.key))
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length);
  return secrets.reduce((t, s) => t.split(s).join('***'), text);
}

export async function runCheck(env: Env, fetchFn: typeof fetch, opts: { jiraProject?: string } = {}): Promise<{ output: string; exitCode: number }> {
  const f = getOnly(fetchFn);
  const icon = { PASS: '✓', WARN: '!', FAIL: '✕', INFO: '·' } as const;
  const out: string[] = ['외부 연계 연결 점검 — 읽기 전용(GET만), 토큰·비밀값은 출력하지 않습니다', ''];
  const block: string[] = [];
  let fail = false;
  for (const s of SYSTEMS) {
    const live = isLive(env, s.system);
    const mode = v(env, `IF_MODE_${ifOf(s.system)}`) || 'mock';
    out.push(`■ ${C.EXT_SYSTEM_LABEL[s.system]} (${C.EXT_SYSTEM_IF[s.system]}) — IF_MODE_${ifOf(s.system)}=${mode}`);
    if (!v(env, s.url) && !live) {
      out.push(`  · 설정 없음 — 건너뜀 (${s.url}와 토큰을 넣으면 점검합니다)`, '');
      continue;
    }
    const r = await s.run(env, f, opts);
    if (live) {
      const missing = C.missingLiveEnv(s.system, (k) => env[k]);
      if (missing.length) r.lines.push({ level: 'FAIL', text: `IF_MODE_${ifOf(s.system)}=live인데 필수 변수 없음: ${missing.join(', ')} — 이대로면 백엔드가 시작하지 않습니다` });
    }
    for (const l of r.lines) out.push(`  ${icon[l.level]} ${l.text}`);
    const bad = r.lines.some((l) => l.level === 'FAIL');
    fail ||= bad;
    out.push('');
    block.push(`# ── ${C.EXT_SYSTEM_LABEL[s.system]} (${C.EXT_SYSTEM_IF[s.system]}) ──`, ...r.env, live ? `IF_MODE_${ifOf(s.system)}=live` : `# IF_MODE_${ifOf(s.system)}=live  ← 위 점검에 ✕가 없으면 켭니다`, '');
  }
  if (block.length) out.push('붙여넣을 환경 변수 (! 제안 값은 확인 후 사용)', '────────', ...block);
  out.push(fail ? '✕ 준비 안 됨 — ✕ 항목을 고친 뒤 다시 실행하세요' : block.length ? '✓ 점검한 연계에 막는 문제 없음' : '· 점검한 연계 없음');
  return { output: redact(out.join('\n'), env), exitCode: fail ? 1 : 0 };
}

export function parseArgs(argv: string[]): { envFile?: string; jiraProject?: string } {
  const at = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { envFile: at('--env-file'), jiraProject: at('--jira-project') };
}

if (import.meta.main ?? process.argv[1]?.endsWith('ext-check.ts')) {
  const args = parseArgs(process.argv.slice(2));
  // --env-file 값이 셸 환경보다 우선한다(점검하려는 파일 그대로 보이게)
  const env: Env = { ...process.env, ...(args.envFile ? parseEnv(readFileSync(resolve(args.envFile), 'utf8')) : {}) };
  const r = await runCheck(env, fetch, { jiraProject: args.jiraProject });
  console.log(r.output);
  process.exit(r.exitCode);
}
