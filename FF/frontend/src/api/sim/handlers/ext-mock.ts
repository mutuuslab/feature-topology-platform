// 시연 엔진 — D05-01 모의 외부 시스템(JIRA·codeBeamer·GitLab, 실서버 없을 때). 서버 ext-sync.service mockAct·mockCreate·ingest·apply와 같은 흐름:
// 바깥 사람이 항목을 바꾸거나 만든다 → (서명 webhook) → 플랫폼이 받아 반영·거부한다 → 거부면 바깥 항목을 플랫폼 값으로 되돌리고 사유 댓글을 단다.
// Epic 상태 = Feature Lifecycle 전이 요청(주인은 플랫폼), CR 승인·반려 = 연결 정책 승인·반려, 연결 없는 Epic = PROPOSED Feature 자동 등록 —
// 그 플랫폼 작업은 해당 묶음의 핸들러(transition·decidePolicy·createFeature)를 매핑된 사람으로 같은 반영 안에서 부른다(simInvoke).
import {
  ChangeRecordBody,
  changeRecordFindings,
  CreateFeatureBody,
  EPIC_SCOPE_LABEL,
  EXT_SYSTEMS,
  FEATURE_TRANSITIONS,
  JIRA_CR_STATUS,
  JIRA_EPIC_STATUS,
  lifecycleOfEpicStatus,
  missingEpicScope,
  MockExtActionBody,
  MockExtCreateBody,
  parseRefs,
  type ExtKind,
  type ExtSystem,
  type Lifecycle,
  type Role,
} from '@ff/contracts';
import { registerSimHandler, registerSimReader, simInvoke } from '../engine';
import type { SimActor, SimReadContext, SimWriteContext } from '../types';
import IDENTITIES from '../../../../../data/fixtures/ext/ext-identities.json';

type Comment = { at: string; by: string; text: string };
export type MockItem = { system: ExtSystem; key: string; kind: ExtKind; title: string; body: string; status: string; revision: number; updatedAt: string; updatedBy: string; comments: Comment[]; fields: Record<string, any> };
type Outcome = { outcome: 'APPLIED' | 'IGNORED' | 'REJECTED' | 'UNMAPPED'; summary: string };
type Identity = { system: ExtSystem; externalId: string; actorId: string; roles: string[]; name: string };
type InboxRow = { system: ExtSystem; deliveryId: string; receivedAt: string; key: string; outcome: Outcome['outcome']; summary: string; externalUser: string };

const ITEM = 'extMockItem';
const INBOX = 'extInboxRow';
/** 외부 항목 ↔ 플랫폼 연결(서버 ext_link) — Epic·CR·MR → Feature, CR → 정책 */
const LINKS = 'extMockLinks';
/** 플랫폼 서비스 계정 — 이 계정이 쓴 변경의 알림은 관측만 맞춘다(서버 adapters PLATFORM_USER) */
const PLATFORM_USER = 'feature-platform';
const BASE_URL: Record<ExtSystem, string> = { GITLAB: 'https://gitlab.ff.example', JIRA: 'https://jira.ff.example', CODEBEAMER: 'https://codebeamer.ff.example' };
const GITLAB_PROJECT = 'vehicle/feature-sw';
const JIRA_PROJECT: Partial<Record<ExtKind, string>> = { EPIC: 'FFE', CHANGE_REQUEST: 'FFCR', DEFECT: 'FFD' };
const EPIC_REF_HINT = 'Epic 화면의 Feature Platform 패널에서 Feature DB 기준 기능을 골라 주세요(첫 번째가 대표 기준 행). 맞는 기준 행이 없으면 플랫폼 Feature 등록 화면에서 추가를 요청하세요.';
const CR_OF_POLICY: Record<string, keyof typeof JIRA_CR_STATUS> = { DRAFT: 'OPEN', VALIDATED: 'IN_REVIEW', APPROVED: 'APPROVED', DEPLOYED: 'DEPLOYED', REJECTED: 'REJECTED', RETIRED: 'CLOSED' };
const crOfPolicy = (status: string): string | undefined => (CR_OF_POLICY[status] ? JIRA_CR_STATUS[CR_OF_POLICY[status]] : undefined);
const fid = (featureId: string, version: string) => `${featureId}@${version}`;
const splitFid = (id: string) => {
  const [featureId, version] = id.split('@');
  return { featureId, version };
};
const idOf = (system: string, key: string) => `${system}:${key}`;

export function extUrl(system: ExtSystem, kind: string, key: string): string {
  const base = BASE_URL[system];
  if (system === 'JIRA') return `${base}/browse/${key}`;
  if (system === 'CODEBEAMER') return `${base}/cb/issue/${key.replace(/^CB-/, '')}`;
  if (kind === 'PIPELINE') return `${base}/${GITLAB_PROJECT}/-/pipelines/${key.split('/').pop()}`;
  return `${base}/${GITLAB_PROJECT}/-/merge_requests/${key.split('!').pop()}`;
}

function systemOf(ctx: SimWriteContext | SimReadContext, s: string): ExtSystem {
  const up = s.toUpperCase() as ExtSystem;
  if (!(EXT_SYSTEMS as readonly string[]).includes(up)) {
    if ('fail' in ctx) ctx.fail('NOT_FOUND', `알 수 없는 외부 시스템입니다: ${s} (gitlab·jira·codebeamer)`);
    throw new Error(`알 수 없는 외부 시스템: ${s}`);
  }
  return up;
}

// ─── 모의 저장소(서버 MockExtStore) ─────────────────────────
async function itemsOf(ctx: SimReadContext, system: ExtSystem): Promise<MockItem[]> {
  const base = ((await ctx.snapshot<{ items: MockItem[] }>('mockExtItems', { system: system.toLowerCase() }, {}))?.items ?? []) as MockItem[];
  const mine = new Map(ctx.list<MockItem>(ITEM).filter((x) => x.system === system).map((x) => [x.key, x]));
  const out = base.map((it) => mine.get(it.key) ?? it);
  const seen = new Set(base.map((x) => x.key));
  // 새 항목은 만든 순서대로 끝에(서버 ORDER BY rowid)
  const fresh = [...mine.values()].filter((x) => !seen.has(x.key)).sort((a, b) => (a.fields._seq ?? 0) - (b.fields._seq ?? 0));
  return [...out, ...fresh];
}
const view = (it: MockItem): MockItem => {
  const { _seq, ...fields } = it.fields;
  void _seq;
  return { ...it, fields };
};
/** 고친 시각 — 같은 밀리초에 여러 번 바뀌어도 늘 커진다(JIRA·GitLab은 updated 시각이 개정 번호 구실) */
const stamp = (prev: string | null) => new Date(prev ? Math.max(Date.now(), Date.parse(prev) + 1) : Date.now()).toISOString();
const save = (ctx: SimWriteContext, it: MockItem, created = false) => ctx.put(ITEM, idOf(it.system, it.key), it, { created });

function update(ctx: SimWriteContext, it: MockItem, by: string, patch: { status?: string; title?: string; body?: string; comment?: string; fields?: Record<string, unknown> }): MockItem {
  const next: MockItem = {
    ...it,
    title: patch.title ?? it.title,
    body: patch.body ?? it.body,
    status: patch.status ?? it.status,
    revision: it.revision + 1,
    updatedAt: stamp(it.updatedAt),
    updatedBy: by,
    comments: patch.comment ? [...it.comments, { at: ctx.iso(), by, text: patch.comment }] : it.comments,
    fields: { ...it.fields, ...(patch.fields ?? {}) },
  };
  save(ctx, next);
  return next;
}

async function create(ctx: SimWriteContext, system: ExtSystem, kind: ExtKind, f: { title: string; body?: string; status: string; by: string; fields?: Record<string, unknown> }): Promise<MockItem> {
  const all = await itemsOf(ctx, system);
  const num = (prefix: string, start: number) => all.reduce((m, x) => (x.key.startsWith(prefix) ? Math.max(m, Number(x.key.slice(prefix.length)) || 0) : m), start - 1) + 1;
  const key =
    system === 'JIRA'
      ? `${JIRA_PROJECT[kind]}-${num(`${JIRA_PROJECT[kind]}-`, 1)}`
      : system === 'CODEBEAMER'
        ? `CB-${num('CB-', 10001)}`
        : kind === 'PIPELINE'
          ? `pipeline/${num('pipeline/', 50001)}`
          : `${GITLAB_PROJECT}!${num(`${GITLAB_PROJECT}!`, 101)}`;
  const seq = ctx.state<{ n: number }>('extMockSeq', () => ({ n: 0 }));
  seq.n += 1;
  const it: MockItem = { system, key, kind, title: f.title, body: f.body ?? '', status: f.status, revision: 1, updatedAt: stamp(null), updatedBy: f.by, comments: [], fields: { ...(f.fields ?? {}), _seq: seq.n } };
  save(ctx, it, true);
  return it;
}

// ─── 연결(서버 ext_link) — 스냅샷 시드 연결 + 이 브라우저에서 생긴 연결 ───────────────
type Links = Record<string, { FEATURE?: string; POLICY?: string }>;
const links = (ctx: SimWriteContext) => ctx.state<Links>(LINKS, () => ({}));
async function featureOfEpic(ctx: SimWriteContext, key: string): Promise<string | null> {
  const mine = links(ctx)[idOf('JIRA', key)]?.FEATURE;
  if (mine) return mine;
  const epics = (await ctx.read<{ items: { feature: string; key: string }[] }>('extFeatureEpics').catch(() => ({ items: [] }))).items ?? [];
  return epics.find((e) => e.key === key)?.feature ?? null;
}

// ─── 받기(서버 ingest·apply) ───────────────────────────────
const IDS = IDENTITIES as Identity[];
const identity = (system: ExtSystem, externalId: string) => IDS.find((i) => i.system === system && i.externalId === externalId) ?? null;
/** 외부 사람 → 이 작업이 허용하는 역할 중 그 사람이 맡은 것(없으면 null). 화면 계정 키는 행위자 ID의 usr- 뒤 */
function actorFor(id: Identity, allowed: readonly string[]): SimActor | null {
  const role = allowed.find((r) => id.roles.includes(r));
  return role ? { id: id.actorId, role: role as Role, persona: id.actorId.replace(/^usr-/, '') } : null;
}
const systemActor = (system: ExtSystem): SimActor => ({ id: `${system.toLowerCase()}-webhook`, role: 'SYSTEM' as Role, persona: 'system' });

type Change = { system: ExtSystem; kind: ExtKind; key: string; title: string; status: string; fromStatus: string | null; revision: number; externalUser: string; refs: { featureId?: string; version?: string; crKey?: string; policyId?: string; epicKey?: string }; extra: Record<string, any> };

/** 항목의 지금 모습 → 정규화 변경(서버 normalize — JIRA는 제목·본문에서 참조, GitLab은 MR 제목·본문·브랜치) */
function changeOf(it: MockItem, fromStatus: string | null): Change {
  const text = `${it.title}\n${it.body}`;
  if (it.system === 'JIRA') {
    const policy = /\b(POL-\d{5})\b/.exec(text)?.[1];
    return { system: 'JIRA', kind: it.kind, key: it.key, title: it.title, status: it.status, fromStatus, revision: Date.parse(it.updatedAt), externalUser: it.updatedBy, refs: { ...parseRefs(text, 'FFCR'), ...(policy ? { policyId: policy } : {}), ...(it.fields.parentKey ? { epicKey: String(it.fields.parentKey) } : {}) }, extra: { description: it.body.slice(0, 2000), ...(it.kind === 'EPIC' ? { scope: it.fields.scope ?? {} } : {}) } };
  }
  if (it.system === 'GITLAB') {
    if (it.kind === 'PIPELINE') return { system: 'GITLAB', kind: 'PIPELINE', key: it.key, title: it.title, status: it.status, fromStatus: null, revision: Date.parse(it.updatedAt), externalUser: it.updatedBy, refs: parseRefs(`${it.fields.ref ?? ''}\n${it.fields.mrTitle ?? ''}`, 'FFCR'), extra: { sha: it.fields.sha, ref: it.fields.ref, mrKey: it.fields.mrKey ?? null, coverage: it.fields.coverage ?? null } };
    return { system: 'GITLAB', kind: it.kind, key: it.key, title: it.title, status: it.status, fromStatus: null, revision: Date.parse(it.updatedAt), externalUser: it.updatedBy, refs: parseRefs(`${it.title}\n${it.body}\n${it.fields.sourceBranch ?? ''}`, 'FFCR'), extra: { sourceBranch: it.fields.sourceBranch, targetBranch: it.fields.targetBranch, sha: it.fields.sha, description: it.body.slice(0, 2000) } };
  }
  return { system: 'CODEBEAMER', kind: it.kind, key: it.key, title: it.title, status: it.status, fromStatus: null, revision: it.revision, externalUser: it.updatedBy, refs: {}, extra: { description: it.body.slice(0, 2000) } };
}

/** 플랫폼이 바깥 항목에 되쓴다(보낼 함 → 모의 어댑터) — 상태가 이미 같으면 댓글만 */
async function writeBack(ctx: SimWriteContext, system: ExtSystem, key: string, patch: { status?: string; comment?: string | null }) {
  const it = (await itemsOf(ctx, system)).find((x) => x.key === key);
  if (!it) return;
  const status = patch.status && patch.status !== it.status ? patch.status : undefined;
  if (!status && !patch.comment) return;
  update(ctx, it, PLATFORM_USER, { ...(status ? { status } : {}), ...(patch.comment ? { comment: patch.comment } : {}) });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function onEpic(ctx: SimWriteContext, c: Change, prev: MockItem | null): Promise<Outcome> {
  const target = (await featureOfEpic(ctx, c.key)) ?? (c.refs.featureId && c.refs.version ? fid(c.refs.featureId, c.refs.version) : null);
  if (target) links(ctx)[idOf('JIRA', c.key)] = { ...links(ctx)[idOf('JIRA', c.key)], FEATURE: target };
  if (!target) return featureFromEpic(ctx, c);
  const { featureId, version } = splitFid(target);
  const f = (await ctx.read<any>('featureDetail', { id: featureId, ver: version }).catch(() => null))?.feature as { lifecycle: Lifecycle } | undefined;
  if (!f) return { outcome: 'IGNORED', summary: `${target} 없음` };
  const statusChanged = (c.fromStatus !== null && c.fromStatus !== c.status) || (!!prev && prev.status !== c.status);
  if (!statusChanged || JIRA_EPIC_STATUS[f.lifecycle] === c.status) return { outcome: 'IGNORED', summary: '상태 같음' };
  const to = lifecycleOfEpicStatus(c.status);
  const revert = async (why: string): Promise<Outcome> => {
    await writeBack(ctx, 'JIRA', c.key, { status: JIRA_EPIC_STATUS[f.lifecycle], comment: `플랫폼이 이 상태 변경을 받지 않았습니다 — ${why} 상태를 '${JIRA_EPIC_STATUS[f.lifecycle]}'(으)로 되돌립니다.` });
    return { outcome: 'REJECTED', summary: `${c.key} '${c.status}' 거부 — ${why}` };
  };
  if (!to) return revert(`'${c.status}'은(는) 플랫폼 Lifecycle 상태가 아닙니다.`);
  const rule = FEATURE_TRANSITIONS.find((r) => r.from === f.lifecycle && r.to === to);
  if (!rule) return revert(`${f.lifecycle} → ${to}는 허용된 전이가 아닙니다.`);
  const who = identity('JIRA', c.externalUser);
  if (!who) return { ...(await revert(`JIRA 계정 '${c.externalUser}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다.`)), outcome: 'UNMAPPED' };
  const actor = actorFor(who, rule.roles);
  if (!actor) return revert(`${who.name}은(는) '${rule.ko}' 권한(${rule.roles.join('·')})이 없습니다.`);
  const reason = `JIRA ${c.key}: ${c.fromStatus ?? prev?.status ?? '?'} → ${c.status} (${c.externalUser})`;
  try {
    await simInvoke(ctx, 'transition', { params: { id: featureId, ver: version }, body: { to, reason }, actor });
  } catch (e) {
    return revert(errText(e));
  }
  // 전이 이벤트 → Epic 거울(상태는 이미 같다 — 댓글만)
  await writeBack(ctx, 'JIRA', c.key, { comment: `플랫폼 Lifecycle ${f.lifecycle} → ${to} (${actor.id}) — ${reason}` });
  return { outcome: 'APPLIED', summary: `${target} ${f.lifecycle} → ${to} (JIRA ${c.key})` };
}

/** 연결된 Feature가 없는 Epic → PROPOSED Feature 자동 등록(매핑된 작성자 계정으로 플랫폼 등록과 같은 경로) */
async function featureFromEpic(ctx: SimWriteContext, c: Change): Promise<Outcome> {
  const refuse = async (why: string, outcome: Outcome['outcome'] = 'REJECTED'): Promise<Outcome> => {
    await writeBack(ctx, 'JIRA', c.key, { comment: `플랫폼 Feature를 등록하지 않았습니다 — ${why}` });
    return { outcome, summary: `${c.key} Feature 자동 등록 안 함 — ${why}` };
  };
  const who = identity('JIRA', c.externalUser);
  if (!who) return refuse(`JIRA 계정 '${c.externalUser}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다.`, 'UNMAPPED');
  const actor = actorFor(who, ['FEATURE_AUTHOR']);
  if (!actor) return refuse(`${who.name}은(는) Feature 등록 권한(Feature 작성)이 없습니다.`);
  const scope = (c.extra.scope ?? {}) as Record<string, string> & { refIds?: string[] };
  const missing = missingEpicScope(scope);
  if (missing.length) return refuse(`Epic에 ${missing.map((k) => EPIC_SCOPE_LABEL[k]).join('·')} 값이 없거나 형식이 틀립니다. 채우면 다시 등록을 시도합니다.`);
  const refIds = Array.isArray(scope.refIds) ? scope.refIds : [];
  if (!refIds.length) return refuse(`기준 기능 ID가 없습니다. ${EPIC_REF_HINT}`);
  const featureRefs = refIds.map((refId, i) => ({ refId, role: i === 0 ? ('PRIMARY' as const) : ('INCLUDED' as const) }));
  const body = CreateFeatureBody.safeParse({ name: c.title, description: String(c.extra.description ?? '').trim() || c.title, country: scope.country, vehicleModel: scope.vehicleModel, trim: scope.trim, asil: scope.asil, ownerId: scope.ownerId, tags: [`jira:${c.key}`], featureRefs });
  if (!body.success) {
    const refIssue = body.error.issues.some((i) => i.path[0] === 'featureRefs');
    return refuse(`Epic 값이 Feature 등록 형식에 맞지 않습니다 — ${body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}${refIssue ? ` ${EPIC_REF_HINT}` : ''}`);
  }
  let f: { featureId: string; version: string };
  try {
    f = await simInvoke<{ featureId: string; version: string }>(ctx, 'createFeature', { body: body.data, actor });
  } catch (e) {
    const refProblem = (e as { code?: string }).code === 'REFDB_LINK_REQUIRED';
    return refuse(`${errText(e)}${refProblem ? ` ${EPIC_REF_HINT}` : ''}`);
  }
  const id = fid(f.featureId, f.version);
  links(ctx)[idOf('JIRA', c.key)] = { FEATURE: id };
  await writeBack(ctx, 'JIRA', c.key, { comment: `플랫폼 Feature ${id} 등록(PROPOSED) — ${who.name}. 이 Epic과 Feature Lifecycle이 양방향으로 연결되었습니다(상태 변경은 플랫폼 게이트를 거칩니다).` });
  return { outcome: 'APPLIED', summary: `${c.key} → ${id} 자동 등록(PROPOSED)` };
}

/** JIRA CR — 흐름의 주인은 JIRA. 승인·반려하면 연결된 정책의 승인·반려 요청(직무 분리는 플랫폼이 확인) */
async function onChangeRequest(ctx: SimWriteContext, c: Change, prev: MockItem | null, it: MockItem): Promise<Outcome> {
  const L = links(ctx);
  const epicFeature = c.refs.epicKey ? await featureOfEpic(ctx, c.refs.epicKey) : null;
  const feature = epicFeature ?? (c.refs.featureId && c.refs.version ? fid(c.refs.featureId, c.refs.version) : undefined);
  const seeded = typeof it.fields.policyId === 'string' ? it.fields.policyId : undefined;
  const candidate = L[idOf('JIRA', c.key)]?.POLICY ?? seeded ?? c.refs.policyId;
  const policy = candidate ? await ctx.read<any>('policyDetail', { id: candidate }).catch(() => null) : null;
  const p = (policy?.policy ?? policy) as { policyId: string; status: string } | null;
  const policyId = p ? candidate : undefined;
  L[idOf('JIRA', c.key)] = { ...L[idOf('JIRA', c.key)], ...(feature ? { FEATURE: feature } : {}), ...(policyId ? { POLICY: policyId } : {}) };
  const statusChanged = (c.fromStatus !== null && c.fromStatus !== c.status) || (!!prev && prev.status !== c.status);
  const decision = c.status === JIRA_CR_STATUS.APPROVED ? 'APPROVE' : c.status === JIRA_CR_STATUS.REJECTED ? 'REJECT' : null;
  if (!statusChanged || !decision || !policyId || !p) return { outcome: 'APPLIED', summary: `CR ${c.key} ${c.status}${policyId ? ` · 정책 ${policyId}` : ''}` };
  if (crOfPolicy(p.status) === c.status) return { outcome: 'IGNORED', summary: '정책 상태와 같음' };
  const word = decision === 'APPROVE' ? '승인' : '반려';
  const revert = async (why: string): Promise<Outcome> => {
    await writeBack(ctx, 'JIRA', c.key, { status: crOfPolicy(p.status) ?? JIRA_CR_STATUS.OPEN, comment: `플랫폼이 이 ${word}를 받지 않았습니다 — ${why}` });
    return { outcome: 'REJECTED', summary: `${c.key} ${c.status} 거부 — ${why}` };
  };
  if (p.status !== 'VALIDATED') return revert(`정책 ${policyId}은(는) ${p.status} 상태입니다(검증 GO 뒤에만 승인·반려).`);
  const who = identity('JIRA', c.externalUser);
  if (!who) return { ...(await revert(`JIRA 계정 '${c.externalUser}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다.`)), outcome: 'UNMAPPED' };
  const actor = actorFor(who, ['FEATURE_APPROVER']);
  if (!actor) return revert(`${who.name}은(는) 정책 승인 권한(Feature 승인자)이 없습니다.`);
  try {
    await simInvoke(ctx, 'decidePolicy', { params: { id: policyId }, body: { decision, reason: `JIRA ${c.key} ${c.status} (${c.externalUser})` }, actor });
  } catch (e) {
    return revert(errText(e));
  }
  await writeBack(ctx, 'JIRA', c.key, { comment: `플랫폼 정책 ${word} — ${policyId}` });
  return { outcome: 'APPLIED', summary: `정책 ${policyId} ${word} (JIRA ${c.key})` };
}

/** 서버 apply — 종류별 반영 */
async function apply(ctx: SimWriteContext, c: Change, prev: MockItem | null, it: MockItem): Promise<Outcome> {
  if (c.externalUser === PLATFORM_USER) return { outcome: 'IGNORED', summary: '플랫폼이 쓴 변경의 알림' };
  switch (c.kind) {
    case 'REQUIREMENT': {
      // codeBeamer 요구 — 주인이 codeBeamer. 내용·상태가 개정되면 연결된 Feature에 G2 재검토 표시
      const changed = !!prev && c.revision > prev.revision && (prev.title !== c.title || prev.status !== c.status || prev.body.slice(0, 2000) !== c.extra.description);
      // 연결된 Feature — 서버는 요구 ID로 맺은 연결(REQ_LINK). 시드 요구는 그 Feature 버전을 릴리스 칸에 적어 둔다
      const features = [...new Set(String(it.fields.release ?? '').match(/FEAT-\d{5}@\d+\.\d+\.\d+/g) ?? [])];
      if (changed) {
        ctx.audit({ action: 'EXT_REQUIREMENT_REVISED', target: c.key, actorId: systemActor('CODEBEAMER').id, actorRole: 'SYSTEM' as Role, before: { title: prev!.title, status: prev!.status, revision: prev!.revision }, after: { title: c.title, status: c.status, revision: c.revision }, reason: `codeBeamer ${c.externalUser}`, componentId: 'D05-01' });
        ctx.emit('ext.requirement.changed', c.key, { key: c.key, revision: c.revision, status: c.status, features, by: c.externalUser }, { componentId: 'D05-01' });
      }
      return changed ? { outcome: 'APPLIED', summary: `요구 ${c.key} 개정 r${c.revision}${features.length ? ` — Feature ${features.length}건 G2 재검토 필요` : ''}` } : { outcome: prev ? 'IGNORED' : 'APPLIED', summary: prev ? '바뀐 내용 없음' : `요구 ${c.key} 등록` };
    }
    case 'EPIC':
      return onEpic(ctx, c, prev);
    case 'CHANGE_REQUEST':
      return onChangeRequest(ctx, c, prev, it);
    case 'DEFECT':
      return { outcome: 'APPLIED', summary: `결함 ${c.key} ${c.status}` };
    case 'MERGE_REQUEST': {
      const feature = c.refs.featureId && c.refs.version ? fid(c.refs.featureId, c.refs.version) : null;
      if (feature) links(ctx)[idOf('GITLAB', c.key)] = { ...links(ctx)[idOf('GITLAB', c.key)], FEATURE: feature };
      if (c.status === 'merged') {
        ctx.audit({ action: 'EXT_MR_MERGED', target: c.key, actorId: systemActor('GITLAB').id, actorRole: 'SYSTEM' as Role, after: { feature, sha: c.extra.sha, targetBranch: c.extra.targetBranch, by: c.externalUser }, componentId: 'D05-01' });
        ctx.emit('ext.mr.merged', c.key, { key: c.key, feature, sha: c.extra.sha, by: c.externalUser }, { componentId: 'D05-01' });
      }
      return { outcome: 'APPLIED', summary: `MR ${c.key} ${c.status}${feature ? ` · ${feature}` : ' · Feature 참조 없음'}` };
    }
    case 'PIPELINE': {
      const mrKey = (c.extra.mrKey as string | null) ?? null;
      const mr = mrKey ? (await itemsOf(ctx, 'GITLAB')).find((x) => x.key === mrKey) : undefined;
      if (c.status !== 'success' || !mr || mr.status !== 'merged') return { outcome: 'APPLIED', summary: `파이프라인 ${c.key} ${c.status}` };
      const sw = /\b(SW-[A-Z0-9-]+)@(\d+\.\d+\.\d+)\b/.exec(String(mr.body ?? ''));
      const sha = String(mr.fields.sha ?? c.extra.sha ?? '');
      if (!sw || !/^[0-9a-f]{7,40}$/.test(sha)) return { outcome: 'APPLIED', summary: `파이프라인 ${c.key} 성공 · SW 변경 기록 없음(MR 본문에 SW-…@버전 없음)` };
      const iid = mr.key.split('!').pop();
      const url = extUrl('GITLAB', 'PIPELINE', c.key);
      {
        const rec = await simInvoke<{ changeId: string; rev: number }>(ctx, 'registerChangeRecord', {
          body: { changeId: `CHG-GL-${iid}`, swId: sw[1], swVersion: sw[2], commit: sha, summary: mr.title.slice(0, 300), aiGenerated: null, evidence: { review: extUrl('GITLAB', 'MERGE_REQUEST', mr.key), staticAnalysis: `${url}#static-analysis`, tests: url, coverage: typeof c.extra.coverage === 'number' && Number.isFinite(c.extra.coverage) ? { achieved: c.extra.coverage, required: 80 } : null } },
          actor: systemActor('GITLAB'),
        });
        return { outcome: 'APPLIED', summary: `파이프라인 ${c.key} 성공 → 변경 기록 ${rec.changeId} r${rec.rev}` };
      }
    }
  }
  return { outcome: 'IGNORED', summary: '이 연계와 무관한 이벤트' };
}

/** 서명 webhook 받기 — 받은 함에 남기고, 거부·매핑 없음은 이벤트로 알린다 */
async function deliver(ctx: SimWriteContext, it: MockItem, prev: MockItem | null, fromStatus: string | null, action = ''): Promise<InboxRow> {
  const c = changeOf(it, fromStatus);
  const r = await apply(ctx, c, prev, it);
  const seq = ctx.state<{ n: number }>('extInboxSeq', () => ({ n: 0 }));
  seq.n += 1;
  const deliveryId = `${it.system}:${it.key}:${it.revision}:${action}`.replace(/[^A-Za-z0-9]/g, '').slice(-32);
  const row: InboxRow = { system: it.system, deliveryId, receivedAt: ctx.iso(), key: c.key, outcome: r.outcome, summary: r.summary, externalUser: c.externalUser };
  ctx.put(INBOX, `${seq.n}`, row, { created: true });
  if (r.outcome === 'REJECTED' || r.outcome === 'UNMAPPED') ctx.emit('ext.change.rejected', c.key, { system: it.system, key: c.key, outcome: r.outcome, summary: r.summary, externalUser: c.externalUser }, { componentId: 'D05-01' });
  return row;
}
const resultOf = (row: InboxRow | null) => (row ? { system: row.system, deliveryId: row.deliveryId, receivedAt: row.receivedAt, key: row.key, outcome: row.outcome, summary: row.summary, externalUser: row.externalUser, duplicate: false } : null);

// ─── 경로 ─────────────────────────────────────────────────
/** New browser drafts have no build-time snapshot. Show only actually stored mock links, never synthesize an Epic or approval. */
export async function registrationTrace(ctx: SimReadContext) {
  const { id, ver } = ctx.req.params;
  const row = ctx.get<{ row: { featureId: string; version: string; lifecycle: Lifecycle; requirementIds: string[] } }>('regFeature', fid(id, ver))?.row;
  if (!row || await ctx.snapshot()) return undefined;
  const target = fid(id, ver);
  const L = (ctx.overlay.data[LINKS] ?? {}) as Links;
  const observed = ctx.list<MockItem>(ITEM).filter((item) => L[idOf(item.system, item.key)]?.FEATURE === target);
  const asLink = (item: MockItem) => ({ system: item.system, key: item.key, kind: item.kind, title: item.title, url: extUrl(item.system, item.kind, item.key), status: item.status, revision: item.revision, syncState: 'SYNCED', extra: item.fields });
  const epic = observed.find((item) => item.system === 'JIRA' && item.kind === 'EPIC');
  const requirements = (await itemsOf(ctx, 'CODEBEAMER')).filter((item) => item.kind === 'REQUIREMENT' && row.requirementIds.includes(String(item.fields.reqId))).map(asLink);
  return { featureId: id, version: ver, lifecycle: row.lifecycle, epicStatusExpected: JIRA_EPIC_STATUS[row.lifecycle], requirements, missingRequirements: row.requirementIds.filter((reqId) => !requirements.some((item) => item.extra.reqId === reqId)), epic: epic ? asLink(epic) : null, changeRequests: observed.filter((item) => item.kind === 'CHANGE_REQUEST').map(asLink), defects: observed.filter((item) => item.kind === 'DEFECT').map(asLink), stories: [], mergeRequests: observed.filter((item) => item.kind === 'MERGE_REQUEST').map(asLink), pipelines: observed.filter((item) => item.kind === 'PIPELINE').map(asLink), policies: [], conflicts: [], stale: [] };
}
registerSimReader('extFeatureTrace', registrationTrace);

registerSimReader('mockExtItems', async (ctx) => {
  if (!ctx.list(ITEM).length) return undefined;
  const system = systemOf(ctx, ctx.req.params.system);
  const kind = ctx.req.query.kind as ExtKind | undefined;
  return { items: (await itemsOf(ctx, system)).filter((x) => !kind || x.kind === kind).map(view) };
});

registerSimReader('extInbox', async (ctx) => {
  const mine = ctx.list<InboxRow>(INBOX);
  if (!mine.length) return undefined;
  const { system, outcome } = ctx.req.query;
  const base = (await ctx.snapshot<{ items: InboxRow[] }>('extInbox', {}, {}))?.items ?? [];
  const fresh = (ctx.overlay.created[INBOX] ?? []).map((k) => ctx.overlay.entities[INBOX]?.[k] as InboxRow).filter(Boolean);
  return { items: [...fresh, ...base].filter((r) => (!system || r.system === system.toUpperCase()) && (!outcome || r.outcome === outcome)).slice(0, 300) };
});

/** Feature별 Epic — 바깥에서 바뀐 Epic 상태(플랫폼이 관측한 값)와 새로 연결된 Epic */
registerSimReader('extFeatureEpics', async (ctx) => {
  const changed = ctx.list<MockItem>(ITEM).filter((x) => x.system === 'JIRA' && x.kind === 'EPIC');
  if (!changed.length) return undefined;
  const base = (await ctx.snapshot<{ items: { feature: string; key: string; url: string; status: string; syncState: string; expected: string | null }[] }>())?.items ?? [];
  const byKey = new Map(changed.map((x) => [x.key, x]));
  const L = (ctx.overlay.data[LINKS] ?? {}) as Links;
  const items = base.map((e) => (byKey.has(e.key) ? { ...e, status: byKey.get(e.key)!.status } : e));
  for (const it of changed) {
    const feature = L[idOf('JIRA', it.key)]?.FEATURE;
    if (feature && !items.some((e) => e.feature === feature)) items.push({ feature, key: it.key, url: extUrl('JIRA', 'EPIC', it.key), status: it.status, syncState: 'SYNCED', expected: it.status });
  }
  return { items };
});

registerSimHandler(
  'mockExtAct',
  async (ctx) => {
    const system = systemOf(ctx, ctx.req.params.system);
    const body = ctx.req.body as MockExtActionBody;
    const it = (await itemsOf(ctx, system)).find((x) => x.key === body.key);
    if (!it) return ctx.fail('NOT_FOUND', `${system} ${body.key}이(가) 없습니다.`);
    const from = it.status;
    let next: MockItem;
    let action = '';
    if (body.action === 'TRANSITION') {
      if (!body.status) ctx.fail('VALIDATION', '새 상태(status)가 필요합니다.');
      next = update(ctx, it, body.externalUser, { status: body.status });
    } else if (body.action === 'COMMENT') {
      if (!body.comment?.trim() || body.comment.trim().length > 2000) ctx.fail('VALIDATION', '댓글은 1~2000자로 입력하세요.');
      next = update(ctx, it, body.externalUser, { comment: body.comment!.trim() });
    } else if (body.action === 'EDIT') {
      next = update(ctx, it, body.externalUser, { title: body.title, body: body.body, ...(body.scope ? { fields: { scope: { ...((it.fields.scope ?? {}) as Record<string, unknown>), ...body.scope } } } : {}) });
    } else if (body.action === 'MERGE') {
      if (it.kind !== 'MERGE_REQUEST') ctx.fail('VALIDATION', 'MR만 병합할 수 있습니다.');
      next = update(ctx, it, body.externalUser, { status: 'merged' });
      action = 'merge';
    } else {
      if (it.kind !== 'MERGE_REQUEST') ctx.fail('VALIDATION', '파이프라인은 MR에 돌립니다.');
      const pl = await create(ctx, 'GITLAB', 'PIPELINE', { title: `pipeline ${it.fields.sourceBranch}`, status: body.status ?? 'success', by: body.externalUser, fields: { sha: it.fields.sha, ref: it.fields.sourceBranch, mrKey: it.key, mrTitle: it.title, coverage: body.coverage ?? null } });
      const row = body.deliver ? await deliver(ctx, pl, null, null) : null;
      return { item: view((await itemsOf(ctx, 'GITLAB')).find((x) => x.key === pl.key) ?? pl), result: resultOf(row) };
    }
    const row = body.deliver ? await deliver(ctx, next, it, from, action) : null;
    return { item: view((await itemsOf(ctx, system)).find((x) => x.key === it.key) ?? next), result: resultOf(row) };
  },
  { body: MockExtActionBody },
);

registerSimHandler(
  'mockExtCreate',
  async (ctx) => {
    const system = systemOf(ctx, ctx.req.params.system);
    const body = ctx.req.body as MockExtCreateBody;
    const kind = body.kind;
    const status = system === 'JIRA' ? (kind === 'EPIC' ? JIRA_EPIC_STATUS.PROPOSED : JIRA_CR_STATUS.OPEN) : system === 'GITLAB' ? 'opened' : 'Draft';
    const fields: Record<string, unknown> = { ...(body.scope ? { scope: body.scope } : {}) };
    if (system === 'GITLAB') {
      const hex = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const r = parseRefs(`${body.title}\n${body.body}`);
      fields.sha = hex;
      fields.sourceBranch = r.featureId ? `feature/${r.featureId.toLowerCase()}${r.version ? `-${r.version}` : ''}-${hex.slice(0, 6)}` : `feature/${body.title.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase()}`;
      fields.targetBranch = 'main';
    }
    const it = await create(ctx, system, kind, { title: body.title, body: body.body, status, by: body.externalUser, fields });
    const row = await deliver(ctx, it, null, null, 'open');
    return { item: view((await itemsOf(ctx, system)).find((x) => x.key === it.key) ?? it), result: resultOf(row) };
  },
  { body: MockExtCreateBody },
);

// ═══ D04-01 변경 기록(IF-13) — CI/CD 등록, 추가만(서버 change-record.service) ═══════════════
// GitLab 파이프라인 성공(병합된 MR, 본문 SW-…@버전)이 이 경로로 변경 기록을 남긴다. 개정은 근거 보완만 — 다른 SW Version으로 옮길 수 없다.
type ChangeRecord = ChangeRecordBody & { registeredBy: string; rev: number; at: string; findings: string[] };
const CHG = 'changeRecord';
const latestChange = async (ctx: SimReadContext): Promise<ChangeRecord[]> => {
  const base = ((await ctx.snapshot<{ items: ChangeRecord[] }>('changeRecords', {}, {}))?.items ?? []) as ChangeRecord[];
  const mine = new Map(ctx.list<ChangeRecord>(CHG).map((c) => [c.changeId, c]));
  const rows = [...base.filter((c) => !mine.has(c.changeId)), ...mine.values()];
  // 서버 ORDER BY at DESC, change_id DESC
  return rows.sort((a, b) => b.at.localeCompare(a.at) || b.changeId.localeCompare(a.changeId));
};

registerSimReader('changeRecords', async (ctx) => {
  if (!ctx.list(CHG).length) return undefined;
  const swId = ctx.req.query.swId;
  const items = (await latestChange(ctx)).filter((c) => !swId || c.swId === swId).map((c) => ({ ...c, findings: changeRecordFindings(c) }));
  const ai = items.filter((x) => x.aiGenerated);
  return { items, summary: { total: items.length, aiGenerated: ai.length, aiComplete: ai.filter((x) => !x.findings.length).length, withFindings: items.filter((x) => x.findings.length).length } };
});

registerSimHandler(
  'registerChangeRecord',
  async (ctx) => {
    const body = ctx.req.body as ChangeRecordBody;
    const prev = (await latestChange(ctx)).find((c) => c.changeId === body.changeId);
    if (prev && (prev.swId !== body.swId || prev.swVersion !== body.swVersion)) ctx.fail('CONFLICT', `${body.changeId}은(는) ${prev.swId} ${prev.swVersion}의 변경입니다.`);
    const rev = (prev?.rev ?? 0) + 1;
    const at = ctx.iso();
    const findings = changeRecordFindings(body);
    ctx.put(CHG, body.changeId, { ...body, registeredBy: ctx.actor.id, rev, at, findings } satisfies ChangeRecord, { created: true });
    ctx.audit({ action: 'CHANGE_RECORD', target: body.changeId, after: { rev, swId: body.swId, swVersion: body.swVersion, aiGenerated: body.aiGenerated, findings }, componentId: 'D04-01' });
    ctx.emit('change.recorded', body.changeId, { swId: body.swId, swVersion: body.swVersion, ai: !!body.aiGenerated, findings }, { componentId: 'D04-01' });
    return { ...body, rev, at, findings };
  },
  { body: ChangeRecordBody },
);
