import { scheduleOtaObservation } from '../p9';
import { gxActiveKills, gxForDeploy, gxStageGuard } from '../gx-deploy';
// 시연 흐름 — 정책 운영(D01-06 정책·D06-04 검증·D01-08 단계 배포·D03-04 롤백·D06-12 이상 대응·D06-09 사후 검토·D06-03 가상검증·IF-04 Unleash).
// 서버 policy.service·staged-rollout·rollback.service·anomaly.service·post-review·virtual-validation·unleash-sync와 같은 순서·규칙(contracts 순수 규칙):
//  작성(DRAFT) → 분야별 검증 8종(runValidators → deploySafety) → 승인(publishCheck — 작성자≠승인자·해시·GO) → 배포(이전 배포본 RETIRED,
//  F2 이상 Canary 5% — deployStartBasisPoints, 서명 게시본 → 차량 회신은 차단 흐름과 같은 합성 'kill.readback') → 단계 조정(judgeStageChange —
//  관측 기간·배포자≠확대자·중단 기준) → 롤백(재검증 recoveryBlockers·scopeBlockers → 지정 승인대상자 → 실행: 지금 정책 RETIRED·복구 기준 DEPLOYED·
//  같은 내용 재서명 게시 → 회신 → 게시본이 닫히면 완료·실패). 이상 건은 게시본 닫힘(DELIVERY)·차단 발령(조치됨)을 서버처럼 구독한다.
import {
  canonicalJson,
  classifyAnomaly,
  cohortBucket,
  conditionText,
  CreatePolicyBody,
  CreateRollbackPlanBody,
  CreateRollbackRequestBody,
  DELIVERY_STATUS,
  DEMO_PERSONAS,
  deploySafety,
  deployStartBasisPoints,
  DUTY_ROLES,
  dutyConflicts,
  effectiveBasisPoints,
  evaluateFlag,
  failureRateTrigger,
  jcs,
  judgeStageChange,
  judgeVirtual,
  LIFECYCLE_RANK,
  oddRestrictionFindings,
  planUnleash,
  PolicyDecisionBody,
  policyChangeLog,
  policyDiff,
  POLICY_EDITABLE,
  PolicyRollbackBody,
  PolicySpec,
  policySpecOf,
  POST_REVIEW_MS,
  postReviewBlocker,
  PostReviewBody,
  publishCheck,
  recoveryBlockers,
  RestorePolicyRevisionBody,
  ROLLBACK_BLOCKER,
  ROLLBACK_TARGET_LABEL,
  RollbackDecisionBody,
  RollbackPreviewBody,
  RollbackScope,
  RolloutStageBody,
  runValidators,
  RunVirtualBody,
  scopeBlockers,
  scopeText,
  targetTypeBlockers,
  unleashContext,
  unleashDrift,
  unleashPartial,
  UpdatePolicyBody,
  AnomalyActionBody,
  variantRow,
  vehicleGroups,
  vehicleInScope,
  versionText,
  virtualScenariosFor,
  type PolicyRevision,
  type RollbackBlocker,
  type RollbackTargetType,
  type RollbackTrigger,
  type UnleashConstraint,
  type UnleashPlan,
  type ValidationInput,
} from '@ff/contracts';
import { z } from 'zod';
import type { PlatformEvent } from '../../shared-event-source';
import { registerSimHandler, registerSimListener, registerSimReader } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';
import { demoSign, REPLY_BATCHES, REPLY_DEADLINE_MS, REPLY_FIRST_MS, REPLY_STEP_MS } from './kill';

const POL = 'policy';
const RUN = 'policyRun';
const PUB = 'publication';
const ANM = 'anomaly';
const PLAN = 'rollbackPlan';
const RREQ = 'rollbackRequest';
const RBX = 'rollbackExecution';
const VV = 'virtualRun';
const EDITABLE: readonly string[] = POLICY_EDITABLE;
/** 시연 정책 게시본 서명 키 — 용도별(FFG-SEC-002) 시연 키. 실제 HSM 키가 아니다(설계 20-60 §한계, 차단 KEY-0901~0903과 같은 방식) */
export const POLICY_KID = 'KEY-0904';
const EmptyBody = z.object({}).strict();
const ReasonBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
/** 시스템 행위자 — 이상 대응·자동 롤백(서버 SYSTEM·system:rollback) */
const SYS = { actorId: 'system', actorRole: 'SYSTEM' };
const AUTO = { actorId: 'system:rollback', actorRole: 'SYSTEM' };

// ─── 공통 ─────────────────────────────────────────────────
const enc = new TextEncoder();
async function sha256hex(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** 정책 내용 해시 — 서버 policyHash와 같다(PolicySpec 칸만 정규 JSON → SHA-256) */
export async function policyHash(p: Record<string, unknown>): Promise<string> {
  const spec = PolicySpec.parse(Object.fromEntries(Object.keys(PolicySpec.shape).map((k) => [k, p[k]])));
  return 'sha256:' + (await sha256hex(canonicalJson(spec)));
}
const byIdDesc = (k: string) => (a: any, b: any) => String(b[k]).localeCompare(String(a[k]));

/** 스냅샷 목록 + 오버레이(ID 교체·새 것 앞) — 질의 없는 전체 목록을 바탕으로 */
async function merged<T = any>(ctx: SimReadContext, name: string, coll: string, idKey: string, extra: any[] = []): Promise<T[]> {
  const base: any[] = [...((await ctx.snapshot<{ items: any[] }>(name))?.items ?? []), ...extra];
  const seen = new Set<string>();
  const items: any[] = [];
  for (const x of base) {
    const id = String(x[idKey]);
    if (seen.has(id)) continue;
    seen.add(id);
    const e = ctx.get(coll, id);
    items.push(e ? { ...x, ...e } : x);
  }
  const fresh = ctx.list(coll).filter((e) => !seen.has(String(e[idKey]))).sort(byIdDesc(idKey));
  return [...fresh, ...items] as T[];
}
const touched = (ctx: SimReadContext, ...colls: string[]) => colls.some((c) => ctx.list(c).length > 0);

async function readOr<T = any>(ctx: SimReadContext, name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}): Promise<T | null> {
  try {
    return await ctx.read<T>(name, params, query);
  } catch {
    return null;
  }
}
const featureDetail = (ctx: SimReadContext, id: string, ver: string) => readOr<any>(ctx, 'featureDetail', { id, ver });
const featureRef = (d: any, featureId: string, version: string) => ({ featureId, version, name: d?.feature?.name ?? featureId, ownerId: d?.feature?.ownerId ?? '' });
async function fClassOf(ctx: SimReadContext, id: string, ver: string): Promise<any> {
  return (await readOr<any>(ctx, 'safetyProfile', { id, ver }))?.profile?.fClass ?? null;
}
const vehiclesOf = async (ctx: SimReadContext): Promise<any[]> => (await ctx.snapshot<{ items: any[] }>('vehicles'))?.items ?? [];

// ─── 정책·검증 기록 ─────────────────────────────────────────
const allPolicies = (ctx: SimReadContext) => merged<any>(ctx, 'listPolicies', POL, 'policyId');
async function loadPolicy(ctx: SimReadContext, id: string): Promise<any | null> {
  const own = ctx.get(POL, id);
  if (own) return structuredClone(own);
  return (await ctx.snapshot<any>('policyDetail', { id }))?.policy ?? null;
}
async function requirePolicy(ctx: SimWriteContext, id: string) {
  return (await loadPolicy(ctx, id)) ?? ctx.fail('NOT_FOUND', `${id}을(를) 찾을 수 없습니다.`);
}
const deployedOf = (all: any[], flagKey: string) => all.find((p) => p.flagKey === flagKey && p.status === 'DEPLOYED');
/** 검증 기록 — 서버 runs(): 시각·ID 내림차순 */
async function allRuns(ctx: SimReadContext): Promise<any[]> {
  const snapRuns: any[] = [];
  for (const p of ctx.list(POL)) snapRuns.push(...(((await ctx.snapshot<any>('policyDetail', { id: p.policyId }))?.runs as any[]) ?? []));
  return (await merged<any>(ctx, 'validations', RUN, 'runId', snapRuns)).sort((a, b) => b.at.localeCompare(a.at) || b.runId.localeCompare(a.runId));
}
const runsOf = async (ctx: SimReadContext, policyId: string) => (await allRuns(ctx)).filter((r) => r.policyId === policyId);

/** 개정본 — 시연에서 바뀐 정책은 data.policyRevisions, 처음 바꿀 때 스냅샷 개정본(내용 포함)으로 시작한다 */
async function seedRevisions(ctx: SimReadContext, p: any): Promise<PolicyRevision[]> {
  const list = await ctx.snapshot<{ items: any[] }>('policyRevisions', { id: p.policyId });
  const out: PolicyRevision[] = [];
  for (const it of [...(list?.items ?? [])].reverse()) {
    const r = await ctx.snapshot<any>('policyRevision', { id: p.policyId, revision: String(it.revision) });
    if (r?.spec) out.push({ policyId: p.policyId, revision: r.revision, contentHash: r.contentHash, kind: r.kind, changedBy: r.changedBy, changedAt: r.changedAt, restoredFrom: r.restoredFrom ?? null, reason: r.reason ?? null, spec: r.spec });
  }
  if (!out.length && p.contentHash) out.push({ policyId: p.policyId, revision: p.revision, contentHash: p.contentHash, kind: 'IMPORTED', changedBy: p.createdBy, changedAt: p.createdAt, restoredFrom: null, reason: null, spec: policySpecOf(p) });
  return out;
}
async function revisionsOf(ctx: SimReadContext, p: any): Promise<PolicyRevision[]> {
  return (ctx.overlay.data.policyRevisions?.[p.policyId] as PolicyRevision[] | undefined) ?? seedRevisions(ctx, p);
}
async function addRevision(ctx: SimWriteContext, p: any, r: { kind: PolicyRevision['kind']; by: string; at: string; restoredFrom?: number | null; reason?: string | null }) {
  const store = ctx.state<Record<string, PolicyRevision[]>>('policyRevisions', () => ({}));
  if (!store[p.policyId]) store[p.policyId] = r.kind === 'CREATE' ? [] : await seedRevisions(ctx, p);
  store[p.policyId].push({ policyId: p.policyId, revision: p.revision, contentHash: await policyHash(p), kind: r.kind, changedBy: r.by, changedAt: r.at, restoredFrom: r.restoredFrom ?? null, reason: r.reason ?? null, spec: policySpecOf(p) });
}

// ─── 분야별 검증 입력(서버 ValidationService.input과 같은 사실) ─────────
async function validationInput(ctx: SimReadContext, policy: any): Promise<ValidationInput | null> {
  const d = await featureDetail(ctx, policy.featureId, policy.featureVersion);
  if (!d?.feature) return null;
  const feature = d.feature;
  const gates = Object.fromEntries(Object.entries(d.gates ?? {}).filter(([, g]: any) => g?.status).map(([g, r]: any) => [g, r.status]));
  const requiresTargets = [];
  for (const dep of (d.dependencies?.outgoing ?? []).filter((x: any) => x.type === 'REQUIRES'))
    requiresTargets.push({
      dependencyId: dep.dependencyId,
      targetFeatureId: dep.targetFeatureId,
      targetVersion: dep.targetVersion,
      targetLifecycle: dep.targetVersion ? ((await featureDetail(ctx, dep.targetFeatureId, dep.targetVersion))?.feature?.lifecycle ?? null) : null,
    });
  const trace = (feature.swIds as string[]).map((swId, i) => {
    const ver = feature.swVersions?.[i] ?? null;
    const ecu = feature.ecuPnos?.[i] ?? null;
    const t = (d.trace ?? []).find((x: any) => x.swId === swId && x.swVersion === ver && x.ecuPno === ecu);
    return { swId, swVersion: ver, ecuPno: ecu, swFound: !!ver && !!t?.sw && t.sw.version === ver && t.sw.ecuPno === ecu, ecuActive: !!t?.ecu && t.ecu.lifecycle !== 'RETIRED' };
  });
  const bls = new Set<string>([...(d.versions ?? []).map((v: any) => v.baselineId), feature.baselineId].filter(Boolean));
  const products: any[] = (await readOr<{ items: any[] }>(ctx, 'listProducts'))?.items ?? d.products ?? [];
  const affectedProducts = products.filter((p) => (p.baselineIds ?? []).some((b: string) => bls.has(b))).map((p) => ({ catalogId: p.catalogId, version: p.version, lifecycle: p.lifecycle }));
  let entitlementProductOk: boolean | null = true;
  if (policy.entitlementCatalogId) {
    const prods = products.filter((p) => p.catalogId === policy.entitlementCatalogId);
    entitlementProductOk = prods.length ? prods.some((p) => (p.baselineIds ?? []).some((b: string) => bls.has(b))) : null;
  }
  const hash = await policyHash(policy);
  const runs = await allVirtualRuns(ctx);
  const virtual = virtualScenariosFor(policy.featureId).map((scenario) => ({
    scenario,
    run: runs.filter((r) => r.policyId === policy.policyId && r.scenarioId === scenario.scenarioId && r.contentHash === hash).sort(byIdDesc('runId'))[0] ?? null,
  }));
  const all = await allPolicies(ctx);
  return {
    virtual,
    policy,
    feature,
    gates,
    requiresTargets,
    trace,
    activePolicies: all.filter((p) => p.featureId === feature.featureId && p.featureVersion === feature.version && p.policyId !== policy.policyId && ['APPROVED', 'DEPLOYED'].includes(p.status)),
    flagKeyClash: all.filter((p) => p.flagKey === policy.flagKey && p.featureId !== policy.featureId && p.status !== 'RETIRED'),
    fleet: await vehiclesOf(ctx),
    affectedProducts,
    entitlementProductOk,
    compliance: await (await import('./compliance-workflows')).complianceRegistryFor(ctx,feature),
  } as ValidationInput;
}

/** 승인 적격성 — 서버 DeploySafetyService.approvable(같은 사유 문장) */
function approvable(policy: any, run: any | undefined, approver: string, currentHash: string) {
  const r = publishCheck({
    allowedRole: true,
    author: policy.createdBy,
    approver,
    candidateHash: currentHash,
    approvedHash: run?.contentHash ?? '',
    sourceRevision: policy.revision,
    approvedSourceRevision: run?.policyRevision ?? -1,
    qualityPassed: run?.decision === 'GO',
    authorizationValid: true,
    supported: true,
    maintenance: false,
    sequence: policy.revision,
    highestSequence: policy.revision - 1,
  });
  const KO: Record<string, string> = {
    SELF_APPROVAL: '정책 작성자는 승인할 수 없습니다',
    HASH_MISMATCH: '검증 이후 정책 내용이 바뀌었습니다 — 다시 검증하세요',
    SOURCE_DRIFT: '검증한 정책 개정본과 다릅니다 — 다시 검증하세요',
    APPROVAL_INCOMPLETE: `배포 안전성 판정이 GO가 아닙니다 (${run?.decision ?? '검증 안 함'})`,
  };
  const stale = r.reasons.some((x) => x === 'HASH_MISMATCH' || x === 'SOURCE_DRIFT');
  const facts = [
    ...(r.reasons.includes('SELF_APPROVAL') ? [KO.SELF_APPROVAL] : []),
    ...(!run ? ['아직 배포 안전성 검증을 하지 않았습니다 — 먼저 분야별 검증을 실행하세요'] : stale ? [KO.HASH_MISMATCH] : r.reasons.includes('APPROVAL_INCOMPLETE') ? [KO.APPROVAL_INCOMPLETE] : []),
    ...r.reasons.filter((x) => !KO[x]),
  ];
  return { eligible: r.eligible, reasons: facts, codes: r.reasons };
}

async function lastRunOf(ctx: SimReadContext, p: any, hash: string) {
  const runs = await runsOf(ctx, p.policyId);
  const last = p.lastValidationId ? runs.find((r) => r.runId === p.lastValidationId) : runs.filter((r) => r.contentHash === hash).sort(byIdDesc('runId'))[0];
  return { runs, last };
}

/** ODD 축소 정책 판정(서버 oddFindings) — 축소 정책이 아니면 발견 없음 */
async function oddFindings(ctx: SimReadContext, p: any) {
  if (!p.oddRestriction) return [];
  const prof = (await readOr<any>(ctx, 'safetyProfile', { id: p.featureId, ver: p.featureVersion }))?.profile;
  const base = await featureDetail(ctx, p.featureId, p.oddRestriction.baseVersion);
  return oddRestrictionFindings({
    featureVersion: p.featureVersion,
    restriction: p.oddRestriction,
    baseExists: !!base?.feature,
    profile: { confirmed: !!(prof?.confirmedBy && prof?.confirmedAt), fClass: prof?.fClass },
    baseProfile: base?.feature ? { fClass: await fClassOf(ctx, p.featureId, p.oddRestriction.baseVersion) } : null,
  } as any);
}
const deployableLifecycle = (lc: string | undefined) => !!lc && LIFECYCLE_RANK[lc as keyof typeof LIFECYCLE_RANK] >= LIFECYCLE_RANK.APPROVED && !['DEPRECATED', 'RETIRED', 'DECOMMISSIONED'].includes(lc);

// ─── 정책 게시본(서버 SecureDeployService.publishPolicy) — 일반 OTA 채널, 차량 회신은 차단 흐름과 같은 합성 ─────
/** 게시본 — 화면이 보는 목록(차단 흐름의 뷰) + 이 쓰기에서 막 바꾼 것 */
async function allPublications(ctx: SimReadContext): Promise<any[]> {
  const items: any[] = (await readOr<{ items: any[] }>(ctx, 'publications'))?.items ?? [];
  const mine = new Map(ctx.list(PUB).map((p) => [p.publicationId, p] as const));
  const out = items.map((p) => mine.get(p.publicationId) ?? p);
  const seen = new Set(out.map((p) => p.publicationId));
  return [...[...mine.values()].filter((p) => !seen.has(p.publicationId)), ...out];
}
const latestPublication = (pubs: any[], policyId: string) =>
  pubs.filter((x) => x.kind === 'POLICY' && x.payload?.policy?.policyId === policyId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.publicationId.localeCompare(a.publicationId))[0];

export async function publishPolicy(ctx: SimWriteContext, policy: any) {
  const d = await featureDetail(ctx, policy.featureId, policy.featureVersion);
  const f = d?.feature;
  const vehicles = await vehiclesOf(ctx);
  const targets: string[] = f ? vehicles.filter((v) => v.country === f.country && v.vehicleModel === f.vehicleModel && v.trim === f.trim && v.fleet !== 'SAMPLE').map((v) => v.vin) : [];
  const offline = new Set<string>(vehicles.filter((v) => v.link === 'OFFLINE' && !(ctx.overlay.data.onlineAgain ?? []).includes(v.vin)).map((v) => v.vin));
  const pubs = await allPublications(ctx);
  const base = await ctx.snapshot<{ items: { publicationId: string }[] }>('publications');
  const id = ctx.nextId('PUB', [...(base?.items ?? []).map((p) => p.publicationId), ...pubs.map((p) => p.publicationId), ...ctx.list(PUB).map((p) => p.publicationId)]);
  // 게시 순번 — flag별 단조 증가(차량의 재전송 방지)
  const sequence = Math.max(0, ...pubs.filter((p) => p.kind === 'POLICY' && p.payload?.flagKey === policy.flagKey).map((p) => Number(p.payload.sequence) || 0)) + 1;
  const now = ctx.iso();
  const payload = { publicationId: id, kind: 'POLICY', sequence, issuedAt: now, featureId: policy.featureId, featureVersion: policy.featureVersion, flagKey: policy.flagKey, policy, kill: null, targets, desired: policy.contentHash };
  const payloadHash = `sha256:${await sha256hex(jcs(payload))}`;
  const campaignId = id.replace('PUB', 'CMP');
  const done = !targets.length;
  const p = {
    publicationId: id,
    kind: 'POLICY',
    status: done ? 'CONFIRMED' : 'DISPATCHED',
    payload,
    signature: { keyId: POLICY_KID, alg: 'Ed25519', payloadHash, signature: (await demoSign(POLICY_KID, payloadHash)).replace(/-/g, '+').replace(/_/g, '/') + '==' },
    campaignId,
    channel: 'OTA',
    createdBy: ctx.actor.id,
    createdAt: now,
    deadlineAt: new Date(Date.now() + REPLY_DEADLINE_MS).toISOString(),
    confirmed: 0,
    denominator: targets.length,
    nodes: targets.map((v) => ({ nodeId: v, state: 'UNKNOWN', reason: 'NO_REPORT' })),
    ackOnly: [],
    closedAt: done ? now : null,
  };
  ctx.put(PUB, id, p, { created: true });
  const store = ctx.state<Record<string, any>>('killDelivery', () => ({}));
  store[id] = {
    killId: null,
    offline: [...offline].filter((v) => targets.includes(v)),
    readbacks: [],
    calls: [{ ifId: 'IF-05', key: id, at: now, request: { channel: 'OTA', priority: 'NORMAL', targets: targets.length, signatureKeyId: POLICY_KID }, response: { campaignId, accepted: true } }],
    job: {
      jobId: `OTA-${id}`,
      state: done ? 'COMPLETED' : 'SUBMITTED',
      serverState: done ? 'COMPLETED' : 'IN_PROGRESS',
      otaJobId: null,
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      targets: targets.length,
      counts: targets.length ? { DELIVERING: targets.length } : {},
      vehicles: targets.map((vin) => ({ vin, outcome: 'DELIVERING', detail: null, at: now })),
    },
  };
  scheduleOtaObservation(ctx, id);
  ctx.emit('publication.signed', id, { publicationId: id, kind: 'POLICY', keyId: POLICY_KID, payloadHash, targets: targets.length }, { componentId: 'D06-08' });
  ctx.emit('publication.dispatched', id, { publicationId: id, kind: 'POLICY', campaignId, channel: 'OTA', unreachable: [...offline].filter((v) => targets.includes(v)), ackOnly: [] }, { componentId: 'D04-01' });
  if (done) ctx.emit('publication.closed', id, { publicationId: id, kind: 'POLICY', status: 'CONFIRMED', confirmed: 0, denominator: 0, killId: null }, { componentId: 'D06-08' });
  else {
    const online = targets.filter((v) => !offline.has(v));
    const size = Math.max(1, Math.ceil(online.length / REPLY_BATCHES));
    for (let i = 0; i * size < online.length; i++) ctx.later(REPLY_FIRST_MS + i * REPLY_STEP_MS, 'kill.readback', { publicationId: id, vins: online.slice(i * size, (i + 1) * size) });
    ctx.later(REPLY_DEADLINE_MS, 'kill.deadline', { publicationId: id });
  }
  return p;
}

// ─── 정책 읽기 ─────────────────────────────────────────────
/** 정책 하나를 시연에서 바꿨나 — 정책·검증 기록·개정본 */
const policyTouched = (ctx: SimReadContext, id: string) => !!ctx.get(POL, id) || ctx.list(RUN).some((r) => r.policyId === id) || !!ctx.overlay.data.policyRevisions?.[id];

registerSimReader('listPolicies', async (ctx) => {
  if (!touched(ctx, POL)) return undefined;
  const q = ctx.req.query;
  const items = (await allPolicies(ctx)).filter((p) => (!q.featureId || p.featureId === q.featureId) && (!q.status || p.status === q.status) && (!q.flagKey || p.flagKey === q.flagKey));
  return { items };
});

registerSimReader('policyDetail', async (ctx) => {
  const id = ctx.req.params.id;
  if (!policyTouched(ctx, id)) return undefined;
  const p = await loadPolicy(ctx, id);
  if (!p) return undefined;
  const hash = await policyHash(p);
  const { runs, last } = await lastRunOf(ctx, p, hash);
  const d = await featureDetail(ctx, p.featureId, p.featureVersion);
  const f = d?.feature;
  return {
    policy: p,
    feature: f ? { featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, asil: f.asil, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, controlPoints: f.controlPoints } : null,
    hashMatchesValidation: !!last && last.contentHash === hash,
    lastRun: last ?? null,
    runs,
    approval: approvable(p, last, ctx.actor.id, hash),
  };
});

registerSimReader('validations', async (ctx) => {
  if (!touched(ctx, RUN)) return undefined;
  const q = ctx.req.query;
  return { items: (await allRuns(ctx)).filter((r) => !q.policyId || r.policyId === q.policyId) };
});

registerSimReader('policyRevisions', async (ctx) => {
  const id = ctx.req.params.id;
  if (!ctx.overlay.data.policyRevisions?.[id] && !policyTouched(ctx, id)) return undefined;
  const p = await loadPolicy(ctx, id);
  if (!p) return undefined;
  const runs = await runsOf(ctx, id);
  const revs = await revisionsOf(ctx, p);
  return {
    policyId: id,
    current: p.revision,
    status: p.status,
    restorable: EDITABLE.includes(p.status),
    items: [...revs].sort((a, b) => b.revision - a.revision).map(({ spec: _s, ...r }) => ({ ...r, current: r.revision === p.revision, validations: runs.filter((v) => v.policyRevision === r.revision).map((v) => ({ runId: v.runId, decision: v.decision, at: v.at })) })),
  };
});

registerSimReader('policyRevision', async (ctx) => {
  const id = ctx.req.params.id;
  if (!ctx.overlay.data.policyRevisions?.[id]) return undefined;
  const p = await loadPolicy(ctx, id);
  if (!p) return undefined;
  const revs = await revisionsOf(ctx, p);
  const n = Number(ctx.req.params.revision);
  const r = revs.find((x) => x.revision === n);
  if (!r) return undefined;
  const current = revs.find((x) => x.revision === p.revision);
  return { ...r, current: r.revision === p.revision, changesFromCurrent: current ? policyDiff(current.spec, r.spec) : [] };
});

registerSimReader('policyChanges', async (ctx) => {
  const id = ctx.req.params.id;
  if (!ctx.overlay.data.policyRevisions?.[id]) return undefined;
  const p = await loadPolicy(ctx, id);
  if (!p) return undefined;
  return { policyId: id, items: policyChangeLog(await revisionsOf(ctx, p)) };
});

// ─── 정책 쓰기 ─────────────────────────────────────────────
registerSimHandler('createPolicy', async (ctx) => {
  const body = ctx.req.body;
  const d = await featureDetail(ctx, body.featureId, body.featureVersion);
  const f = d?.feature;
  if (!f) ctx.fail('NOT_FOUND', `${body.featureId} ${body.featureVersion}이(가) Registry에 없습니다.`);
  if (LIFECYCLE_RANK[f.lifecycle as keyof typeof LIFECYCLE_RANK] < LIFECYCLE_RANK.APPROVED || ['DEPRECATED', 'RETIRED'].includes(f.lifecycle))
    ctx.fail('GUARD_FAILED', `${f.lifecycle} Feature에는 정책을 등록할 수 없습니다 (APPROVED~RELEASED).`);
  const odd = (await oddFindings(ctx, body)).filter((x) => x.code === 'BASE_UNKNOWN' || x.code === 'NOT_NEW_VERSION');
  if (odd.length) ctx.fail('GUARD_FAILED', odd.map((x) => x.message).join(' · '), { rule: 'FFG-SOT-002', findings: odd }, { action: 'POLICY_CREATE', target: body.flagKey, reason: odd.map((x) => x.message).join(' · '), componentId: 'D01-06' });
  const all = await allPolicies(ctx);
  // Flag ID는 다른 Feature에 다시 쓰지 않는다(FFG-CODE-020, 서버 bindFlag)
  const other = all.find((p) => p.flagKey === body.flagKey && p.featureId !== body.featureId);
  if (other) ctx.fail('CONFLICT', `flagKey ${body.flagKey}는 ${other.featureId}에 묶인 키입니다 — Flag ID는 다른 Feature에 다시 쓰지 않습니다 (FFG-CODE-020).`);
  const base = await ctx.snapshot<{ items: { policyId: string }[] }>('listPolicies');
  const at = ctx.iso();
  const p: any = {
    ...body,
    policyId: ctx.nextId('POL', [...(base?.items ?? []).map((x) => x.policyId), ...all.map((x) => x.policyId)]),
    revision: 1,
    status: 'DRAFT',
    contentHash: '',
    createdBy: ctx.actor.id,
    createdAt: at,
    approvedBy: null,
    approvedAt: null,
    lastValidationId: null,
    stageBasisPoints: null,
  };
  p.contentHash = await policyHash(p);
  ctx.put(POL, p.policyId, p, { created: true });
  await addRevision(ctx, p, { kind: 'CREATE', by: p.createdBy, at });
  ctx.audit({ action: 'POLICY_CREATE', target: p.policyId, after: p, componentId: 'D01-06' });
  ctx.emit('policy.created', p.policyId, { policyId: p.policyId, flagKey: p.flagKey, featureId: p.featureId }, { componentId: 'D01-06' });
  return p;
}, { body: CreatePolicyBody });

registerSimHandler('updatePolicy', async (ctx) => {
  const id = ctx.req.params.id;
  const p = await requirePolicy(ctx, id);
  if (!EDITABLE.includes(p.status)) ctx.fail('IMMUTABLE', `${p.status} 정책은 수정할 수 없습니다. 새 정책을 만들어 검증·승인을 다시 받으세요.`, undefined, { action: 'POLICY_UPDATE', target: id, reason: `${p.status} 정책 수정 시도`, componentId: 'D01-06' });
  const next: any = { ...p, ...Object.fromEntries(Object.entries(ctx.req.body).filter(([, v]) => v !== undefined)), status: 'DRAFT', revision: p.revision + 1 };
  next.contentHash = await policyHash(next);
  ctx.put(POL, id, next);
  await addRevision(ctx, next, { kind: 'UPDATE', by: ctx.actor.id, at: ctx.iso() });
  ctx.audit({ action: 'POLICY_UPDATE', target: id, before: { revision: p.revision, contentHash: p.contentHash }, after: { revision: next.revision, contentHash: next.contentHash }, componentId: 'D01-06' });
  return next;
}, { body: UpdatePolicyBody });

registerSimHandler('restorePolicyRevision', async (ctx) => {
  const id = ctx.req.params.id;
  const p = await requirePolicy(ctx, id);
  const n = /^\d+$/.test(ctx.req.params.revision) ? Number(ctx.req.params.revision) : NaN;
  const revs = await revisionsOf(ctx, p);
  const from = revs.find((r) => r.revision === n);
  if (!from) ctx.fail('NOT_FOUND', `${id}에 r${ctx.req.params.revision} 버전이 없습니다.`);
  if (!EDITABLE.includes(p.status))
    ctx.fail('IMMUTABLE', `${p.status} 정책은 이전 버전으로 되살릴 수 없습니다. 배포본을 되돌리려면 롤백을 쓰세요.`, undefined, { action: 'POLICY_RESTORE', target: id, reason: `${p.status} 정책 버전 복원 시도 (r${n})`, componentId: 'D01-06' });
  if (from!.revision === p.revision || from!.contentHash === p.contentHash) ctx.fail('CONFLICT', `r${n}은(는) 지금 내용과 같습니다 — 되살릴 것이 없습니다.`);
  const meta = Object.fromEntries(Object.entries(p).filter(([k]) => !(k in PolicySpec.shape)));
  const next: any = { ...meta, ...from!.spec, status: 'DRAFT', revision: p.revision + 1 };
  next.contentHash = await policyHash(next);
  ctx.put(POL, id, next);
  await addRevision(ctx, next, { kind: 'RESTORE', by: ctx.actor.id, at: ctx.iso(), restoredFrom: n, reason: ctx.req.body.reason });
  ctx.audit({ action: 'POLICY_RESTORE', target: id, before: { revision: p.revision, contentHash: p.contentHash, status: p.status }, after: { revision: next.revision, contentHash: next.contentHash, status: next.status, restoredFrom: n }, reason: ctx.req.body.reason, componentId: 'D01-06' });
  ctx.emit('policy.restored', id, { policyId: id, revision: next.revision, restoredFrom: n, reason: ctx.req.body.reason }, { componentId: 'D01-06' });
  return next;
}, { body: RestorePolicyRevisionBody });

// 분야별 검증 8종(PoC ②) — 같은 순수 검증기(runValidators)·배포 안전성 판정(deploySafety)
registerSimHandler('validatePolicy', async (ctx) => {
  const id = ctx.req.params.id;
  const p = await requirePolicy(ctx, id);
  if (!EDITABLE.includes(p.status)) ctx.fail('CONFLICT', `${p.status} 정책은 다시 검증하지 않습니다.`);
  const input = await validationInput(ctx, p);
  if (!input) ctx.fail('NOT_FOUND', `정책 대상 ${p.featureId} ${p.featureVersion}이(가) Registry에 없습니다.`);
  const results = await runValidators(input!);
  const safety = deploySafety(results);
  const base = await allRuns(ctx);
  const run = {
    runId: ctx.nextId('VAL', base.map((r) => r.runId), 6),
    policyId: p.policyId,
    policyRevision: p.revision,
    contentHash: await policyHash(p),
    decision: safety.decision,
    reasons: safety.reasons,
    at: ctx.iso(),
    by: ctx.actor.id,
    results,
  };
  ctx.put(RUN, run.runId, run, { created: true });
  const next = { ...p, status: safety.decision === 'GO' ? 'VALIDATED' : 'DRAFT', lastValidationId: run.runId };
  ctx.put(POL, id, next);
  ctx.audit({ action: 'POLICY_VALIDATE', target: id, after: { runId: run.runId, decision: run.decision }, reason: safety.reasons.join('; ') || undefined, componentId: 'D06-04' });
  const d = await featureDetail(ctx, p.featureId, p.featureVersion);
  ctx.emit('policy.validated', id, { runId: run.runId, decision: run.decision, results: results.map((r) => ({ componentId: r.componentId, result: r.result })) }, { componentId: 'D06-04', notify: { policy: next, feature: featureRef(d, p.featureId, p.featureVersion) } });
  return { policy: next, run };
}, { body: EmptyBody });

registerSimHandler('decidePolicy', async (ctx) => {
  const id = ctx.req.params.id;
  const body = ctx.req.body;
  const p = await requirePolicy(ctx, id);
  const action = `POLICY_${body.decision}`;
  if (!EDITABLE.includes(p.status)) ctx.fail('CONFLICT', `${p.status} 정책은 결정 대상이 아닙니다.`);
  if (body.decision === 'APPROVE') {
    const hash = await policyHash(p);
    const { last } = await lastRunOf(ctx, { ...p, lastValidationId: p.lastValidationId }, hash);
    const run = p.lastValidationId ? last : undefined;
    const ok = approvable(p, run, ctx.actor.id, hash);
    if (!ok.eligible) ctx.fail(ok.codes.includes('SELF_APPROVAL') ? 'SEPARATION_OF_DUTY' : 'GUARD_FAILED', `승인할 수 없습니다: ${ok.reasons.join(' / ')}`, { blockers: ok.reasons }, { action, target: id, reason: ok.reasons.join('; '), componentId: 'D03-02' });
  }
  const next = body.decision === 'APPROVE' ? { ...p, status: 'APPROVED', approvedBy: ctx.actor.id, approvedAt: ctx.iso() } : { ...p, status: 'REJECTED' };
  ctx.put(POL, id, next);
  ctx.audit({ action, target: id, before: { status: p.status }, after: { status: next.status }, reason: body.reason, componentId: 'D01-06' });
  ctx.emit(body.decision === 'APPROVE' ? 'policy.approved' : 'policy.rejected', id, { policyId: id, featureId: p.featureId, controlPoint: p.controlPoint }, { componentId: 'D01-06' });
  const f = (await featureDetail(ctx, p.featureId, p.featureVersion))?.feature;
  return { policy: next, feature: f ? { featureId: f.featureId, version: f.version, lifecycle: f.lifecycle } : null };
}, { body: PolicyDecisionBody });

// 서버 배포 — 이 flagKey의 평가 기준을 바꾸고(이전 배포본 RETIRED), F2 이상은 Canary에서 시작, 서명 게시본을 차량에 내보낸다
registerSimHandler('deployPolicy', async (ctx) => {
  const id = ctx.req.params.id;
  const reason = ctx.req.body.reason;
  const p = await requirePolicy(ctx, id);
  if (p.status !== 'APPROVED') ctx.fail('GUARD_FAILED', `승인된(APPROVED) 정책만 배포할 수 있습니다 (현재 ${p.status}).`, undefined, { action: 'POLICY_DEPLOY', target: id, reason: `${p.status} 정책 배포 시도`, componentId: 'D01-06' });
  if (p.contentHash !== (await policyHash(p))) ctx.fail('GUARD_FAILED', '승인 이후 정책 내용이 바뀌었습니다 (해시 불일치).');
  const kills = await gxActiveKills(ctx, p.featureId);
  if (kills.length) ctx.fail('GUARD_FAILED', '활성 긴급 차단 중에는 새 정책을 배포할 수 없습니다.', { kills: kills.map((k: any) => k.killId) });
  const d = await featureDetail(ctx, p.featureId, p.featureVersion);
  const lc = d?.feature?.lifecycle;
  if (!(lc && LIFECYCLE_RANK[lc as keyof typeof LIFECYCLE_RANK] >= LIFECYCLE_RANK.APPROVED && !['DEPRECATED', 'RETIRED'].includes(lc)))
    ctx.fail('GUARD_FAILED', `${lc ?? '미등록'} Feature의 정책은 배포할 수 없습니다 (APPROVED~RELEASED).`, { rule: 'FR-REG-002-019', lifecycle: lc ?? '미등록' }, { action: 'POLICY_DEPLOY', target: id, reason: `${p.featureId}@${p.featureVersion} ${lc ?? '미등록'} Feature — 배포 차단`, componentId: 'D01-06' });
  const odd = await oddFindings(ctx, p);
  if (odd.length) ctx.fail('GUARD_FAILED', odd.map((x) => x.message).join(' · '), { rule: 'FFG-SOT-002', findings: odd }, { action: 'POLICY_DEPLOY', target: id, reason: odd.map((x) => x.message).join(' · '), componentId: 'D01-06' });
  const input = await validationInput(ctx, p);
  if (!input) ctx.fail('GUARD_FAILED', '배포 검증의 Feature 원천이 없습니다.');
  const gx = await gxForDeploy(ctx, p, input!);
  const prev = deployedOf(await allPolicies(ctx), p.flagKey);
  if (prev && prev.policyId !== p.policyId) {
    ctx.put(POL, prev.policyId, { ...prev, status: 'RETIRED' });
    ctx.audit({ action: 'POLICY_RETIRE', target: prev.policyId, before: { status: 'DEPLOYED' }, after: { status: 'RETIRED' }, reason: `${p.policyId}로 대체`, componentId: 'D01-06' });
  }
  // F2 이상은 Canary에서 시작한다(FFG-LCY-009) — 단계 값은 해시 밖이라 승인 내용은 그대로
  const fClass = await fClassOf(ctx, p.featureId, p.featureVersion);
  const canary = deployStartBasisPoints(fClass, effectiveBasisPoints({ ...p, stageBasisPoints: null }));
  const now = ctx.iso();
  const cap = gx.cap();
  const start = cap != null ? Math.min(canary ?? effectiveBasisPoints({ ...p, stageBasisPoints: null }), cap) : canary;
  const next = await gx.apply({ ...p, status: 'DEPLOYED', deployedBy: ctx.actor.id, deployedAt: now, ...(start != null ? { stageBasisPoints: start, stagedAt: now } : { stageBasisPoints: null, stagedAt: null }) }, prev);
  ctx.put(POL, id, next);
  ctx.audit({ action: 'POLICY_DEPLOY', target: id, before: { status: 'APPROVED' }, after: { status: 'DEPLOYED', contentHash: p.contentHash, stage: next.stageBasisPoints, fClass }, reason, componentId: 'D01-06' });
  const pub = await publishPolicy(ctx, next);
  ctx.emit('policy.deployed', id, { policyId: id, flagKey: p.flagKey, contentHash: p.contentHash, replaced: prev?.policyId ?? null, publicationId: pub.publicationId, stage: next.stageBasisPoints, reason }, { componentId: 'D01-06', notify: { policy: next, feature: featureRef(d, p.featureId, p.featureVersion) } });
  return { ...next, publicationId: pub.publicationId };
}, { body: ReasonBody });

// ─── 단계적 기능 배포(D01-08) ─────────────────────────────
async function openAnomaliesOf(ctx: SimReadContext, featureId: string) {
  return (await allAnomalies(ctx))
    .filter((a) => a.featureId === featureId && ['OPEN', 'ACKNOWLEDGED'].includes(a.status) && ['FEATURE_FAULT', 'SECURITY', 'FIELD_SOTIF'].includes(a.kind))
    .map((a) => a.anomalyId)
    .sort();
}
async function activeKillsOf(ctx: SimReadContext, featureId: string) {
  return (await gxActiveKills(ctx, featureId)).map((k: any) => k.killId);
}

registerSimHandler('stageRollout', async (ctx) => {
  const id = ctx.req.params.id;
  const body = ctx.req.body;
  const p = await requirePolicy(ctx, id);
  if (p.status !== 'DEPLOYED') ctx.fail('GUARD_FAILED', `배포된 정책만 단계를 바꿀 수 있습니다 (현재 ${p.status}).`);
  await gxStageGuard(ctx, p, body.basisPoints);
  const ceiling = effectiveBasisPoints({ ...p, stageBasisPoints: null });
  if (body.basisPoints > ceiling)
    ctx.fail('GUARD_FAILED', `승인된 배포 범위(${ceiling / 100}%)를 넘을 수 없습니다 — 정책을 새로 승인받으세요.`, undefined, { action: 'ROLLOUT_STAGE', target: id, reason: `승인 범위 ${ceiling / 100}% 초과 요청 ${body.basisPoints / 100}%`, componentId: 'D01-08' });
  const current = effectiveBasisPoints(p);
  const fClass = await fClassOf(ctx, p.featureId, p.featureVersion);
  const since = p.stagedAt ?? p.deployedAt ?? p.approvedAt ?? p.createdAt;
  const j = judgeStageChange({ fClass, current, to: body.basisPoints, since, now: ctx.iso(), actorId: ctx.actor.id, deployedBy: p.deployedBy ?? null, openAnomalies: body.basisPoints === 0 ? [] : await openAnomaliesOf(ctx, p.featureId), activeKills: body.basisPoints === 0 ? [] : await activeKillsOf(ctx, p.featureId), expansion: body.basisPoints>current ? await (await import('./operations-workflows')).expansionSourcesFor(ctx,p) : null });
  if (!j.ok) {
    const msg = j.blockers.map((b) => b.message).join('; ');
    ctx.fail(j.blockers.some((b) => b.code === 'SAME_AS_DEPLOYER') ? 'SEPARATION_OF_DUTY' : 'GUARD_FAILED', `단계를 넓힐 수 없습니다: ${msg}`, { judgement: j }, { action: 'ROLLOUT_STAGE', target: id, reason: msg, componentId: 'D01-08' });
  }
  const next = { ...p, stageBasisPoints: body.basisPoints, stagedAt: ctx.iso() };
  ctx.put(POL, id, next);
  ctx.audit({ action: 'ROLLOUT_STAGE', target: id, before: { stage: p.stageBasisPoints }, after: { stage: body.basisPoints, kind: j.kind, fClass, criteria: j.criteria }, reason: body.reason, componentId: 'D01-08' });
  ctx.emit('rollout.staged', id, { flagKey: p.flagKey, from: p.stageBasisPoints, to: body.basisPoints, kind: j.kind, criteria: j.criteria }, { componentId: 'D01-08' });
  return next;
}, { body: RolloutStageBody });

// ─── 가상검증(D06-03) — 실행기 결과는 같은 시나리오의 기록된 CARLA 실행을 결정적으로 다시 쓴다 ─────────
const allVirtualRuns = (ctx: SimReadContext) => merged<any>(ctx, 'virtualRuns', VV, 'runId');

registerSimReader('virtualRuns', async (ctx) => {
  if (!touched(ctx, VV)) return undefined;
  const q = ctx.req.query;
  return { items: (await allVirtualRuns(ctx)).filter((r) => (!q.policyId || r.policyId === q.policyId) && (!q.featureId || r.featureId === q.featureId) && (!q.featureVersion || r.featureVersion === q.featureVersion)) };
});
registerSimReader('virtualRunDetail', (ctx) => ctx.get(VV, ctx.req.params.id));

registerSimHandler('runVirtual', async (ctx) => {
  const body = ctx.req.body;
  const policy = await loadPolicy(ctx, body.policyId);
  if (!policy) ctx.fail('NOT_FOUND', `정책 ${body.policyId}을(를) 찾을 수 없습니다.`);
  const d = await featureDetail(ctx, policy.featureId, policy.featureVersion);
  const feature = d?.feature;
  if (!feature) ctx.fail('NOT_FOUND', `정책 대상 ${policy.featureId} ${policy.featureVersion}이(가) 없습니다.`);
  const all = virtualScenariosFor(policy.featureId);
  if (!all.length) ctx.fail('GUARD_FAILED', `${policy.featureId}은(는) 가상검증 실행기에 차량 측 런타임이 없어 대상이 아닙니다.`);
  const scenarios = body.scenarioIds?.length ? all.filter((s) => body.scenarioIds.includes(s.scenarioId)) : all;
  const unknown = (body.scenarioIds ?? []).filter((id: string) => !all.some((s) => s.scenarioId === id));
  if (unknown.length) ctx.fail('VALIDATION', `알 수 없는 시나리오: ${unknown.join(', ')}`);
  const vehicles = await vehiclesOf(ctx);
  const vehicle = vehicles.find((v) => v.vin === body.vin);
  if (!vehicle) ctx.fail('NOT_FOUND', `차량 ${body.vin}을(를) 찾을 수 없습니다.`);
  const contentHash = await policyHash(policy);
  const scope = { country: feature.country, vehicleModel: feature.vehicleModel, trim: feature.trim };
  const flag = await evaluateFlag({ policy: { ...policy, status: 'DEPLOYED' }, scope, killed: false, vehicle, entitlementActive: true });
  const evaluation = { value: !!flag.value, decision: flag.decision, reason: flag.reason };
  const prof = (await readOr<any>(ctx, 'safetyProfile', { id: policy.featureId, ver: policy.featureVersion }))?.profile ?? {};
  const safety = { deactClass: prof.deactClass, takeoverMs: prof.takeoverMs, rampMs: prof.rampMs, faultRampMs: prof.faultRampMs, faultTolerantTimeMs: prof.faultTolerantTimeMs, maxPendingMs: prof.maxPendingMs };
  const recorded = (await ctx.snapshot<{ items: any[] }>('virtualRuns'))?.items ?? [];
  const existing = await allVirtualRuns(ctx);
  const at = ctx.iso();
  const base = { policyId: policy.policyId, policyRevision: policy.revision, contentHash, featureId: policy.featureId, featureVersion: policy.featureVersion, vin: body.vin, at, by: ctx.actor.id, tms: null, safety };
  const out: any[] = [];
  for (const s of scenarios) {
    const runId = ctx.nextId('VV', [...existing.map((r) => r.runId), ...out.map((r) => r.runId)]);
    // 같은 시나리오·실행기의 기록된 실행(가장 최근) — 시나리오 파라미터·안전 분류가 같으면 실행기 결과도 같다
    const src = recorded.filter((r) => r.scenarioId === s.scenarioId && r.source === 'carla').sort(byIdDesc('runId'))[0];
    let r: any;
    if (!src) {
      r = { ...base, runId, scenarioId: s.scenarioId, role: s.role, source: 'unavailable', simulator: null, testId: null, overall: 'UNAVAILABLE', gateResult: 'UNAVAILABLE', criteria: [], evaluation: null, evidence: null, error: '시나리오 결과 없음' };
    } else {
      const j = judgeVirtual(src.criteria.map(({ deciding: _d, ...c }: any) => c), src.repro);
      const n = /(\d+)$/.exec(runId)?.[1] ?? '0';
      r = {
        ...base,
        runId,
        scenarioId: s.scenarioId,
        role: s.role,
        source: 'carla',
        simulator: src.simulator,
        testId: `TEST-${policy.flagKey}-${s.scenarioId}-R${Number(n)}`,
        overall: src.overall,
        gateResult: j.gateResult,
        gateReasons: j.reasons,
        criteria: j.criteria,
        repro: src.repro ?? null,
        evaluation,
        // Evidence 파일은 기록된 실행의 것(정적 사이트 파일) — sourceRunId로 연다
        evidence: src.evidence ? { ...src.evidence, sourceRunId: src.runId } : null,
        replayOf: src.runId,
        error: null,
      };
    }
    out.push(r);
    ctx.put(VV, runId, r, { created: true });
    ctx.audit({ action: 'VIRTUAL_VALIDATION', target: runId, after: { policyId: r.policyId, scenarioId: r.scenarioId, source: r.source, testId: r.testId, gateResult: r.gateResult }, componentId: 'D06-03' });
    ctx.emit('virtual.validation.completed', runId, { runId, policyId: r.policyId, scenarioId: r.scenarioId, source: r.source, overall: r.overall, gateResult: r.gateResult, testId: r.testId }, { componentId: 'D06-03' });
  }
  return { items: out };
}, { body: RunVirtualBody });

// ─── 이상 대응(D06-12) ────────────────────────────────────
const allAnomalies = (ctx: SimReadContext) => merged<any>(ctx, 'anomalies', ANM, 'anomalyId');
async function loadAnomaly(ctx: SimWriteContext, id: string) {
  const a = ctx.get(ANM, id) ?? (await ctx.snapshot<any>('anomalyDetail', { id })) ?? (await allAnomalies(ctx)).find((x) => x.anomalyId === id);
  return a ? structuredClone(a) : ctx.fail('NOT_FOUND', `이상 건 ${id}을(를) 찾을 수 없습니다.`);
}

registerSimReader('anomalies', async (ctx) => {
  if (!touched(ctx, ANM)) return undefined;
  const q = ctx.req.query;
  return { items: (await allAnomalies(ctx)).filter((a) => (!q.status || a.status === q.status) && (!q.kind || a.kind === q.kind) && (!q.featureId || a.featureId === q.featureId)).sort(byIdDesc('anomalyId')) };
});
registerSimReader('anomalyDetail', (ctx) => ctx.get(ANM, ctx.req.params.id));

/** 신호 → 이상 건(같은 종류·Feature의 열린 건에 쌓는다) — 서버 AnomalyService.signal */
async function signal(ctx: SimWriteContext, s: { kind: string; featureId: string; featureVersion?: string; vin: string | null; code: string; severity: string; at: string; ref: string | null }) {
  const all = await allAnomalies(ctx);
  const prev = all.filter((a) => a.kind === s.kind && a.featureId === s.featureId && ['OPEN', 'ACKNOWLEDGED'].includes(a.status)).sort(byIdDesc('anomalyId'))[0];
  const now = ctx.iso();
  const base = prev ?? {
    anomalyId: ctx.nextId('ANM', all.map((a) => a.anomalyId)),
    kind: s.kind,
    featureId: s.featureId,
    status: 'OPEN',
    severity: 'INFO',
    advice: 'MONITOR',
    reasons: [],
    vins: [],
    signals: [],
    openedAt: now,
    updatedAt: now,
    acknowledgedBy: null,
    closedBy: null,
    closedAt: null,
    closeReason: null,
    killId: null,
  };
  const { featureVersion, ...sig } = s;
  const signals = [...base.signals, sig].slice(-100);
  const d = featureVersion ? await featureDetail(ctx, s.featureId, featureVersion) : null;
  const c = classifyAnomaly(s.kind as any, signals, { asil: d?.feature?.asil ?? null });
  const next = { ...base, signals, vins: [...new Set([...base.vins, ...(s.vin ? [s.vin] : [])])].sort(), severity: c.severity, advice: c.advice, reasons: c.reasons, updatedAt: now };
  ctx.put(ANM, next.anomalyId, next, { created: !prev });
  if (!prev || prev.severity !== next.severity) {
    ctx.audit({ ...SYS, action: prev ? 'ANOMALY_ESCALATE' : 'ANOMALY_OPEN', target: next.anomalyId, before: prev ? { severity: prev.severity } : undefined, after: { kind: next.kind, featureId: next.featureId, severity: next.severity, advice: next.advice }, componentId: 'D06-12' });
    ctx.emit(prev ? 'anomaly.escalated' : 'anomaly.opened', next.anomalyId, { anomalyId: next.anomalyId, kind: next.kind, featureId: next.featureId, severity: next.severity, advice: next.advice, vins: next.vins.length, signals: next.signals.length }, {
      componentId: 'D06-12',
      notify: { feature: featureRef(d, s.featureId, featureVersion ?? '') },
    });
  }
}

async function closeAnomaly(ctx: SimWriteContext, a: any, status: 'MITIGATED' | 'DISMISSED', reason: string, killId: string | null, system = false) {
  if (a.status !== 'OPEN' && a.status !== 'ACKNOWLEDGED') ctx.fail('GUARD_FAILED', `이미 닫힌 이상 건입니다 (${a.status}).`);
  const now = ctx.iso();
  const next = { ...a, status, closedBy: system ? SYS.actorId : ctx.actor.id, closedAt: now, closeReason: reason, killId: killId ?? a.killId, updatedAt: now };
  ctx.put(ANM, a.anomalyId, next);
  ctx.audit({ ...(system ? SYS : {}), action: status === 'MITIGATED' ? 'ANOMALY_MITIGATE' : 'ANOMALY_DISMISS', target: a.anomalyId, before: { status: a.status }, after: { status, killId: next.killId }, reason, componentId: 'D06-12' });
  ctx.emit(status === 'MITIGATED' ? 'anomaly.mitigated' : 'anomaly.dismissed', a.anomalyId, { anomalyId: a.anomalyId, kind: a.kind, featureId: a.featureId, killId: next.killId }, { componentId: 'D06-12' });
  return next;
}

registerSimHandler('acknowledgeAnomaly', async (ctx) => {
  const a = await loadAnomaly(ctx, ctx.req.params.id);
  if (a.status !== 'OPEN') ctx.fail('GUARD_FAILED', `열린(OPEN) 이상 건만 확인할 수 있습니다 (현재 ${a.status}).`);
  const next = { ...a, status: 'ACKNOWLEDGED', acknowledgedBy: ctx.actor.id, updatedAt: ctx.iso() };
  ctx.put(ANM, a.anomalyId, next);
  ctx.audit({ action: 'ANOMALY_ACK', target: a.anomalyId, before: { status: a.status }, after: { status: next.status }, reason: ctx.req.body.reason, componentId: 'D06-12' });
  ctx.emit('anomaly.acknowledged', a.anomalyId, { anomalyId: a.anomalyId, featureId: a.featureId }, { componentId: 'D06-12' });
  return next;
}, { body: AnomalyActionBody });
registerSimHandler('mitigateAnomaly', async (ctx) => closeAnomaly(ctx, await loadAnomaly(ctx, ctx.req.params.id), 'MITIGATED', ctx.req.body.reason, null), { body: AnomalyActionBody });
registerSimHandler('dismissAnomaly', async (ctx) => closeAnomaly(ctx, await loadAnomaly(ctx, ctx.req.params.id), 'DISMISSED', ctx.req.body.reason, null), { body: AnomalyActionBody });

// 서버처럼 이벤트를 구독한다 — 차단이 이 이상 건을 가리켜 발령되면 조치됨, 배포 회신 이상(게시본 닫힘)은 DELIVERY 신호
registerSimListener(['kill.issued'], async (ctx, e) => {
  const id = (e.payload as any).anomalyId;
  if (!id) return;
  const a = ctx.get(ANM, id) ?? (await ctx.snapshot<any>('anomalyDetail', { id }));
  if (a && (a.status === 'OPEN' || a.status === 'ACKNOWLEDGED')) await closeAnomaly(ctx, a, 'MITIGATED', `긴급 차단 ${(e.payload as any).killId} 발령`, String((e.payload as any).killId), true);
});
registerSimListener(['publication.closed'], async (ctx, e) => {
  const p = e.payload as any;
  const pub = ctx.get(PUB, String(p.publicationId));
  if (!pub) return;
  if (DELIVERY_STATUS[p.status]) await signal(ctx, { kind: 'DELIVERY', featureId: pub.payload.featureId, featureVersion: pub.payload.featureVersion, vin: null, code: p.status, severity: DELIVERY_STATUS[p.status], at: e.at, ref: pub.publicationId });
  if (pub.kind === 'POLICY') await onPolicyPublicationClosed(ctx, e);
});

// ─── 롤백(D03-04) ────────────────────────────────────────
const ref = (p: any) => ({ policyId: p.policyId, revision: p.revision, contentHash: p.contentHash, featureId: p.featureId, featureVersion: p.featureVersion });
const typesText = (ts: readonly RollbackTargetType[]) => ts.map((t) => ROLLBACK_TARGET_LABEL[t]).join(', ');

async function allRequests(ctx: SimReadContext): Promise<any[]> {
  const extra: any[] = [...(((await ctx.snapshot<{ items: any[] }>('rollbackRequests', {}, { status: 'REQUESTED' }))?.items as any[]) ?? [])];
  for (const d of (await ctx.snapshot<{ items: any[] }>('rollbackDeployments'))?.items ?? []) if (d.deploymentId) extra.push(...(((await ctx.snapshot<any>('rollbackDeployment', { deploymentId: d.deploymentId }))?.requests as any[]) ?? []));
  for (const x of (await ctx.snapshot<{ items: any[] }>('rollbacks'))?.items ?? []) if (x.requestId) {
    const r = await ctx.snapshot<any>('rollbackRequest', { id: x.requestId });
    if (r) extra.push(r);
  }
  return merged<any>(ctx, 'rollbackRequests', RREQ, 'requestId', extra);
}
async function allPlans(ctx: SimReadContext): Promise<any[]> {
  const extra: any[] = [];
  for (const d of (await ctx.snapshot<{ items: any[] }>('rollbackDeployments'))?.items ?? []) if (d.deploymentId) extra.push(...(((await ctx.snapshot<any>('rollbackDeployment', { deploymentId: d.deploymentId }))?.plans as any[]) ?? []));
  return merged<any>(ctx, 'rollbackPlans', PLAN, 'planId', extra);
}
const allExecutions = (ctx: SimReadContext) => merged<any>(ctx, 'rollbacks', RBX, 'executionId');
const rollbackTouched = (ctx: SimReadContext) => touched(ctx, POL, RUN, PLAN, RREQ, RBX) || ctx.list(PUB).some((p) => p.kind === 'POLICY');

/** 서명 검증 — 시연 게시본은 이 브라우저의 시연 키로 서명했다(유효), 스냅샷 게시본은 서버 검증 결과 */
async function signatureValid(ctx: SimReadContext, publicationId: string) {
  if (ctx.get(PUB, publicationId)) return true;
  return (await ctx.snapshot<any>('publicationDetail', { id: publicationId }))?.verification?.valid ?? true;
}

interface World {
  policies: any[];
  pubs: any[];
  runs: any[];
}
const world = async (ctx: SimReadContext): Promise<World> => ({ policies: await allPolicies(ctx), pubs: await allPublications(ctx), runs: await allRuns(ctx) });

async function recoveryFacts(ctx: SimReadContext, w: World, candidate: any | undefined, current: any) {
  const pub = candidate ? latestPublication(w.pubs, candidate.policyId) : undefined;
  const lc = candidate ? (await featureDetail(ctx, candidate.featureId, candidate.featureVersion))?.feature?.lifecycle : undefined;
  return {
    artifactId: pub?.publicationId ?? null,
    blockers: recoveryBlockers({
      policy: candidate ? { policyId: candidate.policyId, flagKey: candidate.flagKey, status: candidate.status, contentHash: candidate.contentHash, approvedBy: candidate.approvedBy, deployedAt: candidate.deployedAt ?? null } : null,
      current: { policyId: current.policyId, flagKey: current.flagKey, contentHash: current.contentHash },
      validatedGo: !!candidate && w.runs.some((r) => r.policyId === candidate.policyId && r.decision === 'GO' && r.contentHash === candidate.contentHash),
      artifact: pub ? { status: pub.status, signatureValid: await signatureValid(ctx, pub.publicationId) } : null,
      featureDeployable: !!candidate && deployableLifecycle(lc),
      contentIntact: !candidate || (await policyHash(candidate)) === candidate.contentHash,
    }),
  };
}

async function candidates(ctx: SimReadContext, w: World, current: any) {
  const out = [];
  for (const p of w.policies.filter((x) => x.flagKey === current.flagKey && x.policyId !== current.policyId)) {
    const f = await recoveryFacts(ctx, w, p, current);
    out.push({ ...ref(p), status: p.status, deployedAt: p.deployedAt ?? null, deployedBy: p.deployedBy ?? null, approvedBy: p.approvedBy, artifactId: f.artifactId, eligible: !f.blockers.length, blockers: f.blockers.map((code) => ({ code, message: ROLLBACK_BLOCKER[code] })) });
  }
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.deployedAt ?? '').localeCompare(a.deployedAt ?? ''));
}

/** 영향 Feature(대상 + REQUIRES로 기대는 Feature)·배포 flag·진행 중 차단 — 서버 kill.preview와 같은 규칙(차단 미리보기 계산이 있으면 그것) */
async function impactOf(ctx: SimReadContext, w: World, featureId: string, version: string) {
  const d = await featureDetail(ctx, featureId, version);
  if (!d?.feature) return null;
  const ids = [featureId];
  const dependents: { featureId: string; version: string | null; name: string }[] = [];
  const queue: any[] = [d];
  while (queue.length) {
    const cur = queue.shift();
    for (const dep of (cur?.dependencies?.incoming ?? []).filter((x: any) => x.type === 'REQUIRES' && !ids.includes(x.sourceFeatureId))) {
      ids.push(dep.sourceFeatureId);
      const src = await featureDetail(ctx, dep.sourceFeatureId, dep.sourceVersion);
      dependents.push({ featureId: dep.sourceFeatureId, version: dep.sourceVersion ?? null, name: src?.feature?.name ?? dep.sourceFeatureId });
      queue.push(src);
    }
  }
  const pv = await readOr<any>(ctx, 'killPreview', {}, { featureId, featureVersion: version });
  let activeKill: string | null = pv ? (pv.activeKill ?? null) : null;
  if (!pv) {
    const scope = (await vehiclesOf(ctx)).filter((v) => v.country === d.feature.country && v.vehicleModel === d.feature.vehicleModel && v.trim === d.feature.trim).map((v) => v.vin);
    const now = Date.now();
    activeKill =
      ((await readOr<{ items: any[] }>(ctx, 'killRequests'))?.items ?? []).find(
        (k) => k.featureId === featureId && (k.status === 'ACTIVE' || (k.status === 'REQUESTED' && !(k.expiresAt && Date.parse(k.expiresAt) <= now))) && k.reasonCategory !== 'COMMERCIAL' && (k.vins ?? []).some((v: string) => scope.includes(v)),
      )?.killId ?? null;
  }
  return { name: d.feature.name, dependents, flagKeys: [...new Set(w.policies.filter((p) => p.status === 'DEPLOYED' && ids.includes(p.featureId)).map((p) => p.flagKey))].sort(), activeKill };
}

/** 롤백 재검증·영향 산출 — 기록하지 않는다(서버 assess) */
async function assess(ctx: SimReadContext, deploymentId: string, recoveryPolicyId: string, scope: any, targetTypes: readonly RollbackTargetType[] = ['POLICY_VERSION']) {
  const w = await world(ctx);
  const blockers: RollbackBlocker[] = [...targetTypeBlockers(targetTypes)];
  const pub = w.pubs.find((x) => x.publicationId === deploymentId);
  const policy = pub?.kind === 'POLICY' && pub.payload?.policy ? w.policies.find((p) => p.policyId === pub.payload.policy.policyId) : undefined;
  const recovery = w.policies.find((p) => p.policyId === recoveryPolicyId) ?? null;
  if (!pub || !policy) blockers.push('DEPLOYMENT_NOT_FOUND');
  const current = policy ? deployedOf(w.policies, policy.flagKey) : undefined;
  let sourceArtifactId: string | null = null;
  if (policy && (!current || current.policyId !== policy.policyId || latestPublication(w.pubs, policy.policyId)?.publicationId !== deploymentId)) blockers.push('DEPLOYMENT_NOT_CURRENT');
  if (current) {
    const f = await recoveryFacts(ctx, w, recovery ?? undefined, current);
    sourceArtifactId = f.artifactId;
    blockers.push(...f.blockers);
  }
  const featureOf = recovery ?? current ?? policy;
  let impact: { features: any[]; flagKeys: string[] } = { features: [], flagKeys: [] };
  if (featureOf) {
    const pv = await impactOf(ctx, w, featureOf.featureId, featureOf.featureVersion);
    if (pv) {
      impact = {
        features: [{ featureId: featureOf.featureId, version: featureOf.featureVersion, name: pv.name, role: 'TARGET' }, ...pv.dependents.map((d: any) => ({ featureId: d.featureId, version: d.version, name: d.name, role: 'DEPENDENT' }))],
        flagKeys: pv.flagKeys,
      };
      if (pv.activeKill) blockers.push('KILL_ACTIVE');
    } else blockers.push('FEATURE_NOT_DEPLOYABLE');
  }
  const targets: string[] = pub?.payload?.targets ?? [];
  const vehicles = (await vehiclesOf(ctx)).filter((v) => targets.includes(v.vin) && !!featureOf && vehicleInScope(v, featureOf.featureId, scope));
  const vins = vehicles.map((v) => v.vin);
  blockers.push(...scopeBlockers(targets, vins));
  const uniq = [...new Set(blockers)];
  return {
    deploymentId,
    deployment: pub ? { publicationId: pub.publicationId, status: pub.status, createdAt: pub.createdAt, createdBy: pub.createdBy, targets: targets.length } : null,
    current: current ?? null,
    recovery,
    sourceArtifactId,
    blockers: uniq.map((code) => ({ code, message: ROLLBACK_BLOCKER[code] })),
    applicable: !uniq.length,
    impact,
    vehicleGroups: vehicleGroups(vehicles),
    vins,
    targets,
  };
}
type Assessment = Awaited<ReturnType<typeof assess>>;

const notice = (x: any) => ({
  deploymentId: x.deploymentId,
  featureId: x.featureId,
  featureVersion: x.deployed.featureVersion,
  deployedVersion: versionText(x.deployed),
  targetTypes: typesText(x.targetTypes),
  recoveryVersion: versionText(x.recovery),
  scope: scopeText(x.scope),
  requestedBy: x.requestedBy,
  requestedAt: x.requestedAt,
  approvers: x.approvers,
});
const resultNotice = (x: any) => ({
  executionId: x.executionId,
  deploymentId: x.deploymentId,
  featureId: x.featureId,
  featureVersion: x.after.featureVersion,
  targetTypes: typesText(x.targetTypes),
  recoveryVersion: versionText(x.after),
  afterState: `${x.after.policyId} DEPLOYED · 배포 산출물 ${x.artifactId ?? '-'}`,
  failureReason: x.failureReason,
  failedAt: x.failedAt,
  requestedBy: x.requestedBy,
  approvedBy: x.approvedBy,
  deploymentRequestedBy: x.deploymentRequestedBy,
});
async function featureNotify(ctx: SimReadContext, featureId: string, version: string) {
  return { feature: featureRef(await featureDetail(ctx, featureId, version), featureId, version) };
}

function checkApprovers(ctx: SimWriteContext, approvers: string[], action: string, target: string) {
  if (approvers.includes(ctx.actor.id)) ctx.fail('SEPARATION_OF_DUTY', '요청자는 승인대상자가 될 수 없습니다.', undefined, { action, target, reason: '요청자를 승인대상자로 지정', componentId: 'D03-04' });
  return [...new Set(approvers)];
}
function refuse(ctx: SimWriteContext, action: string, target: string, a: Assessment): never {
  const msg = a.blockers.map((b) => b.message).join(' · ');
  return ctx.fail('GUARD_FAILED', `롤백할 수 없습니다: ${msg}`, { blockers: a.blockers }, { action, target, reason: msg, componentId: 'D03-04' });
}

registerSimHandler('previewRollback', async (ctx) => {
  const b = ctx.req.body;
  const a = await assess(ctx, b.deploymentId, b.recovery.policyId, b.scope);
  return { ...a, current: a.current ? ref(a.current) : null, recovery: a.recovery ? ref(a.recovery) : null };
}, { body: RollbackPreviewBody });

registerSimHandler('createRollbackPlan', async (ctx) => {
  const b = ctx.req.body;
  const approvers = checkApprovers(ctx, b.approvers, 'ROLLBACK_PLAN_CREATE', b.deploymentId);
  const a = await assess(ctx, b.deploymentId, b.recovery.policyId, b.scope, b.targetTypes);
  if (!a.applicable) refuse(ctx, 'ROLLBACK_PLAN_CREATE', b.deploymentId, a);
  const plan = {
    planId: ctx.nextId('RBP', (await allPlans(ctx)).map((p) => p.planId)),
    deploymentId: b.deploymentId,
    featureId: a.current!.featureId,
    flagKey: a.current!.flagKey,
    deployed: ref(a.current!),
    targetTypes: b.targetTypes,
    conditions: b.conditions,
    recovery: ref(a.recovery!),
    scope: b.scope,
    approvers,
    requestedBy: ctx.actor.id,
    requestedAt: ctx.iso(),
    note: b.note ?? null,
    status: 'REQUESTED',
    decision: null,
    executionId: null,
  };
  ctx.put(PLAN, plan.planId, plan, { created: true });
  ctx.audit({ action: 'ROLLBACK_PLAN_CREATE', target: plan.planId, after: plan, componentId: 'D03-04' });
  ctx.emit('rollback.plan.requested', plan.planId, { ...notice(plan), planId: plan.planId, conditions: conditionText(plan.conditions) }, { componentId: 'D03-04', notify: await featureNotify(ctx, plan.featureId, plan.deployed.featureVersion) });
  return plan;
}, { body: CreateRollbackPlanBody });

async function createRequest(ctx: SimWriteContext, b: any) {
  const approvers = checkApprovers(ctx, b.approvers, 'ROLLBACK_REQUEST', b.deploymentId);
  const a = await assess(ctx, b.deploymentId, b.recovery.policyId, b.scope, b.targetTypes);
  if (!a.applicable) refuse(ctx, 'ROLLBACK_REQUEST', b.deploymentId, a);
  const r = {
    requestId: ctx.nextId('RBR', (await allRequests(ctx)).map((x) => x.requestId)),
    deploymentId: b.deploymentId,
    featureId: a.current!.featureId,
    flagKey: a.current!.flagKey,
    deployed: ref(a.current!),
    targetTypes: b.targetTypes,
    recovery: ref(a.recovery!),
    scope: b.scope,
    reason: b.reason,
    approvers,
    requestedBy: ctx.actor.id,
    requestedAt: ctx.iso(),
    status: 'REQUESTED',
    decision: null,
    executionId: null,
  };
  ctx.put(RREQ, r.requestId, r, { created: true });
  ctx.audit({ action: 'ROLLBACK_REQUEST', target: r.requestId, after: r, reason: b.reason, componentId: 'D03-04' });
  ctx.emit('rollback.requested', r.requestId, { ...notice(r), requestId: r.requestId, reason: r.reason }, { componentId: 'D03-04', notify: await featureNotify(ctx, r.featureId, r.deployed.featureVersion) });
  return r;
}
registerSimHandler('createRollbackRequest', (ctx) => createRequest(ctx, ctx.req.body), { body: CreateRollbackRequestBody });

// 정책 상세의 되돌리기 요청 — 수동 롤백 요청과 같은 재검증·승인·실행(412 기준 배포 바뀜, 409 진행 중 요청)
registerSimHandler('requestPolicyRollback', async (ctx) => {
  const id = ctx.req.params.id;
  const b = ctx.req.body;
  const p = await requirePolicy(ctx, id);
  const w = await world(ctx);
  const current = deployedOf(w.policies, p.flagKey);
  const pub = current ? latestPublication(w.pubs, current.policyId) : undefined;
  if (!current || !pub) ctx.fail('GUARD_FAILED', `${p.flagKey}에는 지금 배포된 정책이 없습니다 — 되돌릴 배포가 없습니다.`, undefined, { action: 'ROLLBACK_REQUEST', target: id, reason: `${p.flagKey} 지금 배포 없음`, componentId: 'D03-04' });
  if (b.expectedDeploymentId !== pub.publicationId)
    ctx.fail('PRECONDITION_FAILED', `화면을 연 뒤 배포가 바뀌었습니다(지금 ${pub.publicationId}) — 이력을 새로 보고 다시 고르세요.`, { deploymentId: pub.publicationId }, { action: 'ROLLBACK_REQUEST', target: pub.publicationId, reason: `기준 배포 ${b.expectedDeploymentId} ≠ 지금 배포 ${pub.publicationId}`, componentId: 'D03-04' });
  const open = (await allRequests(ctx)).find((r) => r.deploymentId === pub.publicationId && (r.status === 'REQUESTED' || r.status === 'APPROVED'));
  if (open)
    ctx.fail('CONFLICT', `이 배포에는 진행 중인 되돌리기 요청 ${open.requestId}(${open.status})이 있습니다 — 그 요청을 승인·실행하거나 반려한 뒤 다시 요청하세요.`, { requestId: open.requestId }, { action: 'ROLLBACK_REQUEST', target: pub.publicationId, reason: `진행 중인 요청 ${open.requestId}`, componentId: 'D03-04' });
  return createRequest(ctx, { deploymentId: pub.publicationId, targetTypes: ['POLICY_VERSION'], recovery: b.recovery, scope: RollbackScope.parse({ featureIds: [current.featureId] }), reason: b.reason, approvers: b.approvers });
}, { body: PolicyRollbackBody });

function decision(ctx: SimWriteContext, x: any, action: string, id: string) {
  if (x.status !== 'REQUESTED') ctx.fail('CONFLICT', `${id}은(는) ${x.status} — 승인 대기 상태가 아닙니다.`);
  if (ctx.actor.id === x.requestedBy) ctx.fail('SEPARATION_OF_DUTY', '요청자는 승인할 수 없습니다.', undefined, { action, target: id, reason: '요청자 본인 승인 시도', componentId: 'D03-04' });
  if (!x.approvers.includes(ctx.actor.id)) ctx.fail('FORBIDDEN', `지정된 승인대상자(${x.approvers.join(', ')})만 승인·반려할 수 있습니다.`, undefined, { action, target: id, reason: `지정 승인대상자 아님 (${x.approvers.join(', ')})`, componentId: 'D03-04' });
  return { decision: ctx.req.body.decision, by: ctx.actor.id, role: ctx.actor.role, at: ctx.iso(), comment: ctx.req.body.comment };
}

registerSimHandler('decideRollbackPlan', async (ctx) => {
  const id = ctx.req.params.id;
  const plan = (await allPlans(ctx)).find((p) => p.planId === id) ?? (await ctx.snapshot<any>('rollbackPlan', { id })) ?? ctx.fail('NOT_FOUND', `Rollback Plan ${id}을(를) 찾을 수 없습니다.`);
  const d = decision(ctx, plan, 'ROLLBACK_PLAN_DECIDE', id);
  const next = { ...plan, status: d.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decision: d };
  ctx.put(PLAN, id, next);
  ctx.audit({ action: 'ROLLBACK_PLAN_DECIDE', target: id, before: { status: plan.status }, after: { status: next.status, decision: d }, reason: d.comment, componentId: 'D03-04' });
  ctx.emit('rollback.plan.decided', id, { planId: id, decision: d.decision, by: ctx.actor.id, featureId: plan.featureId }, { componentId: 'D03-04' });
  return next;
}, { body: RollbackDecisionBody });

async function requireRequest(ctx: SimWriteContext, id: string) {
  return (await allRequests(ctx)).find((r) => r.requestId === id) ?? (await ctx.snapshot<any>('rollbackRequest', { id })) ?? ctx.fail('NOT_FOUND', `수동 롤백 요청 ${id}을(를) 찾을 수 없습니다.`);
}

registerSimHandler('decideRollbackRequest', async (ctx) => {
  const id = ctx.req.params.id;
  const r = await requireRequest(ctx, id);
  const d = decision(ctx, r, 'ROLLBACK_REQUEST_DECIDE', id);
  const next = { ...r, status: d.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decision: d };
  ctx.put(RREQ, id, next);
  ctx.audit({ action: 'ROLLBACK_REQUEST_DECIDE', target: id, before: { status: r.status }, after: { status: next.status, decision: d }, reason: d.comment, componentId: 'D03-04' });
  ctx.emit('rollback.request.decided', id, { requestId: id, decision: d.decision, by: ctx.actor.id, featureId: r.featureId }, { componentId: 'D03-04' });
  return next;
}, { body: RollbackDecisionBody });

/** 실행 — 늘 재검증부터(fail-closed). 통과하면 지금 정책 RETIRED·복구 기준 DEPLOYED·같은 내용을 새 순번으로 재서명해 게시 */
async function execute(ctx: SimWriteContext, run: { mode: 'AUTO' | 'MANUAL'; source: any; trigger: RollbackTrigger }) {
  const src = run.source;
  const plan = 'planId' in src ? src : null;
  const actor = run.mode === 'AUTO' ? AUTO : {};
  const a = await assess(ctx, src.deploymentId, src.recovery.policyId, src.scope, src.targetTypes);
  const now = ctx.iso();
  const x: any = {
    executionId: ctx.nextId('RBX', (await allExecutions(ctx)).map((e) => e.executionId)),
    mode: run.mode,
    planId: plan?.planId ?? null,
    requestId: plan ? null : src.requestId,
    deploymentId: src.deploymentId,
    featureId: src.featureId,
    flagKey: src.flagKey,
    targetTypes: src.targetTypes,
    trigger: run.trigger,
    before: a.current ? ref(a.current) : src.deployed,
    after: a.recovery ? ref(a.recovery) : src.recovery,
    sourceArtifactId: a.sourceArtifactId,
    artifactId: null,
    vehicleGroups: a.vehicleGroups,
    vins: a.vins,
    status: 'REQUESTED',
    result: null,
    failureReason: null,
    failedAt: null,
    requestedBy: src.requestedBy,
    approvedBy: src.decision?.by ?? null,
    deploymentRequestedBy: a.current?.deployedBy ?? null,
    startedAt: now,
    finishedAt: null,
  };
  const markSource = (executionId: string) => (plan ? ctx.put(PLAN, plan.planId, { ...plan, status: 'TRIGGERED', executionId }) : ctx.put(RREQ, src.requestId, { ...src, status: 'EXECUTED', executionId }));
  const notify = await featureNotify(ctx, x.featureId, x.after.featureVersion);
  if (!a.applicable) {
    const failed = { ...x, status: 'FAILED', result: 'FAILURE', failureReason: a.blockers.map((b) => b.message).join(' · '), failedAt: now, finishedAt: now };
    ctx.put(RBX, failed.executionId, failed, { created: true });
    markSource(failed.executionId);
    ctx.audit({ ...actor, action: 'ROLLBACK_EXECUTE', target: failed.executionId, after: { status: 'FAILED', blockers: a.blockers.map((b) => b.code) }, reason: `${run.trigger.detail} — 재검증 실패`, componentId: 'D03-04' });
    ctx.emit('rollback.failed', failed.executionId, resultNotice(failed), { componentId: 'D03-04', notify });
    return failed;
  }
  const current = a.current!;
  const recovery = a.recovery!;
  ctx.put(POL, current.policyId, { ...current, status: 'RETIRED' });
  ctx.audit({ ...actor, action: 'POLICY_RETIRE', target: current.policyId, before: { status: 'DEPLOYED' }, after: { status: 'RETIRED' }, reason: `롤백 ${x.executionId} — ${recovery.policyId}로 복구`, componentId: 'D03-04' });
  const restored = { ...recovery, status: 'DEPLOYED', deployedBy: (actor as any).actorId ?? ctx.actor.id, deployedAt: now };
  ctx.put(POL, recovery.policyId, restored);
  ctx.audit({ ...actor, action: 'POLICY_DEPLOY', target: recovery.policyId, before: { status: recovery.status }, after: { status: 'DEPLOYED', contentHash: recovery.contentHash }, reason: `롤백 ${x.executionId} (${run.trigger.detail})`, componentId: 'D03-04' });
  const pub = await publishPolicy(ctx, restored);
  const running = { ...x, status: 'RUNNING', artifactId: pub.publicationId };
  ctx.put(RBX, running.executionId, running, { created: true });
  markSource(running.executionId);
  ctx.audit({ ...actor, action: 'ROLLBACK_EXECUTE', target: running.executionId, before: { policyId: current.policyId, contentHash: current.contentHash }, after: { policyId: recovery.policyId, contentHash: recovery.contentHash, artifactId: pub.publicationId }, reason: run.trigger.detail, componentId: 'D03-04' });
  ctx.emit('policy.deployed', recovery.policyId, { policyId: recovery.policyId, flagKey: recovery.flagKey, contentHash: recovery.contentHash, replaced: current.policyId, publicationId: pub.publicationId, reason: `롤백 ${running.executionId}` }, { componentId: 'D03-04', notify: { policy: restored, feature: notify.feature } });
  ctx.emit('rollback.started', running.executionId, { executionId: running.executionId, featureId: running.featureId, artifactId: pub.publicationId, mode: run.mode }, { componentId: 'D03-04' });
  // 대상 차량이 없으면 게시본이 바로 닫힌다 — 같은 반영 안에서 끝낸다
  if (ctx.get(PUB, pub.publicationId)?.closedAt) await finish(ctx, running, 'CONFIRMED', 0, 0);
  return ctx.get(RBX, running.executionId);
}

registerSimHandler('executeRollbackRequest', async (ctx) => {
  const id = ctx.req.params.id;
  const r = await requireRequest(ctx, id);
  if (r.status === 'EXECUTED') ctx.fail('CONFLICT', `이미 실행한 롤백 요청입니다 — 실행 기록 ${r.executionId}.`, { executionId: r.executionId }, { action: 'ROLLBACK_EXECUTE', target: id, reason: `이미 실행한 요청 (${r.executionId})`, componentId: 'D03-04' });
  if (r.status !== 'APPROVED') ctx.fail('GUARD_FAILED', `승인된 요청만 실행할 수 있습니다 (지금 ${r.status}).`, undefined, { action: 'ROLLBACK_EXECUTE', target: id, reason: `${r.status} 요청 실행 시도`, componentId: 'D03-04' });
  return execute(ctx, { mode: 'MANUAL', source: r, trigger: { kind: 'MANUAL', detail: r.reason } });
}, { body: EmptyBody });

/** 롤백 게시본이 닫힘 — 전부 확인이면 완료·성공, 그 밖은 실패(사유·시점) */
async function finish(ctx: SimWriteContext, x: any, status: string, confirmed: number, denominator: number) {
  const now = ctx.iso();
  const ok = status === 'CONFIRMED';
  const next = ok
    ? { ...x, status: 'COMPLETED', result: 'SUCCESS', finishedAt: now }
    : { ...x, status: 'FAILED', result: 'FAILURE', failureReason: `롤백 배포 산출물 ${x.artifactId} ${status} — 차량 확인 ${confirmed}/${denominator}`, failedAt: now, finishedAt: now };
  ctx.put(RBX, x.executionId, next);
  ctx.audit({ ...AUTO, action: 'ROLLBACK_RESULT', target: next.executionId, after: { status: next.status, result: next.result }, reason: next.failureReason ?? undefined, componentId: 'D03-04' });
  ctx.emit(ok ? 'rollback.completed' : 'rollback.failed', next.executionId, resultNotice(next), { componentId: 'D03-04', notify: await featureNotify(ctx, next.featureId, next.after.featureVersion) });
}

/** 정책 게시본 닫힘 — 롤백 실행 마무리, 승인된 Rollback Plan의 실패율 조건(자동 롤백) */
async function onPolicyPublicationClosed(ctx: SimWriteContext, e: PlatformEvent) {
  const p = e.payload as any;
  const x = (await allExecutions(ctx)).find((r) => r.artifactId === p.publicationId);
  if (x && x.status === 'RUNNING') await finish(ctx, x, String(p.status), Number(p.confirmed ?? 0), Number(p.denominator ?? 0));
  for (const plan of (await allPlans(ctx)).filter((q) => q.deploymentId === p.publicationId && q.status === 'APPROVED')) {
    const t = failureRateTrigger(plan.conditions, Number(p.confirmed ?? 0), Number(p.denominator ?? 0));
    if (t) await execute(ctx, { mode: 'AUTO', source: plan, trigger: t });
  }
}

// 롤백 읽기 — 시연에서 정책·게시본·롤백 기록이 바뀌면 같은 규칙으로 다시 센다
registerSimReader('rollbackDeployments', async (ctx) => {
  if (!rollbackTouched(ctx)) return undefined;
  const w = await world(ctx);
  const plans = await allPlans(ctx);
  const items = [];
  for (const p of w.policies.filter((x) => x.status === 'DEPLOYED')) {
    const pub = latestPublication(w.pubs, p.policyId);
    const f = (await featureDetail(ctx, p.featureId, p.featureVersion))?.feature;
    const cs = await candidates(ctx, w, p);
    items.push({
      deploymentId: pub?.publicationId ?? null,
      flagKey: p.flagKey,
      controlPoint: p.controlPoint,
      feature: { featureId: p.featureId, version: p.featureVersion, name: f?.name ?? p.featureId },
      deployed: ref(p),
      deployedBy: p.deployedBy ?? null,
      deployedAt: p.deployedAt ?? null,
      publication: pub ? { status: pub.status, confirmed: pub.confirmed, denominator: pub.denominator, createdAt: pub.createdAt } : null,
      candidates: cs.length,
      eligible: cs.filter((c) => c.eligible).length,
      plans: plans.filter((x) => x.deploymentId === (pub?.publicationId ?? '-') && x.status === 'APPROVED').length,
    });
  }
  return { items };
});

async function changesOf(ctx: SimReadContext, p: any) {
  if (ctx.overlay.data.policyRevisions?.[p.policyId]) return policyChangeLog(await revisionsOf(ctx, p));
  return (await ctx.snapshot<any>('policyChanges', { id: p.policyId }))?.items ?? [];
}

registerSimReader('rollbackDeployment', async (ctx) => {
  if (!rollbackTouched(ctx)) return undefined;
  const deploymentId = ctx.req.params.deploymentId;
  const w = await world(ctx);
  const pub = w.pubs.find((x) => x.publicationId === deploymentId);
  const policy = pub?.kind === 'POLICY' && pub.payload?.policy ? w.policies.find((p) => p.policyId === pub.payload.policy.policyId) : undefined;
  if (!pub || !policy) return undefined;
  const f = (await featureDetail(ctx, policy.featureId, policy.featureVersion))?.feature;
  const current = deployedOf(w.policies, policy.flagKey);
  const executions = await allExecutions(ctx);
  const history = w.pubs
    .filter((x) => x.kind === 'POLICY' && x.payload?.flagKey === policy.flagKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((x) => ({ publicationId: x.publicationId, policyId: x.payload.policy?.policyId ?? null, revision: x.payload.policy?.revision ?? null, contentHash: x.payload.policy?.contentHash ?? null, status: x.status, confirmed: x.confirmed, denominator: x.denominator, createdAt: x.createdAt, createdBy: x.createdBy, rollback: executions.find((r) => r.artifactId === x.publicationId)?.executionId ?? null }));
  return {
    deploymentId,
    current: !!current && current.policyId === policy.policyId && latestPublication(w.pubs, policy.policyId)?.publicationId === deploymentId,
    feature: { featureId: policy.featureId, version: policy.featureVersion, name: f?.name ?? policy.featureId, ownerId: f?.ownerId ?? null, scope: f ? { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim } : null },
    deployed: { ...ref(policy), flagKey: policy.flagKey, controlPoint: policy.controlPoint, status: policy.status, deployedBy: policy.deployedBy ?? null, deployedAt: policy.deployedAt ?? null },
    publication: { status: pub.status, confirmed: pub.confirmed, denominator: pub.denominator, targets: pub.payload.targets.length, createdAt: pub.createdAt },
    policyChanges: await changesOf(ctx, policy),
    deploymentHistory: history,
    swHistory: { available: false, note: 'SW 변경 이력의 원천은 OTA(IF-05) — 이 플랫폼에는 없습니다 (결정 대기 D7)' },
    candidates: current ? await candidates(ctx, w, current) : [],
    plans: (await allPlans(ctx)).filter((x) => x.deploymentId === deploymentId),
    requests: (await allRequests(ctx)).filter((x) => x.deploymentId === deploymentId),
  };
});

registerSimReader('rollbackRequests', async (ctx) => {
  if (!touched(ctx, RREQ)) return undefined;
  const q = ctx.req.query;
  return { items: (await allRequests(ctx)).filter((r) => (!q.deploymentId || r.deploymentId === q.deploymentId) && (!q.status || r.status === q.status)) };
});
registerSimReader('rollbackRequest', (ctx) => ctx.get(RREQ, ctx.req.params.id));
registerSimReader('rollbackPlans', async (ctx) => {
  if (!touched(ctx, PLAN)) return undefined;
  const q = ctx.req.query;
  return { items: (await allPlans(ctx)).filter((r) => (!q.deploymentId || r.deploymentId === q.deploymentId) && (!q.status || r.status === q.status)) };
});
registerSimReader('rollbackPlan', (ctx) => ctx.get(PLAN, ctx.req.params.id));
registerSimReader('rollbacks', async (ctx) => {
  if (!touched(ctx, RBX)) return undefined;
  const q = ctx.req.query;
  return {
    items: (await allExecutions(ctx))
      .filter((x) => !q.deploymentId || x.deploymentId === q.deploymentId)
      .filter((x) => !q.featureId || x.featureId === q.featureId)
      .filter((x) => !q.planId || x.planId === q.planId)
      .filter((x) => !q.requestId || x.requestId === q.requestId)
      .filter((x) => !q.targetType || x.targetTypes.includes(q.targetType))
      .filter((x) => !q.vin || x.vins.includes(q.vin))
      .filter((x) => !q.status || x.status === q.status)
      .filter((x) => !q.result || x.result === q.result)
      .filter((x) => !q.from || x.startedAt >= q.from)
      .filter((x) => !q.to || x.startedAt <= q.to),
  };
});
registerSimReader('rollbackExecution', (ctx) => ctx.get(RBX, ctx.req.params.id));

// 정책 상세의 버전·배포 이력(RD-FN-02)
registerSimReader('policyHistory', async (ctx) => {
  if (!rollbackTouched(ctx)) return undefined;
  const id = ctx.req.params.id;
  const w = await world(ctx);
  const p = w.policies.find((x) => x.policyId === id);
  if (!p) return undefined;
  const current = deployedOf(w.policies, p.flagKey) ?? null;
  const currentPub = current ? latestPublication(w.pubs, current.policyId) : undefined;
  const executions = await allExecutions(ctx);
  const deployments = w.pubs
    .filter((x) => x.kind === 'POLICY' && x.payload?.flagKey === p.flagKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.publicationId.localeCompare(a.publicationId))
    .map((x) => ({
      publicationId: x.publicationId,
      policyId: x.payload.policy?.policyId ?? null,
      revision: x.payload.policy?.revision ?? null,
      contentHash: x.payload.policy?.contentHash ?? null,
      status: x.status,
      confirmed: x.confirmed,
      denominator: x.denominator,
      createdAt: x.createdAt,
      createdBy: x.createdBy,
      current: x.publicationId === currentPub?.publicationId,
      rollbackExecutionId: executions.find((r) => r.artifactId === x.publicationId)?.executionId ?? null,
    }));
  const eligibility = new Map((current ? await candidates(ctx, w, current) : []).map((c) => [c.policyId, c]));
  const versions = w.policies
    .filter((v) => v.flagKey === p.flagKey)
    .map((v) => {
      const c = eligibility.get(v.policyId);
      return { ...ref(v), status: v.status, description: v.description, approvedBy: v.approvedBy, deployedAt: v.deployedAt ?? null, deployedBy: v.deployedBy ?? null, current: !!current && v.policyId === current.policyId, rollback: c ? { eligible: c.eligible, blockers: c.blockers } : null };
    })
    .sort((a, b) => (b.deployedAt ?? '').localeCompare(a.deployedAt ?? '') || b.policyId.localeCompare(a.policyId));
  return {
    policyId: id,
    flagKey: p.flagKey,
    deploymentId: currentPub?.publicationId ?? null,
    current: current ? ref(current) : null,
    deployments,
    versions,
    requests: currentPub ? (await allRequests(ctx)).filter((r) => r.deploymentId === currentPub.publicationId) : [],
    executions: executions.filter((x) => x.flagKey === p.flagKey),
  };
});

// ─── 긴급 권한 사후 독립 검토(D06-09, FFG-PLT-016) ─────────────
async function postReviews(ctx: SimReadContext) {
  const snap = (await ctx.snapshot<{ items: any[] }>('killPostReviews'))?.items ?? [];
  const mine: Record<string, any> = ctx.overlay.data.killPostReview ?? {};
  const kills = ((await readOr<{ items: any[] }>(ctx, 'killRequests'))?.items ?? []).filter((k) => !!k.command);
  const now = new Date().toISOString();
  return kills
    .sort((a, b) => a.killId.localeCompare(b.killId))
    .map((k) => {
      const issuedAt = k.command.issuedAt;
      const due = new Date(Date.parse(issuedAt) + POST_REVIEW_MS).toISOString();
      const r = mine[k.killId] ?? snap.find((x) => x.killId === k.killId)?.review ?? null;
      return {
        killId: k.killId,
        featureId: k.featureId,
        issuedAt,
        due,
        requestedBy: k.requestedBy,
        approvers: (k.approvals ?? []).map((a: any) => a.approverId),
        review: r ? { reviewer: r.reviewer, role: r.role, at: r.at, summary: r.summary, late: r.at > due } : null,
        status: r ? 'REVIEWED' : now > due ? 'OVERDUE' : 'PENDING',
      };
    });
}
const reviewTouched = (ctx: SimReadContext) => !!Object.keys(ctx.overlay.data.killPostReview ?? {}).length || ctx.list('kill').some((k) => !!k.command);
registerSimReader('killPostReviews', async (ctx) => (reviewTouched(ctx) ? { items: await postReviews(ctx) } : undefined));
registerSimReader('iamSodAudit', async (ctx) => {
  if (!reviewTouched(ctx)) return undefined;
  const reviews = await postReviews(ctx);
  return {
    duties: DUTY_ROLES,
    accounts: DEMO_PERSONAS,
    conflicts: dutyConflicts(DEMO_PERSONAS),
    postReviews: { issued: reviews.length, reviewed: reviews.filter((r) => r.status === 'REVIEWED').length, pending: reviews.filter((r) => r.status === 'PENDING').length, overdue: reviews.filter((r) => r.status === 'OVERDUE').length },
  };
});

registerSimHandler('recordKillPostReview', async (ctx) => {
  const killId = ctx.req.params.id;
  const k = ((await readOr<{ items: any[] }>(ctx, 'killRequests'))?.items ?? []).find((x) => x.killId === killId && !!x.command);
  if (!k) ctx.fail('NOT_FOUND', `${killId}은(는) 발행된 차단 명령이 아닙니다.`);
  const blocker = postReviewBlocker({ requestedBy: k.requestedBy, approvers: (k.approvals ?? []).map((a: any) => a.approverId) }, ctx.actor.id);
  if (blocker) ctx.fail('SEPARATION_OF_DUTY', blocker, { rule: 'FFG-PLT-016' }, { action: 'KILL_POST_REVIEW', target: killId, reason: `FFG-PLT-016 ${blocker}`, componentId: 'D06-09' });
  const store = ctx.state<Record<string, any>>('killPostReview', () => ({}));
  const snap = (await ctx.snapshot<{ items: any[] }>('killPostReviews'))?.items ?? [];
  if (store[killId] || snap.find((x) => x.killId === killId)?.review) ctx.fail('CONFLICT', `${killId}은(는) 이미 사후 검토되었습니다.`);
  store[killId] = { reviewer: ctx.actor.id, role: ctx.actor.role, at: ctx.iso(), summary: ctx.req.body.summary };
  ctx.audit({ action: 'KILL_POST_REVIEW', target: killId, after: { summary: ctx.req.body.summary }, componentId: 'D06-09' });
  ctx.emit('kill.post_reviewed', killId, { killId, reviewer: ctx.actor.id, role: ctx.actor.role }, { componentId: 'D06-09' });
  const due = new Date(Date.parse(k.command.issuedAt) + POST_REVIEW_MS).toISOString();
  const r = store[killId];
  return { killId, featureId: k.featureId, issuedAt: k.command.issuedAt, due, requestedBy: k.requestedBy, approvers: (k.approvals ?? []).map((a: any) => a.approverId), review: { ...r, late: r.at > due }, status: 'REVIEWED' };
}, { body: PostReviewBody });

// ─── 서버 활성화 판단(D01-09) — 시연에서 바뀐 정책이면 같은 평가기(evaluateFlag) ─────────
/** 차량의 사용 권한 — 같은 Feature flag의 스냅샷 판단에 실린 권한(서버 entitlements.activeFor는 Feature 단위) */
async function entitlementOf(ctx: SimReadContext, vin: string, featureId: string, flagKey: string): Promise<{ active: boolean; grants: any[] } | null> {
  const own = await ctx.snapshot<any>('activationDecide', {}, { vin, flagKey });
  if (own?.entitlement) return own.entitlement;
  const snap = (await ctx.snapshot<{ items: any[] }>('listPolicies'))?.items ?? [];
  for (const k of [...new Set(snap.filter((p) => p.featureId === featureId).map((p) => p.flagKey))]) {
    const d = await ctx.snapshot<any>('activationDecide', {}, { vin, flagKey: k });
    if (d?.entitlement) return d.entitlement;
  }
  return null;
}
/** 판단 문맥 — flag 하나에 한 번(정책·Feature·차량 표), 차량마다 평가는 같은 평가기 */
async function decideContext(ctx: SimReadContext, flagKey: string) {
  const policy = deployedOf(await allPolicies(ctx), flagKey);
  if (!policy) return null;
  const f = (await featureDetail(ctx, policy.featureId, policy.featureVersion))?.feature;
  if (!f) return null;
  return { policy, f, vehicles: new Map((await vehiclesOf(ctx)).map((v) => [v.vin, v] as const)), kills: ctx.list('kill') };
}
async function platformDecide(ctx: SimReadContext, vin: string, flagKey: string, dc?: Awaited<ReturnType<typeof decideContext>>) {
  const c = dc ?? (await decideContext(ctx, flagKey));
  const vehicle = c?.vehicles.get(vin);
  if (!c || !vehicle) return null;
  const { policy: p, f } = c;
  const entitlement = (await entitlementOf(ctx, vin, p.featureId, flagKey)) ?? { active: false, grants: [] };
  const snap = await ctx.snapshot<any>('activationDecide', {}, { vin, flagKey });
  const mine = (k: any) => (k.featureIds ?? [k.featureId]).includes(p.featureId);
  // 차단 — 시연에서 발령·해제한 것은 시연 상태, 그 밖은 스냅샷 판단의 차단 사유
  const killedBySim = c.kills.some((k) => k.status === 'ACTIVE' && mine(k) && k.vins?.includes(vin) && !k.restoredVins?.includes(vin));
  const killed = killedBySim || (snap?.result?.reason === 'KILL_SWITCH' && !c.kills.some((k) => k.status !== 'ACTIVE' && mine(k)));
  const sup = variantRow({ ...f, featureId: p.featureId, version: p.featureVersion }, vehicle);
  const result = await evaluateFlag({ policy: p, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, killed, vehicle, entitlementActive: p.entitlementCatalogId ? entitlement.active : null, support: { verdict: sup.verdict, reason: sup.reason } } as any);
  return { vehicle, policy: p, result, entitlement };
}
const flagTouched = (ctx: SimReadContext, flagKey: string) => ctx.list(POL).some((p) => p.flagKey === flagKey);
registerSimReader('activationDecide', async (ctx) => {
  const { vin, flagKey } = ctx.req.query;
  if (!vin || !flagKey || !flagTouched(ctx, flagKey)) return undefined;
  return (await platformDecide(ctx, vin, flagKey)) ?? undefined;
});

// ─── IF-04 Unleash(모의) — 계획·서버 정의·drift, 동기화, 차량별 대조 ─────────
/** Unleash 제약 의미(모의 서버 unleashConstraintTrue와 같다) — 문맥이 없으면 거짓, NOT_IN은 참 */
const semver = (v: string) => v.split(/[.+-]/).slice(0, 3).map((x) => Number(x));
const cmpSemver = (a: string, b: string) => {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
function constraintTrue(c: UnleashConstraint, props: Record<string, string | undefined>): boolean {
  const raw = props[c.contextName];
  let ok: boolean;
  if (raw === undefined) ok = false;
  else {
    const v = c.caseInsensitive ? raw.toLowerCase() : raw;
    const vals = (c.values ?? (c.value !== undefined ? [c.value] : [])).map((x) => (c.caseInsensitive ? x.toLowerCase() : x));
    const one = c.value ?? vals[0];
    switch (c.operator) {
      case 'IN': ok = vals.includes(v); break;
      case 'NOT_IN': ok = !vals.includes(v); break;
      case 'STR_CONTAINS': ok = vals.some((x) => v.includes(x)); break;
      case 'STR_STARTS_WITH': ok = vals.some((x) => v.startsWith(x)); break;
      case 'STR_ENDS_WITH': ok = vals.some((x) => v.endsWith(x)); break;
      case 'NUM_EQ': ok = Number(v) === Number(one); break;
      case 'NUM_GT': ok = Number(v) > Number(one); break;
      case 'NUM_GTE': ok = Number(v) >= Number(one); break;
      case 'NUM_LT': ok = Number(v) < Number(one); break;
      case 'NUM_LTE': ok = Number(v) <= Number(one); break;
      case 'SEMVER_EQ': ok = cmpSemver(v, one) === 0; break;
      case 'SEMVER_GT': ok = cmpSemver(v, one) > 0; break;
      case 'SEMVER_LT': ok = cmpSemver(v, one) < 0; break;
      case 'DATE_AFTER': ok = Date.parse(v) > Date.parse(one); break;
      case 'DATE_BEFORE': ok = Date.parse(v) < Date.parse(one); break;
      default: ok = false;
    }
  }
  if (raw === undefined && c.operator === 'NOT_IN') ok = true;
  return c.inverted ? !ok : ok;
}
type MockFlag = { enabled: boolean; strategies: any[]; tags: { type: string; value: string }[]; dependencies: { feature: string }[]; variants: any[] };
const mockServer = (ctx: SimReadContext): Record<string, MockFlag> => ctx.overlay.data.unleashMock ?? {};
/** 모의 Unleash에 있는 flag 정의 — 시연에서 동기화한 것, 없으면 스냅샷(같은 flag 정책의 서버 정의) */
async function serverDef(ctx: SimReadContext, flagName: string): Promise<MockFlag | null> {
  const mine = mockServer(ctx)[flagName];
  if (mine) return mine;
  for (const p of ((await ctx.snapshot<{ items: any[] }>('listPolicies'))?.items ?? []).filter((x) => x.flagKey === flagName)) {
    const v = (await ctx.snapshot<any>('policyUnleash', { id: p.policyId }))?.server;
    if (v) return { enabled: !!v.enabled, strategies: v.strategies ?? [], tags: v.tags ?? [], dependencies: v.dependencies ?? [], variants: v.variants ?? [] };
  }
  return null;
}
/** 같은 flag의 마지막 동기화 기록(IF-04) — 시연에서 한 것, 없으면 스냅샷 */
async function lastSyncOf(ctx: SimReadContext, flagName: string, policyId: string, base: any) {
  const mine = (ctx.overlay.data.unleashCalls as any[] | undefined)?.find((c) => c.request.flagName === flagName);
  if (mine) return mine;
  if (base?.lastSync) return base.lastSync;
  for (const p of ((await ctx.snapshot<{ items: any[] }>('listPolicies'))?.items ?? []).filter((x) => x.flagKey === flagName && x.policyId !== policyId)) {
    const v = (await ctx.snapshot<any>('policyUnleash', { id: p.policyId }))?.lastSync;
    if (v) return v;
  }
  return null;
}

/** 계획 — 서버 UnleashSyncService.plan(REQUIRES 배포 flag·EXCLUDES·서명 코호트·서명 게시본 확인) */
async function unleashPlan(ctx: SimReadContext, p: any): Promise<UnleashPlan | null> {
  const d = await featureDetail(ctx, p.featureId, p.featureVersion);
  const f = d?.feature;
  if (!f) return null;
  const all = await allPolicies(ctx);
  const deployedFlags = (featureId: string) => [...new Set(all.filter((x) => x.featureId === featureId && x.status === 'DEPLOYED').map((x) => x.flagKey))].sort();
  const out: any[] = d.dependencies?.outgoing ?? [];
  const requires = out.filter((x) => x.type === 'REQUIRES').map((x) => ({ featureId: x.targetFeatureId, flagKeys: deployedFlags(x.targetFeatureId) }));
  const excludes = [...new Set([...out.filter((x) => x.type === 'EXCLUDES').map((x) => x.targetFeatureId), ...(d.dependencies?.incoming ?? []).filter((x: any) => x.type === 'EXCLUDES').map((x: any) => x.sourceFeatureId)])];
  let cohortMembers: string[] | null = null;
  if (unleashPartial(p)) {
    const bp = effectiveBasisPoints(p);
    cohortMembers = [];
    if (bp > 0) for (const v of await vehiclesOf(ctx)) if (v.quality === 'TRUSTED' && (v.canary || (await cohortBucket('1', p.flagKey, p.rollout.salt, v.vin)) < bp)) cohortMembers.push(v.vin);
  }
  const plan = planUnleash({ policy: p, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, requires, excludes, cohortMembers });
  const signed = (await allPublications(ctx)).some((pub) => pub.kind === 'POLICY' && pub.payload?.policy && canonicalJson(pub.payload.policy) === canonicalJson(p));
  if (!signed) {
    plan.blockers.push('현재 정책과 일치하는 유효한 FF 서명 게시본이 없습니다 (UL-LIVE: FF Gate가 원천)');
    plan.ready = false;
  }
  return plan;
}

const unleashTouched = (ctx: SimReadContext, p: any) => !!ctx.get(POL, p.policyId) || !!mockServer(ctx)[p.flagKey] || flagTouched(ctx, p.flagKey) || ctx.list('kill').length > 0;

registerSimReader('policyUnleash', async (ctx) => {
  const p = await loadPolicy(ctx, ctx.req.params.id);
  if (!p || !unleashTouched(ctx, p)) return undefined;
  const base = await ctx.snapshot<any>();
  const plan = await unleashPlan(ctx, p);
  if (!plan) return undefined;
  const server = await serverDef(ctx, plan.flagName);
  const lastSync = await lastSyncOf(ctx, plan.flagName, p.policyId, base);
  return { status: base?.status ?? (await ctx.snapshot<any>('unleashStatus')), plan, server, drift: unleashDrift(plan, server), serverError: null, lastSync };
});

registerSimHandler('syncUnleash', async (ctx) => {
  const id = ctx.req.params.id;
  const p = await requirePolicy(ctx, id);
  const plan = (await unleashPlan(ctx, p)) ?? ctx.fail('NOT_FOUND', `정책 대상 ${p.featureId} ${p.featureVersion}이(가) 없습니다.`);
  const status = await ctx.snapshot<any>('unleashStatus');
  const mode = status?.mode ?? 'mock';
  const servers = ctx.state<Record<string, MockFlag>>('unleashMock', () => ({}));
  const steps: { name: string; state: string; code: number; why: string | null; detail?: string }[] = [];
  const ok = (name: string, detail?: string, code = 200) => steps.push({ name, state: 'OK', code, why: null, ...(detail ? { detail } : {}) });
  let outcome: 'SYNCED' | 'BLOCKED' | 'FAILED' = 'SYNCED';
  if (!plan.ready) outcome = 'BLOCKED';
  else {
    // 모의 Unleash 쓰기 순서(서버 deploy): flag 보장 → 태그 → REQUIRES 의존 → 전략 교체 → 환경 on/off → 다시 읽어 대조
    const prev = servers[plan.flagName] ?? (await serverDef(ctx, plan.flagName));
    ok('ensureFlag', prev ? 'REUSED' : 'CREATED', prev ? 200 : 201);
    ok('tagTypes');
    ok('tags');
    for (const t of plan.tags) ok(`attach ${t.type}`, t.value);
    for (const parent of plan.dependencies) {
      if (!servers[parent] && !(await serverDef(ctx, parent))) {
        steps.push({ name: `parent ${parent}`, state: 'NOT_FOUND', code: 404, why: `${parent} 없음`, detail: '상위 flag를 먼저 동기화하세요' });
        outcome = 'FAILED';
        break;
      }
      ok(`parent ${parent}`);
      ok(`dependency ${parent}`);
    }
    if (outcome === 'SYNCED') {
      ok('strategies');
      const strategies = plan.strategies.map((s, i) => ({ id: `sim-${plan.flagName}-${i + 1}`, ...s }));
      if ((prev?.strategies.length ?? 0) === 1 && strategies.length === 1) ok('strategy PUT', 'UPDATED');
      else for (const s of plan.strategies) ok('strategy POST', s.title);
      ok(`environment ${plan.enabled ? 'on' : 'off'}`);
      servers[plan.flagName] = { enabled: plan.enabled, strategies, tags: plan.tags.map((t) => ({ ...t })), dependencies: plan.dependencies.map((feature) => ({ feature })), variants: [] };
      const drift = unleashDrift(plan, servers[plan.flagName]);
      if (drift.length) {
        outcome = 'FAILED';
        steps.push({ name: 'verifySource', state: 'FAILED', code: 200, why: drift.join(' / ') });
      } else ok('verifySource');
    }
  }
  const calls = ctx.state<any[]>('unleashCalls', () => []);
  const n = calls.length + 1;
  calls.unshift({ ifId: 'IF-04', key: `${p.policyId}@r${p.revision}#${n}`, at: ctx.iso(), request: { policyId: p.policyId, revision: p.revision, flagName: plan.flagName, mode }, response: { outcome, steps } });
  if (outcome !== 'SYNCED') ctx.audit({ action: 'UNLEASH_SYNC', target: p.policyId, reason: outcome === 'BLOCKED' ? plan.blockers.join(' / ') : (steps.at(-1)?.why ?? 'Unleash 동기화 실패'), result: 'FAILED', componentId: 'D01-06' });
  else ctx.audit({ action: 'UNLEASH_SYNC', target: p.policyId, after: { flagName: plan.flagName, enabled: plan.enabled, strategies: plan.strategies.length, mode }, componentId: 'D01-06' });
  ctx.emit(`unleash.${outcome.toLowerCase()}`, p.policyId, { policyId: p.policyId, flagName: plan.flagName, outcome, mode, failedStep: outcome === 'FAILED' ? (steps.at(-1)?.name ?? null) : null }, { componentId: 'D01-06' });
  return { outcome, plan, steps };
}, { body: EmptyBody });

/** 차량별 대조 — 모의 Unleash 판단(서버 정의) vs 플랫폼 판단(evaluateFlag). 문맥 품질이 TRUSTED가 아니면 비교 제외 */
registerSimReader('unleashEvaluation', async (ctx) => {
  const p = await loadPolicy(ctx, ctx.req.params.id);
  if (!p || !unleashTouched(ctx, p)) return undefined;
  const plan = await unleashPlan(ctx, p);
  if (!plan) return undefined;
  const servers: Record<string, MockFlag | null> = {};
  const def = async (name: string) => (name in servers ? servers[name] : (servers[name] = await serverDef(ctx, name)));
  await def(plan.flagName);
  for (const dep of servers[plan.flagName]?.dependencies ?? []) await def(dep.feature);
  let props: Record<string, string | undefined> = {};
  const evalFlag = (name: string): boolean => {
    const f = servers[name];
    return !!f && f.strategies.some((s) => !s.disabled && (s.constraints ?? []).every((c: UnleashConstraint) => constraintTrue(c, props)) && Number(s.parameters?.rollout) >= 100);
  };
  const dc = await decideContext(ctx, p.flagKey);
  const rows: any[] = [];
  for (const v of await vehiclesOf(ctx)) {
    const trial = p.entitlementCatalogId ? ((await entitlementOf(ctx, v.vin, p.featureId, p.flagKey))?.active ?? false) : null;
    const server = (await platformDecide(ctx, v.vin, p.flagKey, dc))?.result ?? null;
    if (v.quality !== 'TRUSTED') {
      rows.push({ vin: v.vin, label: v.label, unleash: null, platform: server?.value ?? null, platformReason: server?.reason ?? null, verdict: 'NO_CONTEXT', why: `문맥 ${v.quality} — 플랫폼은 HOLD(Safe Default)` });
      continue;
    }
    const f = servers[plan.flagName];
    if (!f) {
      rows.push({ vin: v.vin, label: v.label, unleash: null, platform: server?.value ?? null, platformReason: server?.reason ?? null, verdict: 'ERROR', why: 'Unleash에 flag가 없습니다 — 먼저 동기화하세요' });
      continue;
    }
    const c = unleashContext(v, trial);
    props = { ...c.properties, userId: c.userId };
    const unsatisfied = f.dependencies.some((dep) => !servers[dep.feature] || !servers[dep.feature]!.enabled || !evalFlag(dep.feature));
    const unleash = f.enabled && evalFlag(plan.flagName) && !unsatisfied;
    const platform = server?.value ?? null;
    rows.push({
      vin: v.vin,
      label: v.label,
      unleash,
      platform,
      platformReason: server?.reason ?? null,
      verdict: unleash === platform ? 'AGREE' : 'MISMATCH',
      why: unleash === platform ? null : server?.reason === 'KILL_SWITCH' ? '긴급 차단은 FP에서만 — Unleash 정의는 그대로' : unsatisfied ? '상위 flag 미충족' : null,
    });
  }
  const n = (k: string) => rows.filter((r) => r.verdict === k).length;
  return { flagName: plan.flagName, summary: { vehicles: rows.length, agree: n('AGREE'), mismatch: n('MISMATCH'), noContext: n('NO_CONTEXT'), error: n('ERROR') }, rows };
});
