// 시연 흐름 — 긴급 차단(D03-03)·복원(D03-04). 서버 kill.service·restore.service와 같은 순서·규칙(contracts 순수 규칙)으로:
// 요청(type-to-confirm·영향 범위·DC4 거부·F2 이상 안전 봉쇄 근거) → 2인 승인(approvalCheck — 요청자 제외·서로 다른 2인·FSM·CSM)
// → 정책 게이트 최종 판정(gateVerdict — 같은 규칙표) → 명령 원장 +1 → 서명(시연 키)·차량별 봉투 → 긴급 채널 게시본
// → 차량 회신이 몇 초에 걸쳐 들어온다(통신이 끊긴 차량은 회신 없음 → 전달 재시도) → 회신 집계(aggregate) → 게시본 닫힘.
// 복원은 차단 해제다(기능 활성화가 아님, desired=INACTIVE) — 직전 차단 승인자 제외 2인 승인·Canary 상한·BOM·SBOM 게이트.
import {
  aggregate,
  approvalCheck,
  approvalPlan,
  approverRef,
  DEFAULT_GATE_POLICY,
  gateVerdict,
  jcs,
  KillApproveBody,
  KillCreateBody,
  KillRejectBody,
  killTimeline,
  OtaJobActionBody,
  RestoreRequestBody,
  MARKETS,
  nextApprovers,
  NOTIFICATION_ACCOUNTS,
  recallReportDue,
  reportRolesOf,
  restoreOutlook,
  type ApproverRole,
  type GateLedger,
  type KillCommandV2,
  type KillRequestType,
  type Market,
  type ReasonCategory,
  type Role,
  type TimelineCommand,
  type TimelineReport,
} from '@ff/contracts';
import { blockedVins, missingRestoreChecks, RESTORE_CHECK_LABEL } from '../../../../../contracts/src/rules/kill-scope';
import { registerSimHandler, registerSimReader, registerSimTask, registerSimView, simUnhandled } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';

const KILL = 'kill';
const PUB = 'publication';
/** 승인 대기 기한(서버 APPROVAL_TTL_MS) */
const APPROVAL_TTL_MS = 2 * 3600_000;
/** 명령 유효기간(서버 COMMAND_TTL_MS) */
const COMMAND_TTL_MS = 12 * 3600_000;
const UNSIGNED = 'A'.repeat(86);
/** 시연 회신 — 첫 회신까지·묶음 간격(ms)·묶음 수. 통신이 끊긴 차량은 재시도 전까지 답하지 않는다 */
export const REPLY_FIRST_MS = 1200;
export const REPLY_STEP_MS = 1100;
export const REPLY_BATCHES = 5;
/** 회신 기한 — 지나면 받은 만큼으로 닫는다(PARTIAL·TIMEOUT) */
export const REPLY_DEADLINE_MS = 10 * 60_000;
/** 시연 서명 키 ID — 용도별로 나눈다(FFG-SEC-002). 실제 HSM 키가 아니라 이 브라우저의 결정적 서명이다(설계 20-60 §한계) */
export const DEMO_KID = { kill: 'KEY-0901', restore: 'KEY-0902', publication: 'KEY-0903' } as const;
const KEY_EPOCH = 1;

type Approval = { approverId: string; platformRole: string; role: ApproverRole; signedAt: string; kid: string; sig: string; comment: string | null };

// ─── 시연 서명(결정적) ─────────────────────────────────────
const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
/** 64바이트 서명 모양(base64url 86자) — 같은 대상·키면 같은 값 */
export async function demoSign(kid: string, body: string): Promise<string> {
  const a = await digest(`${kid}\n${body}`);
  const b = await digest(`${kid}\n${body}\n2`);
  const out = new Uint8Array(64);
  out.set(a, 0);
  out.set(b, 32);
  return b64url(out);
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// ─── 공통 읽기 ─────────────────────────────────────────────
interface FeatureInfo {
  name: string;
  ownerId: string;
  country: string;
  baselineId: string | null;
  ecu: string;
  swId: string;
  swVersion: string;
  sbomRef: string | null;
  rxswin: string;
}
async function featureInfo(ctx: SimReadContext, featureId: string, version: string): Promise<FeatureInfo> {
  const d = await ctx.snapshot<any>('featureDetail', { id: featureId, ver: version });
  const s = await ctx.snapshot<any>('safetyProfile', { id: featureId, ver: version });
  const f = d?.feature ?? {};
  const p = s?.profile ?? {};
  return {
    name: f.name ?? featureId,
    ownerId: f.ownerId ?? '',
    country: f.country ?? 'KR',
    baselineId: f.baselineId ?? d?.baseline?.baselineId ?? null,
    ecu: f.ecuPnos?.[0] ?? 'UNSPECIFIED',
    swId: f.swIds?.[0] ?? 'UNSPECIFIED',
    swVersion: f.swVersions?.[0] ?? version,
    sbomRef: p.sbomRef ?? null,
    rxswin: p.rxswin?.[0] ?? 'NONE',
  };
}
const marketOf = (country: string): Market => ((MARKETS as readonly string[]).includes(country) ? (country as Market) : 'OTHER');

/** 영향 범위 스냅샷 — 같은 사유가 없으면 사유 없는 것 */
async function basePreview(ctx: SimReadContext, featureId: string, featureVersion: string, category?: string) {
  return (
    (category ? await ctx.snapshot<any>('killPreview', {}, { featureId, featureVersion, reasonCategory: category }) : null) ??
    (await ctx.snapshot<any>('killPreview', {}, { featureId, featureVersion })) ??
    (category ? null : await ctx.snapshot<any>('killPreview', {}, { featureId, featureVersion, reasonCategory: 'SAFETY' }))
  );
}

/** 명령 원장(Feature별) — 시연에서 발행한 것이 있으면 그것, 없으면 스냅샷 미리보기의 순번·직전 승인자·24시간 누적 */
function ledgerOf(o: { data: Record<string, any> }, featureId: string, base: any): GateLedger {
  const mine = o.data.killLedger?.[featureId] as GateLedger | undefined;
  if (mine) return mine;
  const at = new Date().toISOString();
  return {
    last_order_seq: Math.max(0, Number(base?.nextSeq ?? 1) - 1),
    last_kill_approvers: base?.lastKillApprovers ?? [],
    recent: [
      ...(base?.window?.deactivate ? [{ request: 'deactivate', vehicles: Number(base.window.deactivate), at }] : []),
      ...(base?.window?.restore ? [{ request: 'restore', vehicles: Number(base.window.restore), at }] : []),
    ],
  };
}
const registryOf = (featureId: string, base: any, led: GateLedger) => ({ features: { [featureId]: base.registry }, policy: DEFAULT_GATE_POLICY, ledger: { [featureId]: led } });

/** kill_command v2 초안 — 서버 buildCommand와 같은 칸 */
function buildCommand(
  k: { featureId: string; featureVersion: string; vins: string[]; reasonCategory: ReasonCategory; reasonCode: string; anomalyId?: string | null; recallCampaignId?: string | null; containmentJustification?: string | null; userNoticeRef?: string | null },
  request: KillRequestType,
  approvals: { approverId: string; role: ApproverRole; signedAt: string; sig: string }[],
  reg: { f_class: any; deact_class: any },
  info: FeatureInfo,
  led: GateLedger,
  now: Date,
): KillCommandV2 {
  const ordered = [...approvals].sort((a, b) => Number(b.role === 'FSM') - Number(a.role === 'FSM'));
  return {
    type: 'kill_command',
    schema_version: '2.0',
    command_id: crypto.randomUUID(),
    command_seq: (led.last_order_seq ?? 0) + 1,
    request,
    feature: { id: k.featureId, version: k.featureVersion, f_class: reg.f_class, deact_class: reg.deact_class },
    reason: { category: k.reasonCategory, code: k.reasonCode, ...(k.anomalyId ? { incident_id: k.anomalyId } : {}) },
    scope: { vehicle_ids: [...k.vins], max_vehicles: k.vins.length },
    target: { market: marketOf(info.country), ecu_id: info.ecu, sw_id: info.swId, sw_version: info.swVersion, rxswin: info.rxswin },
    validity: { not_before: now.toISOString(), expires_at: new Date(now.getTime() + COMMAND_TTL_MS).toISOString() },
    approvals: ordered.map((a) => ({ approver_id: a.approverId, role: a.role, signed_at: a.signedAt, approval_sig: a.sig })),
    regulatory: {
      type_approval_impact: 'NONE',
      r156_assessment_id: `SUMS-IA-${k.featureId}-${k.featureVersion}`,
      ...(k.recallCampaignId ? { recall_campaign_id: k.recallCampaignId } : {}),
      ...(k.containmentJustification ? { containment_justification: k.containmentJustification } : {}),
    },
    user_notice: k.userNoticeRef
      ? { required: true, text_ref: k.userNoticeRef, ...(marketOf(info.country) === 'CN' ? { user_confirmation_required: true } : {}) }
      : { required: true, text_ref: `HMI-TXT-${k.featureId.replace('-', '')}-${request === 'restore' ? 'RESTORE' : 'DEACT'}` },
    evidence: { evidence_manifest_id: `EVM-${k.featureId}-${k.featureVersion}`, ...(info.baselineId ? { bom_baseline_id: info.baselineId } : {}), ...(info.sbomRef ? { sbom_ref: info.sbomRef } : {}) },
    issued_by: 'ff-platform',
    issued_at: now.toISOString(),
    signature: { alg: 'EdDSA', kid: 'unsigned', value: UNSIGNED },
  } as KillCommandV2;
}

const accounts = () => NOTIFICATION_ACCOUNTS.map((a) => ({ id: a.id, roles: reportRolesOf(a.roles) })).filter((a) => a.roles.length > 0);
const effective = (k: any, now = Date.now()) => (k.status === 'REQUESTED' && k.expiresAt && Date.parse(k.expiresAt) <= now ? { ...k, status: 'EXPIRED' } : k);
const excludedOf = (k: any, led: GateLedger | undefined) => [...new Set([...(k.approvals ?? []).map((a: Approval) => a.approverId), ...(led?.last_kill_approvers ?? [])])];

function summary(p: any) {
  return p ? { publicationId: p.publicationId, status: p.status, confirmed: p.confirmed, denominator: p.denominator, deadlineAt: p.deadlineAt, closedAt: p.closedAt, nodes: p.nodes, ackOnly: p.ackOnly } : null;
}
/** 회신 집계·승인 후보를 붙인 모양(서버 withProgress + outlook) */
function project(k: any, ctx: SimReadContext) {
  const e = effective(k);
  const pub = (id: string | null) => (id ? ctx.get(PUB, id) : undefined);
  const led = ctx.overlay.data.killLedger?.[e.featureId] as GateLedger | undefined;
  const out: any = { ...e, delivery: summary(pub(e.publicationId)) ?? e.delivery ?? null, restore: summary(pub(e.restorePublicationId)) ?? e.restore ?? null };
  if (e.version === 2 && e.status === 'REQUESTED' && e.fClass && e.reasonCategory)
    out.approverCandidates = nextApprovers(accounts(), { requestedBy: e.requestedBy, approvals: e.approvals ?? [], plan: approvalPlan(e.fClass, 'deactivate', e.reasonCategory) });
  if (e.version === 2 && e.status === 'ACTIVE') {
    const rr = e.restoreRequest?.status === 'REQUESTED' ? e.restoreRequest : null;
    out.restoreOutlook = restoreOutlook(accounts(), approvalPlan(e.fClass ?? 'F0', 'restore', e.reasonCategory ?? 'SAFETY'), excludedOf(e, led), rr?.approvals ?? [], rr?.requestedBy ?? '');
  }
  return out;
}

registerSimView('killRequests', { collection: KILL, idKey: 'killId', filter: (k, q) => !q.status || effective(k).status === q.status, project });
registerSimView('killDetail', { collection: KILL, idKey: 'killId', detailParam: 'id', project });
registerSimView('publications', { collection: PUB, idKey: 'publicationId', filter: (p, q) => (!q.kind || p.kind === q.kind) && (!q.status || p.status === q.status) });

// 게시본 상세 — 시연에서 만든 게시본이면 서명 검증·회신·전달 작업까지
registerSimReader('publicationDetail', (ctx) => {
  const p = ctx.get(PUB, ctx.req.params.id);
  if (!p) return undefined;
  const store = ctx.overlay.data.killDelivery?.[p.publicationId] ?? {};
  return { publication: p, verification: { valid: true, reason: 'SIGNATURE_VALID' }, readbacks: store.readbacks ?? [], calls: store.calls ?? [], delivery: store.job ?? null };
});

// 영향 범위 미리보기 — 진행 중 차단·원장·24시간 누적을 시연 상태로, 게이트 사전 점검은 같은 규칙(승인 칸 제외)
registerSimReader('killPreview', async (ctx) => {
  const q = ctx.req.query;
  if (!q.featureId || !q.featureVersion) return undefined;
  const base = await basePreview(ctx, q.featureId, q.featureVersion, q.reasonCategory);
  if (!base) return undefined;
  const category = (q.reasonCategory || undefined) as ReasonCategory | undefined;
  const list = q.vins ? q.vins.split(',').map((v) => v.trim()).filter(Boolean) : undefined;
  const all: string[] = base.vehicles.map((v: { vin: string }) => v.vin);
  const unknownVins = (list ?? []).filter((v) => !all.includes(v));
  const picked = list?.length ? all.filter((v) => list.includes(v)) : all;
  const kills: any[] = (await ctx.read<{ items: any[] }>('killRequests')).items ?? [];
  const vehicleVins = new Set(all);
  const activeKill =
    kills.find(
      (k) => k.featureId === q.featureId && (k.status === 'ACTIVE' || effective(k).status === 'REQUESTED') && !(k.reasonCategory === 'COMMERCIAL' && category !== 'COMMERCIAL') && (k.vins ?? []).some((v: string) => vehicleVins.has(v)),
    )?.killId ?? null;
  const led = ledgerOf(ctx.overlay, q.featureId, base);
  const win = 24 * 3600_000;
  const sum = (req: string) => (led.recent ?? []).filter((r) => r.request === req && Date.now() - Date.parse(r.at) <= win).reduce((a, r) => a + r.vehicles, 0);
  let checks: unknown[] = [];
  if (category && picked.length && base.registry) {
    const info = await featureInfo(ctx, q.featureId, q.featureVersion);
    const csm = approvalPlan(base.registry.f_class, 'deactivate', category).required?.includes('CSM');
    const at = new Date().toISOString();
    const placeholder = [
      { approverId: '(승인 1)', role: 'FSM' as ApproverRole, signedAt: at, sig: UNSIGNED },
      { approverId: '(승인 2)', role: (csm ? 'CSM' : 'OPS_LEAD') as ApproverRole, signedAt: at, sig: UNSIGNED },
    ];
    const cmd = buildCommand(
      { featureId: q.featureId, featureVersion: q.featureVersion, vins: picked, reasonCategory: category, reasonCode: 'FIELD_FAULT', recallCampaignId: q.recallCampaignId || null, containmentJustification: q.containmentJustification || null },
      'deactivate',
      placeholder,
      base.registry,
      info,
      led,
      new Date(),
    );
    checks = gateVerdict(cmd, registryOf(q.featureId, base, led), new Date()).findings.filter((x) => x.rule !== 'FFG-PLT-005');
  }
  return {
    ...base,
    unknownVins,
    activeKill,
    window: { ...base.window, deactivate: sum('deactivate'), restore: sum('restore') },
    nextSeq: (led.last_order_seq ?? 0) + 1,
    lastKillApprovers: led.last_kill_approvers ?? [],
    checks,
  };
});

// 재검증 Evidence — 이 Feature 스냅샷이 없으면 전체 원장에서 같은 규칙(featureId·gate·result)으로 거른다
registerSimReader('evidenceLedger', async (ctx) => {
  if (await ctx.snapshot()) return undefined;
  const all = await ctx.snapshot<{ items: any[] }>('evidenceLedger');
  if (!all) return undefined;
  const q = ctx.req.query;
  return { ...all, items: all.items.filter((e) => (!q.featureId || e.featureId === q.featureId) && (!q.gate || e.gate === q.gate) && (!q.result || e.inputResult === q.result) && (!q.ref || String(e.evidenceRef).includes(q.ref))) };
});

// 발행 명령·차량별 봉투, 종료·복원 시간 기록 — 시연에서 발행한 것
registerSimReader('killEnvelopes', (ctx) => {
  const c = ctx.overlay.data.killCommands?.[ctx.req.params.id];
  return c ? { commands: c.commands, envelopes: c.envelopes } : undefined;
});
registerSimReader('killTimeline', (ctx) => {
  const id = ctx.req.params.id;
  const c = ctx.overlay.data.killCommands?.[id];
  const k = ctx.get(KILL, id);
  if (!c || !k) return undefined;
  const reports: TimelineReport[] = c.reports ?? [];
  const commands: TimelineCommand[] = c.timeline ?? [];
  return { killId: id, featureId: k.featureId, items: k.vins.map((vin: string) => killTimeline(vin, commands, reports, { adsFeature: !!c.adsFeature })) };
});

// ─── 쓰기 ─────────────────────────────────────────────────
async function load(ctx: SimWriteContext, id: string) {
  const own = ctx.get(KILL, id);
  if (own) return structuredClone(own);
  try {
    // 회신 집계(delivery·restore)는 스냅샷 값을 지닌다 — 시연 게시본이 생기면 project가 덮는다
    const { approverCandidates: _a, restoreOutlook: _o, ...k } = await ctx.read<any>('killDetail', { id });
    return k;
  } catch {
    return ctx.fail('NOT_FOUND', `차단 요청 ${id}을(를) 찾을 수 없습니다.`);
  }
}

/** 승인 1건 서명 — 서버 signApproval(approvalCheck 실패면 감사 후 403·409) */
async function signApproval(
  ctx: SimWriteContext,
  subject: { killId: string; featureId: string; featureVersion: string; vins: string[]; reasonCategory: ReasonCategory },
  request: KillRequestType,
  state: { requestedBy: string; approvals: Approval[]; plan: ReturnType<typeof approvalPlan>; excluded?: string[] },
  action: string,
  comment?: string,
): Promise<Approval> {
  const check = approvalCheck(state, { id: ctx.actor.id, roles: reportRolesOf([ctx.actor.role as Role]) });
  if ('code' in check) {
    ctx.fail(check.code === 'SELF_APPROVAL' || check.code === 'NO_APPROVER_ROLE' ? 'FORBIDDEN' : 'CONFLICT', check.message, { code: check.code }, {
      action,
      target: subject.killId,
      reason: `${check.code}: ${check.message}`,
      componentId: request === 'restore' ? 'D03-04' : 'D03-03',
    });
  }
  const role = (check as { role: ApproverRole }).role;
  const signedAt = ctx.iso();
  const kid = `APR-${ctx.actor.id}`;
  const body = jcs({ feature: `${subject.featureId}@${subject.featureVersion}`, request, reason: subject.reasonCategory, vehicles: [...subject.vins].sort(), approver: ctx.actor.id, role, signed_at: signedAt });
  return { approverId: ctx.actor.id, platformRole: ctx.actor.role, role, signedAt, kid, sig: await demoSign(kid, body), comment: comment?.trim() || null };
}

/** 원장 +1·서명·차량별 봉투·긴급 채널 게시본 — 서버 issueCommand + publishKill/publishRestore */
async function issueCommand(ctx: SimWriteContext, k: any, stage: { vins: string[] }, draft: KillCommandV2, led: GateLedger) {
  const purpose = draft.request === 'restore' ? 'restore' : 'kill';
  const { signature: _u, ...body } = draft;
  const command: KillCommandV2 = { ...body, signature: { alg: 'EdDSA', kid: DEMO_KID[purpose], value: await demoSign(DEMO_KID[purpose], jcs(body)) } } as KillCommandV2;
  const store = ctx.state<Record<string, any>>('killCommands', () => ({}));
  const rec = (store[k.killId] ??= { commands: [], envelopes: [], timeline: [], reports: [], adsFeature: false });
  rec.commands.push(command);
  const seqs = ctx.state<Record<string, number>>('vehicleSeq', () => ({}));
  const refs = [approverRef(command.approvals[0].approver_id), approverRef(command.approvals[1].approver_id)];
  for (const vin of stage.vins) {
    const key = `${vin}|${command.feature.id}`;
    const vehicleSeq = (seqs[key] = (seqs[key] ?? 0) + 1);
    const cmdAuth = b64url((await digest(`${vin}|${KEY_EPOCH}|${command.command_id}|${vehicleSeq}`)).slice(0, 16));
    const { signature: _s, ...fleetBody } = command;
    const envBody = { ...fleetBody, scope: { vehicle_ids: [vin], max_vehicles: 1 }, vehicle_auth: { key_epoch: KEY_EPOCH, vehicle_seq: vehicleSeq, approver_refs: refs, cmd_auth: cmdAuth } };
    rec.envelopes.push({ ...envBody, signature: { alg: 'EdDSA', kid: DEMO_KID[purpose], value: await demoSign(DEMO_KID[purpose], jcs(envBody)) } });
    rec.timeline.push({ commandId: command.command_id, request: command.request, vin, vehicleSeq });
  }
  // 원장 — 순번·직전 차단 승인자·24시간 누적(게이트 SEC-003·PLT-017·복원 PLT-005)
  const ledger = ctx.state<Record<string, GateLedger>>('killLedger', () => ({}));
  ledger[k.featureId] = {
    last_order_seq: command.command_seq,
    last_kill_approvers: command.request === 'deactivate' ? command.approvals.map((a) => a.approver_id) : (led.last_kill_approvers ?? []),
    recent: [...(led.recent ?? []), { request: command.request, vehicles: stage.vins.length, at: ctx.iso() }],
  };
  return { command, envelopes: stage.vins.length };
}

const commandRef = (i: { command: KillCommandV2; envelopes: number }) => ({
  commandId: i.command.command_id,
  commandSeq: i.command.command_seq,
  kid: i.command.signature.kid,
  signature: i.command.signature.value,
  issuedAt: i.command.issued_at,
  envelopes: i.envelopes,
});

/** 서명 게시본(차단 KILL·복구 RESTORE) — 긴급 채널, 차량 회신을 기다린다. 통신이 끊긴 차량은 전달 작업에 '재시도 가능'으로 남는다 */
async function publish(ctx: SimWriteContext, k: any, kind: 'KILL' | 'RESTORE', vins: string[], offline: Set<string>, legacyDesired?: string) {
  const base = await ctx.snapshot<{ items: { publicationId: string }[] }>('publications');
  const id = ctx.nextId('PUB', [...(base?.items ?? []).map((p) => p.publicationId), ...ctx.list(PUB).map((p) => p.publicationId)]);
  const now = ctx.iso();
  // v1 레거시 해제는 flag 평가 재개(ACTIVE) — 서버 publishRestore와 같다
  const desired = legacyDesired ?? (kind === 'KILL' ? 'DISABLED' : 'INACTIVE');
  const payload = { publicationId: id, kind, sequence: 1, issuedAt: now, featureId: k.featureId, featureVersion: k.featureVersion, flagKey: null, policy: null, kill: { killId: k.killId, safeMode: 'SAFE_DEFAULT', featureIds: k.featureIds }, targets: vins, desired };
  const payloadHash = `sha256:${hex(await digest(jcs(payload)))}`;
  const campaignId = id.replace('PUB', 'CMP');
  const p = {
    publicationId: id,
    kind,
    status: 'DISPATCHED',
    payload,
    signature: { keyId: DEMO_KID.publication, alg: 'Ed25519', payloadHash, signature: (await demoSign(DEMO_KID.publication, payloadHash)).replace(/-/g, '+').replace(/_/g, '/') + '==' },
    campaignId,
    channel: 'EMERGENCY',
    createdBy: ctx.actor.id,
    createdAt: now,
    deadlineAt: new Date(Date.now() + REPLY_DEADLINE_MS).toISOString(),
    confirmed: 0,
    denominator: vins.length,
    nodes: vins.map((v) => ({ nodeId: v, state: 'UNKNOWN', reason: 'NO_REPORT' })),
    ackOnly: [],
    closedAt: null,
  };
  ctx.put(PUB, id, p, { created: true });
  const store = ctx.state<Record<string, any>>('killDelivery', () => ({}));
  store[id] = {
    killId: k.killId,
    offline: [...offline],
    readbacks: [],
    calls: [{ ifId: 'IF-05', key: id, at: now, request: { channel: 'CCS', priority: 'EMERGENCY', targets: vins.length, signatureKeyId: DEMO_KID.publication }, response: { campaignId, accepted: true } }],
    job: {
      jobId: `OTA-${id}`,
      state: 'SUBMITTED',
      serverState: 'IN_PROGRESS',
      otaJobId: null,
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      targets: vins.length,
      counts: { DELIVERING: vins.length },
      vehicles: vins.map((vin) => ({ vin, outcome: 'DELIVERING', detail: null, at: now })),
    },
  };
  ctx.emit('publication.signed', id, { publicationId: id, kind, keyId: DEMO_KID.publication, payloadHash, targets: vins.length }, { componentId: 'D06-08' });
  ctx.emit('publication.dispatched', id, { publicationId: id, kind, campaignId, channel: 'EMERGENCY', unreachable: [...offline].filter((v) => vins.includes(v)), ackOnly: [] }, { componentId: 'D04-01' });
  // 회신 — 통신되는 차량이 몇 초에 걸쳐 묶음으로
  const online = vins.filter((v) => !offline.has(v));
  const size = Math.max(1, Math.ceil(online.length / REPLY_BATCHES));
  for (let i = 0; i * size < online.length; i++) ctx.later(REPLY_FIRST_MS + i * REPLY_STEP_MS, 'kill.readback', { publicationId: id, vins: online.slice(i * size, (i + 1) * size) });
  ctx.later(REPLY_DEADLINE_MS, 'kill.deadline', { publicationId: id });
  return p;
}

/** 영향 범위 차량 중 통신이 끊긴 것(미리보기 link) */
async function offlineOf(ctx: SimReadContext, k: any): Promise<Set<string>> {
  const pv = await basePreview(ctx, k.featureId, k.featureVersion, k.reasonCategory);
  // 재전송으로 연결이 돌아온 차량은 다음 게시본부터 바로 답한다
  const back = new Set<string>(ctx.overlay.data.onlineAgain ?? []);
  return new Set((pv?.vehicles ?? []).filter((v: { link: string; vin: string }) => v.link === 'OFFLINE' && !back.has(v.vin)).map((v: { vin: string }) => v.vin));
}

registerSimHandler('issueKill', async (ctx) => {
  const b = ctx.req.body;
  if (String(b.confirm).trim() !== b.featureId) ctx.fail('VALIDATION', `확인 입력이 차단 대상 Feature ID(${b.featureId})와 다릅니다.`, undefined, { action: 'KILL_REQUEST', target: b.featureId, reason: 'type-to-confirm 불일치', componentId: 'D03-03' });
  const pv = await ctx.read<any>('killPreview', {}, { featureId: b.featureId, featureVersion: b.featureVersion, reasonCategory: b.reasonCategory, vins: b.vins?.length ? b.vins.join(',') : undefined }).catch(() => null);
  if (!pv) ctx.fail('NOT_FOUND', `${b.featureId} ${b.featureVersion}을(를) 찾을 수 없습니다.`);
  if (pv.activeKill) ctx.fail('CONFLICT', `${b.featureId}은(는) 이미 차단 중이거나 승인 대기 중입니다 (${pv.activeKill}).`, { killId: pv.activeKill });
  if (pv.unknownVins.length) ctx.fail('VALIDATION', `영향 범위 밖의 차량이 있습니다: ${pv.unknownVins.join(', ')}`, { unknownVins: pv.unknownVins });
  const vins: string[] = b.vins?.length ? pv.vehicles.map((v: { vin: string }) => v.vin).filter((v: string) => b.vins.includes(v)) : pv.vehicles.map((v: { vin: string }) => v.vin);
  if (!vins.length) ctx.fail('GUARD_FAILED', '차단할 대상 차량이 없습니다.');
  const reg = pv.registry;
  if (!reg) ctx.fail('NOT_FOUND', `${b.featureId} ${b.featureVersion}이(가) Registry에 없습니다.`);
  if (reg.deact_class === 'DC4' || reg.gsr_mandatory)
    ctx.fail('GUARD_FAILED', 'DC4·법규 의무 기능은 원격으로 비활성화하지 않습니다 — 정비·리콜 절차로 처리합니다 (FFG-PLT-004·FFG-DEAC-011).', { rule: 'FFG-PLT-004' }, {
      action: 'KILL_REQUEST',
      target: b.featureId,
      reason: `FFG-PLT-004 DC4·법규 의무 기능 원격 비활성화 거부 (${reg.deact_class}${reg.gsr_mandatory ? ', GSR' : ''})`,
      componentId: 'D03-03',
    });
  const plan = approvalPlan(reg.f_class, 'deactivate', b.reasonCategory);
  const safetyKill = b.reasonCategory === 'SAFETY' && ['F2', 'F3', 'F4'].includes(reg.f_class);
  if (safetyKill && !b.recallCampaignId && !b.containmentJustification)
    ctx.fail('VALIDATION', 'F2 이상 안전 차단은 리콜 캠페인 ID나 봉쇄 결정 근거가 필요합니다 (FFG-PLT-009·FFG-DEAC-010).', { rule: 'FFG-DEAC-010' }, {
      action: 'KILL_REQUEST',
      target: b.featureId,
      reason: 'FFG-DEAC-010 리콜·봉쇄 근거 없는 F2 이상 안전 차단',
      componentId: 'D03-03',
    });
  const info = await featureInfo(ctx, b.featureId, b.featureVersion);
  const base = await ctx.snapshot<{ items: { killId: string }[] }>('killRequests');
  const now = ctx.now();
  const k: any = {
    killId: ctx.nextId('KILL', [...(base?.items ?? []).map((x) => x.killId), ...ctx.list(KILL).map((x) => x.killId)]),
    featureId: b.featureId,
    featureVersion: b.featureVersion,
    featureIds: pv.featureIds,
    flagKeys: pv.flagKeys,
    vins,
    reason: b.reason,
    status: 'REQUESTED',
    requestedBy: ctx.actor.id,
    requestedAt: now.toISOString(),
    publicationId: null,
    releasedBy: null,
    releasedAt: null,
    releaseReason: null,
    restorePublicationId: null,
    anomalyId: b.anomalyId ?? null,
    version: 2,
    reasonCategory: b.reasonCategory,
    reasonCode: b.reasonCode,
    fClass: reg.f_class,
    deactClass: reg.deact_class,
    fsmRequired: plan.fsm,
    approvals: [],
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    recallCampaignId: b.recallCampaignId ?? null,
    containmentJustification: b.containmentJustification ?? null,
    ...(safetyKill ? { defectDeterminedAt: b.defectDeterminedAt ?? null, recallReports: recallReportDue([info.country], b.defectDeterminedAt ?? null) } : {}),
    userNoticeRef: null,
    gate: null,
    command: null,
    rejectedBy: null,
    rejectReason: null,
    restoreRequest: null,
  };
  ctx.put(KILL, k.killId, k, { created: true });
  ctx.audit({ action: 'KILL_REQUEST', target: k.killId, after: { featureId: k.featureId, vins: k.vins.length, reason: `${k.reasonCategory}/${k.reasonCode}`, deactClass: k.deactClass, fsmRequired: plan.fsm }, reason: b.reason, componentId: 'D03-03' });
  const candidates = nextApprovers(accounts(), { requestedBy: k.requestedBy, approvals: [], plan }).map((c) => c.id);
  ctx.emit(
    'kill.requested',
    k.killId,
    { killId: k.killId, featureId: k.featureId, vins: k.vins.length, reasonCategory: k.reasonCategory, fsmRequired: plan.fsm, anomalyId: k.anomalyId, candidates },
    { componentId: 'D03-03', notify: { kill: k, feature: { featureId: k.featureId, version: k.featureVersion, name: info.name, ownerId: info.ownerId } } },
  );
  return project(k, ctx);
}, { body: KillCreateBody });

registerSimHandler('approveKill', async (ctx) => {
  const id = ctx.req.params.id;
  const k = effective(await load(ctx, id));
  if (k.status !== 'REQUESTED')
    ctx.fail('CONFLICT', k.status === 'EXPIRED' ? '승인 기한이 지났습니다 — 다시 요청하세요.' : `승인 대기 중인 요청이 아닙니다 (${k.status}).`, undefined, { action: 'KILL_APPROVE', target: id, reason: `${k.status} 상태 승인 시도`, componentId: 'D03-03' });
  const approvals: Approval[] = k.approvals ?? [];
  const plan = approvalPlan(k.fClass, 'deactivate', k.reasonCategory);
  const a = await signApproval(ctx, k, 'deactivate', { requestedBy: k.requestedBy, approvals, plan }, 'KILL_APPROVE', ctx.req.body?.comment);
  const next = { ...k, approvals: [...approvals, a] };
  const info = await featureInfo(ctx, k.featureId, k.featureVersion);
  const feature = { featureId: k.featureId, version: k.featureVersion, name: info.name, ownerId: info.ownerId };
  if (next.approvals.length < plan.count) {
    ctx.put(KILL, id, next);
    ctx.audit({ action: 'KILL_APPROVE', target: id, after: { approvals: next.approvals.length, role: a.role, kid: a.kid }, componentId: 'D03-03' });
    ctx.emit('kill.approved', id, { killId: id, featureId: k.featureId, approvals: next.approvals.length, role: a.role }, { componentId: 'D03-03' });
    return project(next, ctx);
  }
  // 두 번째 승인 — 게이트 최종 판정(같은 규칙표) → 원장 +1·서명·봉투·긴급 채널
  const base = await basePreview(ctx, k.featureId, k.featureVersion, k.reasonCategory);
  const led = ledgerOf(ctx.overlay, k.featureId, base);
  const draft = buildCommand(k, 'deactivate', next.approvals, base?.registry ?? { f_class: k.fClass, deact_class: k.deactClass }, info, led, ctx.now());
  const verdict = base?.registry ? gateVerdict(draft, registryOf(k.featureId, base, led), ctx.now()) : { result: 'PASS' as const, findings: [] };
  if (verdict.result !== 'PASS') {
    const failed = verdict.findings.filter((x) => !x.ok);
    const done = { ...next, status: 'REJECTED', gate: { result: verdict.result, failed: failed.map((x) => x.rule), at: ctx.iso() }, rejectedBy: 'policy-gate', rejectReason: failed.map((x) => `${x.rule} ${x.message}`).join(' / ') };
    ctx.put(KILL, id, done);
    ctx.audit({ action: 'KILL_ISSUE', target: id, reason: `정책 게이트 거부: ${failed.map((x) => x.rule).join(', ')}`, result: 'FAILED', componentId: 'D03-02' });
    ctx.emit('kill.rejected', id, { killId: id, featureId: k.featureId, by: 'policy-gate', failed: done.gate.failed }, { componentId: 'D03-03' });
    return project(done, ctx);
  }
  const issued = await issueCommand(ctx, k, next, draft, led);
  const pub = await publish(ctx, next, 'KILL', next.vins, await offlineOf(ctx, k));
  const done = { ...next, status: 'ACTIVE', publicationId: pub.publicationId, gate: { result: 'PASS', failed: [], at: ctx.iso() }, command: commandRef(issued) };
  ctx.put(KILL, id, done);
  ctx.audit({ action: 'KILL_APPROVE', target: id, after: { approvals: 2, role: a.role, kid: a.kid }, componentId: 'D03-03' });
  ctx.audit({
    action: 'KILL_ISSUE',
    target: id,
    after: { featureIds: done.featureIds, vins: done.vins.length, deactClass: done.deactClass, commandId: issued.command.command_id, commandSeq: issued.command.command_seq, envelopes: issued.envelopes, publicationId: pub.publicationId },
    reason: done.reason,
    componentId: 'D03-03',
  });
  ctx.emit(
    'kill.issued',
    id,
    { killId: id, featureId: done.featureId, featureIds: done.featureIds, flagKeys: done.flagKeys, vins: done.vins.length, deactClass: done.deactClass, commandId: issued.command.command_id, publicationId: pub.publicationId, anomalyId: done.anomalyId },
    { componentId: 'D03-03', notify: { kill: done, feature } },
  );
  // 복원 막힘 경보 — 차단 승인자를 빼면 복원 2인을 끝낼 수 없을 때(서버 warnRestoreBlocked)
  const ledNow = ctx.state<Record<string, GateLedger>>('killLedger', () => ({}))[k.featureId];
  const o = restoreOutlook(accounts(), approvalPlan(k.fClass, 'restore', k.reasonCategory), excludedOf(done, ledNow));
  if (!o.complete) ctx.emit('kill.restore-blocked', id, { killId: id, featureId: k.featureId, missing: o.missing, excluded: excludedOf(done, ledNow) }, { componentId: 'D03-04', notify: { kill: done, feature } });
  return project(done, ctx);
}, { body: KillApproveBody });

registerSimHandler('rejectKill', async (ctx) => {
  const id = ctx.req.params.id;
  const k = effective(await load(ctx, id));
  if (k.status !== 'REQUESTED') ctx.fail('CONFLICT', `승인 대기 중인 요청이 아닙니다 (${k.status}).`, undefined, { action: 'KILL_REJECT', target: id, reason: `${k.status} 상태 거절 시도`, componentId: 'D03-03' });
  const done = { ...k, status: 'REJECTED', rejectedBy: ctx.actor.id, rejectReason: ctx.req.body.reason };
  ctx.put(KILL, id, done);
  ctx.audit({ action: 'KILL_REJECT', target: id, before: { status: 'REQUESTED' }, after: { status: 'REJECTED' }, reason: ctx.req.body.reason, componentId: 'D03-03' });
  ctx.emit('kill.rejected', id, { killId: id, featureId: k.featureId, by: ctx.actor.id }, { componentId: 'D03-03' });
  return project(done, ctx);
}, { body: KillRejectBody });

// ─── 복원(차단 해제 — 기능 활성화가 아니다) ─────────────────
const remaining = (k: any) => {
  const done = new Set(k.restoredVins ?? []);
  return (k.vins as string[]).filter((v) => !done.has(v));
};
/** 원장(이 Feature) — 시연 원장이 없으면 스냅샷 미리보기로 시작해 둔다(복원 승인자 제외 판정이 서버와 같게) */
async function ensureLedger(ctx: SimWriteContext, k: any): Promise<GateLedger> {
  const ledger = ctx.state<Record<string, GateLedger>>('killLedger', () => ({}));
  if (!ledger[k.featureId]) ledger[k.featureId] = ledgerOf(ctx.overlay, k.featureId, await basePreview(ctx, k.featureId, k.featureVersion, k.reasonCategory));
  return ledger[k.featureId];
}

registerSimHandler('requestRestore', async (ctx) => {
  const id = ctx.req.params.id;
  const b = ctx.req.body;
  const k = await load(ctx, id);
  const open = k.restoreRequest?.status === 'REQUESTED';
  if (k.version !== 2 || k.status !== 'ACTIVE' || open)
    ctx.fail('CONFLICT', k.version !== 2 ? 'v1 레거시 차단은 해제(release)로 처리합니다.' : open ? '이미 복원 승인 대기 중입니다.' : `차단 중인 요청이 아닙니다 (${k.status}).`, undefined, {
      action: 'RESTORE_REQUEST',
      target: id,
      reason: `복원 요청 불가(${k.version === 2 ? k.status : 'v1 레거시'}${open ? ', 진행 중 요청 있음' : ''})`,
      componentId: 'D03-04',
    });
  const left = new Set(remaining(k));
  const cohort = [...new Set<string>(b.cohort)];
  const outside = cohort.filter((v) => !left.has(v));
  if (outside.length) ctx.fail('VALIDATION', `이번 단계 Cohort에 이 차단의 남은 차량이 아닌 차량이 있습니다: ${outside.join(', ')}`, { outside }, { action: 'RESTORE_REQUEST', target: id, reason: `Cohort에 복원 대상이 아닌 차량: ${outside.join(', ')}`, componentId: 'D03-04' });
  const evidenceRef = String(b.evidenceRef).trim();
  const ev = await ctx.read<{ items: any[] }>('evidenceLedger', {}, { featureId: k.featureId }).catch(() => ({ items: [] }));
  const passed = ev.items.some((e) => e.evidenceRef === evidenceRef && k.featureIds.includes(e.featureId) && e.inputResult === 'PASS');
  if (!passed)
    ctx.fail('VALIDATION', `재검증 Evidence ${evidenceRef}을(를) ${k.featureId}의 PASS 판정 근거에서 찾을 수 없습니다 — 원인 수정 뒤 PASS로 판정한 Evidence를 고르세요.`, { field: 'evidenceRef' }, {
      action: 'RESTORE_REQUEST',
      target: id,
      reason: `재검증 Evidence ${evidenceRef} 없음 또는 대상 Feature의 PASS 판정 아님`,
      componentId: 'D03-04',
    });
  // 해제 확인 항목·지정 승인대상자(서버 restore.service와 같은 규칙, P11a)
  const missing = missingRestoreChecks(b);
  if (missing.length) {
    const names = missing.map((c) => RESTORE_CHECK_LABEL[c]).join('·');
    ctx.fail('VALIDATION', `해제 요청 전에 확인 항목을 체크하세요: ${names}`, { field: 'checks', missing }, { action: 'RESTORE_REQUEST', target: id, reason: `확인 항목 미체크: ${names}`, componentId: 'D03-04' });
  }
  const led = await ensureLedger(ctx, k);
  const excluded = excludedOf(k, led);
  const targets = [...new Set<string>(b.approverTargets ?? [])];
  if (targets.length) {
    const can = new Set(restoreOutlook(accounts(), approvalPlan(k.fClass ?? 'F0', 'restore', k.reasonCategory ?? 'SAFETY'), excluded, [], ctx.actor.id).candidates.map((c) => c.id));
    const invalid = targets.filter((t) => !can.has(t) || t === ctx.actor.id);
    if (invalid.length) ctx.fail('VALIDATION', `복원을 승인할 수 없는 사람이 승인대상자에 있습니다: ${invalid.join(', ')} — 직전 차단 승인자·요청자는 복원을 승인하지 않습니다.`, { field: 'approverTargets', invalid }, { action: 'RESTORE_REQUEST', target: id, reason: `승인대상자 아님: ${invalid.join(', ')}`, componentId: 'D03-04' });
  }
  const rr = { requestedBy: ctx.actor.id, requestedAt: ctx.iso(), reason: b.reason, status: 'REQUESTED', approvals: [], gate: null, command: null, rejectedBy: null, rejectReason: null, evidenceRef, cohort: k.vins.filter((v: string) => cohort.includes(v)), checks: { resolved: true, causeFixed: true }, approverTargets: targets };
  const next = { ...k, restoreRequest: rr };
  ctx.put(KILL, id, next);
  ctx.audit({ action: 'RESTORE_REQUEST', target: id, after: { status: 'REQUESTED', evidenceRef, cohort: rr.cohort.length, remaining: left.size }, reason: b.reason, componentId: 'D03-04' });
  const info = await featureInfo(ctx, k.featureId, k.featureVersion);
  const feature = { featureId: k.featureId, version: k.featureVersion, name: info.name, ownerId: info.ownerId };
  const o = restoreOutlook(accounts(), approvalPlan(k.fClass ?? 'F0', 'restore', k.reasonCategory ?? 'SAFETY'), excluded, [], ctx.actor.id);
  if (!o.complete) ctx.emit('kill.restore-blocked', id, { killId: id, featureId: k.featureId, missing: o.missing, excluded }, { componentId: 'D03-04', notify: { kill: next, feature } });
  ctx.emit(
    'kill.restore-requested',
    id,
    { killId: id, featureId: k.featureId, cohort: rr.cohort.length, evidenceRef, candidates: o.candidates.map((c) => c.id), complete: o.complete, excluded },
    { componentId: 'D03-04', notify: { kill: next, feature } },
  );
  return project(next, ctx);
}, { body: RestoreRequestBody });

registerSimHandler('approveRestore', async (ctx) => {
  const id = ctx.req.params.id;
  const k = await load(ctx, id);
  const rr = k.restoreRequest;
  if (k.status !== 'ACTIVE' || rr?.status !== 'REQUESTED') ctx.fail('CONFLICT', '복원 승인 대기 중인 요청이 아닙니다.', undefined, { action: 'RESTORE_APPROVE', target: id, reason: '복원 승인 대기 아님', componentId: 'D03-04' });
  if (rr.approverTargets?.length && !rr.approverTargets.includes(ctx.actor.id))
    ctx.fail('FORBIDDEN', `이 복원 요청의 승인대상자가 아닙니다 — 지정: ${rr.approverTargets.join(', ')}`, { code: 'NOT_DESIGNATED' }, { action: 'RESTORE_APPROVE', target: id, reason: `지정 승인대상자 아님(${rr.approverTargets.join(', ')})`, componentId: 'D03-04' });
  const plan = approvalPlan(k.fClass, 'restore', k.reasonCategory);
  const led = await ensureLedger(ctx, k);
  const excluded = excludedOf(k, led);
  const cohort: string[] = rr.cohort?.length ? rr.cohort : remaining(k);
  const stage = { ...k, vins: cohort };
  const a = await signApproval(ctx, stage, 'restore', { requestedBy: rr.requestedBy, approvals: rr.approvals, plan, excluded }, 'RESTORE_APPROVE', ctx.req.body?.comment);
  const approvals = [...rr.approvals, a];
  if (approvals.length < plan.count) {
    const next = { ...k, restoreRequest: { ...rr, approvals } };
    ctx.put(KILL, id, next);
    ctx.audit({ action: 'RESTORE_APPROVE', target: id, after: { approvals: approvals.length, role: a.role, kid: a.kid }, componentId: 'D03-04' });
    ctx.emit('kill.restore-approved', id, { killId: id, approvals: approvals.length, role: a.role }, { componentId: 'D03-04' });
    return project(next, ctx);
  }
  const base = await basePreview(ctx, k.featureId, k.featureVersion, k.reasonCategory);
  const info = await featureInfo(ctx, k.featureId, k.featureVersion);
  const draft = buildCommand(stage, 'restore', approvals, base?.registry ?? { f_class: k.fClass, deact_class: k.deactClass }, info, led, ctx.now());
  const verdict = base?.registry ? gateVerdict(draft, registryOf(k.featureId, base, led), ctx.now()) : { result: 'PASS' as const, findings: [] };
  if (verdict.result !== 'PASS') {
    const failed = verdict.findings.filter((x) => !x.ok);
    const rejected = { ...rr, approvals, status: 'REJECTED', gate: { result: verdict.result, failed: failed.map((x) => x.rule), at: ctx.iso() }, rejectedBy: 'policy-gate', rejectReason: failed.map((x) => `${x.rule} ${x.message}`).join(' / ') };
    const next = { ...k, restoreRequest: rejected };
    ctx.put(KILL, id, next);
    ctx.audit({ action: 'RESTORE_APPROVE', target: id, reason: `정책 게이트 거부: ${failed.map((x) => x.rule).join(', ')}`, result: 'FAILED', componentId: 'D03-02' });
    ctx.emit('kill.restore-rejected', id, { killId: id, by: 'policy-gate', failed: rejected.gate.failed }, { componentId: 'D03-04' });
    return project(next, ctx);
  }
  const issued = await issueCommand(ctx, k, stage, draft, led);
  const pub = await publish(ctx, k, 'RESTORE', cohort, await offlineOf(ctx, k));
  const at = ctx.iso();
  const restoredVins = [...(k.restoredVins ?? []), ...cohort];
  const all = (k.vins as string[]).every((v) => restoredVins.includes(v));
  const status = all ? 'RELEASED' : k.status;
  const before = { status: k.status, blockedVins: blockedVins(k) };
  const after = { status, blockedVins: blockedVins({ ...k, status, restoredVins }) };
  const done = {
    ...k,
    ...(all ? { status: 'RELEASED', releasedBy: ctx.actor.id, releasedAt: at, releaseReason: rr.reason } : {}),
    restoredVins,
    restoreStages: [
      ...(k.restoreStages ?? []),
      { cohort, evidenceRef: rr.evidenceRef ?? null, publicationId: pub.publicationId, approvedAt: at, approvers: approvals.map((x) => x.approverId), featureId: k.featureId, requestedBy: rr.requestedBy, before, after },
    ],
    restorePublicationId: pub.publicationId,
    restoreRequest: { ...rr, cohort, approvals, status: 'APPROVED', gate: { result: 'PASS', failed: [], at }, command: commandRef(issued) },
  };
  ctx.put(KILL, id, done);
  ctx.audit({ action: 'RESTORE_APPROVE', target: id, after: { approvals: 2, role: a.role, kid: a.kid, cohort: cohort.length }, componentId: 'D03-04' });
  if (all)
    ctx.audit({
      action: 'KILL_RELEASE',
      target: id,
      before: { status: 'ACTIVE' },
      after: { status: 'RELEASED', commandId: issued.command.command_id, commandSeq: issued.command.command_seq, envelopes: issued.envelopes, publicationId: pub.publicationId },
      reason: rr.reason,
      componentId: 'D03-04',
    });
  ctx.emit(
    all ? 'kill.released' : 'kill.restore-staged',
    id,
    { killId: id, featureId: k.featureId, publicationId: pub.publicationId, commandId: issued.command.command_id, restored: restoredVins.length, total: k.vins.length },
    { componentId: 'D03-04' },
  );
  return project(done, ctx);
}, { body: KillApproveBody });

// 레거시(v1) 차단 해제 — v2 차단은 혼자 해제할 수 없다(복원 요청·2인 승인). 서버 restore.service release와 같은 순서
registerSimHandler('releaseKill', async (ctx) => {
  const id = ctx.req.params.id;
  const k = await load(ctx, id);
  if (k.version === 2)
    ctx.fail('CONFLICT', 'v2 차단은 혼자 해제할 수 없습니다 — 복원 요청 후 다른 2인이 승인합니다 (FFG-DEAC-008).', undefined, { action: 'KILL_RELEASE', target: id, reason: 'v2 차단 단독 해제 시도 — 복원 요청·2인 승인 필요', componentId: 'D03-04' });
  if (k.status !== 'ACTIVE') ctx.fail('GUARD_FAILED', `이미 해제된 차단입니다 (${k.releasedAt}).`, undefined, { action: 'KILL_RELEASE', target: id, reason: `${k.status} 차단 해제 시도`, componentId: 'D03-04' });
  const pub = await publish(ctx, k, 'RESTORE', k.vins, await offlineOf(ctx, k), 'ACTIVE');
  const next = { ...k, status: 'RELEASED', releasedBy: ctx.actor.id, releasedAt: ctx.iso(), releaseReason: ctx.req.body.reason, restorePublicationId: pub.publicationId };
  ctx.put(KILL, id, next);
  ctx.audit({ action: 'KILL_RELEASE', target: id, before: { status: 'ACTIVE' }, after: { status: 'RELEASED', publicationId: pub.publicationId }, reason: ctx.req.body.reason, componentId: 'D03-04' });
  ctx.emit('kill.released', id, { killId: id, featureId: k.featureId, publicationId: pub.publicationId }, { componentId: 'D03-04' });
  return project(next, ctx);
}, { body: KillRejectBody });

registerSimHandler('rejectRestore', async (ctx) => {
  const id = ctx.req.params.id;
  const k = await load(ctx, id);
  const rr = k.restoreRequest;
  if (rr?.status !== 'REQUESTED') ctx.fail('CONFLICT', '복원 승인 대기 중인 요청이 아닙니다.', undefined, { action: 'RESTORE_REJECT', target: id, reason: '복원 승인 대기 아님', componentId: 'D03-04' });
  const next = { ...k, restoreRequest: { ...rr, status: 'REJECTED', rejectedBy: ctx.actor.id, rejectReason: ctx.req.body.reason } };
  ctx.put(KILL, id, next);
  ctx.audit({ action: 'RESTORE_REJECT', target: id, before: { status: 'REQUESTED' }, after: { status: 'REJECTED' }, reason: ctx.req.body.reason, componentId: 'D03-04' });
  ctx.emit('kill.restore-rejected', id, { killId: id, by: ctx.actor.id }, { componentId: 'D03-04' });
  return project(next, ctx);
}, { body: KillRejectBody });

// ─── 차량 회신(시연 합성) ───────────────────────────────────
/** 회신 → 게시본 집계(서버 secure-deploy evaluate와 같은 aggregate) — 다 확인되면 닫는다 */
function recompute(ctx: SimWriteContext, publicationId: string, final: boolean) {
  const p = structuredClone(ctx.get(PUB, publicationId));
  if (!p || p.closedAt) return;
  const store = ctx.state<Record<string, any>>('killDelivery', () => ({}))[publicationId];
  const now = Date.now();
  const latest = new Map<string, any>();
  for (const r of store.readbacks) latest.set(r.vin, r);
  const reports = [...latest.values()].map((r) => ({ nodeId: r.vin, metricType: 'READBACK' as const, publication: r.publicationId, policyHash: r.policyHash, featureVersion: r.featureVersion, bootId: r.bootId, sequence: r.sequence, ageMs: Math.max(0, now - Date.parse(r.at)), observed: r.observed }));
  const required: string[] = p.payload.targets;
  const agg = aggregate(required, reports, {
    publication: publicationId,
    policyHash: p.signature.payloadHash,
    featureVersion: p.payload.featureVersion,
    bootIds: Object.fromEntries(required.map((v) => [v, `BOOT-${v}-1`])),
    minSequence: Object.fromEntries(required.map((v) => [v, p.payload.sequence])),
    maxAgeMs: 24 * 3600_000,
    desired: p.payload.desired,
  });
  const close = final ? (agg.state === 'PARTIAL' ? 'PARTIAL' : agg.state === 'UNKNOWN' ? 'TIMEOUT' : agg.state) : agg.state === 'CONFIRMED' || agg.state === 'DIVERGED' ? agg.state : null;
  const next = { ...p, confirmed: agg.confirmed, denominator: agg.denominator, nodes: agg.nodes, ...(close ? { status: close, closedAt: ctx.iso() } : {}) };
  ctx.put(PUB, publicationId, next);
  // 전달 작업 — 회신한 차량은 '차량에 넘김', 남은 차량은 기한까지 닿지 못하면 재시도 가능
  const job = store.job;
  const replied = new Set(latest.keys());
  job.vehicles = job.vehicles.map((v: any) => (replied.has(v.vin) ? { ...v, outcome: 'DELIVERED', detail: 'READBACK', at: latest.get(v.vin).at } : v));
  job.counts = job.vehicles.reduce((m: Record<string, number>, v: any) => ((m[v.outcome] = (m[v.outcome] ?? 0) + 1), m), {});
  if (agg.state === 'CONFIRMED') Object.assign(job, { state: 'COMPLETED', serverState: 'COMPLETED', nextAttemptAt: null, lastError: null });
  if (close) ctx.emit('publication.closed', publicationId, { publicationId, kind: p.kind, status: close, confirmed: agg.confirmed, denominator: agg.denominator, killId: p.payload.kill?.killId ?? null }, { componentId: 'D06-08' });
  return { next, agg };
}

registerSimTask('kill.readback', (ctx, args) => {
  const publicationId = String(args.publicationId);
  const p = ctx.get(PUB, publicationId);
  if (!p || p.closedAt) return;
  const store = ctx.state<Record<string, any>>('killDelivery', () => ({}))[publicationId];
  const cmds = ctx.state<Record<string, any>>('killCommands', () => ({}))[p.payload.kill?.killId];
  const kill = ctx.get(KILL, p.payload.kill?.killId);
  const request = p.kind === 'RESTORE' ? 'restore' : 'deactivate';
  for (const vin of args.vins as string[]) {
    const at = ctx.iso();
    store.readbacks.push({ vin, publicationId, metricType: 'READBACK', policyHash: p.signature.payloadHash, featureVersion: p.payload.featureVersion, bootId: `BOOT-${vin}-1`, sequence: p.payload.sequence, observed: p.payload.desired, at, via: 'IF-06' });
    // 차량 상태(회신으로 확인) — Fleet 현황·지도·홈 수신 현황·차량 상세가 이것 하나로 같은 상태를 본다(handlers/fleet.ts). 정책 게시본(POLICY)은 차단 상태가 아니다
    const vk = ctx.state<Record<string, Record<string, unknown>>>('vehicleKill', () => ({}));
    if (p.kind !== 'POLICY') for (const f of p.payload.kill?.featureIds ?? [p.payload.featureId]) (vk[vin] ??= {})[f] = { killId: p.payload.kill?.killId, state: p.payload.desired, at, publicationId, kind: p.kind, deactClass: kill?.deactClass ?? null };
    // 종료·복원 시간 기록 — 수락 → 끝 상태(차량 서명 status_report v2와 같은 칸)
    const seq = [...(cmds?.timeline ?? [])].reverse().find((c: TimelineCommand) => c.vin === vin && c.request === request)?.vehicleSeq ?? 1;
    const report = (state: string, ms: number): TimelineReport => ({ vin, state, request_result: 'ACCEPTED', vehicle_seq: seq, observed_at: new Date(Date.parse(at) - ms).toISOString(), time_sync: 'SYNCED', edr_aligned_state: state, reason: { category: 'SAFETY', source: 'REMOTE' } });
    if (cmds) cmds.reports.push(report(request === 'restore' ? 'ACTIVE_PENDING' : 'DEACTIVATING', 600), report(p.payload.desired, 0));
    ctx.emit('vehicle.readback', vin, { publicationId, kind: p.kind, observed: p.payload.desired, metricType: 'READBACK', rejectReason: null, via: 'IF-06' }, { componentId: 'D04-03' });
  }
  recompute(ctx, publicationId, false);
  // 통신되는 차량이 다 답했는데 끊긴 차량이 남았으면 — 전달 작업을 '재시도 가능'으로(재전송은 운영자가 /deployments에서)
  const after = ctx.get(PUB, publicationId);
  const waiting = (after.nodes as { nodeId: string; state: string }[]).filter((n) => n.state !== 'CONFIRMED').map((n) => n.nodeId);
  const pendingOnline = waiting.filter((v) => !store.offline.includes(v));
  if (!after.closedAt && !pendingOnline.length && waiting.length) {
    Object.assign(store.job, {
      state: 'RETRY_WAIT',
      serverState: 'PARTIAL',
      nextAttemptAt: null,
      lastError: { code: 'VEHICLE_UNREACHABLE', status: null, message: `통신이 끊긴 차량 ${waiting.length}대 — 다시 보내기 필요` },
      vehicles: store.job.vehicles.map((v: any) => (waiting.includes(v.vin) ? { ...v, outcome: 'NO_RESPONSE', detail: 'OFFLINE', at: ctx.iso() } : v)),
    });
    store.job.counts = store.job.vehicles.reduce((m: Record<string, number>, v: any) => ((m[v.outcome] = (m[v.outcome] ?? 0) + 1), m), {});
  }
});

registerSimTask('kill.deadline', (ctx, args) => {
  recompute(ctx, String(args.publicationId), true);
});

// 전달 재시도 — 시연 게시본의 끊긴 차량에 다시 보낸다(같은 명령·같은 봉투, 두 번 적용되지 않는다). 차량이 연결되면 회신이 들어온다
registerSimHandler('otaJobRetry', (ctx) => {
  const jobId = ctx.req.params.jobId;
  const all = ctx.state<Record<string, any>>('killDelivery', () => ({}));
  const publicationId = Object.keys(all).find((id) => all[id].job?.jobId === jobId);
  // 스냅샷의 OTA 작업(정책 배포 등)은 아직 시연 흐름이 없다 — 공통 처리
  if (!publicationId) return simUnhandled(ctx);
  const store = all[publicationId!];
  const job = store.job;
  if (job.state !== 'RETRY_WAIT' && job.state !== 'FAILED') ctx.fail('CONFLICT', '다시 제출할 수 있는 상태가 아닙니다.', undefined, { action: 'OTA_JOB_RETRY', target: jobId, reason: `${job.state} 상태 재시도`, componentId: 'D04-01' });
  const pending: string[] = job.vehicles.filter((v: any) => v.outcome !== 'DELIVERED').map((v: any) => v.vin);
  Object.assign(job, { state: 'SUBMITTED', serverState: 'IN_PROGRESS', attempts: job.attempts + 1, lastError: null, vehicles: job.vehicles.map((v: any) => (pending.includes(v.vin) ? { ...v, outcome: 'DELIVERING', detail: null, at: ctx.iso() } : v)) });
  job.counts = job.vehicles.reduce((m: Record<string, number>, v: any) => ((m[v.outcome] = (m[v.outcome] ?? 0) + 1), m), {});
  // 다시 보낸 차량은 연결이 돌아와 회신한다(시연)
  store.offline = [];
  const again = ctx.state<string[]>('onlineAgain', () => []);
  for (const v of pending) if (!again.includes(v)) again.push(v);
  // 정책 게시본은 일반 OTA 채널(handlers/policy-ops), 차단·복구는 긴급 채널
  const ota = ctx.get(PUB, publicationId!)?.channel === 'OTA';
  store.calls.push({ ifId: 'IF-05', key: publicationId, at: ctx.iso(), request: { channel: ota ? 'OTA' : 'CCS', priority: ota ? 'NORMAL' : 'EMERGENCY', targets: pending.length, retry: job.attempts, reason: ctx.req.body.reason }, response: { campaignId: ctx.get(PUB, publicationId!)?.campaignId, accepted: true } });
  ctx.audit({ action: 'OTA_JOB_RETRY', target: jobId, after: { publicationId, vehicles: pending.length, attempts: job.attempts }, reason: ctx.req.body.reason, componentId: 'D04-01' });
  ctx.emit('publication.dispatched', publicationId!, { publicationId, kind: ctx.get(PUB, publicationId!)?.kind, retry: job.attempts, unreachable: [], ackOnly: [] }, { componentId: 'D04-01' });
  const size = Math.max(1, Math.ceil(pending.length / 3));
  for (let i = 0; i * size < pending.length; i++) ctx.later(REPLY_FIRST_MS + i * REPLY_STEP_MS, 'kill.readback', { publicationId, vins: pending.slice(i * size, (i + 1) * size) });
  return job;
}, { body: OtaJobActionBody });
