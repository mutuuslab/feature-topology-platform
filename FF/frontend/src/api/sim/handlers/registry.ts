// 시연 흐름 — Feature Registry·Lifecycle·Gate·안전 분류·분석 근거·Release Sign-off·Baseline(D01-01·D01-02), Feature DB 변경 요청(D01-01),
// 업무 절차 활동 완료(D04-04). 서버 registry·lifecycle·gate·safety-profile·analysis-evidence·release-signoff·baseline·refdb-change·
// request-add·procedure 서비스와 같은 순서·오류(contracts 순수 규칙 evaluateTransition·gateStageBlocker·gateEvidenceBlockers·checkProfile·
// refChangeDuty·checkRegistration·readyActivityIds)로 처리한다. 서버만 아는 값(서명·순번·해시)은 결정적으로 합성한다(설계 20-60 §2).
import {
  ANALYSIS_AUTHOR_ROLE,
  ANALYSIS_LABEL,
  asilInheritance,
  autoTransition,
  BASELINE_ELIGIBLE,
  BaselineDecisionBody,
  BaselineRequestBody,
  blocking,
  blockingFailures,
  bumpVersion,
  canonicalJson,
  changedKeys,
  checkProfile,
  checkRegistration,
  compareVersion,
  CreateDependencyBody,
  CreateFeatureBody,
  codeRemovalDue,
  CreateRefChangeBody,
  CreateVersionBody,
  DecideRefChangeBody,
  decisionPayload,
  decisionUsable,
  domainAbbrOf,
  domainOfAbbr,
  evaluateTransition,
  featureRefsProblems,
  fRank,
  G7SignoffBody,
  GATE_META,
  gateEvidenceBlockers,
  GATES,
  gateStageBlocker,
  gateStatusOf,
  gatesToRejudge,
  HaraBody,
  HomologationBody,
  inferFClass,
  jcs,
  judgeDependency,
  JudgeGateBody,
  LIFECYCLE_RANK,
  LOCKED_AFTER_CONFIRM,
  nextRefId,
  nextTransitions,
  predecessorsOf,
  ProcedureCompleteBody,
  procedureGatesFor,
  PublishRefReleaseBody,
  readyActivityIds,
  RecordSourceReviewBody,
  REF_MONEY_FIELDS,
  REF_PENDING_APPROVED,
  REF_STATUS_POLICY,
  refAttrMissing,
  refChangeDuty,
  REHARA_BLOCKED_GATES,
  REHARA_LABEL,
  ReleaseSignoffBody,
  RETIREMENT_STEPS,
  retirementApprovers,
  retirementBlocker,
  RetirementRequestBody,
  RetirementStepBody,
  RequestRefAddBody,
  ReviewRefChangeBody,
  ROLE_LABEL,
  SafetyConfirmBody,
  SafetyProfile,
  SafetyProfilePatch,
  SCOPE_KEYS,
  securityRelevance,
  snapshotContent,
  snapshotDiff,
  SotifBody,
  TaraBody,
  TransitionBody,
  UpdateDraftBody,
  validateNewDependency,
  type AnalysisKind,
  type FeatureVersionRow,
  type GateId,
  type Lifecycle,
  type TransitionContext,
  type WorkflowIndexDoc,
} from '@ff/contracts';
import { z } from 'zod';
import { registerSimHandler, registerSimReader } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';
import { demoSign } from './kill';
import { signLocalGate } from '../gate-signatures';

// ─── 컬렉션·키 ─────────────────────────────────────────────
const FEATURE = 'regFeature'; // `${id}@${ver}` → { row, meta }
const SAFETY = 'regSafety'; // `${id}@${ver}` → SafetyProfile
const SIGNOFF = 'regSignoff'; // `${id}@${ver}` → ReleaseSignoff(최신)
const BREQ = 'regBaselineReq'; // requestId → BaselineRequest
const BASELINE = 'regBaseline'; // baselineId → BaselineRecord
const CHANGE = 'refChange'; // changeId → RefChange
const REF = 'refRow'; // refId → FeatureRefRow
const DEP = 'regDependency'; // dependencyId → DependencyRow(시연 등록·재판정)
/** 시연 Gate 결정 서명 키(서버 HSM 'gate' 용도 키 대신) — 이 브라우저의 결정적 서명이다(설계 20-60 §5) */
export const GATE_KID = 'KEY-0910';
/** 승인자 개인 서명 키 ID — 서버 HSM 승인 키와 같은 이름 규칙 */
const apr = (userId: string) => `APR-${userId}`;
const fkey = (id: string, ver: string) => `${id}@${ver}`;
const pad = (n: number, w = 5) => String(n).padStart(w, '0');
const kst = (d: Date) => `${new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 19)}+09:00`;
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const SYSTEM_ACTOR = { actorId: 'system:registry', actorRole: 'SYSTEM' };

type Row = FeatureVersionRow & Record<string, any>;
interface FeatureEntity {
  row: Row;
  meta: { createdBy: string | null; createdAt: string | null };
}
interface GateEntry {
  record: any;
  decision: { payload: any; signature: { alg: 'EdDSA'; kid: string; value: string }; signedAt: string };
}

const isWrite = (ctx: SimReadContext): ctx is SimWriteContext => typeof (ctx as SimWriteContext).state === 'function';
/** 도메인 상태 — 쓰기 중이면 반영 전 사본(같은 핸들러 안에서 바꾼 것까지), 읽기면 반영된 값 */
function data<T>(ctx: SimReadContext, key: string, init: () => T): T {
  return isWrite(ctx) ? ctx.state<T>(key, init) : ((ctx.overlay.data[key] as T | undefined) ?? init());
}

// ─── Feature 읽기 ──────────────────────────────────────────
async function featureOf(ctx: SimReadContext, id: string, ver: string): Promise<FeatureEntity | null> {
  const mine = ctx.get<FeatureEntity>(FEATURE, fkey(id, ver));
  if (mine) return structuredClone(mine);
  const d = await ctx.snapshot<any>('featureDetail', { id, ver });
  return d?.feature ? { row: d.feature, meta: d.meta ?? { createdBy: null, createdAt: null } } : null;
}
async function requireFeature(ctx: SimWriteContext, id: string, ver: string): Promise<FeatureEntity> {
  const f = await featureOf(ctx, id, ver);
  if (!f) ctx.fail('NOT_FOUND', `${id} ${ver}을(를) 찾을 수 없습니다.`);
  return f!;
}
/** 목록 요약(서버 RegistryService.summary와 같은 칸) */
async function summaryOf(ctx: SimReadContext, f: Row, latestVersion: string) {
  const g = await gateLatest(ctx, f.featureId, f.version);
  return {
    featureId: f.featureId,
    version: f.version,
    isLatest: f.version === latestVersion,
    name: f.name,
    country: f.country,
    vehicleModel: f.vehicleModel,
    trim: f.trim,
    lifecycle: f.lifecycle,
    baselineId: f.baselineId,
    ownerId: f.ownerId,
    asil: f.asil,
    tags: f.tags,
    controlPoints: f.controlPoints,
      taxonomyLevel: f.taxonomyLevel ?? 'L2',
    featureRefCount: (f.featureRefs ?? []).length,
    gates: Object.fromEntries(Object.entries(g).map(([k, r]) => [k, (r as any).status])),
  };
}
/** 모든 Feature Version 요약 — 스냅샷 전체 목록 + 시연에서 바뀐·새로 만든 것. featureId·Version 오름차순(서버 all()) */
async function allSummaries(ctx: SimReadContext): Promise<any[]> {
  const base: any[] = (await ctx.snapshot<any>('listFeatures', {}, { latestOnly: false }))?.items ?? [];
  const mine = ctx.list<FeatureEntity>(FEATURE);
  const rows = new Map<string, any>(base.map((s) => [fkey(s.featureId, s.version), s]));
  const latest = new Map<string, string>();
  for (const k of [...rows.keys(), ...mine.map((e) => fkey(e.row.featureId, e.row.version))]) {
    const [id, v] = k.split('@');
    if (!latest.has(id) || compareVersion(v, latest.get(id)!) > 0) latest.set(id, v);
  }
  const touched = new Set(Object.keys(data<Record<string, GateEntry[]>>(ctx, 'regGates', () => ({}))));
  for (const e of mine) rows.set(fkey(e.row.featureId, e.row.version), await summaryOf(ctx, e.row, latest.get(e.row.featureId)!));
  for (const [k, s] of rows) {
    if (!mine.some((e) => fkey(e.row.featureId, e.row.version) === k) && touched.has(k)) rows.set(k, { ...s, gates: (await summaryOf(ctx, s, latest.get(s.featureId)!)).gates });
    rows.set(k, { ...rows.get(k), isLatest: rows.get(k).version === latest.get(rows.get(k).featureId) });
  }
  return [...rows.values()].sort((a, b) => (a.featureId === b.featureId ? compareVersion(a.version, b.version) : a.featureId < b.featureId ? -1 : 1));
}

// ─── Gate 기록 ─────────────────────────────────────────────
const gateLog = (ctx: SimReadContext, key: string): GateEntry[] => data<Record<string, GateEntry[]>>(ctx, 'regGates', () => ({}))[key] ?? [];
/** Gate별 최신 기록 — 스냅샷 상세 + 시연 판정 */
async function gateLatest(ctx: SimReadContext, id: string, ver: string): Promise<Partial<Record<GateId, any>>> {
  const d = await ctx.snapshot<any>('featureDetail', { id, ver });
  const out: Partial<Record<GateId, any>> = { ...(d?.gates ?? {}) };
  for (const e of gateLog(ctx, fkey(id, ver))) out[e.record.gate as GateId] = e.record;
  return out;
}
const statusesOf = (g: Partial<Record<GateId, any>>) => Object.fromEntries(Object.entries(g).map(([k, r]) => [k, r?.status])) as Partial<Record<GateId, any>>;
/** 결정 서명이 전이 근거가 되지 못하는 Gate(FFG-LCY-001) — 시연 판정은 서명됨, 스냅샷은 그때의 검증 결과 */
async function unsignedOf(ctx: SimReadContext, id: string, ver: string): Promise<Partial<Record<GateId, string>>> {
  const view = await ctx.snapshot<any>('gates', { id, ver });
  const mine = new Set(gateLog(ctx, fkey(id, ver)).map((e) => e.record.gate));
  const out: Partial<Record<GateId, string>> = {};
  for (const g of view?.gates ?? []) {
    if (mine.has(g.gate) || !g.latest) continue;
    if (!g.decision || !decisionUsable(g.decision.state)) out[g.gate as GateId] = g.decision?.reason ?? `${g.latest.gateRecordId}: 서명된 Decision Record가 없습니다`;
  }
  return out;
}
/** 열린 재-HARA 요청 — 시연 G2 PASS가 닫은 것은 뺀다 */
async function openRehara(ctx: SimReadContext, id: string, ver: string) {
  const view = await ctx.snapshot<any>('gates', { id, ver });
  const closed = new Set(data<Record<string, string[]>>(ctx, 'regReharaClosed', () => ({}))[fkey(id, ver)] ?? []);
  return ((view?.rehara ?? []) as any[]).filter((r) => r.status === 'OPEN' && !closed.has(r.requestId));
}
/** 시연 Gate 기록 번호 — 스냅샷 Evidence 원장·이 Version 기록 다음(서버 gate_record 전체 최대 + 1) */
async function nextGateRecordId(ctx: SimWriteContext, gate: GateId, id: string, ver: string): Promise<string> {
  const ledger = (await ctx.snapshot<any>('evidenceLedger'))?.items ?? [];
  const view = await ctx.snapshot<any>('gates', { id, ver });
  const ids = [...ledger.map((e: any) => e.gateRecordId), ...(view?.gates ?? []).flatMap((g: any) => (g.history ?? []).map((h: any) => h.gateRecordId))].filter(Boolean);
  const top = ids.reduce((m: number, x: string) => Math.max(m, Number(/-(\d{6})$/.exec(x)?.[1] ?? 0)), 0);
  const k = 'id:SIMGATE';
  const n = Math.max(ctx.state<Record<string, number>>('regSeq', () => ({}))[k] ?? 0, top) + 1;
  ctx.state<Record<string, number>>('regSeq', () => ({}))[k] = n;
  return `SIM-${gate}-${pad(n, 6)}`;
}

// ─── Feature DB 기준 행 ────────────────────────────────────
async function refOf(ctx: SimReadContext, refId: string): Promise<any | null> {
  const mine = ctx.get<any>(REF, refId);
  if (mine) return mine;
  return (await ctx.snapshot<any>('refDetail', { refId }))?.ref ?? null;
}
/** Feature DB 전체 행 — 화면 검색용 전체 목록 쪽(200개씩) + 시연에서 바뀐·추가 요청한 행 */
async function allRefs(ctx: SimReadContext): Promise<any[]> {
  const out = new Map<string, any>();
  for (let offset = 0; ; offset += 200) {
    const page = await ctx.snapshot<any>('listRefs', {}, { offset: offset || undefined, limit: 200 });
    for (const r of page?.items ?? []) out.set(r.refId, r);
    if (!page || offset + 200 >= (page.total ?? 0)) break;
  }
  for (const r of ctx.list<any>(REF)) out.set(r.refId, r);
  return [...out.values()];
}
async function refChanges(ctx: SimReadContext): Promise<any[]> {
  const base: any[] = (await ctx.snapshot<any>('listRefChanges'))?.items ?? [];
  const mine = new Map(ctx.list<any>(CHANGE).map((c) => [c.changeId, c]));
  return [...base.filter((c) => !mine.has(c.changeId)), ...mine.values()];
}
const usedRefIds = async (ctx: SimReadContext) => [...new Set([...(await allRefs(ctx)).map((r) => r.refId), ...(await refChanges(ctx)).map((c) => c.refId)])];
const sourceIds = async (ctx: SimReadContext) => ((await ctx.snapshot<any>('refSources'))?.items ?? []).map((s: any) => s.sourceId);
const taxonomy = async (ctx: SimReadContext): Promise<any[]> => [...((await ctx.snapshot<any>('refTaxonomy'))?.items ?? []), ...data<any[]>(ctx, 'refTaxonomyAdded', () => [])];
const latestRelease = async (ctx: SimReadContext): Promise<string> => {
  const mine = data<any[]>(ctx, 'refReleases', () => []);
  if (mine.length) return mine[mine.length - 1].release;
  const base = await ctx.snapshot<any>('refReleases');
  return base?.items?.[0]?.release ?? base?.latest?.release ?? 'v1.3';
};

// ─── 기준 행 연결(서버 FeatureRefLinker) ───────────────────
interface RefWarning {
  code: string;
  refId: string;
  message: string;
  status?: string;
  replacedBy?: string | null;
}
async function statusWarnings(ctx: SimReadContext, links: readonly { refId: string }[] | undefined, statuses: readonly string[], next: string): Promise<RefWarning[]> {
  const out: RefWarning[] = [];
  for (const l of links ?? []) {
    const row = await refOf(ctx, l.refId);
    if (!row || !statuses.includes(row.status)) continue;
    const policy = (REF_STATUS_POLICY as any)[row.status];
    const replaced = row.replacedBy ? ` 대체 행: ${row.replacedBy}.` : '';
    const memo = row.status === 'REVIEW' && row.adminMemo ? ` (관리 메모: ${row.adminMemo})` : '';
    out.push({ code: 'REF_STATUS', refId: l.refId, status: row.status, replacedBy: row.replacedBy ?? null, message: `기준 행 ${l.refId}은(는) ${policy.ko} 상태입니다 — ${policy.hint}${memo}${replaced} ${next}` });
  }
  return out;
}

const LINK_REQUIRED = '기준 기능(Feature DB)을 연결하세요 — 대표(PRIMARY) 기준 행이 하나 있어야 등록할 수 있습니다. 맞는 행이 없으면 Feature DB에 추가를 요청하세요.';

/** 연결 검증 — 막는 위반은 ctx.fail, 나머지는 경고 */
async function resolveRefs(
  ctx: SimWriteContext,
  req: { featureRefs?: readonly { refId: string; role: string }[]; previous?: readonly { refId: string; refVersion: string }[]; asil: string; asilDeviation?: any; scope: { country: string; vehicleModel: string; trim: string }; featureId?: string; duplicate: 'reject' | 'warn'; confirmDuplicate?: boolean; duplicateReason?: string },
  failAudit: (reason: string) => { action: string; target: string; reason: string; componentId: string },
) {
  const links = req.featureRefs ?? [];
  const problems = featureRefsProblems(links as any);
  const fail = (code: string, msg: string, details?: unknown): never => ctx.fail(code, msg, details, failAudit(`기준 기능 연결: ${msg}`));
  if (!links.length || !links.some((l) => l.role === 'PRIMARY')) fail('REFDB_LINK_REQUIRED', LINK_REQUIRED, { field: 'featureRefs', problems });
  if (problems.length) fail('VALIDATION', problems.join(' '), { field: 'featureRefs', problems });
  const rows = new Map<string, any>();
  const unknown: string[] = [];
  for (const l of links) {
    const row = await refOf(ctx, l.refId);
    if (row) rows.set(l.refId, row);
    else unknown.push(l.refId);
  }
  if (unknown.length) fail('VALIDATION', `Feature DB에 없는 기준 행입니다: ${unknown.join(', ')} — 검색해서 고르거나 추가를 요청하세요.`, { field: 'featureRefs', refIds: unknown });
  const retired = links.filter((l) => rows.get(l.refId).status === 'RETIRED');
  if (retired.length) fail('VALIDATION', retired.map((l) => `기준 행 ${l.refId}은(는) ${REF_STATUS_POLICY.RETIRED.ko} 상태라 연결할 수 없습니다 — ${REF_STATUS_POLICY.RETIRED.hint}`).join(' '), { field: 'featureRefs', refIds: retired.map((l) => l.refId) });
  const primaryLink = links.find((l) => l.role === 'PRIMARY')!;
  const primary = rows.get(primaryLink.refId);
  let asilDeviation = req.asilDeviation;
  if (req.asil === primary.asilRep) asilDeviation = undefined;
  else if (!asilDeviation || asilDeviation.from !== primary.asilRep || asilDeviation.to !== req.asil)
    fail('VALIDATION', `ASIL ${req.asil}이(가) 대표 기준 행 ${primary.refId}의 대표 ASIL ${primary.asilRep}과(와) 다릅니다 — 사유(asilDeviation: from ${primary.asilRep}, to ${req.asil}, reason)를 입력하세요. 기능안전 담당자가 G2에서 검토합니다.`, { field: 'asilDeviation', from: primary.asilRep, to: req.asil, refId: primary.refId });
  const warnings: RefWarning[] = [];
  for (const l of links) {
    const row = rows.get(l.refId);
    const policy = (REF_STATUS_POLICY as any)[row.status];
    if (!policy.warn) continue;
    const extra = row.status === 'REVIEW' && row.adminMemo ? ` (관리 메모: ${row.adminMemo})` : row.status === 'DEPRECATED' && row.replacedBy ? ` 대체 행: ${row.replacedBy}` : '';
    warnings.push({ code: 'REF_STATUS', refId: l.refId, status: row.status, message: `기준 행 ${l.refId}은(는) ${policy.ko} 상태입니다 — ${policy.hint}${extra}` });
  }
  // 같은 범위에서 같은 대표 기준 행을 쓰는 Feature — 대표 행의 '이 행을 쓰는 Feature'(Feature마다 최신 버전, 폐기 제외) + 시연에서 만든 것
  const inScope = (f: { country?: string; vehicleModel?: string; trim?: string }) => f.country === req.scope.country && f.vehicleModel === req.scope.vehicleModel && f.trim === req.scope.trim;
  const users: any[] = [...((await ctx.snapshot<any>('refDetail', { refId: primary.refId }))?.usedBy ?? [])];
  for (const e of ctx.list<FeatureEntity>(FEATURE)) for (const l of e.row.featureRefs ?? []) if (l.refId === primary.refId) users.push({ ...e.row, role: l.role, lifecycle: e.row.lifecycle });
  const latest = new Map<string, any>();
  for (const u of users.filter((u) => u.role === 'PRIMARY' && u.featureId !== req.featureId && inScope(u))) if (!latest.has(u.featureId) || compareVersion(u.version, latest.get(u.featureId).version) > 0) latest.set(u.featureId, u);
  const duplicates = [...latest.values()].filter((u) => u.lifecycle !== 'RETIRED').map((u) => ({ featureId: u.featureId, version: u.version, name: u.name }));
  if (duplicates.length) {
    const list = duplicates.map((d) => `${d.featureId}@${d.version} ${d.name}`).join(', ');
    if (req.duplicate === 'reject' && !(req.confirmDuplicate && req.duplicateReason?.trim()))
      fail('REFDB_DUPLICATE_IN_SCOPE', `같은 국가·차종·트림에 대표 기준 행 ${primary.refId}을(를) 쓰는 Feature가 이미 있습니다: ${list}. 같은 기능의 변형(하드웨어 차이 등)이면 확인하고 사유를 적어 다시 등록하세요.`, { refId: primary.refId, features: duplicates, hint: 'confirmDuplicate: true와 duplicateReason을 함께 보내면 등록합니다.' });
    warnings.push({ code: req.duplicate === 'reject' ? 'REF_DUPLICATE_CONFIRMED' : 'REF_DUPLICATE', refId: primary.refId, message: `같은 범위에 대표 기준 행 ${primary.refId}을(를) 쓰는 Feature가 있습니다: ${list}${req.duplicate === 'reject' ? ` — 확인 사유: ${req.duplicateReason!.trim()}` : ''}` });
  }
  const release = await latestRelease(ctx);
  const prev = new Map((req.previous ?? []).map((l) => [l.refId, l.refVersion]));
  const ordered = [primaryLink, ...links.filter((l) => l !== primaryLink)];
  return { featureRefs: ordered.map((l) => ({ refId: l.refId, role: l.role, refVersion: prev.get(l.refId) ?? release })), primary, asilDeviation, warnings, duplicates };
}
const regulationsOf = (ref: any): string[] => [ref.definition?.regulations ?? '', ref.sourceDetail ?? ''].map((s: string) => s.trim()).filter(Boolean);
const refAuditDetail = (linked: { warnings: RefWarning[]; asilDeviation?: any; duplicates: unknown[] }, duplicateReason?: string) => ({
  refWarnings: linked.warnings,
  ...(linked.asilDeviation ? { asilDeviationReview: 'G2' } : {}),
  ...(duplicateReason && linked.duplicates.length ? { duplicateConfirmed: { reason: duplicateReason, of: linked.duplicates } } : {}),
});

// ─── 안전 분류 ─────────────────────────────────────────────
function inferProfile(asil: string, swClasses: string[], country: string): SafetyProfile {
  const fClass = inferFClass(asil, swClasses);
  const r = fRank(fClass);
  const dc = r === 0 ? 'DC0' : r === 1 ? 'DC1' : 'DC2';
  return SafetyProfile.parse({
    featureId: 'FEAT-00000', version: '0.0.0', status: 'DRAFT', source: 'INFERRED',
    fClass, deactClass: dc, regClass: r >= 2 ? 'R1' : 'R0', flagType: r >= 2 ? 'OPS' : 'RELEASE',
    adsFeature: false, adsfType: null, gsrMandatory: false, itemIds: [], haraRef: null,
    asilRef: ['QM', 'A', 'B', 'C', 'D'].includes(asil) ? asil : 'QM', safetyGoalIds: [],
    safeState: r >= 2 ? 'BASE_ONLY' : null, endState: r >= 2 ? 'DISABLED' : null,
    takeoverMs: dc === 'DC2' ? 4000 : 0, rampMs: dc === 'DC2' ? 3000 : 0, faultRampMs: r >= 2 ? 1500 : 0, faultTolerantTimeMs: r >= 2 ? 5000 : 0,
    maxPendingMs: dc === 'DC1' ? 600000 : 0, maxCycleWaitMs: dc === 'DC0' ? 0 : 28800000,
    maxActivationScope: { vehicles: 50000, perWindow: 5000 }, markets: [country], rxswin: [],
    approvalProfile: null, evidenceManifestId: null, sbomRef: null, rollbackTarget: null, expiresAt: null, retirementPlan: null,
    confirmedBy: null, confirmedAt: null, confirmSig: null,
  });
}
/** 안전 분류 — 시연 값 → 스냅샷 → 초안(기준 Version을 잇거나 추정, 서버 ensure) */
async function safetyOf(ctx: SimReadContext, id: string, ver: string, baseVersion?: string): Promise<SafetyProfile> {
  const mine = ctx.get<SafetyProfile>(SAFETY, fkey(id, ver));
  if (mine) return structuredClone(mine);
  const snap = (await ctx.snapshot<any>('safetyProfile', { id, ver }))?.profile;
  if (snap) return snap;
  const f = await featureOf(ctx, id, ver);
  const prev = baseVersion && baseVersion !== ver ? await safetyOf(ctx, id, baseVersion) : null;
  const sw: any[] = f?.row.swIds?.length ? ((await ctx.snapshot<any>('masterSw'))?.items ?? []) : [];
  const swClasses = (f?.row.swIds ?? []).map((s) => sw.find((x) => x.swId === s)?.safetyClass).filter(Boolean) as string[];
  const base = prev ?? inferProfile(f?.row.asil ?? 'QM', swClasses, f?.row.country ?? 'KR');
  return { ...base, featureId: id, version: ver, status: 'DRAFT', source: prev ? 'MANUAL' : 'INFERRED', confirmedBy: null, confirmedAt: null, confirmSig: null } as SafetyProfile;
}
/** 도구 신뢰도(FFG-PLT-013) — 서버가 찍은 판정(키트 Feature 안전 분류의 조건)을 그대로 쓴다 */
async function toolConfidence(ctx: SimReadContext): Promise<boolean> {
  const v = await ctx.snapshot<any>('safetyProfile', { id: 'FEAT-00022', ver: '1.0.0' });
  return v?.asil?.conditions?.find((c: any) => c.id === 'TOOL_CONFIDENCE')?.met ?? true;
}
async function safetyView(ctx: SimReadContext, id: string, ver: string) {
  const profile = await safetyOf(ctx, id, ver);
  const f = await featureOf(ctx, id, ver);
  return { profile, findings: checkProfile(profile), asil: asilInheritance({ asil: f?.row.asil ?? ('QM' as any), controlPoints: f?.row.controlPoints ?? [] }, profile, { toolConfidence: await toolConfidence(ctx) }) };
}
async function gatePrerequisite(ctx: SimReadContext, id: string, ver: string, gate: GateId): Promise<string | null> {
  const p = await safetyOf(ctx, id, ver);
  if (gate === 'G1') {
    const bad = blocking(checkProfile(p));
    return bad.length ? `안전 분류 조합 위반 — ${bad.map((b) => `${b.rule} ${b.message}`).join(' / ')}` : null;
  }
  if (p.status !== 'CONFIRMED') return `안전 분류(F·DC·R·유형)가 Safety Manager 확정 전입니다 — G1 다음 Gate는 확정된 분류가 필요합니다 (FFG-CLS-001·보고서 6.1 G2).`;
  if (gate === 'G7') return (await safetyView(ctx, id, ver)).asil.blocker;
  return null;
}

// ─── 분석 근거 ─────────────────────────────────────────────
interface AnalysisLog {
  records: any[];
  g7: any[];
}
const analysisLog = (ctx: SimReadContext, key: string): AnalysisLog => data<Record<string, AnalysisLog>>(ctx, 'regAnalysis', () => ({}))[key] ?? { records: [], g7: [] };
async function asilDeviationOf(ctx: SimReadContext, row: Row) {
  const p = row.featureRefs?.find((l: any) => l.role === 'PRIMARY');
  const primary = p ? await refOf(ctx, p.refId) : null;
  if (primary && primary.asilRep !== row.asil) return { from: primary.asilRep, to: row.asil, reason: row.asilDeviation?.reason ?? '등록 때 남긴 사유가 없습니다', refId: primary.refId };
  if (row.asilDeviation) return { from: row.asilDeviation.from, to: row.asilDeviation.to, reason: row.asilDeviation.reason, refId: p?.refId ?? null };
  return null;
}
async function analysisView(ctx: SimReadContext, id: string, ver: string): Promise<any | null> {
  const f = await featureOf(ctx, id, ver);
  if (!f) return null;
  const base = await ctx.snapshot<any>('analysisEvidence', { id, ver });
  const mine = analysisLog(ctx, fkey(id, ver));
  const current: Record<string, any> = { ...(base?.current ?? {}) };
  for (const r of mine.records) current[r.kind] = { ...r, valid: true };
  const byRole = new Map<string, any>();
  for (const s of [...(base?.g7 ?? []), ...mine.g7.map((s) => ({ ...s, valid: true }))]) byRole.set(s.role, s);
  const g7 = [...byRole.values()].map((s) => {
    const stale = s.bound.HARA !== (current.HARA?.recordId ?? null) || s.bound.TARA !== (current.TARA?.recordId ?? null);
    return { ...s, stale, valid: !stale && s.valid !== false && (!s.stale || !stale) };
  });
  const changed = !!ctx.get(FEATURE, fkey(id, ver));
  return {
    featureId: id,
    version: ver,
    lifecycle: f.row.lifecycle,
    asil: f.row.asil,
    security: securityRelevance(await safetyOf(ctx, id, ver)),
    asilDeviation: changed || !base ? await asilDeviationOf(ctx, f.row) : (base.asilDeviation ?? null),
    current,
    history: [...(base?.history ?? []), ...mine.records],
    g7,
  };
}
/** 다음 분석 기록·G7 서명 번호 — 데모 이관 기록이 있는 Feature들과 이 Version 기록 다음 */
async function nextAnalysisId(ctx: SimWriteContext, prefix: 'ANL' | 'G7S', id: string, ver: string): Promise<string> {
  const ids: string[] = [];
  for (const [fid, v] of [[id, ver], ['FEAT-00010', '2.0.0'], ['FEAT-00005', '5.5.0'], ['FEAT-00022', '1.0.0']]) {
    const b = await ctx.snapshot<any>('analysisEvidence', { id: fid, ver: v });
    ids.push(...(b?.history ?? []).map((r: any) => r.recordId), ...(b?.g7 ?? []).map((s: any) => s.signoffId));
  }
  return ctx.nextId(prefix, ids.filter((x) => x?.startsWith(`${prefix}-`)));
}

// ─── Release Sign-off ──────────────────────────────────────
async function signoffView(ctx: SimReadContext, id: string, ver: string) {
  const mine = ctx.get<any>(SIGNOFF, fkey(id, ver));
  const base = mine ? null : await ctx.snapshot<any>('releaseSignoff', { id, ver });
  const s = mine ?? base?.signoff ?? null;
  if (!s) return { signoff: null, valid: false, stale: false };
  const g = await gateLatest(ctx, id, ver);
  const current = g.G8?.status === 'PASS' && g.G9?.status === 'PASS' && g.G8.gateRecordId === s.gateRecords.G8 && g.G9.gateRecordId === s.gateRecords.G9;
  return { signoff: s, valid: current && (!!mine || !!base?.valid), stale: !current };
}

// ─── 전이 문맥(서버 LifecycleService.context) ─────────────
async function transitionContext(ctx: SimReadContext, e: FeatureEntity, extra: Partial<TransitionContext> = {}): Promise<TransitionContext> {
  const { featureId: id, version: ver } = e.row;
  const detail = await ctx.snapshot<any>('featureDetail', { id, ver });
  const policies = await ctx.read<any>('listPolicies').catch(() => null);
  const cps = new Set(((policies?.items ?? []) as any[]).filter((p) => p.featureId === id && p.featureVersion === ver && ['APPROVED', 'DEPLOYED'].includes(p.status)).map((p) => p.controlPoint ?? p.flagKey));
  const refs = new Map<string, any>();
  for (const l of e.row.featureRefs ?? []) refs.set(l.refId, await refOf(ctx, l.refId));
  const so = e.row.lifecycle === 'VERIFIED' ? await signoffView(ctx, id, ver) : null;
  return {
    latestGates: statusesOf(await gateLatest(ctx, id, ver)),
    unsignedGates: await unsignedOf(ctx, id, ver),
    dependencies: (await dependenciesOf(ctx, id, ver, detail)).outgoing,
    policyCoverage: cps.size,
    createdBy: e.meta.createdBy,
    releaseSignoff: so?.valid && so.signoff ? { signedBy: so.signoff.signedBy, signedAt: so.signoff.signedAt } : null,
    openRehara: (await openRehara(ctx, id, ver)).map((r: any) => ({ requestId: r.requestId, condition: r.condition, detail: r.detail })),
    refStatusOf: (refId) => refs.get(refId)?.status ?? null,
    refAsilRepOf: (refId) => refs.get(refId)?.asilRep,
    ...extra,
  };
}
async function transitionOptions(ctx: SimReadContext, e: FeatureEntity, actor?: { id: string; role: any }) {
  const base = await transitionContext(ctx, e);
  return nextTransitions(e.row.lifecycle).map((r) => ({
    to: r.to,
    ko: r.ko,
    auto: r.auto,
    roles: r.roles.map((x) => ROLE_LABEL[x]),
    blockers: evaluateTransition(e.row, r.to, actor && !r.auto ? { ...base, actor, reason: 'preview' } : base).blockers,
  }));
}
async function transitionWarnings(ctx: SimReadContext, f: Row, to: Lifecycle): Promise<RefWarning[]> {
  if (f.lifecycle === 'PROPOSED' && to === 'APPROVED') return statusWarnings(ctx, f.featureRefs, ['REVIEW', 'DEPRECATED'], '승인은 막지 않습니다.');
  if (to === 'RELEASED') return statusWarnings(ctx, f.featureRefs, ['DEPRECATED', 'RETIRED'], '출시는 막지 않습니다 — 다음 Version에서 대체 행으로 다시 연결하세요.');
  return [];
}
/** 전이 적용 — 상태·Baseline Lifecycle·감사·이벤트(자동 전이는 시스템 행위자) */
async function applyTransition(ctx: SimWriteContext, e: FeatureEntity, to: Lifecycle, reason: string, auto: boolean): Promise<FeatureEntity> {
  const f = e.row;
  const next: FeatureEntity = { ...e, row: { ...f, lifecycle: to } };
  ctx.put(FEATURE, fkey(f.featureId, f.version), next);
  // 원천 Lifecycle이 바뀌면 관계 판정이 달라질 수 있다(예: 승인되면 미판정 → PASS)
  await rejudgeOutgoing(ctx, next.row);
  if (f.baselineId) {
    const bl = await baselineOf(ctx, f.baselineId);
    if (bl) ctx.put(BASELINE, bl.baselineId, { ...bl, snapshot: { ...bl.snapshot, lifecycle: to } });
  }
  const target = fkey(f.featureId, f.version);
  const refWarnings = await transitionWarnings(ctx, f, to);
  ctx.audit({ action: `FEATURE_TRANSITION ${f.lifecycle}→${to}`, target, before: { lifecycle: f.lifecycle }, after: { lifecycle: to, ...(refWarnings.length ? { refWarnings } : {}) }, reason, componentId: 'D01-01', ...(auto ? SYSTEM_ACTOR : {}) });
  ctx.emit('feature.lifecycle.changed', target, { featureId: f.featureId, version: f.version, from: f.lifecycle, to, by: auto ? SYSTEM_ACTOR.actorId : ctx.actor.id, auto, reason }, { componentId: 'D01-01' });
  return next;
}
/** 자동 전이(APPROVED→DEVELOPING, DEVELOPING→VERIFIED)를 조건이 허락하는 만큼 */
async function autoAdvance(ctx: SimWriteContext, e: FeatureEntity): Promise<FeatureEntity> {
  let cur = e;
  for (let i = 0; i < 4; i++) {
    const rule = autoTransition(cur.row, await transitionContext(ctx, cur));
    if (!rule) break;
    cur = await applyTransition(ctx, cur, rule.to, `자동 전이: ${rule.ko}`, true);
  }
  return cur;
}
const notifyFeature = (f: Row) => ({ feature: { featureId: f.featureId, version: f.version, name: f.name, ownerId: f.ownerId } });

// ─── 구현 연결·병합(서버 RegistryService) ──────────────────
const isEmpty = (v: unknown) => v == null || (Array.isArray(v) && v.length === 0) || v === '';
const stripUndefined = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const pick = (o: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (o as any)[k]]));
function merge(f: Row, body: Record<string, unknown>): Row {
  const next = { ...f, ...stripUndefined(body) } as Row;
  const missing = { ...f._missing };
  for (const k of Object.keys(body)) if (!isEmpty((next as any)[k])) delete missing[k];
  return { ...next, _missing: missing };
}
async function implLinks(ctx: SimWriteContext, action: string, target: string, f: Row, body: any): Promise<Partial<Row>> {
  if (body.functions === undefined && body.swIds === undefined && body.swVersions === undefined && body.ecuPnos === undefined) return {};
  const swIds = body.swIds ?? f.swIds;
  const swVersions = body.swVersions ?? f.swVersions;
  const ecuPnos = body.ecuPnos ?? f.ecuPnos;
  const problems: string[] = [];
  const swTouched = body.swIds !== undefined || body.swVersions !== undefined || body.ecuPnos !== undefined;
  if (swTouched && (swIds.length !== swVersions.length || swIds.length !== ecuPnos.length)) problems.push('SW ID·SW Version·제어기 P/N은 같은 수로 짝을 맞춰야 합니다.');
  else if (swTouched) {
    const sw: any[] = (await ctx.snapshot<any>('masterSw'))?.items ?? [];
    const ecus: any[] = (await ctx.snapshot<any>('masterEcu'))?.items ?? [];
    swIds.forEach((swId: string, i: number) => {
      const ecu = ecus.find((x) => x.ecuPno === ecuPnos[i]);
      if (!ecu) problems.push(`제어기 ${ecuPnos[i]}이(가) ECU 기준정보에 없습니다.`);
      else if (ecu.lifecycle === 'RETIRED') problems.push(`제어기 ${ecuPnos[i]}은(는) 단종되어 연결할 수 없습니다.`);
      if (!sw.some((s) => s.swId === swId && s.version === swVersions[i] && s.ecuPno === ecuPnos[i])) problems.push(`${swId} ${swVersions[i]}은(는) 제어기 ${ecuPnos[i]}의 SW 기준정보에 없습니다 — SW·Artifact 기준정보에서 고르세요.`);
    });
  }
  if (problems.length) ctx.fail('VALIDATION', `구현 연결을 저장할 수 없습니다 — 기준정보와 맞지 않는 항목 ${problems.length}건`, { fields: ['swIds'], blockers: problems }, { action, target, reason: `구현 연결: ${problems.join(' / ')}`, componentId: 'D01-01' });
  if (!body.functions) return {};
  // 새 기능 번호 — 기능 기준정보·모든 Feature 기능 중 가장 큰 번호 다음(시연에서 매긴 번호 포함)
  const structure: any = await ctx.snapshot<any>('masterStructure');
  const used = [...JSON.stringify(structure ?? {}).matchAll(/FUNC-(\d{6})/g)].map((m) => Number(m[1]));
  for (const e of ctx.list<FeatureEntity>(FEATURE)) for (const fn of e.row.functions ?? []) used.push(Number(fn.functionId.slice(5)) || 0);
  let next = used.reduce((m, n) => Math.max(m, n), 0);
  return { functions: body.functions.map((fn: any) => ({ functionId: fn.functionId ?? `FUNC-${pad(++next, 6)}`, label: fn.label })) };
}

// ─── Baseline ──────────────────────────────────────────────
async function baselineOf(ctx: SimReadContext, baselineId: string): Promise<any | null> {
  return ctx.get<any>(BASELINE, baselineId) ?? ((await ctx.snapshot<any>('baselines'))?.items ?? []).find((b: any) => b.baselineId === baselineId) ?? null;
}
async function allBaselines(ctx: SimReadContext): Promise<any[]> {
  const base: any[] = (await ctx.snapshot<any>('baselines'))?.items ?? [];
  const mine = new Map(ctx.list<any>(BASELINE).map((b) => [b.baselineId, b]));
  return [...base.map((b) => mine.get(b.baselineId) ?? b), ...[...mine.values()].filter((b) => !base.some((x) => x.baselineId === b.baselineId))];
}
async function allBaselineRequests(ctx: SimReadContext): Promise<any[]> {
  const base: any[] = (await ctx.snapshot<any>('baselineRequests'))?.items ?? [];
  const mine = new Map(ctx.list<any>(BREQ).map((q) => [q.requestId, q]));
  // 최신이 앞(서버 목록 순서) — 새 요청을 앞에
  const fresh = [...mine.values()].filter((q) => !base.some((x) => x.requestId === q.requestId)).sort((a, b) => (a.requestId < b.requestId ? 1 : -1));
  return [...fresh, ...base.map((q) => mine.get(q.requestId) ?? q)];
}
const featureTouched = (ctx: SimReadContext, key: string) => !!ctx.get(FEATURE, key) || gateLog(ctx, key).length > 0;
/** BOM 승인자 체크리스트(서버 BaselineService.checklist) — 바뀐 것이 없으면 서버가 찍은 결과 */
async function checklist(ctx: SimReadContext, id: string, ver: string): Promise<any[] | null> {
  const key = fkey(id, ver);
  if (!featureTouched(ctx, key)) {
    const snap = await ctx.snapshot<any>('baselineChecklist', { id, ver });
    if (snap?.items) return snap.items;
  }
  const e = await featureOf(ctx, id, ver);
  if (!e) return null;
  const f = e.row;
  const items: any[] = [];
  const eligible = BASELINE_ELIGIBLE.includes(f.lifecycle);
  items.push({ id: 'STATE', label: 'Lifecycle이 APPROVED 이상', state: eligible ? 'PASS' : 'FAIL', detail: `현재 ${f.lifecycle}` });
  const developing = LIFECYCLE_RANK[f.lifecycle] >= LIFECYCLE_RANK.DEVELOPING;
  const required = ['name', 'description', 'requirementIds', 'ownerId', 'asil', ...(developing ? ['functions', 'swIds', 'swVersions', 'ecuPnos'] : [])];
  const missing = required.filter((k) => isEmpty((f as any)[k]));
  items.push({ id: 'ATTRS', label: '단계별 필수 속성', state: missing.length ? 'FAIL' : 'PASS', detail: missing.length ? `누락: ${missing.join(', ')}` : `${required.length}개 확인${developing ? ' (Function·SW·ECU 포함)' : ''}` });
  const scopeOk = !!(f.country && f.vehicleModel && f.trim && f.upgVc.length);
  items.push({ id: 'SCOPE', label: '적용 범위·UPG-VC', state: scopeOk ? 'PASS' : 'FAIL', detail: `${f.country} · ${f.vehicleModel} · ${f.trim} · UPG-VC ${f.upgVc.join(', ') || '없음'}` });
  const deps: any[] = (await ctx.snapshot<any>('featureDetail', { id, ver }))?.dependencies?.outgoing ?? [];
  const badDeps = deps.filter((d) => d.verdict !== 'PASS');
  items.push({ id: 'DEPENDENCY', label: '최신 의존관계 판정 PASS (미판정 없음)', state: badDeps.length ? 'FAIL' : 'PASS', detail: badDeps.length ? badDeps.map((d) => `${d.dependencyId} ${d.verdict}`).join(', ') : `${deps.length}건 PASS`, data: deps });
  if (!developing) items.push({ id: 'IMPLEMENTATION', label: '구현 연결 = 기준정보', state: 'INFO', detail: 'DEVELOPING 이전 — 해당 없음' });
  else {
    const sw: any[] = (await ctx.snapshot<any>('masterSw'))?.items ?? [];
    const ecus: any[] = (await ctx.snapshot<any>('masterEcu'))?.items ?? [];
    const broken: string[] = [];
    if (!f.swIds.length) broken.push('Function→SW→ECU 구현 연결 없음');
    f.swIds.forEach((swId, i) => {
      const v = f.swVersions[i];
      const ecu = f.ecuPnos[i];
      if (!sw.some((s) => s.swId === swId && s.version === v && s.ecuPno === ecu)) broken.push(`${swId}@${v} on ${ecu} 기준정보 없음`);
      const e2 = ecus.find((x) => x.ecuPno === ecu);
      if (!e2) broken.push(`${ecu} ECU 기준정보 없음`);
      else if (e2.lifecycle === 'RETIRED') broken.push(`${ecu} ECU RETIRED`);
    });
    items.push({ id: 'IMPLEMENTATION', label: '구현 연결 = 기준정보 (SW·ECU 활성)', state: broken.length ? 'FAIL' : 'PASS', detail: broken.length ? broken.join('; ') : `${f.swIds.length}개 SW 형상 일치` });
  }
  const latest = Object.values(await gateLatest(ctx, id, ver)) as any[];
  const open = latest.filter((g) => g.status !== 'PASS');
  items.push({ id: 'GATES', label: 'Gate Record PASS, 열린 CONDITIONAL 없음', state: open.length ? 'FAIL' : 'PASS', detail: open.length ? open.map((g) => `${g.gate} ${g.status}`).join(', ') : `${latest.length}건 PASS` });
  const prev = (await allBaselines(ctx)).filter((b) => b.featureId === id && compareVersion(b.version, ver) < 0).sort((a, b) => compareVersion(a.version, b.version)).at(-1);
  const diff = snapshotDiff(prev ? snapshotContent(prev.snapshot) : null, snapshotContent(f));
  items.push({ id: 'DIFF', label: '이전 Baseline 대비 변경', state: 'INFO', detail: prev ? `${prev.baselineId}(${prev.version}) 대비 ${diff.length}개 필드 변경` : '최초 Baseline', data: diff });
  const affected: string[] = prev?.products ?? [];
  items.push({ id: 'PRODUCTS', label: '상품 Version 영향', state: 'INFO', detail: affected.length ? `이전 Baseline 사용 상품 ${affected.length}건 — 상품 재검토 필요` : '영향 상품 없음', data: affected });
  return items;
}
/** Registry 행 → BOM_Item 스냅샷(서버 toBomItem) */
function toBomItem(f: Row, baselineId: string) {
  const missing = { ...f._missing };
  delete missing.baselineId;
  delete missing.gateRecordIds;
  delete missing.catalogIds;
  const { featureId, name, description, requirementIds, country, vehicleModel, trim, version, lifecycle, ownerId, tags, asil, upgVc, functions, swIds, swVersions, ecuPnos, controlPoints, dependencyIds } = f;
  return {
    baselineId, featureId, name, description, requirementIds, country, vehicleModel, trim, version, lifecycle, ownerId, tags, asil, upgVc, functions, swIds, swVersions, ecuPnos, controlPoints, dependencyIds,
    ...(f.featureRefs ? { featureRefs: f.featureRefs } : {}),
    ...(f.asilDeviation ? { asilDeviation: f.asilDeviation } : {}),
    ...(f.refRegulations ? { refRegulations: f.refRegulations } : {}),
    _missing: missing,
  };
}

// ═══ 읽기 ═════════════════════════════════════════════════

// Feature 목록 — 질의 q(ID·이름·담당·태그 부분 일치, 대소문자 무관)·lifecycle·country·vehicleModel·latestOnly·limit·cursor(서버 RegistryService.list)
registerSimReader('listFeatures', async (ctx) => {
  const q = ctx.req.query;
  const all = await allSummaries(ctx);
  const needle = q.q?.trim().toLowerCase();
  const latestOnly = q.latestOnly === 'true';
  const matched = all
    .filter((f) => !q.lifecycle || f.lifecycle === q.lifecycle)
    .filter((f) => !q.country || f.country === q.country)
    .filter((f) => !q.vehicleModel || f.vehicleModel === q.vehicleModel)
    .filter((f) => !q.taxonomyLevel || (f.taxonomyLevel ?? 'L2') === q.taxonomyLevel)
    .filter((f) => !latestOnly || f.isLatest)
    .filter((f) => !needle || [f.featureId, f.name, f.ownerId, ...(f.tags ?? [])].some((s: string) => String(s ?? '').toLowerCase().includes(needle)));
  const count = (k: string) => {
    const m: Record<string, number> = {};
    for (const f of all) m[f[k]] = (m[f[k]] ?? 0) + 1;
    return m;
  };
  const limit = q.limit ? Math.min(Math.max(Math.floor(Number(q.limit)) || 1, 1), 500) : undefined;
  let offset = 0;
  if (q.cursor) {
    try {
      offset = Number(JSON.parse(atob(q.cursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (q.cursor.length % 4)) % 4))).o) || 0;
    } catch {
      offset = 0;
    }
  }
  const items = limit === undefined ? matched : matched.slice(offset, offset + limit);
  const next = limit !== undefined && offset + limit < matched.length ? btoa(JSON.stringify({ o: offset + limit })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
  return { total: matched.length, items, nextCursor: next, facets: { lifecycle: count('lifecycle'), country: count('country'), vehicleModel: count('vehicleModel') } };
});

registerSimReader('featureVersions', async (ctx) => {
  const id = ctx.req.params.id;
  const vs = (await allSummaries(ctx)).filter((f) => f.featureId === id);
  if (!vs.length) return undefined;
  const base = await ctx.snapshot<any>('featureVersions', { id });
  return { ...(base ?? {}), featureId: id, name: vs[vs.length - 1].name, latestVersion: vs[vs.length - 1].version, versions: vs, rationale: base?.rationale ?? null };
});

// Feature Version 상세 — 전이 미리 보기는 묻는 사람의 역할로(서버 detail(id, ver, actor))
registerSimReader('featureDetail', async (ctx) => {
  const { id, ver } = ctx.req.params;
  const e = await featureOf(ctx, id, ver);
  if (!e) return undefined;
  const base = await ctx.snapshot<any>('featureDetail', { id, ver });
  const key = fkey(id, ver);
  const f = e.row;
  const baseline = f.baselineId ? ((await baselineOf(ctx, f.baselineId)) ?? base?.baseline ?? null) : null;
  const pending = (await allBaselineRequests(ctx)).find((q) => q.featureId === id && q.version === ver && q.status === 'PENDING') ?? null;
  const versions = (await allSummaries(ctx)).filter((s) => s.featureId === id).map((s) => ({ version: s.version, lifecycle: s.lifecycle, baselineId: s.baselineId }));
  let trace = base?.trace ?? [];
  if (!base || ctx.get(FEATURE, key)) {
    const sw: any[] = f.swIds?.length ? ((await ctx.snapshot<any>('masterSw'))?.items ?? []) : [];
    const ecus: any[] = f.swIds?.length ? ((await ctx.snapshot<any>('masterEcu'))?.items ?? []) : [];
    trace = (f.swIds ?? []).map((swId, i) => {
      const swVersion = f.swVersions[i] ?? null;
      const ecuPno = f.ecuPnos[i] ?? null;
      const s = swVersion ? (sw.find((x) => x.swId === swId && x.version === swVersion && (!ecuPno || x.ecuPno === ecuPno)) ?? null) : null;
      return { function: f.functions[i] ?? null, swId, swVersion, ecuPno, sw: s, ecu: ecuPno ? (ecus.find((x) => x.ecuPno === ecuPno) ?? null) : null };
    });
  }
  return {
    ...(base ?? {}),
    feature: f,
    meta: e.meta,
    gates: await gateLatest(ctx, id, ver),
    dependencies: await dependenciesOf(ctx, id, ver, base),
    functions: base?.functions ?? [],
    trace,
    baseline,
    products: baseline && base?.baseline?.baselineId === baseline.baselineId ? (base?.products ?? []) : [],
    pendingBaselineRequest: pending,
    transitions: await transitionOptions(ctx, e, { id: ctx.actor.id, role: ctx.actor.role }),
    versions,
  };
});

registerSimReader('gates', async (ctx) => {
  const { id, ver } = ctx.req.params;
  const e = await featureOf(ctx, id, ver);
  if (!e) return undefined;
  const base = await ctx.snapshot<any>('gates', { id, ver });
  const mine = gateLog(ctx, fkey(id, ver));
  const closed = new Set(data<Record<string, string[]>>(ctx, 'regReharaClosed', () => ({}))[fkey(id, ver)] ?? []);
  if (!mine.length && base && !ctx.get(FEATURE, fkey(id, ver)) && !closed.size) return base;
  const evidenceOf = (r: any) => (r.evidenceRef ? { evidenceRef: r.evidenceRef, gate: r.gate, gateRecordId: r.gateRecordId, featureId: id, featureVersion: ver, featureName: e.row.name, featureDescription: e.row.description, scope: [e.row.country, e.row.vehicleModel, e.row.trim].filter(Boolean).join(' · '), owner: e.row.ownerId, lifecycle: e.row.lifecycle, inputResult: r.inputResult, resultReason: `${r.inputResult} — ${r.rationale}`, additionalEvidence: null, _missing: {} } : null);
  return {
    gates: GATES.map((g) => {
      const b = (base?.gates ?? []).find((x: any) => x.gate === g);
      const ms = mine.filter((x) => x.record.gate === g);
      const last = ms.at(-1);
      if (!last) return b ?? { gate: g, name: GATE_META[g].name, judgeRole: GATE_META[g].judgeRole, stage: GATE_META[g].stage, latest: null, decision: null, status: '미판정', evidence: null, history: [], procedureGates: procedureGatesFor(g).map((m) => m.procedureGate) };
      return {
        gate: g,
        name: GATE_META[g].name,
        judgeRole: GATE_META[g].judgeRole,
        stage: GATE_META[g].stage,
        latest: last.record,
        decision: { state: 'SIGNED', reason: null, provenance: 'PLATFORM', kid: last.decision.signature.kid, approver: last.decision.payload.approver, signedAt: last.decision.signedAt },
        decisionRecord: last.decision,
        decisionSource: 'LOCAL_SIMULATION',
        status: last.record.status,
        evidence: evidenceOf(last.record),
        history: [...(b?.history ?? []), ...ms.map((x) => ({ ...x.record, decision: 'SIGNED' }))],
        procedureGates: procedureGatesFor(g).map((m) => m.procedureGate),
      };
    }),
    lifecycle: e.row.lifecycle,
    rehara: ((base?.rehara ?? []) as any[]).map((r) => (closed.has(r.requestId) ? { ...r, status: 'RESOLVED' } : r)),
  };
});

registerSimReader('safetyProfile', async (ctx) => {
  const { id, ver } = ctx.req.params;
  if (!ctx.get(SAFETY, fkey(id, ver)) && !ctx.get(FEATURE, fkey(id, ver))) return undefined;
  return safetyView(ctx, id, ver);
});
registerSimReader('safetyProfiles', async (ctx) => {
  const mine = ctx.list<SafetyProfile>(SAFETY);
  if (!mine.length) return undefined;
  const base: any[] = (await ctx.snapshot<any>('safetyProfiles', {}, ctx.req.query))?.items ?? (await ctx.snapshot<any>('safetyProfiles'))?.items ?? [];
  const featureId = ctx.req.query.featureId;
  const byKey = new Map<string, any>(base.map((p) => [fkey(p.featureId, p.version), p]));
  for (const p of mine) if (!featureId || p.featureId === featureId) byKey.set(fkey(p.featureId, p.version), p);
  return { items: [...byKey.values()].filter((p) => !featureId || p.featureId === featureId).sort((a, b) => (a.featureId === b.featureId ? compareVersion(a.version, b.version) : a.featureId < b.featureId ? -1 : 1)) };
});

registerSimReader('releaseSignoff', async (ctx) => {
  const { id, ver } = ctx.req.params;
  if (!ctx.get(SIGNOFF, fkey(id, ver)) && !gateLog(ctx, fkey(id, ver)).length) return undefined;
  return signoffView(ctx, id, ver);
});

registerSimReader('analysisEvidence', async (ctx) => {
  const { id, ver } = ctx.req.params;
  const key = fkey(id, ver);
  const log = analysisLog(ctx, key);
  if (!log.records.length && !log.g7.length && !ctx.get(FEATURE, key) && !ctx.get(SAFETY, key)) return undefined;
  return (await analysisView(ctx, id, ver)) ?? undefined;
});

registerSimReader('baselineChecklist', async (ctx) => {
  const { id, ver } = ctx.req.params;
  if (!featureTouched(ctx, fkey(id, ver))) return undefined;
  const items = await checklist(ctx, id, ver);
  return items ? { items } : undefined;
});
registerSimReader('baselineRequests', async (ctx) => {
  if (!ctx.list(BREQ).length) return undefined;
  const status = ctx.req.query.status;
  return { items: (await allBaselineRequests(ctx)).filter((q) => !status || q.status === status) };
});
registerSimReader('baselineRequest', async (ctx) => {
  const rid = ctx.req.params.rid;
  const q = ctx.get<any>(BREQ, rid);
  const base = q ? null : await ctx.snapshot<any>('baselineRequest', { rid });
  const r = q ?? base?.request;
  if (!r) return undefined;
  if (!q && !featureTouched(ctx, fkey(r.featureId, r.version))) return undefined;
  const f = await featureOf(ctx, r.featureId, r.version);
  return { request: r, checklist: r.status === 'PENDING' ? await checklist(ctx, r.featureId, r.version) : null, feature: f?.row ?? base?.feature ?? null };
});
registerSimReader('baselines', async (ctx) => (ctx.list(BASELINE).length ? { items: await allBaselines(ctx) } : undefined));

// ─── Feature DB 읽기 ───────────────────────────────────────
const changeView = async (ctx: SimReadContext, c: any) => ({ ...c, awaitingPublish: c.status === 'APPROVED' && c.release === null, domain: c.after?.domain ?? c.before?.domain ?? (await refOf(ctx, c.refId))?.domain ?? null });
registerSimReader('listRefChanges', async (ctx) => {
  if (!ctx.list(CHANGE).length) return undefined;
  const q = ctx.req.query;
  const all = await refChanges(ctx);
  const items: any[] = [];
  for (const c of all.sort((a, b) => b.changeId.localeCompare(a.changeId, 'en', { numeric: true }))) {
    const v = ctx.get(CHANGE, c.changeId) ? await changeView(ctx, c) : c;
    if ((!q.status || v.status === q.status) && (!q.kind || v.kind === q.kind) && (!q.refId || v.refId === q.refId) && (!q.domain || v.domain === q.domain)) items.push(v);
  }
  return { items, total: items.length };
});
/** 필드 단위 차이(서버 change-rules fieldDiff) */
function fieldDiff(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const b = before ?? {};
  return Object.keys(after)
    .filter((k) => canonicalJson(b[k] ?? null) !== canonicalJson(after[k] ?? null))
    .sort()
    .map((k) => ({ field: k, before: k in b ? b[k] : null, after: after[k] ?? null }));
}
async function usersOf(ctx: SimReadContext, refId: string): Promise<any[]> {
  const base: any[] = (await ctx.snapshot<any>('refDetail', { refId }))?.usedBy ?? [];
  const mine = ctx.list<FeatureEntity>(FEATURE).flatMap((e) => (e.row.featureRefs ?? []).filter((l) => l.refId === refId).map((l) => ({ featureId: e.row.featureId, version: e.row.version, role: l.role, refVersion: l.refVersion, lifecycle: e.row.lifecycle, name: e.row.name, ownerId: e.row.ownerId, country: e.row.country, vehicleModel: e.row.vehicleModel, trim: e.row.trim })));
  const keys = new Set(mine.map((u) => fkey(u.featureId, u.version)));
  return [...base.filter((u) => !keys.has(fkey(u.featureId, u.version))), ...mine];
}
registerSimReader('refChangeDetail', async (ctx) => {
  const c = ctx.get<any>(CHANGE, ctx.req.params.id);
  if (!c) return undefined;
  const users = await usersOf(ctx, c.refId);
  const recalcFields = c.kind === 'ADD' ? [] : ['asilRep', 'tshirt'].filter((k) => k in (c.after ?? {}));
  return {
    change: await changeView(ctx, c),
    diff: fieldDiff(c.before, c.after),
    checks: c.checks ?? [],
    impact: { features: users.map((u) => ({ featureId: u.featureId, version: u.version, role: u.role, refVersion: u.refVersion, name: u.name ?? null, ownerId: u.ownerId ?? null, lifecycle: u.lifecycle })), recalcRequired: recalcFields.length > 0, recalcFields, costProjects: [] },
    usedBy: users.map((u) => ({ featureId: u.featureId, version: u.version, refId: c.refId, role: u.role, refVersion: u.refVersion })),
  };
});
const AUDIT_STAGE: Record<string, string> = { REFDB_ADD_REQUEST: 'REQUEST', REFDB_CHANGE_CREATE: 'REQUEST', REFDB_CHANGE_REVIEW: 'REVIEW', REFDB_CHANGE_DECIDE: 'DECIDE', REFDB_RELEASE_PUBLISH: 'PUBLISH' };
registerSimReader('refChangeAudit', async (ctx) => {
  const changeId = ctx.req.params.id;
  const c = ctx.get<any>(CHANGE, changeId);
  if (!c) return undefined;
  const base = await ctx.snapshot<any>('refChangeAudit', { id: changeId });
  const mine = ctx.overlay.audit
    .filter((a) => a.target === changeId || (a.target === c.refId && a.action === 'REFDB_ADD_REQUEST' && (a.after as any)?.changeId === changeId) || (!!c.release && a.target === c.release && a.action === 'REFDB_RELEASE_PUBLISH' && !!(a.after as any)?.changeIds?.includes(changeId)))
    .map(({ prevHash: _p, hash: _h, correlationId: _c, componentId: _x, ...a }) => ({ ...a, stage: AUDIT_STAGE[a.action] ?? null }))
    .sort((a, b) => a.id - b.id);
  const rel = c.release ? data<any[]>(ctx, 'refReleases', () => []).find((r) => r.release === c.release) : null;
  return {
    changeId,
    refId: c.refId,
    items: [...(base?.items ?? []), ...mine.filter((a) => !(base?.items ?? []).some((b: any) => b.id === a.id))],
    decision: c.decision ? { decision: c.decision.decision, decidedBy: c.decision.decidedBy, at: c.decision.at } : null,
    release: rel ? { release: rel.release, publishedBy: rel.publishedBy, publishedAt: rel.publishedAt, note: rel.note ?? null } : (base?.release ?? null),
  };
});
registerSimReader('refDetail', async (ctx) => {
  const refId = ctx.req.params.refId;
  const mine = ctx.get<any>(REF, refId);
  const linked = ctx.list<FeatureEntity>(FEATURE).some((e) => (e.row.featureRefs ?? []).some((l) => l.refId === refId));
  const approvedAdd = (await refChanges(ctx)).find((c) => c.refId === refId && c.kind === 'ADD' && c.status === 'APPROVED' && c.release === null);
  if (!mine && !linked && !approvedAdd) return undefined;
  const base = await ctx.snapshot<any>('refDetail', { refId });
  const ref = mine ?? base?.ref;
  if (!ref) return undefined;
  const tax = await taxonomy(ctx);
  const domain = tax.find((n) => n.level === 'DOMAIN' && n.nameEn === ref.domain) ?? null;
  const under = (level: string, name: string) => tax.find((n) => n.level === level && n.nameEn === name && (!domain || n.parentId === domain.nodeId)) ?? null;
  const srcs: any[] = (await ctx.snapshot<any>('refSources'))?.items ?? [];
  const replacement = ref.replacedBy ? await refOf(ctx, ref.replacedBy) : null;
  return {
    ...(base ?? {}),
    ref,
    taxonomy: base?.taxonomy ?? { domain, cluster: under('CLUSTER', ref.cluster), component: under('COMPONENT', ref.component) },
    sources: (ref.sourceIds ?? []).map((sid: string) => ({ sourceId: sid, source: srcs.find((s) => s.sourceId === sid) ?? null })),
    glossary: base?.glossary ?? [],
    subfunctions: base?.subfunctions ?? ((await ctx.snapshot<any>('refSubfunctions', {}, { component: ref.component }))?.items ?? []),
    usedBy: await usersOf(ctx, refId),
    policy: { status: ref.status, ...(REF_STATUS_POLICY as any)[ref.status], replacedBy: replacement ? { refId: replacement.refId, nameKo: replacement.nameKo, status: replacement.status } : null },
    awaitingPublish: approvedAdd && ref.status === 'PENDING' ? { changeId: approvedAdd.changeId, decidedAt: approvedAdd.decision?.at ?? null, label: REF_PENDING_APPROVED.label, hint: REF_PENDING_APPROVED.hint } : null,
  };
});
// 기준 행 목록 — 시연에서 바뀐 행은 ID로 바꾸고, 추가 요청한 행(요청 중)은 같은 질의(도메인·컴포넌트·상태)에 맞으면 앞에
registerSimReader('listRefs', async (ctx) => {
  const mine = ctx.list<any>(REF);
  if (!mine.length) return undefined;
  const base = await ctx.snapshot<any>('listRefs', {}, ctx.req.query);
  if (!base) return undefined;
  const q = ctx.req.query;
  const pass = (r: any) => (!q.domain || r.domain === q.domain) && (!q.component || r.component === q.component) && (!q.status || r.status === q.status);
  const byId = new Map(mine.map((r) => [r.refId, r]));
  const seen = new Set<string>();
  const items = (base.items as any[]).flatMap((r) => {
    seen.add(r.refId);
    const m = byId.get(r.refId);
    return m ? (pass(m) ? [{ ...r, ...m }] : []) : [r];
  });
  // 새로 추가 요청한 행(스냅샷에 없음) — 같은 질의에 맞으면 첫 쪽 앞에, 전체 수에 더한다
  const fresh = new Set(ctx.overlay.created[REF] ?? []);
  const news = mine.filter((r) => fresh.has(r.refId) && pass(r));
  const added = Number(q.offset ?? 0) === 0 ? news.filter((r) => !seen.has(r.refId)) : [];
  return { ...base, items: [...added, ...items], total: (base.total ?? 0) + news.length };
});

// ─── 업무 절차 읽기 ────────────────────────────────────────
let indexP: Promise<{ index: WorkflowIndexDoc; preds: ReturnType<typeof predecessorsOf> }> | null = null;
/** 업무 절차 색인 — 절차 묶음을 불러올 때 한 번(서버 WORKFLOW_INDEX와 같은 원천 docs/65-workflows) */
const workflowIndex = () =>
  (indexP ??= import('../../../../../contracts/src/generated/workflow-index').then((m) => {
    const index = m.WORKFLOW_INDEX;
    return { index, preds: predecessorsOf(index) };
  }));
type Completion = Record<string, any>;
/** 지금 유효한 완료(활동마다 최신 1건) — 스냅샷 + 시연 완료·취소 */
async function completions(ctx: SimReadContext): Promise<Map<string, Completion>> {
  const base = await ctx.snapshot<any>('procedureState');
  const out = new Map<string, Completion>(((base?.items ?? []) as Completion[]).map((c) => [c.activityId, c]));
  for (const [id, c] of Object.entries(data<Record<string, Completion | null>>(ctx, 'procDone', () => ({})))) {
    if (c) out.set(id, c);
    else out.delete(id);
  }
  return out;
}
async function orgRoles(actor: { id: string; role: string }): Promise<string[]> {
  const { index } = await workflowIndex();
  const persona = actor.id.startsWith('usr-') ? actor.id.slice(4) : null;
  const byPersona = persona ? index.personas[persona] : undefined;
  return [...new Set(byPersona?.length ? byPersona : index.roles.filter((r) => r.platformRoles.includes(actor.role as any)).map((r) => r.id))];
}
const kindOf = (a: WorkflowIndexDoc['activities'][number], orgs: string[]) => {
  const r = a.raci.R.find((id) => orgs.includes(id));
  if (r) return { kind: 'TODO' as const, roleId: r };
  if (orgs.includes(a.raci.A)) return { kind: 'REVIEW' as const, roleId: a.raci.A };
  return null;
};
async function inbox(ctx: SimReadContext) {
  const { index, preds } = await workflowIndex();
  const orgs = await orgRoles(ctx.actor);
  const done = await completions(ctx);
  const doneSet = new Set(done.keys());
  const ready = readyActivityIds(index, doneSet, preds);
  const roleName = new Map(index.roles.map((r) => [r.id, r.name]));
  const now = Date.now();
  const items: any[] = [];
  for (const a of index.activities) {
    if (!ready.has(a.id)) continue;
    const mine = kindOf(a, orgs);
    if (!mine) continue;
    const ps = preds.get(a.id) ?? [];
    const times = ps.map((id) => done.get(id)?.completedAt).filter((x): x is string => !!x);
    const readyAt = ps.length && times.length === ps.length ? times.sort().at(-1)! : null;
    const dueAt = readyAt && a.slaHours ? new Date(new Date(readyAt).getTime() + a.slaHours * 3_600_000).toISOString() : null;
    items.push({ activityId: a.id, processId: a.processId, processName: a.processName, activityName: a.name, kind: mine.kind, roleId: mine.roleId, roleName: roleName.get(mine.roleId) ?? mine.roleId, readyAt, dueAt, overdue: !!dueAt && new Date(dueAt).getTime() < now, gateDecision: a.gateDecision, anchor: a.anchor });
  }
  const order = new Map(index.activities.map((a, i) => [a.id, i]));
  items.sort((x, y) => Number(y.overdue) - Number(x.overdue) || (x.dueAt ?? '9').localeCompare(y.dueAt ?? '9') || order.get(x.activityId)! - order.get(y.activityId)!);
  const counts = new Map(index.processes.map((p) => [p.id, { id: p.id, total: 0, done: 0, todo: 0, review: 0, overdue: 0 }]));
  for (const a of index.activities) {
    const c = counts.get(a.processId);
    if (!c) continue;
    c.total += 1;
    if (doneSet.has(a.id)) c.done += 1;
  }
  for (const i of items) {
    const c = counts.get(i.processId);
    if (!c) continue;
    if (i.kind === 'TODO') c.todo += 1;
    else c.review += 1;
    if (i.overdue) c.overdue += 1;
  }
  const mineAll = index.activities.filter((a) => kindOf(a, orgs));
  const summary = { todo: items.filter((i) => i.kind === 'TODO').length, review: items.filter((i) => i.kind === 'REVIEW').length, overdue: items.filter((i) => i.overdue).length, done: mineAll.filter((a) => doneSet.has(a.id)).length, total: mineAll.length, processes: [...counts.values()] };
  return { items, summary, roleIds: orgs };
}
const procedureTouched = (ctx: SimReadContext) => Object.keys(data<Record<string, unknown>>(ctx, 'procDone', () => ({}))).length > 0;
registerSimReader('procedureState', async (ctx) => {
  if (!procedureTouched(ctx)) return undefined;
  const { index } = await workflowIndex();
  const done = await completions(ctx);
  const items = index.activities.filter((a) => done.has(a.id)).map((a) => done.get(a.id)!);
  return { items, done: items.map((i) => i.activityId), updatedAt: items.map((i) => i.completedAt).sort().at(-1) ?? null };
});
registerSimReader('procedureInbox', (ctx) => inbox(ctx));
registerSimReader('procedureSummary', async (ctx) => (await inbox(ctx)).summary);

// ═══ 쓰기 ═════════════════════════════════════════════════

// ─── Feature 등록·초안·새 Version ──────────────────────────
registerSimHandler('createFeature', async (ctx) => {
  const parsed = CreateFeatureBody.safeParse(ctx.req.body ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const refs = (ctx.req.body as { featureRefs?: unknown } | null)?.featureRefs;
    const noPrimary = !Array.isArray(refs) || refs.length === 0 || !refs.some((l) => (l as { role?: unknown } | null)?.role === 'PRIMARY');
    if (noPrimary && parsed.error.issues.some((i) => i.path[0] === 'featureRefs')) ctx.fail('REFDB_LINK_REQUIRED', LINK_REQUIRED, issues);
    ctx.fail('VALIDATION', '입력값을 확인하세요.', issues);
  }
  const body = parsed.data!;
  const failAudit = (reason: string) => ({ action: 'FEATURE_CREATE', target: body.name, reason, componentId: 'D01-01' });
  const all = await allSummaries(ctx);
  // 이름 유사 거부 — 같은 대표 기준 행(확인+사유)은 같은 범위 중복 확인으로 대신한다
  const primaryRef = body.featureRefs?.find((l) => l.role === 'PRIMARY')?.refId;
  const confirmed = !!(body.confirmDuplicate && body.duplicateReason?.trim());
  const key = body.name.replace(/\s+/g, '').toLowerCase();
  const latestOf = new Map<string, any>();
  for (const f of all) latestOf.set(f.featureId, f);
  const primaryOfLatest = async (fid: string) => {
    const l = latestOf.get(fid);
    const e = l ? await featureOf(ctx, fid, l.version) : null;
    return e?.row.featureRefs?.find((x: any) => x.role === 'PRIMARY')?.refId;
  };
  const similar = all.filter((f) => f.country === body.country && f.vehicleModel === body.vehicleModel && f.trim === body.trim && (f.name.replace(/\s+/g, '').toLowerCase().includes(key) || key.includes(f.name.replace(/\s+/g, '').toLowerCase())));
  const dup: any[] = [];
  for (const d of similar) if (!(confirmed && primaryRef && (await primaryOfLatest(d.featureId)) === primaryRef)) dup.push(d);
  if (dup.length)
    ctx.fail('CONFLICT', '같은 국가·차종·트림에 이름이 비슷한 Feature가 이미 있습니다. 기존 Feature의 새 Version인지 확인하세요.', { similar: dup.map((d) => ({ featureId: d.featureId, version: d.version, name: d.name, lifecycle: d.lifecycle })) }, failAudit('같은 적용 범위에 유사 Feature 존재'));
  const linked = await resolveRefs(ctx, { featureRefs: body.featureRefs, asil: body.asil, asilDeviation: body.asilDeviation, scope: { country: body.country, vehicleModel: body.vehicleModel, trim: body.trim }, duplicate: 'reject', confirmDuplicate: body.confirmDuplicate, duplicateReason: body.duplicateReason }, failAudit);
  const featureId = ctx.nextId('FEAT', all.map((f) => f.featureId));
  const f: Row = {
    featureId,
    name: body.name,
    description: body.description,
    requirementIds: body.requirementIds,
    country: body.country,
    vehicleModel: body.vehicleModel,
    trim: body.trim,
    version: '0.1.0',
    baselineId: null,
    lifecycle: 'PROPOSED',
    ownerId: body.ownerId,
    tags: body.tags,
    asil: body.asil,
    upgVc: body.upgVc,
    functions: [],
    swIds: [],
    swVersions: [],
    ecuPnos: [],
    controlPoints: body.controlPoints,
    dependencyIds: [],
    catalogIds: [],
    gateRecordIds: [],
    featureRefs: linked.featureRefs as any,
    ...(linked.asilDeviation ? { asilDeviation: linked.asilDeviation } : {}),
    refRegulations: body.refRegulations ?? regulationsOf(linked.primary),
    _missing: { baselineId: '미발급', functions: '미입력', swIds: '미입력', swVersions: '미입력', ecuPnos: '미입력' },
  } as Row;
  ctx.put(FEATURE, fkey(featureId, f.version), { row: f, meta: { createdBy: ctx.actor.id, createdAt: ctx.iso() } }, { created: true });
  ctx.put(SAFETY, fkey(featureId, f.version), await safetyOf(ctx, featureId, f.version));
  const target = fkey(featureId, f.version);
  ctx.audit({ action: 'FEATURE_CREATE', target, after: { ...f, ...refAuditDetail(linked, body.duplicateReason) }, componentId: 'D01-01' });
  ctx.emit('feature.created', target, { featureId, version: f.version, name: f.name, primaryRef: linked.primary.refId, asilDeviation: !!linked.asilDeviation }, { componentId: 'D01-01' });
  return { ...f, warnings: linked.warnings };
});

registerSimHandler(
  'updateDraft',
  async (ctx) => {
    const { id, ver } = ctx.req.params;
    const input = ctx.req.body as UpdateDraftBody;
    const e = await requireFeature(ctx, id, ver);
    const f = e.row;
    const { confirmDuplicate: _c, duplicateReason, ...body } = input;
    const target = fkey(id, ver);
    if (f.lifecycle !== 'PROPOSED') ctx.fail('IMMUTABLE', `${f.lifecycle} 버전은 수정할 수 없습니다. 새 Version을 만드세요.`, { hint: `POST /api/features/${id}/versions` }, { action: 'FEATURE_UPDATE', target, reason: `${f.lifecycle} 버전 수정 시도`, componentId: 'D01-01' });
    const impl = await implLinks(ctx, 'FEATURE_UPDATE', target, f, body);
    let linked: Awaited<ReturnType<typeof resolveRefs>> | null = null;
    if ((input.featureRefs !== undefined || input.asil !== undefined || input.asilDeviation !== undefined) && (input.featureRefs ?? f.featureRefs)?.length) {
      const primaryChanged = input.featureRefs !== undefined && input.featureRefs.find((l) => l.role === 'PRIMARY')?.refId !== f.featureRefs?.find((l: any) => l.role === 'PRIMARY')?.refId;
      linked = await resolveRefs(ctx, { featureRefs: input.featureRefs ?? f.featureRefs, previous: f.featureRefs, asil: input.asil ?? f.asil, asilDeviation: input.asilDeviation ?? f.asilDeviation, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, featureId: f.featureId, duplicate: primaryChanged ? 'reject' : 'warn', confirmDuplicate: input.confirmDuplicate, duplicateReason }, (reason) => ({ action: 'FEATURE_UPDATE', target, reason, componentId: 'D01-01' }));
    }
    let next = merge(f, { ...body, ...impl });
    if (linked) {
      const { asilDeviation: _d, ...rest } = next;
      next = { ...rest, featureRefs: linked.featureRefs, ...(linked.asilDeviation ? { asilDeviation: linked.asilDeviation } : {}) } as Row;
    }
    ctx.put(FEATURE, target, { ...e, row: next });
    const changed = changedKeys(f, body as any);
    ctx.audit({ action: 'FEATURE_UPDATE', target, before: pick(f, changed), after: { ...pick(next, changed), ...(linked ? refAuditDetail(linked, duplicateReason) : {}) }, componentId: 'D01-01' });
    ctx.emit('feature.updated', target, { featureId: id, version: ver, changed }, { componentId: 'D01-01' });
    return linked ? { ...next, warnings: linked.warnings } : next;
  },
  { body: UpdateDraftBody },
);

registerSimHandler(
  'createVersion',
  async (ctx) => {
    const id = ctx.req.params.id;
    const body = ctx.req.body as CreateVersionBody;
    const base = await requireFeature(ctx, id, body.baseVersion);
    const scopeChange = SCOPE_KEYS.filter((k) => k in (body.changes as object));
    if (scopeChange.length) ctx.fail('VALIDATION', '국가·차종·트림이 바뀌면 새 Feature ID로 등록해야 합니다.', { fields: scopeChange });
    if (base.row.lifecycle === 'RETIRED') ctx.fail('GUARD_FAILED', 'RETIRED Feature에서는 새 Version을 만들 수 없습니다.');
    const versions = (await allSummaries(ctx)).filter((s) => s.featureId === id);
    const version = bumpVersion(versions.at(-1)?.version ?? body.baseVersion, body.bump);
    const changed = changedKeys(base.row, body.changes as any);
    const impl = await implLinks(ctx, 'FEATURE_VERSION_CREATE', fkey(id, body.baseVersion), base.row, body.changes);
    const ch = body.changes as any;
    const linked =
      (ch.featureRefs !== undefined || ch.asil !== undefined || ch.asilDeviation !== undefined) && (ch.featureRefs ?? base.row.featureRefs)?.length
        ? await resolveRefs(ctx, { featureRefs: ch.featureRefs ?? base.row.featureRefs, previous: base.row.featureRefs, asil: ch.asil ?? base.row.asil, asilDeviation: ch.asilDeviation ?? base.row.asilDeviation, scope: { country: base.row.country, vehicleModel: base.row.vehicleModel, trim: base.row.trim }, featureId: id, duplicate: 'warn' }, (reason) => ({ action: 'FEATURE_VERSION_CREATE', target: fkey(id, body.baseVersion), reason, componentId: 'D01-01' }))
        : null;
    const warnings = linked ? linked.warnings : await statusWarnings(ctx, base.row.featureRefs, ['DEPRECATED', 'RETIRED'], '새 Version에서 대체 행으로 다시 연결하세요.');
    let merged = merge(base.row, { ...ch, ...impl });
    if (linked) {
      const { asilDeviation: _d, ...rest } = merged;
      merged = { ...rest, featureRefs: linked.featureRefs, ...(linked.asilDeviation ? { asilDeviation: linked.asilDeviation } : {}) } as Row;
    }
    const f: Row = { ...merged, version, lifecycle: 'PROPOSED', baselineId: null, catalogIds: [], gateRecordIds: [], _missing: { ...merged._missing, baselineId: '미발급' } };
    const target = fkey(id, version);
    ctx.put(FEATURE, target, { row: f, meta: { createdBy: ctx.actor.id, createdAt: ctx.iso() } }, { created: true });
    ctx.put(SAFETY, target, await safetyOf(ctx, id, version, base.row.version));
    const rejudge = gatesToRejudge(changed, base.row.lifecycle);
    ctx.audit({ action: 'FEATURE_VERSION_CREATE', target, before: { baseVersion: base.row.version }, after: { version, changed, rejudge, ...(warnings.length ? { refWarnings: warnings } : {}) }, reason: body.reason, componentId: 'D01-01' });
    ctx.emit('feature.version.created', target, { featureId: id, version, baseVersion: base.row.version, changed, rejudge, notifyBomApprover: !!base.row.baselineId }, { componentId: 'D01-01' });
    return { feature: f, changed, rejudge, ...(linked || warnings.length ? { warnings } : {}) };
  },
  { body: CreateVersionBody },
);

// ─── Lifecycle 전이 ────────────────────────────────────────
registerSimHandler(
  'transition',
  async (ctx) => {
    const { id, ver } = ctx.req.params;
    const { to, reason } = ctx.req.body as { to: Lifecycle; reason: string };
    const e = await requireFeature(ctx, id, ver);
    const f = e.row;
    const { rule, blockers } = evaluateTransition(f, to, await transitionContext(ctx, e, { actor: { id: ctx.actor.id, role: ctx.actor.role }, reason }));
    const action = `FEATURE_TRANSITION ${f.lifecycle}→${to}`;
    const target = fkey(id, ver);
    if (rule?.auto) ctx.fail('CONFLICT', `${rule.ko}은(는) 조건이 갖춰지면 시스템이 자동으로 전이합니다.`, { blockers }, { action, target, reason: '자동 전이는 직접 실행할 수 없습니다', componentId: 'D01-01' });
    if (blockers.length) {
      const text = blockers.map((b) => b.message).join('; ');
      const code = blockers.some((b) => b.code === 'SEPARATION_OF_DUTY') ? 'SEPARATION_OF_DUTY' : blockers.some((b) => b.code === 'ROLE') ? 'FORBIDDEN' : 'GUARD_FAILED';
      ctx.fail(code, `전이할 수 없습니다: ${text}`, { blockers }, { action, target, reason: text, componentId: 'D01-01' });
    }
    const warnings = await transitionWarnings(ctx, f, to);
    const next = await applyTransition(ctx, e, to, reason, false);
    const cur = await autoAdvance(ctx, next);
    return warnings.length ? { ...cur.row, warnings } : cur.row;
  },
  { body: TransitionBody },
);

// ─── Gate 판정 ─────────────────────────────────────────────
registerSimHandler(
  'judgeGate',
  async (ctx) => {
    const { id, ver } = ctx.req.params;
    const body = ctx.req.body as JudgeGateBody;
    const e = await requireFeature(ctx, id, ver);
    const f = e.row;
    const key = fkey(id, ver);
    const target = `${key}#${body.gate}`;
    const action = `GATE_JUDGE ${body.gate}`;
    const fail = (code: string, msg: string, details?: unknown, audit = msg): never => ctx.fail(code, msg, details, { action, target, reason: audit, componentId: 'D01-02' });
    const latest = await gateLatest(ctx, id, ver);
    const blocked = gateStageBlocker({ lifecycle: f.lifecycle, gate: body.gate, role: ctx.actor.role, latest: statusesOf(latest) });
    if (blocked) fail(blocked.readOnly ? 'IMMUTABLE' : 'GUARD_FAILED', blocked.reason);
    const pre = body.inputResult === 'PASS' ? await gatePrerequisite(ctx, id, ver, body.gate) : null;
    if (pre) fail('GUARD_FAILED', pre);
    // FFG-LCY-003 — 열린 재-HARA 요청이 있으면 G3 이후 PASS는 G2 재판정 뒤에
    const rh = body.inputResult === 'PASS' && (REHARA_BLOCKED_GATES as readonly string[]).includes(body.gate) ? await openRehara(ctx, id, ver) : [];
    if (rh.length) fail('GUARD_FAILED', `재-HARA 요청 ${rh.map((x: any) => `${x.requestId}(${(REHARA_LABEL as any)[x.condition] ?? x.condition})`).join(', ')}이(가) 열려 있습니다 — G2를 다시 판정한 뒤 ${body.gate}을(를) PASS로 판정할 수 있습니다.`);
    // 가상검증 근거(VV-NNNNN) — 이 Version의 기록, PASS 근거는 CARLA 실행 PASS(+G5는 TMS 제출)
    const runs: any[] = (body.evidenceRef ?? '').match(/\bVV-\d{5}\b/) ? ((await ctx.read<any>('virtualRuns').catch(() => null))?.items ?? []) : [];
    for (const vv of (body.evidenceRef ?? '').match(/\bVV-\d{5}\b/g) ?? []) {
      const r = runs.find((x) => x.runId === vv || x.id === vv);
      if (!r) fail('GUARD_FAILED', `${vv}: 가상검증 기록이 없습니다.`);
      if (r.featureId !== id || r.featureVersion !== ver) fail('GUARD_FAILED', `${vv}: ${r.featureId} ${r.featureVersion}의 가상검증입니다 (판정 대상 ${id} ${ver}).`);
      if (body.inputResult !== 'PASS') continue;
      if (r.source !== 'carla' || r.gateResult !== 'PASS') fail('GUARD_FAILED', `${vv}: PASS 근거가 될 수 없습니다 (${r.source === 'carla' ? `가상검증 ${r.gateResult}` : r.source === 'vecu' ? '이전 실행기 기록 — CARLA로 다시 실행' : '실행기 미연결 결과'}).`);
      if (body.gate === 'G5' && !r.tms) fail('GUARD_FAILED', `${vv}: TMS(IF-09)에 제출한 Evidence만 G5 근거가 됩니다 — 먼저 제출하세요.`);
    }
    // 분석 근거 번호(ANL-NNNNN)는 이 Version의 것
    const view = await analysisView(ctx, id, ver);
    for (const anl of (body.evidenceRef ?? '').match(/\bANL-\d{5}\b/g) ?? []) {
      const r = (view?.history ?? []).find((x: any) => x.recordId === anl);
      if (!r) fail('GUARD_FAILED', `${anl}: 분석 근거 기록이 없습니다 — 분석 근거 패널의 기록 번호를 적습니다.`);
    }
    // G2(HARA·TARA·ASIL 사유)·G7(SM·CSM 서명) — contracts gateEvidenceBlockers
    if (body.inputResult === 'PASS' && (body.gate === 'G2' || body.gate === 'G7') && view) {
      const current = Object.fromEntries(Object.entries(view.current).filter(([, r]: any) => r?.valid));
      const evidence = gateEvidenceBlockers({ gate: body.gate, inputResult: body.inputResult, current, securityRelevant: view.security.relevant, asilDeviation: view.asilDeviation, asilReasonReviewed: !!body.asilReasonReviewed, g7: view.g7.filter((s: any) => s.valid) });
      if (evidence.length) fail('GUARD_FAILED', `${body.gate}을(를) PASS로 판정할 근거가 부족합니다.`, { blockers: evidence.map((message) => ({ code: 'ANALYSIS_EVIDENCE', message, ref: body.gate })) }, evidence.join(' / '));
    }
    const deviation = body.gate === 'G2' && body.inputResult === 'PASS' && body.asilReasonReviewed ? view?.asilDeviation : null;
    const prev = latest[body.gate];
    const record = {
      gateRecordId: await nextGateRecordId(ctx, body.gate, id, ver),
      featureId: id,
      featureVersion: ver,
      country: f.country,
      gate: body.gate,
      gateName: GATE_META[body.gate].name,
      inputResult: body.inputResult,
      rationale: body.rationale,
      evidenceRef: body.evidenceRef,
      judgeRole: GATE_META[body.gate].judgeRole,
      judgedAt: kst(ctx.now()),
      status: gateStatusOf(body.inputResult),
      gateStageLifecycle: GATE_META[body.gate].stage,
      currentLifecycle: f.lifecycle,
      transitionNote: `${prev ? `재판정 — 이전 ${prev.gateRecordId}(${prev.status}) 대체` : '최초 판정'}${deviation ? ` · ASIL 사유 검토함(대표 ${deviation.from} → ${deviation.to})` : ''}`,
      _missing: {},
    };
    const payload = decisionPayload(record as any, { id: ctx.actor.id, role: ctx.actor.role }, 'PLATFORM', f.baselineId ?? null);
    const decision = await signLocalGate(ctx, payload);
    const log = ctx.state<Record<string, GateEntry[]>>('regGates', () => ({}));
    log[key] = [...(log[key] ?? []), { record, decision }];
    // G2 재판정 PASS가 열린 재-HARA 요청을 닫는다
    if (body.gate === 'G2' && record.status === 'PASS')
      for (const x of await openRehara(ctx, id, ver)) {
        const closed = ctx.state<Record<string, string[]>>('regReharaClosed', () => ({}));
        closed[key] = [...(closed[key] ?? []), x.requestId];
        ctx.audit({ action: 'REHARA_RESOLVE', target: key, before: { requestId: x.requestId, status: 'OPEN' }, after: { status: 'RESOLVED', gateRecordId: record.gateRecordId }, componentId: 'D01-02' });
      }
    ctx.audit({ action, target, before: prev ? { gateRecordId: prev.gateRecordId, status: prev.status } : null, after: { gateRecordId: record.gateRecordId, status: record.status, evidenceRef: record.evidenceRef, decisionKid: decision.signature.kid, signatureSource: 'LOCAL_SIMULATION', ...(deviation ? { asilReasonReviewed: { from: deviation.from, to: deviation.to } } : {}) }, reason: body.rationale, componentId: 'D01-02' });
    ctx.emit('gate.judged', key, { gateRecordId: record.gateRecordId, gate: record.gate, status: record.status, by: ctx.actor.id }, { componentId: 'D01-02', notify: notifyFeature(f) });
    const feature = await autoAdvance(ctx, e);
    return { record, feature: feature.row };
  },
  { body: JudgeGateBody },
);

// ─── 안전 분류 ─────────────────────────────────────────────
registerSimHandler(
  'updateSafetyProfile',
  async (ctx) => {
    const { id, ver } = ctx.req.params;
    await requireFeature(ctx, id, ver);
    const patch = ctx.req.body as Record<string, unknown>;
    const cur = await safetyOf(ctx, id, ver);
    const target = `${fkey(id, ver)}#safety`;
    if (cur.status === 'CONFIRMED') {
      const touched = Object.keys(patch).filter((k) => (LOCKED_AFTER_CONFIRM as string[]).includes(k));
      const msg = `확정된 안전 분류는 바꿀 수 없습니다(${touched.join(', ') || '확정 후 수정'}) — 새 Version을 만드세요 (FFG-CLS-004).`;
      ctx.fail('IMMUTABLE', msg, undefined, { action: 'SAFETY_PROFILE_UPDATE', target, reason: msg, componentId: 'D01-01' });
    }
    const r = SafetyProfile.safeParse({ ...cur, ...patch, source: 'MANUAL' });
    if (!r.success) ctx.fail('VALIDATION', '입력값을 확인하세요.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const next = r.data!;
    ctx.put(SAFETY, fkey(id, ver), next);
    ctx.audit({ action: 'SAFETY_PROFILE_UPDATE', target, before: cur, after: next, componentId: 'D01-01' });
    ctx.emit('safety.profile.updated', target, { featureId: id, version: ver, fClass: next.fClass, deactClass: next.deactClass }, { componentId: 'D01-01' });
    return { profile: next, findings: checkProfile(next) };
  },
  { body: SafetyProfilePatch },
);

registerSimHandler(
  'confirmSafetyProfile',
  async (ctx) => {
    const { id, ver } = ctx.req.params;
    await requireFeature(ctx, id, ver);
    const { reason } = ctx.req.body as { reason: string };
    const cur = await safetyOf(ctx, id, ver);
    const target = `${fkey(id, ver)}#safety`;
    const failAudit = (r: string) => ({ action: 'SAFETY_PROFILE_CONFIRM', target, reason: r, componentId: 'D01-01' });
    if (cur.status === 'CONFIRMED') ctx.fail('CONFLICT', '이미 확정된 안전 분류입니다.', undefined, failAudit('이미 확정된 안전 분류입니다.'));
    const bad = blocking(checkProfile(cur));
    if (bad.length) ctx.fail('GUARD_FAILED', '안전 분류 조합 위반이 있어 확정할 수 없습니다.', { blockers: bad.map((b) => ({ code: b.rule, message: b.message, ref: b.field })) }, failAudit(bad.map((b) => `${b.rule} ${b.message}`).join(' / ')));
    const signed = { ...cur, status: 'CONFIRMED' as const, confirmedBy: ctx.actor.id, confirmedAt: ctx.iso(), confirmSig: null };
    const next = SafetyProfile.parse({ ...signed, confirmSig: await demoSign(apr(ctx.actor.id), jcs(signed)) });
    ctx.put(SAFETY, fkey(id, ver), next);
    ctx.audit({ action: 'SAFETY_PROFILE_CONFIRM', target, before: { status: cur.status }, after: { status: 'CONFIRMED', fClass: next.fClass, deactClass: next.deactClass, regClass: next.regClass, kid: apr(ctx.actor.id) }, reason, componentId: 'D01-01' });
    ctx.emit('safety.profile.confirmed', target, { featureId: id, version: ver, fClass: next.fClass, deactClass: next.deactClass, regClass: next.regClass }, { componentId: 'D01-01' });
    return { profile: next, findings: checkProfile(next) };
  },
  { body: SafetyConfirmBody },
);

// ─── 분석 근거·G7 서명 ─────────────────────────────────────
const ANALYSIS_ACTION: Record<AnalysisKind, string> = { HARA: 'ANALYSIS_HARA', TARA: 'ANALYSIS_TARA', SOTIF: 'ANALYSIS_SOTIF', HOMOLOGATION: 'ANALYSIS_HOMOLOGATION' };
const writable = (ctx: SimWriteContext, action: string, target: string, f: Row) => {
  if (LIFECYCLE_RANK[f.lifecycle] >= LIFECYCLE_RANK.RELEASED) {
    const msg = `${f.lifecycle} 버전의 분석 근거는 바꿀 수 없습니다 — 새 Version에서 다시 분석합니다.`;
    ctx.fail('IMMUTABLE', msg, undefined, { action, target, reason: msg, componentId: 'D01-02' });
  }
};
const recordAnalysis = (kind: AnalysisKind) => async (ctx: SimWriteContext) => {
  const { id, ver } = ctx.req.params;
  const e = await requireFeature(ctx, id, ver);
  const target = `${fkey(id, ver)}#${kind.toLowerCase()}`;
  writable(ctx, ANALYSIS_ACTION[kind], target, e.row);
  const { reason, ...rest } = ctx.req.body as { reason: string } & Record<string, unknown>;
  const docId = typeof rest.docId === 'string' ? rest.docId : null;
  delete rest.docId;
  const view = await analysisView(ctx, id, ver);
  const unsigned = { recordId: await nextAnalysisId(ctx, 'ANL', id, ver), kind, featureId: id, version: ver, docId, content: rest, reason, signedBy: ctx.actor.id, signedRole: ANALYSIS_AUTHOR_ROLE[kind], signedAt: ctx.iso(), provenance: 'PERSONAL' as const, supersedes: view?.current?.[kind]?.recordId ?? null, kid: '', sig: null };
  const r = { ...unsigned, kid: apr(ctx.actor.id), sig: await demoSign(apr(ctx.actor.id), jcs(unsigned)) };
  const log = ctx.state<Record<string, AnalysisLog>>('regAnalysis', () => ({}));
  const k = fkey(id, ver);
  log[k] = { records: [...(log[k]?.records ?? []), r], g7: log[k]?.g7 ?? [] };
  ctx.audit({ action: ANALYSIS_ACTION[kind], target, before: unsigned.supersedes ? { recordId: unsigned.supersedes } : null, after: { recordId: r.recordId, docId, kid: r.kid }, reason, componentId: 'D01-02' });
  ctx.emit('analysis.recorded', k, { recordId: r.recordId, kind, by: ctx.actor.id }, { componentId: 'D01-02' });
  return r;
};
registerSimHandler('recordHara', recordAnalysis('HARA'), { body: HaraBody });
registerSimHandler('recordTara', recordAnalysis('TARA'), { body: TaraBody });
registerSimHandler('recordSotif', recordAnalysis('SOTIF'), { body: SotifBody });
registerSimHandler('recordHomologation', recordAnalysis('HOMOLOGATION'), { body: HomologationBody });

const signG7 = (role: 'SAFETY_OFFICER' | 'SECURITY_OFFICER') => async (ctx: SimWriteContext) => {
  const { id, ver } = ctx.req.params;
  const e = await requireFeature(ctx, id, ver);
  const action = role === 'SAFETY_OFFICER' ? 'G7_SIGNOFF_SAFETY' : 'G7_SIGNOFF_SECURITY';
  const target = `${fkey(id, ver)}#G7`;
  const fail = (code: string, msg: string): never => ctx.fail(code, msg, undefined, { action, target, reason: msg, componentId: 'D01-02' });
  writable(ctx, action, target, e.row);
  const v = (await analysisView(ctx, id, ver))!;
  const hara = v.current.HARA?.valid ? v.current.HARA : undefined;
  const tara = v.current.TARA?.valid ? v.current.TARA : undefined;
  if (role === 'SAFETY_OFFICER' && !hara) fail('GUARD_FAILED', `G7 기능안전 서명 전에 이 Version의 ${ANALYSIS_LABEL.HARA} 기록이 있어야 합니다.`);
  if (role === 'SECURITY_OFFICER' && v.security.relevant && !tara) fail('GUARD_FAILED', `보안 관련 Feature(${v.security.why})라 G7 사이버보안 서명 전에 ${ANALYSIS_LABEL.TARA} 기록이 있어야 합니다.`);
  const other = v.g7.find((s: any) => s.valid && s.role !== role);
  if (other && other.signedBy === ctx.actor.id) fail('GUARD_FAILED', '기능안전 서명과 사이버보안 서명은 서로 다른 사람이 합니다 — 이미 다른 쪽에 서명했습니다.');
  if (v.g7.find((s: any) => s.valid && s.role === role)) fail('CONFLICT', '이 역할의 G7 서명이 이미 있습니다 — 분석 근거가 바뀌면 다시 서명합니다.');
  const unsigned = { signoffId: await nextAnalysisId(ctx, 'G7S', id, ver), featureId: id, version: ver, role, signedBy: ctx.actor.id, signedAt: ctx.iso(), reason: (ctx.req.body as { reason: string }).reason, bound: { HARA: v.current.HARA?.recordId ?? null, TARA: v.current.TARA?.recordId ?? null }, kid: '', sig: null };
  const s = { ...unsigned, kid: apr(ctx.actor.id), sig: await demoSign(apr(ctx.actor.id), jcs(unsigned)) };
  const log = ctx.state<Record<string, AnalysisLog>>('regAnalysis', () => ({}));
  const k = fkey(id, ver);
  log[k] = { records: log[k]?.records ?? [], g7: [...(log[k]?.g7 ?? []), s] };
  ctx.audit({ action, target, after: { signoffId: s.signoffId, bound: s.bound, kid: s.kid }, reason: s.reason, componentId: 'D01-02' });
  ctx.emit('gate.signed', k, { signoffId: s.signoffId, gate: 'G7', role, by: ctx.actor.id }, { componentId: 'D01-02' });
  return s;
};
registerSimHandler('signG7Safety', signG7('SAFETY_OFFICER'), { body: G7SignoffBody });
registerSimHandler('signG7Security', signG7('SECURITY_OFFICER'), { body: G7SignoffBody });

// ─── Release Sign-off ──────────────────────────────────────
registerSimHandler(
  'signRelease',
  async (ctx) => {
    const { id, ver } = ctx.req.params;
    const { reason } = ctx.req.body as { reason: string };
    const target = `${fkey(id, ver)}#release-signoff`;
    const fail = (msg: string, code: string): never => ctx.fail(code, msg, undefined, { action: 'RELEASE_SIGNOFF', target, reason: msg, componentId: 'D01-01' });
    const e = await featureOf(ctx, id, ver);
    if (!e) return fail(`${id} ${ver}을(를) 찾을 수 없습니다.`, 'NOT_FOUND');
    const f = e.row;
    if (f.lifecycle !== 'VERIFIED') fail(`${f.lifecycle} 상태에서는 Release Sign-off를 할 수 없습니다 — VERIFIED에서 출시 전에 서명합니다.`, 'GUARD_FAILED');
    const latest = await gateLatest(ctx, id, ver);
    const missing = (['G8', 'G9'] as const).filter((g) => latest[g]?.status !== 'PASS');
    if (missing.length) fail(`${missing.join('·')} 최신 판정이 PASS가 아닙니다 — G8·G9 PASS 뒤에 서명합니다.`, 'GUARD_FAILED');
    const open = await openRehara(ctx, id, ver);
    if (open.length) fail(`재-HARA 요청 ${open.map((r: any) => `${r.requestId}(${r.condition})`).join(', ')}이 열려 있습니다 — 영향 검토(G2 재판정)를 마친 뒤 서명합니다.`, 'GUARD_FAILED');
    if ((await signoffView(ctx, id, ver)).valid) fail('현재 G8·G9 판정에 대한 Release Sign-off가 이미 있습니다.', 'CONFLICT');
    const unsigned = { featureId: id, version: ver, ownerId: f.ownerId, signedBy: ctx.actor.id, signedRole: 'FEATURE_AUTHOR' as const, signedAt: ctx.iso(), gateRecords: { G8: latest.G8.gateRecordId, G9: latest.G9.gateRecordId }, reason, kid: '', sig: null };
    const stored = { ...unsigned, sig: await demoSign(apr(ctx.actor.id), jcs(unsigned)), kid: apr(ctx.actor.id) };
    const warnings = await statusWarnings(ctx, f.featureRefs, ['DEPRECATED', 'RETIRED'], '서명은 막지 않습니다 — 다음 Version에서 대체 행으로 다시 연결하세요.');
    ctx.put(SIGNOFF, fkey(id, ver), stored);
    ctx.audit({ action: 'RELEASE_SIGNOFF', target, after: { ownerId: f.ownerId, gateRecords: unsigned.gateRecords, kid: stored.kid, ...(warnings.length ? { refWarnings: warnings } : {}) }, reason, componentId: 'D01-01' });
    ctx.emit('release.signed', target, { featureId: id, version: ver, ownerId: f.ownerId, signedBy: ctx.actor.id }, { componentId: 'D01-01', notify: notifyFeature(f) });
    return { signoff: stored, valid: true, stale: false, ...(warnings.length ? { warnings } : {}) };
  },
  { body: ReleaseSignoffBody },
);

// ─── Baseline 확정 요청·결정 ───────────────────────────────
registerSimHandler(
  'requestBaseline',
  async (ctx) => {
    const body = ctx.req.body as { featureId: string; version: string; reason: string };
    const e = await requireFeature(ctx, body.featureId, body.version);
    const target = fkey(body.featureId, body.version);
    const fail = (code: string, msg: string): never => ctx.fail(code, msg, undefined, { action: 'BASELINE_REQUEST', target, reason: msg, componentId: 'D01-01' });
    if (!BASELINE_ELIGIBLE.includes(e.row.lifecycle)) fail('GUARD_FAILED', `${e.row.lifecycle} 버전은 Baseline 확정 대상이 아닙니다 (APPROVED~RELEASED만).`);
    const existing = (await allBaselines(ctx)).find((b) => b.featureId === body.featureId && b.version === body.version);
    if (existing) fail('CONFLICT', `이미 ${existing.baselineId}로 확정된 버전입니다. 상태 변경만으로는 재발급하지 않습니다.`);
    const all = await allBaselineRequests(ctx);
    if (all.some((q) => q.featureId === body.featureId && q.version === body.version && q.status === 'PENDING')) fail('CONFLICT', '같은 버전의 확정 요청이 이미 대기 중입니다.');
    const q = { requestId: ctx.nextId('BR', all.map((x) => x.requestId)), featureId: body.featureId, version: body.version, status: 'PENDING', requestedBy: ctx.actor.id, requestedAt: ctx.iso(), reason: body.reason, decidedBy: null, decidedAt: null, decisionReason: null, baselineId: null };
    ctx.put(BREQ, q.requestId, q, { created: true });
    ctx.audit({ action: 'BASELINE_REQUEST', target, after: q, reason: body.reason, componentId: 'D01-01' });
    ctx.emit('baseline.requested', target, { requestId: q.requestId, featureId: q.featureId, version: q.version, by: ctx.actor.id }, { componentId: 'D01-01', notify: notifyFeature(e.row) });
    return q;
  },
  { body: BaselineRequestBody },
);

registerSimHandler(
  'decideBaseline',
  async (ctx) => {
    const rid = ctx.req.params.rid;
    const body = ctx.req.body as { decision: 'APPROVE' | 'REJECT'; reason: string };
    const q = (await allBaselineRequests(ctx)).find((x) => x.requestId === rid);
    if (!q) ctx.fail('NOT_FOUND', `${rid}을(를) 찾을 수 없습니다.`);
    const target = fkey(q.featureId, q.version);
    const action = `BASELINE_${body.decision}`;
    if (q.status !== 'PENDING') ctx.fail('CONFLICT', `이미 ${q.status} 처리된 요청입니다.`);
    if (q.requestedBy === ctx.actor.id) ctx.fail('SEPARATION_OF_DUTY', '확정을 요청한 사람은 같은 요청을 승인·반려할 수 없습니다.', undefined, { action, target, reason: '요청자 본인 승인 시도 (직무 분리)', componentId: 'D01-01' });
    const items = (await checklist(ctx, q.featureId, q.version)) ?? [];
    if (body.decision === 'APPROVE') {
      const failed = items.filter((c) => c.state === 'FAIL');
      if (failed.length) ctx.fail('GUARD_FAILED', `체크리스트 ${failed.length}개 항목이 충족되지 않아 확정할 수 없습니다.`, { checklist: items }, { action, target, reason: failed.map((c) => `${c.id}: ${c.detail}`).join('; '), componentId: 'D01-01' });
    }
    const decided = { ...q, status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: ctx.actor.id, decidedAt: ctx.iso(), decisionReason: body.reason };
    let baseline: any = null;
    if (body.decision === 'APPROVE') {
      const e = await requireFeature(ctx, q.featureId, q.version);
      const baselineId = ctx.nextId('BL', (await allBaselines(ctx)).map((b) => b.baselineId));
      const snapshot = toBomItem(e.row, baselineId);
      baseline = { baselineId, featureId: e.row.featureId, version: e.row.version, contentHash: 'sha256:' + (await sha256(canonicalJson(snapshotContent(snapshot as any)))), approvedBy: ctx.actor.id, approvedAt: decided.decidedAt, requestId: rid, snapshot, products: [] };
      ctx.put(BASELINE, baselineId, baseline, { created: true });
      const missing = { ...e.row._missing };
      delete missing.baselineId;
      ctx.put(FEATURE, target, { ...e, row: { ...e.row, baselineId, _missing: missing } });
      decided.baselineId = baselineId;
    }
    ctx.put(BREQ, rid, decided);
    ctx.audit({ action, target, before: { status: 'PENDING' }, after: { status: decided.status, baselineId: decided.baselineId, contentHash: baseline?.contentHash }, reason: body.reason, componentId: 'D01-01' });
    ctx.emit(body.decision === 'APPROVE' ? 'baseline.confirmed' : 'baseline.rejected', target, { requestId: rid, featureId: q.featureId, version: q.version, baselineId: decided.baselineId, contentHash: baseline?.contentHash ?? null, by: ctx.actor.id }, { componentId: 'D01-01' });
    return { request: decided, baseline, checklist: items };
  },
  { body: BaselineDecisionBody },
);

// ─── Feature DB 추가 요청·변경 요청·검토·결정·발행 ─────────
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const maskMoney = (row: Record<string, unknown> | null | undefined) => {
  if (!row) return row;
  const out: Record<string, unknown> = { ...row };
  for (const k of REF_MONEY_FIELDS as readonly string[]) if (out[k] !== undefined && out[k] !== null && out[k] !== '') out[k] = '(벤치마크 값 — 감사에는 남기지 않음)';
  return out;
};
const canSeeBenchmark = (role: string) => role === 'REFDB_ADMIN' || role === 'COST_ESTIMATOR' || role === 'COST_APPROVER' || role === 'COST_BASIS_ADMIN';
const hideBenchmark = (row: Record<string, unknown> | null, role: string) => {
  if (!row || canSeeBenchmark(role)) return row;
  const out = { ...row };
  for (const k of REF_MONEY_FIELDS as readonly string[]) delete out[k];
  return out;
};
const nextChangeId = async (ctx: SimWriteContext) => {
  const year = ctx.now().getUTCFullYear();
  const ids = (await refChanges(ctx)).map((c) => c.changeId).filter((x: string) => x.startsWith(`CR-${year}-`));
  const top = ids.reduce((m: number, x: string) => Math.max(m, Number(x.slice(8)) || 0), 0);
  const seq = ctx.state<Record<string, number>>('regSeq', () => ({}));
  const n = Math.max(seq[`CR-${year}`] ?? 0, top) + 1;
  seq[`CR-${year}`] = n;
  return `CR-${year}-${String(n).padStart(3, '0')}`;
};
const nextRefIdOr409 = (ctx: SimWriteContext, domainAbbr: string, componentAbbr: string, used: string[]) => {
  try {
    return nextRefId(domainAbbr, componentAbbr, used);
  } catch (e) {
    return ctx.fail('CONFLICT', `${domainAbbr}-${componentAbbr}- 일련번호를 모두 썼습니다(999) — 새 컴포넌트 약어로 요청하세요.`, { prefix: `${domainAbbr}-${componentAbbr}-`, cause: (e as Error).message });
  }
};

registerSimHandler(
  'requestRefAdd',
  async (ctx) => {
    const body = ctx.req.body as z.infer<typeof RequestRefAddBody>;
    const domainAbbr = domainAbbrOf(body.domain) ?? (domainOfAbbr(body.domain.toUpperCase()) ? body.domain.toUpperCase() : undefined);
    if (!domainAbbr) ctx.fail('VALIDATION', `도메인 '${body.domain}'은(는) Feature DB 공식 도메인이 아닙니다.`, { field: 'domain' });
    const domain = domainOfAbbr(domainAbbr!)!;
    const tax = await taxonomy(ctx);
    const refs = await allRefs(ctx);
    const used = await usedRefIds(ctx);
    // 컴포넌트 → 약어·클러스터(서버 componentOf)
    let component: string, componentAbbr: string, cluster: string, newComponent = false;
    const node = tax.find((n) => n.level === 'COMPONENT' && n.parentId === domainAbbr && (same(n.nameEn, body.component) || same(n.nodeId, body.component) || (!!n.abbr && same(n.abbr, body.component))));
    const existing = refs.find((r) => r.domain === domain && same(r.component, body.component));
    if (node?.abbr) {
      const clusterNode = node.clusterIds?.length ? tax.find((n) => n.nodeId === node.clusterIds[0]) : undefined;
      const fromRefs = refs.find((r) => r.domain === domain && r.component === node.nameEn)?.cluster;
      component = node.nameEn;
      componentAbbr = node.abbr;
      cluster = body.cluster ?? clusterNode?.nameEn ?? fromRefs ?? ctx.fail('VALIDATION', `컴포넌트 '${node.nameEn}'의 클러스터를 찾을 수 없습니다 — 클러스터(cluster)를 입력하세요.`, { field: 'cluster' });
    } else if (existing) {
      component = existing.component;
      componentAbbr = existing.refId.split('-')[1];
      cluster = body.cluster ?? existing.cluster;
    } else {
      if (!body.componentAbbr) ctx.fail('VALIDATION', `컴포넌트 '${body.component}'이(가) ${domain} 분류에 없습니다 — 새 컴포넌트라면 3글자 약어(componentAbbr)를 제안하세요.`, { field: 'componentAbbr' });
      const taken = tax.some((n) => n.level === 'COMPONENT' && n.parentId === domainAbbr && (n.abbr === body.componentAbbr || n.abbrs?.includes(body.componentAbbr))) || used.some((id) => id.startsWith(`${domainAbbr}-${body.componentAbbr}-`));
      if (taken) ctx.fail('CONFLICT', `약어 ${body.componentAbbr}은(는) ${domain}에서 이미 다른 컴포넌트가 씁니다 — 다른 약어를 제안하세요.`, { field: 'componentAbbr' });
      if (!body.cluster?.trim()) ctx.fail('VALIDATION', '새 컴포넌트는 클러스터(cluster)를 함께 입력하세요.', { field: 'cluster' });
      component = body.component.trim();
      componentAbbr = body.componentAbbr!;
      cluster = body.cluster!.trim();
      newComponent = true;
    }
    const refId = nextRefIdOr409(ctx, domainAbbr!, componentAbbr, used);
    const at = ctx.iso();
    const changeId = await nextChangeId(ctx);
    const basis = body.basisNote.trim();
    const ref = {
      refId, status: 'PENDING', replacedBy: null, registeredIn: '', evidenceCheckedAt: at.slice(0, 10), domain, cluster, component,
      swStack: body.swStack ?? '', lifecycle: body.lifecycle ?? '', techStack: body.techStack ?? '', vehicleType: '', region: '',
      nameEn: body.nameEn, nameKo: body.nameKo, aliases: [], autoQuality: '', techQuality: '', asilRep: body.asilRep, method: '', tshirt: body.tshirt,
      bundleId: null, bundleRep: null, sizeEvidenceGrade: null, benchmarkEur: null, kearneyNote: '', makeBuyVolume: '', makeBuyPremium: '', relevance: '',
      sourceIds: body.sourceIds, sourceDetail: '', remark: basis, basisType: body.sourceIds.length ? '' : '근거 메모', duplicateOf: null, requires: [], excludes: [],
      procurement: '', swPackage: '', licenseItem: '', billing: '', definition: null,
      adminMemo: `${changeId} 등록 화면 추가 요청(${ctx.actor.id})${newComponent ? ` — 새 컴포넌트 약어 ${componentAbbr} 제안` : ''}`,
    };
    const change = {
      changeId, kind: 'ADD', refId, before: null, after: ref,
      reason: [`등록 화면 추가 요청 — ${body.nameKo}`, newComponent ? `새 컴포넌트 '${component}' 약어 ${componentAbbr} 제안(분류 표 추가 승인 필요)` : '', basis ? `근거: ${basis}` : ''].filter(Boolean).join(' · '),
      requestedBy: ctx.actor.id, requestedAt: at, status: 'REVIEW', reviews: [], decision: null, release: null,
      checks: checkRegistration(ref as any, { kind: 'ADD', usedIds: used, sourceIds: await sourceIds(ctx) }),
      fromRegistration: true,
      ...(newComponent ? { newComponent: { component, abbr: componentAbbr, cluster } } : {}),
    };
    ctx.put(REF, refId, ref, { created: true });
    ctx.put(CHANGE, changeId, change, { created: true });
    ctx.audit({ action: 'REFDB_ADD_REQUEST', target: refId, after: { ref: maskMoney(ref), changeId, newComponent: newComponent ? { component, abbr: componentAbbr } : null }, componentId: 'D01-01' });
    ctx.emit('refdb.ref.requested', refId, { refId, changeId, domain, component, nameKo: ref.nameKo, by: ctx.actor.id }, { componentId: 'D01-01' });
    const view = hideBenchmark(ref, ctx.actor.role);
    return { ref: view, change: { ...change, after: view } };
  },
  { body: RequestRefAddBody },
);

/** 변경 요청 자동 점검(서버 checksFor) — 이 요청이 잡아 둔 ID는 '이미 쓴 ID'로 보지 않는다 */
async function checksFor(ctx: SimReadContext, kind: string, row: any, ownReservation: boolean) {
  const refs = await allRefs(ctx);
  const real = refs.find((r) => r.refId === row.refId);
  let used = await usedRefIds(ctx);
  if (kind === 'ADD' && ownReservation && (!real || real.status === 'PENDING')) used = used.filter((x) => x !== row.refId);
  return checkRegistration(row, { kind: kind as any, usedIds: used, existingIds: refs.filter((r) => r.status !== 'PENDING').map((r) => r.refId), sourceIds: await sourceIds(ctx) });
}
const isOpenChange = (c: any) => c.release === null && (c.status === 'DRAFT' || c.status === 'REVIEW' || c.status === 'APPROVED' || (c.status === 'REJECTED' && c.kind === 'ADD'));
const draftRefRow = (refId: string, patch: Record<string, unknown>, today: string) => ({
  replacedBy: null, registeredIn: '', evidenceCheckedAt: today, domain: '', cluster: '', component: '', swStack: '', lifecycle: '', techStack: '', vehicleType: '', region: '',
  nameEn: '', nameKo: '', aliases: [], autoQuality: '', techQuality: '', method: '', tshirt: '', bundleId: null, bundleRep: null, sizeEvidenceGrade: null, benchmarkEur: null,
  kearneyNote: '', makeBuyVolume: '', makeBuyPremium: '', relevance: '', sourceIds: [], sourceDetail: '', remark: '', basisType: '', duplicateOf: null, requires: [], excludes: [],
  procurement: '', swPackage: '', licenseItem: '', billing: '', definition: null, adminMemo: '',
  ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
  refId,
  status: 'PENDING',
});
const applyDiff = (kind: string, cur: any, after: Record<string, unknown>) => {
  const next = { ...cur, ...after, refId: cur.refId };
  if (kind === 'DEPRECATE') next.status = 'DEPRECATED';
  if (kind === 'RETIRE') next.status = 'RETIRED';
  return next;
};
const staleFields = (cur: any, before: Record<string, unknown> | null) =>
  Object.entries(before ?? {})
    .filter(([k, v]) => canonicalJson(cur[k] ?? null) !== canonicalJson(v ?? null))
    .map(([k]) => k)
    .sort();

registerSimHandler(
  'createRefChange',
  async (ctx) => {
    const body = ctx.req.body as z.infer<typeof CreateRefChangeBody>;
    const requested = { ...(body.after as Record<string, any>) };
    if (!canSeeBenchmark(ctx.actor.role)) {
      const money = (REF_MONEY_FIELDS as readonly string[]).filter((k) => requested[k] !== undefined);
      if (money.length) {
        const message = `벤치마크 필드(${money.join('·')})는 산정 역할(Feature DB 관리자)만 바꿀 수 있습니다.`;
        ctx.fail('FORBIDDEN', message, { fields: money }, { action: 'REFDB_CHANGE_CREATE', target: body.refId ?? requested.refId ?? 'refdb:add', reason: message, componentId: 'D01-01', result: 'DENIED' });
      }
    }
    let refId: string, before: Record<string, unknown> | null, after: Record<string, unknown>, row: any;
    if (body.kind === 'ADD') {
      if (body.refId && requested.refId && requested.refId !== body.refId) ctx.fail('VALIDATION', '기준 행 ID(refId)와 after.refId가 다릅니다.', { field: 'after.refId' });
      const given = body.refId ?? requested.refId;
      const used = await usedRefIds(ctx);
      if (given) {
        const m = /^(.+-)(\d{3})$/.exec(given);
        if (m) {
          const max = used.filter((x) => x.startsWith(m[1])).reduce((n, x) => Math.max(n, Number(x.slice(m[1].length)) || 0), 0);
          if (Number(m[2]) > max + 1) ctx.fail('VALIDATION', `지정한 ID ${given}은(는) 다음 번호 ${m[1]}${String(max + 1).padStart(3, '0')}보다 큽니다 — ID를 비우면 다음 번호를 붙입니다.`, { field: 'refId' });
        }
      }
      let id = given;
      if (!id) {
        const domainAbbr = requested.domain ? domainAbbrOf(requested.domain) : undefined;
        if (!domainAbbr) ctx.fail('VALIDATION', '추가 요청은 공식 도메인(after.domain)을 입력하거나 기준 행 ID(refId)를 지정하세요.', { field: 'after.domain' });
        const node = (await taxonomy(ctx)).find((n) => n.level === 'COMPONENT' && n.parentId === domainAbbr && !!requested.component && (same(n.nameEn, requested.component) || (!!n.abbr && same(n.abbr, requested.component))));
        const abbr = node?.abbr ?? (requested.component ? (await allRefs(ctx)).find((x) => x.domain === requested.domain && same(x.component, requested.component))?.refId.split('-')[1] : undefined);
        if (!abbr) ctx.fail('VALIDATION', `컴포넌트 '${requested.component ?? ''}'의 약어를 찾을 수 없습니다 — 기준 행 ID(refId)를 지정하세요(새 컴포넌트는 등록 화면 추가 요청으로).`, { field: 'refId' });
        id = nextRefIdOr409(ctx, domainAbbr!, abbr!, used);
      }
      refId = id!;
      row = draftRefRow(refId, requested, ctx.iso().slice(0, 10));
      before = null;
      after = row;
    } else {
      refId = body.refId!;
      const cur = await refOf(ctx, refId);
      if (!cur) ctx.fail('NOT_FOUND', `기준 행 ${refId}이(가) Feature DB에 없습니다.`);
      if (cur.status === 'PENDING') ctx.fail('CONFLICT', `기준 행 ${refId}은(는) 요청 중입니다 — 추가 요청이 승인·발행된 뒤 변경을 요청하세요.`);
      if (cur.status === 'RETIRED') ctx.fail('CONFLICT', `기준 행 ${refId}은(는) 폐기되었습니다 — 폐기한 행은 바꾸지 않습니다(ID 재사용 금지).`);
      if (requested.refId !== undefined && requested.refId !== refId) ctx.fail('VALIDATION', '기준 행 ID는 바꿀 수 없습니다.', { field: 'after.refId' });
      delete requested.refId;
      if (body.kind === 'MODIFY' && requested.status !== undefined && !['ACTIVE', 'REVIEW'].includes(requested.status)) ctx.fail('VALIDATION', '수정 요청으로는 상태를 활성·검토 필요로만 바꿀 수 있습니다 — 폐기 예정·폐기는 그 종류로 요청하세요.', { field: 'after.status' });
      if (body.kind === 'DEPRECATE') {
        requested.status = 'DEPRECATED';
        const to = requested.replacedBy;
        if (to) {
          const t = await refOf(ctx, to);
          if (to === refId || !t || t.status === 'RETIRED' || t.status === 'PENDING') ctx.fail('VALIDATION', `대체 행 ${to}은(는) 선택할 수 있는 다른 기준 행이어야 합니다.`, { field: 'after.replacedBy' });
        }
      }
      if (body.kind === 'RETIRE') requested.status = 'RETIRED';
      before = {};
      after = {};
      for (const [k, v] of Object.entries(requested)) {
        if (v === undefined || k === 'refId') continue;
        if (canonicalJson(cur[k] ?? null) === canonicalJson(v ?? null)) continue;
        before[k] = cur[k] ?? null;
        after[k] = v;
      }
      if (!Object.keys(after).length) ctx.fail('VALIDATION', '바뀌는 필드가 없습니다.', { field: 'after' });
      row = applyDiff(body.kind, cur, after);
    }
    const open = (await refChanges(ctx)).find((c) => c.refId === refId && isOpenChange(c));
    if (open) ctx.fail('CONFLICT', `기준 행 ${refId}에는 진행 중인 변경 요청 ${open.changeId}이(가) 있습니다 — 그 요청이 발행되거나 반려된 뒤 다시 요청하세요.`, { changeId: open.changeId });
    const checks = await checksFor(ctx, body.kind, row, false);
    const blockingChecks = checks.filter((c) => !c.ok && c.blocking);
    if (blockingChecks.length) ctx.fail('VALIDATION', `등록 기준을 채우지 못해 제출할 수 없습니다: ${blockingChecks.map((c) => c.message).join(' / ')}`, { checks: blockingChecks });
    const change = { changeId: await nextChangeId(ctx), kind: body.kind, refId, before, after, reason: body.reason, requestedBy: ctx.actor.id, requestedAt: ctx.iso(), status: 'REVIEW', reviews: [], decision: null, release: null, checks };
    ctx.put(CHANGE, change.changeId, change, { created: true });
    ctx.audit({ action: 'REFDB_CHANGE_CREATE', target: change.changeId, after: { refId, kind: change.kind, before: maskMoney(before), after: maskMoney(after), advisory: checks.filter((c) => !c.ok) }, reason: body.reason, componentId: 'D01-01' });
    ctx.emit('refdb.change.created', change.changeId, { changeId: change.changeId, refId, kind: change.kind, by: ctx.actor.id, advisory: checks.filter((c) => !c.ok && !c.blocking).map((c) => c.id) }, { componentId: 'D01-01' });
    return { ...(await changeView(ctx, change)), before: hideBenchmark(before, ctx.actor.role), after: hideBenchmark(after, ctx.actor.role) };
  },
  { body: CreateRefChangeBody },
);

/** 변경 요청 — 시연 값 또는 스냅샷 상세 */
async function changeOf(ctx: SimWriteContext, changeId: string): Promise<any> {
  const c = ctx.get<any>(CHANGE, changeId) ?? (await ctx.snapshot<any>('refChangeDetail', { id: changeId }))?.change;
  if (!c) ctx.fail('NOT_FOUND', `변경 요청 ${changeId}이(가) 없습니다.`);
  const { awaitingPublish: _a, domain: _d, ...rest } = c;
  return rest;
}
/** 직무 분리(SOD-13·14·15, 계정 기준) — 막히면 거부 감사(DENIED, 사유에 규칙 ID) 뒤 403 */
function separate(ctx: SimWriteContext, c: any, stage: 'REVIEW' | 'DECIDE', action: string) {
  const blocked = refChangeDuty(c, ctx.actor.id, stage);
  if (blocked) ctx.fail('SEPARATION_OF_DUTY', blocked.message, { rule: blocked.rule, changeId: c.changeId }, { action, target: c.changeId, reason: `${blocked.message} (${blocked.rule})`, componentId: 'D01-01', result: 'DENIED' });
}
const mustBeDecidable = (ctx: SimWriteContext, c: any) => {
  if (!['DRAFT', 'REVIEW'].includes(c.status)) ctx.fail('CONFLICT', `변경 요청 ${c.changeId}은(는) 검토·승인할 단계가 아닙니다(지금 ${c.status}).`, { status: c.status });
};
const OPINION_KO: Record<string, string> = { AGREE: '동의', REVISE: '보완', OPPOSE: '반대' };

registerSimHandler(
  'reviewRefChange',
  async (ctx) => {
    const c = await changeOf(ctx, ctx.req.params.id);
    separate(ctx, c, 'REVIEW', 'REFDB_CHANGE_REVIEW');
    mustBeDecidable(ctx, c);
    const body = ctx.req.body as { opinion: string; comment: string };
    const review = { reviewerId: ctx.actor.id, opinion: body.opinion, comment: body.comment, at: ctx.iso() };
    const next = { ...c, status: 'REVIEW', reviews: [...c.reviews.filter((r: any) => r.reviewerId !== ctx.actor.id), review] };
    ctx.put(CHANGE, c.changeId, next);
    ctx.audit({ action: 'REFDB_CHANGE_REVIEW', target: c.changeId, before: { status: c.status, reviews: c.reviews.length }, after: review, reason: body.comment, componentId: 'D01-01' });
    ctx.emit('refdb.change.reviewed', c.changeId, { changeId: c.changeId, refId: c.refId, opinion: body.opinion, by: ctx.actor.id }, { componentId: 'D01-01', notify: { refChange: { changeId: c.changeId, refId: c.refId, kind: c.kind, requestedBy: c.requestedBy, reason: c.reason } } });
    return changeView(ctx, next);
  },
  { body: ReviewRefChangeBody },
);

registerSimHandler(
  'decideRefChange',
  async (ctx) => {
    const c = await changeOf(ctx, ctx.req.params.id);
    separate(ctx, c, 'DECIDE', 'REFDB_CHANGE_DECIDE');
    mustBeDecidable(ctx, c);
    const body = ctx.req.body as { decision: 'APPROVE' | 'REJECT'; reason: string };
    let checks = c.checks ?? [];
    if (body.decision === 'APPROVE') {
      if (!c.reviews.length) ctx.fail('GUARD_FAILED', '도메인 검토 의견이 하나 이상 있어야 승인할 수 있습니다.', { code: 'REVIEW_REQUIRED' });
      const last = c.reviews.at(-1);
      if (last.opinion !== 'AGREE') ctx.fail('GUARD_FAILED', `마지막 도메인 검토 의견이 '${OPINION_KO[last.opinion]}'입니다 — 동의 의견을 받은 뒤 승인하세요.`, { code: 'REVIEW_NOT_AGREED', opinion: last.opinion, reviewerId: last.reviewerId });
      const cur = await refOf(ctx, c.refId);
      let row: any;
      let stale: string[] = [];
      if (c.kind === 'ADD') {
        if (cur && cur.status !== 'PENDING') stale = ['refId'];
        row = cur && cur.status !== 'PENDING' ? { ...cur } : { ...(cur ?? {}), ...c.after, refId: c.refId };
      } else {
        if (!cur) ctx.fail('NOT_FOUND', `기준 행 ${c.refId}이(가) Feature DB에 없습니다.`);
        row = applyDiff(c.kind, cur, c.after);
        stale = staleFields(cur, c.before);
      }
      if (stale.length) ctx.fail('CONFLICT', `요청 뒤에 기준 행 ${c.refId}의 ${stale.join('·')}이(가) 바뀌었습니다 — 반려하고 새로 요청하세요.`, { fields: stale });
      checks = await checksFor(ctx, c.kind, row, true);
      // 등록 화면 추가 요청이 출처 ID 없이 근거 메모만 냈으면 출처 ID 누락은 막지 않는다(승인하면 '검토 필요'로 발행)
      const blockers = blockingFailures(checks).filter((x) => !(x.id === 'REQUIRED_INFO' && c.kind === 'ADD' && c.fromRegistration && /^필수 정보 누락: 출처 ID$/.test(x.message) && !!row.remark?.trim()));
      if (blockers.length) ctx.fail('GUARD_FAILED', `필수 정보가 빠져 승인할 수 없습니다: ${blockers.map((b) => b.message).join(' / ')}`, { checks: blockers });
    }
    const decision = { decision: body.decision, decidedBy: ctx.actor.id, reason: body.reason, at: ctx.iso() };
    const next = { ...c, status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decision, checks };
    ctx.put(CHANGE, c.changeId, next);
    ctx.audit({ action: 'REFDB_CHANGE_DECIDE', target: c.changeId, before: { status: c.status }, after: { status: next.status, decision }, reason: body.reason, componentId: 'D01-01' });
    ctx.emit('refdb.change.decided', c.changeId, { changeId: c.changeId, refId: c.refId, kind: c.kind, decision: body.decision, by: ctx.actor.id, requestedBy: c.requestedBy }, { componentId: 'D01-01' });
    return changeView(ctx, next);
  },
  { body: DecideRefChangeBody },
);

registerSimHandler(
  'publishRefRelease',
  async (ctx) => {
    const body = ctx.req.body as { changeIds: string[]; note: string };
    const all = await refChanges(ctx);
    const full = await Promise.all(all.map((c) => (ctx.get(CHANGE, c.changeId) ? c : changeOf(ctx, c.changeId))));
    const candidates: any[] = [];
    for (const c of full) if (c.release === null && (c.status === 'APPROVED' || (c.status === 'REJECTED' && c.kind === 'ADD' && (await refOf(ctx, c.refId))?.status === 'PENDING'))) candidates.push(c);
    const selected = body.changeIds.length
      ? body.changeIds.map((id) => candidates.find((x) => x.changeId === id) ?? ctx.fail('CONFLICT', `변경 요청 ${id}은(는) 발행할 수 없습니다 — 승인되고 아직 발행되지 않은 요청만 묶습니다.`, { changeId: id }))
      : candidates;
    if (!selected.length) ctx.fail('CONFLICT', '발행할 변경 요청이 없습니다 — 승인된(발행 대기) 요청이 있어야 합니다.');
    const ordered = [...new Map(selected.map((c) => [c.changeId, c])).values()].sort((a, b) => a.changeId.localeCompare(b.changeId, 'en', { numeric: true }));
    const latest = await latestRelease(ctx);
    const m = /^v(\d+)\.(\d+)$/.exec(latest);
    const release = m ? `v${m[1]}.${Number(m[2]) + 1}` : 'v1.0';
    const at = ctx.iso();
    const applied: any[] = [];
    const retired: any[] = [];
    const memo = (a: string, line: string) => (a?.trim() ? `${a.trim()}\n${line}` : line);
    for (const c of ordered) {
      const cur = await refOf(ctx, c.refId);
      if (c.status === 'REJECTED') {
        const row = { ...cur, status: 'RETIRED', adminMemo: memo(cur.adminMemo, `${c.changeId} 추가 요청 반려(${release}): ${c.decision?.reason ?? ''}`.trim()) };
        ctx.put(REF, c.refId, row);
        const features = (await usersOf(ctx, c.refId)).map((u) => ({ featureId: u.featureId, version: u.version }));
        retired.push({ changeId: c.changeId, refId: c.refId, features });
        for (const f of features) {
          const fe = await featureOf(ctx, f.featureId, f.version);
          ctx.emit('refdb.ref.rejected', fkey(f.featureId, f.version), { featureId: f.featureId, version: f.version, refId: c.refId, nameKo: row.nameKo, changeId: c.changeId, reason: c.decision?.reason ?? '', release, by: ctx.actor.id }, { componentId: 'D01-01', ...(fe ? { notify: notifyFeature(fe.row) } : {}) });
        }
        applied.push({ changeId: c.changeId, refId: c.refId, kind: c.kind, status: 'RETIRED' });
        continue;
      }
      if (c.kind === 'ADD') {
        if (cur && cur.status !== 'PENDING') ctx.fail('CONFLICT', `기준 행 ${c.refId}이(가) 이미 Feature DB에 있습니다 — ${c.changeId}을(를) 발행할 수 없습니다.`, { changeId: c.changeId });
        const merged = { ...(cur ?? {}), ...c.after, refId: c.refId };
        const sourceMissing = !merged.sourceIds?.length || (c.checks ?? []).some((x: any) => x.id === 'SOURCE_REGISTERED' && !x.ok);
        const status = sourceMissing || refAttrMissing(merged) ? 'REVIEW' : 'ACTIVE';
        const attrNote = refAttrMissing(merged) ? ' — SW 계층·수명주기·기술 영역 미입력으로 검토 필요' : '';
        ctx.put(REF, c.refId, { ...merged, status, registeredIn: release, adminMemo: memo(merged.adminMemo ?? '', `${c.changeId} 추가 승인·${release} 발행${attrNote}`) });
        const nc = c.newComponent;
        const taxonomyMade: string[] = [];
        if (nc) {
          const abbr = domainAbbrOf(merged.domain);
          const tax = await taxonomy(ctx);
          if (abbr && !tax.some((n) => n.level === 'COMPONENT' && n.parentId === abbr && (same(n.nameEn, nc.component) || n.abbr === nc.abbr || n.abbrs?.includes(nc.abbr)))) {
            const added = ctx.state<any[]>('refTaxonomyAdded', () => []);
            let cl = tax.find((n) => n.level === 'CLUSTER' && n.parentId === abbr && same(n.nameEn, nc.cluster));
            if (!cl) {
              cl = { nodeId: `${abbr}:${nc.cluster}`, level: 'CLUSTER', parentId: abbr, nameEn: nc.cluster, nameKo: '', abbr: null, status: 'ACTIVE' };
              added.push(cl);
              taxonomyMade.push(cl.nodeId);
            }
            added.push({ nodeId: `${abbr}/${nc.component}`, level: 'COMPONENT', parentId: abbr, nameEn: nc.component, nameKo: '', abbr: nc.abbr, abbrs: [nc.abbr], clusterIds: [cl.nodeId], status: 'ACTIVE' });
            taxonomyMade.push(`${abbr}/${nc.component}`);
          }
        }
        applied.push({ changeId: c.changeId, refId: c.refId, kind: c.kind, status, ...(taxonomyMade.length ? { taxonomy: taxonomyMade } : {}) });
        continue;
      }
      if (!cur) ctx.fail('NOT_FOUND', `기준 행 ${c.refId}이(가) Feature DB에 없습니다.`);
      const stale = staleFields(cur, c.before);
      if (stale.length) ctx.fail('CONFLICT', `요청 ${c.changeId} 뒤에 기준 행 ${c.refId}의 ${stale.join('·')}이(가) 바뀌었습니다 — 이 요청을 빼고 발행하세요.`, { changeId: c.changeId, fields: stale });
      const row = applyDiff(c.kind, cur, c.after);
      ctx.put(REF, c.refId, row);
      applied.push({ changeId: c.changeId, refId: c.refId, kind: c.kind, status: row.status });
    }
    // 전체 정규화 해시 — 요청 중이 아닌 모든 기준 행(refId 순)
    const rows = (await allRefs(ctx)).map((r) => ctx.get<any>(REF, r.refId) ?? r);
    for (const r of ctx.list<any>(REF)) if (!rows.some((x) => x.refId === r.refId)) rows.push(r);
    const hash = await sha256(canonicalJson(rows.filter((r) => r.status !== 'PENDING').sort((a, b) => (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0))));
    const rel = { release, publishedBy: ctx.actor.id, publishedAt: at, changeIds: ordered.map((c) => c.changeId), hash, ...(body.note ? { note: body.note } : {}) };
    ctx.state<any[]>('refReleases', () => []).push(rel);
    for (const c of ordered) ctx.put(CHANGE, c.changeId, { ...c, status: c.status === 'APPROVED' ? 'PUBLISHED' : c.status, release });
    ctx.audit({ action: 'REFDB_RELEASE_PUBLISH', target: release, before: { release: latest ?? null }, after: { release, changeIds: rel.changeIds, hash, applied }, reason: body.note || `Feature DB ${release} 발행`, componentId: 'D01-01' });
    ctx.emit('refdb.release.published', release, { release, changeIds: rel.changeIds, hash, by: ctx.actor.id, retired: retired.map((r) => r.refId) }, { componentId: 'D01-01' });
    return { release: rel, applied, retired };
  },
  { body: PublishRefReleaseBody },
);
// 발행 이력 — 시연에서 발행한 버전을 앞에
registerSimReader('refReleases', async (ctx) => {
  const mine = data<any[]>(ctx, 'refReleases', () => []);
  if (!mine.length) return undefined;
  const base = await ctx.snapshot<any>('refReleases');
  return { ...(base ?? {}), items: [...[...mine].reverse(), ...(base?.items ?? [])] };
});

// ─── 업무 절차 활동 완료·취소 ──────────────────────────────
registerSimHandler(
  'completeProcedureActivity',
  async (ctx) => {
    const activityId = ctx.req.params.id;
    const { index, preds } = await workflowIndex();
    const a = index.activities.find((x) => x.id === activityId);
    if (!a) ctx.fail('NOT_FOUND', '요청한 활동을 찾을 수 없습니다.');
    const orgs = await orgRoles(ctx.actor);
    const mine = kindOf(a!, orgs);
    if (!mine) ctx.fail('FORBIDDEN', `${a!.name}은(는) 내 역할의 활동이 아닙니다.`, undefined, { action: 'PROCEDURE_ACTIVITY_COMPLETE', target: activityId, reason: `내 조직 역할(${orgs.join(', ') || '없음'})의 수행(R)·책임(A) 활동이 아니다`, componentId: 'D04-04', result: 'DENIED' });
    const done = await completions(ctx);
    if (done.has(activityId)) ctx.fail('CONFLICT', `${a!.name}은(는) 이미 완료되었습니다.`);
    const blockers = (preds.get(activityId) ?? []).filter((id) => !done.has(id)).map((id) => `${id} ${index.activities.find((x) => x.id === id)?.name ?? ''}`.trim());
    if (blockers.length) ctx.fail('GUARD_FAILED', `${a!.name}은(는) 앞 활동이 끝나야 시작할 수 있습니다.`, { blockers }, { action: 'PROCEDURE_ACTIVITY_COMPLETE', target: activityId, reason: `앞 활동 미완료: ${blockers.join(', ')}`, componentId: 'D04-04' });
    const body = ctx.req.body as { note?: string; evidence: any[]; sign: boolean };
    const at = ctx.iso();
    const base = { activityId, processId: a!.processId, roleId: mine!.roleId, completedBy: ctx.actor.id, completedRole: ctx.actor.role, completedAt: at, note: body.note?.trim() ? body.note.trim() : null, evidence: body.evidence };
    const canonical = jcs(base);
    const signature = body.sign ? { kid: apr(ctx.actor.id), signedBy: ctx.actor.id, signedAt: at, digest: await sha256(canonical), value: await demoSign(apr(ctx.actor.id), canonical) } : null;
    const completion = { ...base, signature, signatureValid: signature ? true : null };
    ctx.state<Record<string, Completion | null>>('procDone', () => ({}))[activityId] = completion;
    const roleName = new Map(index.roles.map((r) => [r.id, r.name]));
    const platformRoles = (roleId: string) => index.roles.find((r) => r.id === roleId)?.platformRoles ?? [];
    const next = a!.next.map((nid) => {
      const n = index.activities.find((x) => x.id === nid)!;
      return { id: nid, name: n.name, platformRoles: [...new Set([...platformRoles(n.raci.R[0] ?? ''), ...platformRoles(n.raci.A)])] };
    });
    const nextIds = a!.next.flatMap((nid) => {
      const n = index.activities.find((x) => x.id === nid)!;
      return [n.raci.R[0], n.raci.A].filter(Boolean);
    });
    ctx.audit({ action: 'PROCEDURE_ACTIVITY_COMPLETE', target: activityId, after: { roleId: base.roleId, note: base.note, evidence: base.evidence.length, signed: !!signature }, reason: base.note ?? undefined, componentId: 'D04-04' });
    ctx.emit('procedure.activity.completed', activityId, { activityId, activityName: a!.name, processId: a!.processId, processName: a!.processName, roleId: base.roleId, roleName: roleName.get(base.roleId) ?? base.roleId, by: ctx.actor.id, next, nextRoleNames: [...new Set(nextIds)].map((rid) => `${roleName.get(rid) ?? rid}(${rid})`).join(', ') }, { componentId: 'D04-04' });
    return { completion };
  },
  { body: ProcedureCompleteBody },
);

registerSimHandler(
  'undoProcedureActivity',
  async (ctx) => {
    const activityId = ctx.req.params.id;
    const { index } = await workflowIndex();
    const a = index.activities.find((x) => x.id === activityId);
    if (!a) ctx.fail('NOT_FOUND', '요청한 활동을 찾을 수 없습니다.');
    const orgs = await orgRoles(ctx.actor);
    if (!kindOf(a!, orgs)) ctx.fail('FORBIDDEN', `${a!.name}은(는) 내 역할의 활동이 아닙니다.`, undefined, { action: 'PROCEDURE_ACTIVITY_UNDO', target: activityId, reason: '내 역할의 활동이 아니다', componentId: 'D04-04', result: 'DENIED' });
    const done = await completions(ctx);
    const row = done.get(activityId);
    if (!row) ctx.fail('NOT_FOUND', `${a!.name}은(는) 완료되지 않았습니다.`);
    ctx.state<Record<string, Completion | null>>('procDone', () => ({}))[activityId] = null;
    ctx.audit({ action: 'PROCEDURE_ACTIVITY_UNDO', target: activityId, before: { completedBy: row!.completedBy, completedAt: row!.completedAt }, reason: '활동 완료 취소', componentId: 'D04-04' });
    ctx.emit('procedure.activity.reopened', activityId, { activityId, processId: a!.processId, by: ctx.actor.id }, { componentId: 'D04-04' });
    done.delete(activityId);
    const items = index.activities.filter((x) => done.has(x.id)).map((x) => done.get(x.id)!);
    return { items, done: items.map((i) => i.activityId), updatedAt: items.map((i) => i.completedAt).sort().at(-1) ?? null };
  },
  { body: z.object({}).strict() },
);

// ─── 의존관계 등록·판정(D01-02, 서버 TopologyService) ──────
async function allDependencies(ctx: SimReadContext): Promise<any[]> {
  const base: any[] = (await ctx.snapshot<any>('dependencies'))?.items ?? [];
  const mine = new Map(ctx.list<any>(DEP).map((d) => [d.dependencyId, d]));
  return [...base.map((d) => mine.get(d.dependencyId) ?? d), ...[...mine.values()].filter((d) => !base.some((b) => b.dependencyId === d.dependencyId))];
}
registerSimReader('dependencies', async (ctx) => {
  if (!ctx.list(DEP).length) return undefined;
  const q = ctx.req.query;
  return { items: (await allDependencies(ctx)).filter((d) => (!q.featureId || d.sourceFeatureId === q.featureId || d.targetFeatureId === q.featureId) && (!q.type || d.type === q.type) && (!q.verdict || d.verdict === q.verdict)) };
});
/** 이 Version이 원천·대상인 의존관계 — Feature 상세·전이 문맥 */
async function dependenciesOf(ctx: SimReadContext, id: string, ver: string, base: any) {
  if (!ctx.list(DEP).length) return base?.dependencies ?? { outgoing: [], incoming: [] };
  const all = await allDependencies(ctx);
  return { outgoing: all.filter((d) => d.sourceFeatureId === id && d.sourceVersion === ver), incoming: all.filter((d) => d.targetFeatureId === id) };
}
/** 원천 Lifecycle이 바뀌면 관계를 다시 판정한다(서버 rejudgeOutgoing) */
async function rejudgeOutgoing(ctx: SimWriteContext, f: Row) {
  for (const d of (await allDependencies(ctx)).filter((x) => x.sourceFeatureId === f.featureId && x.sourceVersion === f.version)) {
    const target = d.targetVersion ? (await featureOf(ctx, d.targetFeatureId, d.targetVersion))?.row : undefined;
    const j = judgeDependency(d, f, target);
    if (j.verdict === d.verdict) continue;
    ctx.put(DEP, d.dependencyId, { ...d, verdict: j.verdict, rationale: j.rationale });
    ctx.emit('dependency.rejudged', d.dependencyId, { from: d.verdict, to: j.verdict, rationale: j.rationale }, { componentId: 'D01-02' });
  }
}
registerSimHandler(
  'createDependency',
  async (ctx) => {
    const body = ctx.req.body as { type: string; sourceFeatureId: string; sourceVersion: string; targetFeatureId: string; targetVersion: string | null };
    const label = `${body.sourceFeatureId}@${body.sourceVersion} ${body.type} ${body.targetFeatureId}@${body.targetVersion ?? '?'}`;
    const reject = (code: string, msg: string, details?: unknown): never => ctx.fail(code, msg, details, { action: 'DEPENDENCY_CREATE', target: label, reason: msg, componentId: 'D01-02' });
    const source = await featureOf(ctx, body.sourceFeatureId, body.sourceVersion);
    const target = body.targetVersion ? await featureOf(ctx, body.targetFeatureId, body.targetVersion) : null;
    if (!source) reject('NOT_FOUND', `원천 ${body.sourceFeatureId} ${body.sourceVersion}이(가) Registry에 없습니다.`);
    if (source!.row.lifecycle !== 'PROPOSED') reject('IMMUTABLE', `원천 버전이 ${source!.row.lifecycle}입니다 — 의존관계 변경은 새 Version에서 하세요 (재판정 G1·G3).`);
    if (body.targetVersion && !target) reject('NOT_FOUND', `대상 ${body.targetFeatureId} ${body.targetVersion}이(가) Registry에 없습니다.`);
    const targetVersions = (await allSummaries(ctx)).filter((s) => s.featureId === body.targetFeatureId);
    if (!body.targetVersion && !targetVersions.length) reject('NOT_FOUND', `대상 ${body.targetFeatureId}이(가) Registry에 없습니다.`);
    const all = await allDependencies(ctx);
    const issues = validateNewDependency(all, body as any, source!.row, target?.row);
    if (issues.length) reject('GUARD_FAILED', issues.map((i) => i.message).join(' / '), { issues });
    const s = source!.row;
    const draft = {
      dependencyId: ctx.nextId('DEP', all.map((d) => d.dependencyId)),
      type: body.type,
      sourceFeatureId: body.sourceFeatureId,
      sourceVersion: body.sourceVersion,
      targetFeatureId: body.targetFeatureId,
      targetVersion: body.targetVersion,
      country: s.country,
      vehicleModel: s.vehicleModel,
      trim: s.trim,
      targetVersionCheck: targetVersions.length > 1 ? '버전 확정' : '단일 후보',
      ruleVersion: 'DATA-PRECHECK-1.0',
      _missing: body.targetVersion ? {} : { targetVersion: '미입력' },
    };
    const j = judgeDependency(draft as any, s, target?.row);
    const dep = { ...draft, verdict: j.verdict, rationale: j.rationale };
    ctx.put(DEP, dep.dependencyId, dep, { created: true });
    const missing = { ...s._missing };
    delete missing.dependencyIds;
    ctx.put(FEATURE, fkey(s.featureId, s.version), { ...source!, row: { ...s, dependencyIds: [...s.dependencyIds, dep.dependencyId].sort(), _missing: missing } });
    ctx.audit({ action: 'DEPENDENCY_CREATE', target: label, after: dep, componentId: 'D01-02' });
    ctx.emit('dependency.created', fkey(body.sourceFeatureId, body.sourceVersion), { dependencyId: dep.dependencyId, verdict: dep.verdict }, { componentId: 'D01-02' });
    return dep;
  },
  { body: CreateDependencyBody },
);

// ─── Flag Retirement 6단계(D01-01, 서버 RetirementService) ──
const RET = 'regRetirement'; // retirementId → Retirement
const retirementView = (r: any, now = new Date().toISOString()) => {
  const due = codeRemovalDue(r.approvedAt, r.nextReleaseAt);
  return { ...r, requiredApprovals: retirementApprovers(r.fClass), codeRemovalDue: due, overdue: !!due && !r.steps.CODE_REMOVED && now > due, next: RETIREMENT_STEPS.find((s) => s.step > 1 && !r.steps[s.key])?.key ?? null };
};
async function allRetirements(ctx: SimReadContext): Promise<any[]> {
  const base: any[] = (await ctx.snapshot<any>('flagRetirements'))?.items ?? [];
  const mine = new Map(ctx.list<any>(RET).map((r) => [r.retirementId, r]));
  const fresh = [...mine.values()].filter((r) => !base.some((b) => b.retirementId === r.retirementId)).sort((a, b) => (a.retirementId < b.retirementId ? 1 : -1));
  return [...fresh, ...base.map((r) => mine.get(r.retirementId) ?? r)];
}
registerSimReader('flagRetirements', async (ctx) => {
  if (!ctx.list(RET).length) return undefined;
  const base = await ctx.snapshot<any>('flagRetirements');
  return { ...(base ?? {}), items: (await allRetirements(ctx)).map((r) => (ctx.get(RET, r.retirementId) ? retirementView(r) : r)), steps: base?.steps ?? RETIREMENT_STEPS };
});
const stripView = ({ requiredApprovals: _a, codeRemovalDue: _c, overdue: _o, next: _n, ...r }: any) => r;
async function retirementOf(ctx: SimWriteContext, id: string) {
  const r = ctx.get<any>(RET, id) ?? (await allRetirements(ctx)).find((x) => x.retirementId === id);
  if (!r) ctx.fail('NOT_FOUND', `${id} Retirement 건을 찾을 수 없습니다.`);
  return structuredClone(stripView(r));
}
registerSimHandler(
  'requestFlagRetirement',
  async (ctx) => {
    const body = ctx.req.body as { flagKey: string; reason: string; nextReleaseAt: string | null };
    const pols: any[] = (await ctx.read<any>('listPolicies').catch(() => null))?.items ?? [];
    const p = pols.find((x) => x.flagKey === body.flagKey && (x.status === 'DEPLOYED' || x.status === 'APPROVED')) ?? pols.filter((x) => x.flagKey === body.flagKey).at(-1);
    if (!p) ctx.fail('NOT_FOUND', `${body.flagKey} 정책이 없습니다.`);
    const all = await allRetirements(ctx);
    if (all.some((r) => r.flagKey === body.flagKey && r.status !== 'CLOSED')) ctx.fail('CONFLICT', `${body.flagKey}은(는) 이미 Retirement 진행 중입니다.`);
    const r = { retirementId: `RET-${pad(all.length + 1)}`, flagKey: body.flagKey, featureId: p.featureId, featureVersion: p.featureVersion, fClass: (await safetyOf(ctx, p.featureId, p.featureVersion)).fClass, reason: body.reason, nextReleaseAt: body.nextReleaseAt, requestedBy: ctx.actor.id, requestedAt: ctx.iso(), status: 'REQUESTED', approvals: [], approvedAt: null, steps: {} };
    ctx.put(RET, r.retirementId, r, { created: true });
    ctx.audit({ action: 'FLAG_RETIREMENT_REQUEST', target: r.retirementId, after: { flagKey: r.flagKey, featureId: r.featureId, fClass: r.fClass, reason: r.reason }, componentId: 'D01-01' });
    return retirementView(r);
  },
  { body: RetirementRequestBody },
);
registerSimHandler(
  'approveFlagRetirement',
  async (ctx) => {
    const id = ctx.req.params.id;
    const r = await retirementOf(ctx, id);
    const need = retirementApprovers(r.fClass);
    if (r.status !== 'REQUESTED') ctx.fail('GUARD_FAILED', `${r.status} Retirement 건은 승인할 수 없습니다.`);
    if (ctx.actor.id === r.requestedBy || r.approvals.some((a: any) => a.by === ctx.actor.id)) ctx.fail('SEPARATION_OF_DUTY', '요청자나 이미 승인한 사람은 승인할 수 없습니다.', undefined, { action: 'FLAG_RETIREMENT_APPROVE', target: id, reason: '요청자·같은 승인자 중복', componentId: 'D01-01' });
    if (!need.includes(ctx.actor.role) || r.approvals.some((a: any) => a.role === ctx.actor.role)) ctx.fail('FORBIDDEN', `필요한 승인 역할: ${need.join(', ')}`);
    const at = ctx.iso();
    r.approvals.push({ by: ctx.actor.id, role: ctx.actor.role, at });
    if (need.every((role) => r.approvals.some((a: any) => a.role === role))) {
      r.approvedAt = at;
      r.status = 'APPROVED';
    }
    ctx.put(RET, id, r);
    ctx.audit({ action: 'FLAG_RETIREMENT_APPROVE', target: id, after: { approvals: r.approvals, status: r.status, codeRemovalDue: codeRemovalDue(r.approvedAt, r.nextReleaseAt) }, componentId: 'D01-01' });
    return retirementView(r);
  },
  { body: z.object({}).strict() },
);
registerSimHandler(
  'recordFlagRetirementStep',
  async (ctx) => {
    const id = ctx.req.params.id;
    const body = ctx.req.body as { step: string } & Record<string, unknown>;
    const r = await retirementOf(ctx, id);
    const blocker = retirementBlocker(r, body as any, retirementApprovers(r.fClass));
    if (blocker) ctx.fail('GUARD_FAILED', blocker, { rule: 'FFG-LCY-011' }, { action: `FLAG_RETIREMENT_${body.step}`, target: id, reason: blocker, componentId: 'D01-01' });
    const at = ctx.iso();
    let stepData: Record<string, unknown> = { ...body };
    if (body.step === 'REMAINING_VEHICLES') {
      // 이 Flag 정책을 받은 차량(게시본 대상) × 차량 상태 보고의 최신 Feature Version
      const pubs: any[] = (await ctx.read<any>('publications', {}, { kind: 'POLICY' }).catch(() => null))?.items ?? [];
      const targets = new Set<string>(pubs.filter((p) => p.payload?.flagKey === r.flagKey).flatMap((p) => p.payload?.targets ?? []));
      const onOld: string[] = [];
      const unknown: string[] = [];
      for (const vin of [...targets].sort()) {
        const st = await ctx.snapshot<any>('vehicleStatusView', { vin });
        const v = (st?.features ?? []).find((x: any) => x.featureId === r.featureId)?.report?.feature?.version;
        if (v === undefined) unknown.push(vin);
        else if (v === r.featureVersion) onOld.push(vin);
      }
      stepData = { onOldVersion: onOld, unreported: unknown, at };
    }
    r.steps[body.step] = { at, by: ctx.actor.id, data: stepData };
    if (body.step === 'REGISTRY_RETIRED') {
      // Registry 퇴역 — 이 Flag의 배포 정책은 RETIRED(ID 재사용 금지, 정책 화면도 같은 상태)
      const pols: any[] = (await ctx.read<any>('listPolicies').catch(() => null))?.items ?? [];
      for (const p of pols.filter((x) => x.flagKey === r.flagKey && x.status === 'DEPLOYED')) ctx.put('policy', p.policyId, { ...(ctx.get<any>('policy', p.policyId) ?? p), status: 'RETIRED' });
      r.status = 'RETIRED';
    }
    if (body.step === 'RECORDS_RETAINED') r.status = 'CLOSED';
    ctx.put(RET, id, r);
    ctx.audit({ action: `FLAG_RETIREMENT_${body.step}`, target: id, after: { flagKey: r.flagKey, ...stepData }, componentId: 'D01-01' });
    ctx.emit('flag.retirement.step', id, { retirementId: id, flagKey: r.flagKey, step: body.step, status: r.status }, { componentId: 'D01-01' });
    return retirementView(r);
  },
  { body: RetirementStepBody },
);

// ─── Feature DB 출처 정기 점검(§8.5) ───────────────────────
registerSimReader('refSources', async (ctx) => {
  const patch = data<Record<string, any>>(ctx, 'refSourcesPatch', () => ({}));
  if (!Object.keys(patch).length) return undefined;
  const base = await ctx.snapshot<any>('refSources');
  const items = ((base?.items ?? []) as any[]).map((s) => (patch[s.sourceId] ? { ...s, ...patch[s.sourceId] } : s));
  return { ...(base ?? {}), items, noNextReview: items.filter((s) => !s.nextReviewAt).length };
});
registerSimHandler(
  'recordSourceReview',
  async (ctx) => {
    const body = ctx.req.body as { sourceIds: string[]; checkedAt?: string; nextReviewAt: string; note: string; result: string };
    const today = ctx.iso().slice(0, 10);
    const checkedAt = body.checkedAt ?? today;
    if (checkedAt > today) ctx.fail('VALIDATION', `확인일(${checkedAt})은 오늘(${today}) 뒤일 수 없습니다.`, { field: 'checkedAt' });
    if (body.nextReviewAt <= checkedAt) ctx.fail('VALIDATION', '다음 점검일은 확인일보다 뒤여야 합니다.', { field: 'nextReviewAt' });
    const patch = ctx.state<Record<string, any>>('refSourcesPatch', () => ({}));
    const sources: any[] = ((await ctx.snapshot<any>('refSources'))?.items ?? []).map((s: any) => ({ ...s, ...(patch[s.sourceId] ?? {}) }));
    const unknown = body.sourceIds.filter((sid) => !sources.some((s) => s.sourceId === sid));
    if (unknown.length) ctx.fail('NOT_FOUND', `출처 ${unknown.join(', ')}이(가) Feature DB 출처 표에 없습니다.`, { sourceIds: unknown });
    const result = body.result ?? 'NO_CHANGE';
    const refs = result === 'REVISED' ? (await allRefs(ctx)).filter((r) => r.status !== 'RETIRED' && r.status !== 'PENDING') : [];
    const items = body.sourceIds.map((sid) => {
      const before = sources.find((s) => s.sourceId === sid);
      const { usedBy: _u, ...rest } = before;
      patch[sid] = { checkedAt, nextReviewAt: body.nextReviewAt, lastResult: result };
      ctx.audit({ action: 'REFDB_SOURCE_REVIEW', target: sid, before: { checkedAt: before.checkedAt, nextReviewAt: before.nextReviewAt }, after: { checkedAt, nextReviewAt: body.nextReviewAt, result }, reason: body.note, componentId: 'D01-01' });
      ctx.emit('refdb.source.reviewed', sid, { sourceId: sid, checkedAt, nextReviewAt: body.nextReviewAt, result, by: ctx.actor.id }, { componentId: 'D01-01' });
      return { ...rest, checkedAt, nextReviewAt: body.nextReviewAt, lastResult: result };
    });
    return { items, affected: body.sourceIds.map((sid) => ({ sourceId: sid, refIds: refs.filter((r) => (r.sourceIds ?? []).includes(sid)).map((r) => r.refId) })) };
  },
  { body: RecordSourceReviewBody },
);
