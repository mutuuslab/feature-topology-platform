import { EXCEPTION_APPROVER_ROLES, EXCEPTION_KIND_LABEL, EXCEPTION_RESTRICTION_LABEL, EXCEPTION_STATUS_LABEL, RESTRICTION_CAP_BP, checkLabel, exceptionActive, exceptionDue, releaseGateDecision, type ExceptionPolicy, type GateId, type GateStatus, type Policy } from '@ff/contracts';
import { SimError } from './engine';
import type { SimReadContext, SimWriteContext } from './types';
import { verifyGateBytes } from './gate-signatures';
import { policyHash, publishPolicy } from './handlers/policy-ops';

export const GX = 'exceptionPolicy', GX_HISTORY = 'gxHistory';
const COMPONENT = 'D03-02';
export const gxSourceFailure = (name: string): never => { throw new SimError('INTERNAL', `예외 배포 원천 스냅샷을 확인할 수 없습니다: ${name}`, { source: name }); };
export async function gxSnapshot<T>(ctx: SimReadContext, name: string, params: Record<string, string> = {}): Promise<T> {
  return await ctx.snapshot<T>(name, params) ?? gxSourceFailure(name);
}
export async function gxFeature(ctx: SimReadContext, id: string, version: string) {
  const detail = await ctx.read<any>('featureDetail', { id, ver: version });
  if (!detail?.feature || detail.feature.featureId !== id || detail.feature.version !== version) return gxSourceFailure(`featureDetail ${id}@${version}`);
  return detail;
}
export async function gxPolicy(ctx: SimReadContext, id: string): Promise<Policy> {
  const local = ctx.get<Policy>('policy', id);
  if (local) return local;
  const detail = await gxSnapshot<{ policy: Policy }>(ctx, 'policyDetail', { id });
  if (!detail.policy || detail.policy.policyId !== id) return gxSourceFailure(`policyDetail ${id}`);
  return detail.policy;
}
export async function gxExceptions(ctx: SimReadContext): Promise<ExceptionPolicy[]> {
  const source = await gxSnapshot<{ items: ExceptionPolicy[] }>(ctx, 'exceptionPolicies');
  if (!Array.isArray(source.items)) return gxSourceFailure('exceptionPolicies.items');
  const map = new Map(source.items.map((e) => [e.exceptionId, e]));
  for (const local of ctx.list<ExceptionPolicy>(GX)) map.set(local.exceptionId, local);
  return [...map.values()];
}
export function gxLog(ctx: SimWriteContext, id: string, kind: string, fields: Record<string, unknown> = {}, system = false) {
  const prior = ctx.get<{ events: any[] }>(GX_HISTORY, id)?.events ?? [];
  ctx.put(GX_HISTORY, id, { events: [...prior, { at: ctx.iso(), kind, actorId: system ? 'system:exception' : ctx.actor.id, ...fields }] });
}
export const gxScope = (e: ExceptionPolicy) => e.kind === 'GATE_PENDING' ? `PENDING Gate ${e.gates.join('·')}` : e.checks.map((c) => c === 'COMPLIANCE_RULE' ? `${checkLabel(c)}(${e.ruleIds.join(', ')})` : checkLabel(c)).join(' · ');
export function validateActiveGx(e: ExceptionPolicy, now: string): boolean {
  return exceptionActive(e, now) && Array.isArray(e.approvals) && e.approvals.length >= 2 && new Set(e.approvals.map((a) => a.by)).size === e.approvals.length && e.approvals.every((a) => !!a.by && a.by !== e.requestedBy && EXCEPTION_APPROVER_ROLES.includes(a.role) && Date.parse(a.expiresAt) >= Date.parse(e.expiresAt!));
}
export function gxView(e: ExceptionPolicy, ctx: SimReadContext) {
  const active = exceptionActive(e, ctx.now().toISOString());
  return { ...e, kindLabel: EXCEPTION_KIND_LABEL[e.kind], statusLabel: EXCEPTION_STATUS_LABEL[e.status], restrictionLabel: EXCEPTION_RESTRICTION_LABEL[e.restriction], capBasisPoints: RESTRICTION_CAP_BP[e.restriction], active, remainingMs: e.expiresAt && active ? Date.parse(e.expiresAt) - ctx.now().getTime() : null, scope: gxScope(e), provenance: (e as any).provenance === 'LOCAL_SIMULATION' || ctx.overlay.created[GX]?.includes(e.exceptionId) ? 'LOCAL_SIMULATION' : 'CAPTURED_NATIVE' };
}

export async function gxGateFacts(ctx: SimReadContext, featureId: string, version: string) {
  const detail = await gxFeature(ctx, featureId, version);
  const view = await ctx.read<any>('gates', { id: featureId, ver: version });
  if (!Array.isArray(view?.gates) || view.gates.length !== 9 || new Set(view.gates.map((g: any) => g.gate)).size !== 9) return gxSourceFailure(`gates ${featureId}@${version}`);
  const latest: Partial<Record<GateId, GateStatus>> = {}, unsigned: Partial<Record<GateId, string>> = {};
  const local = (ctx.overlay.data.regGates?.[`${featureId}@${version}`] ?? []) as { record: { gateRecordId: string } }[];
  for (const row of view.gates) {
    const record = detail.gates?.[row.gate] ?? null;
    if (!record && !row.latest) continue; // Captured, known absence is PENDING; a missing source is never absence.
    latest[row.gate as GateId] = record?.status;
    if (!record || !row.latest || record.gateRecordId !== row.latest.gateRecordId || record.featureId !== featureId || record.featureVersion !== version) { unsigned[row.gate as GateId] = '최신 Gate 기록의 귀속이 다릅니다.'; continue; }
    const verified = await verifyGateBytes(ctx, record, row.decisionRecord ?? null, detail.feature.baselineId ?? null, local.some((e) => e.record.gateRecordId === record.gateRecordId));
    if (!verified.valid) unsigned[row.gate as GateId] = verified.reason ?? 'Gate 서명을 확인할 수 없습니다.';
  }
  return { detail, latest, unsigned };
}
export async function gxRelease(ctx: SimReadContext, policy: Policy) {
  const facts = await gxGateFacts(ctx, policy.featureId, policy.featureVersion);
  const untrusted = Object.keys(facts.unsigned) as GateId[];
  if (untrusted.length) return { allowed: false, shadowOnly: true, cap: 0, restriction: null, exceptionIds: [], pendingGates: untrusted, unsignedGates: facts.unsigned, message: `${untrusted.join('·')} 판정의 서명된 근거를 확인할 수 없습니다 — 올바른 근거로 다시 판정한 뒤 배포하세요.` };
  return releaseGateDecision({ featureId: policy.featureId, featureVersion: policy.featureVersion, lifecycle: facts.detail.feature.lifecycle, latestGates: facts.latest, exceptions: (await gxExceptions(ctx)).filter((e) => validateActiveGx(e, ctx.now().toISOString())), now: ctx.now().toISOString(), narrowing: !!policy.oddRestriction });
}

/** Called only inside the engine's explicit serial/CAS expiry transaction. */
export async function hydrateGx(ctx: SimWriteContext) {
  if (ctx.overlay.data.gxHydrated?.complete || ctx.state<{ complete?: boolean }>('gxHydrated', () => ({})).complete) return;
  const list = await gxExceptions(ctx);
  const details = await Promise.all(list.map((e) => gxSnapshot<any>(ctx, 'exceptionPolicy', { id: e.exceptionId })));
  for (let i = 0; i < list.length; i++) {
    const detail = details[i];
    if (detail.exceptionId !== list[i].exceptionId || !Array.isArray(detail.approvals) || !Array.isArray(detail.applications) || !Array.isArray(detail.history)) return gxSourceFailure(`exceptionPolicy ${list[i].exceptionId}`);
    if (!ctx.get(GX, detail.exceptionId)) {
      const { history, ...record } = detail;
      ctx.put(GX, record.exceptionId, record);
      ctx.put(GX_HISTORY, record.exceptionId, { events: history });
    }
  }
  ctx.state<{ complete?: boolean }>('gxHydrated', () => ({})).complete = true;
  for (const e of list) if (e.status === 'ACTIVE' && e.expiresAt) ctx.later(Math.max(0, Date.parse(e.expiresAt) - ctx.now().getTime()), 'gx.expire', { exceptionId: e.exceptionId });
}

async function revertApplication(ctx: SimWriteContext, e: ExceptionPolicy, a: ExceptionPolicy['applications'][number]) {
  const policy = await gxPolicy(ctx, a.policyId);
  if (policy.status !== 'DEPLOYED') return `${a.policyId}은(는) 이미 ${policy.status} — 되돌릴 것이 없습니다.`;
  const prior = a.prior ? await gxPolicy(ctx, a.prior.policyId) : null;
  if (prior && prior.status === 'RETIRED' && prior.flagKey === policy.flagKey && prior.contentHash === await policyHash(prior)) {
    const all = await gxExceptions(ctx);
    const validScope = !prior.exceptionScope || prior.exceptionScope.exceptionIds.every((id) => all.some((x) => x.exceptionId === id && exceptionActive(x, ctx.iso())));
    if (validScope) {
      ctx.put('policy', policy.policyId, { ...policy, status: 'RETIRED' });
      ctx.audit({ action: 'POLICY_RETIRE', target: policy.policyId, before: { status: 'DEPLOYED' }, after: { status: 'RETIRED' }, reason: `예외 ${e.exceptionId} 종료 — 이전 배포 ${prior.policyId}로 원복`, componentId: COMPONENT });
      const restored = { ...prior, status: 'DEPLOYED' as const, stageBasisPoints: a.prior!.stageBasisPoints, stagedAt: ctx.iso(), deployedBy: ctx.actor.id, deployedAt: ctx.iso() };
      ctx.put('policy', prior.policyId, restored);
      const publication = await publishPolicy(ctx, restored);
      ctx.audit({ action: 'POLICY_DEPLOY', target: prior.policyId, before: { status: 'RETIRED' }, after: { status: 'DEPLOYED', stage: restored.stageBasisPoints, publicationId: publication.publicationId }, reason: `예외 ${e.exceptionId} 종료 — 적용 이전 배포로 원복`, componentId: COMPONENT });
      ctx.emit('policy.deployed', prior.policyId, { policyId: prior.policyId, flagKey: prior.flagKey, contentHash: prior.contentHash, replaced: policy.policyId, publicationId: publication.publicationId, stage: restored.stageBasisPoints, reason: `예외 ${e.exceptionId} 종료 원복` }, { componentId: COMPONENT });
      return `${policy.policyId}을(를) 거두고 이전 배포 ${prior.policyId}${a.prior!.stageBasisPoints != null ? `(${a.prior!.stageBasisPoints / 100}%)` : ''}로 되돌렸습니다.`;
    }
  }
  ctx.put('policy', policy.policyId, { ...policy, stageBasisPoints: 0, stagedAt: ctx.iso() });
  ctx.audit({ action: 'ROLLOUT_STAGE', target: policy.policyId, before: { stage: policy.stageBasisPoints }, after: { stage: 0, kind: 'SHRINK' }, reason: `예외 ${e.exceptionId} 종료 — 유효한 이전 배포가 없어 멈춤`, componentId: COMPONENT });
  ctx.emit('rollout.staged', policy.policyId, { flagKey: policy.flagKey, from: policy.stageBasisPoints, to: 0, kind: 'SHRINK', criteria: null }, { componentId: COMPONENT });
  return `유효한 이전 배포가 없어 ${policy.policyId}을(를) 멈췄습니다(0%).`;
}

export async function closeGx(ctx: SimWriteContext, e: ExceptionPolicy, status: 'EXPIRED' | 'REVOKED', reason: string) {
  const actions: string[] = [];
  if (e.status === 'ACTIVE') for (const application of [...e.applications].reverse()) actions.push(await revertApplication(ctx, e, application));
  const message = actions.length ? actions.join(' / ') : e.status === 'ACTIVE' ? '이 예외로 연 배포가 없어 되돌릴 정책 상태가 없습니다.' : '승인 전에 회수했습니다 — 적용된 적이 없습니다.';
  const next = { ...e, status, closedAt: ctx.iso(), revert: { at: ctx.iso(), message, actions } };
  ctx.put(GX, e.exceptionId, next); gxLog(ctx, e.exceptionId, status, { reason, message }, status === 'EXPIRED');
  ctx.audit({ action: status === 'EXPIRED' ? 'EXCEPTION_EXPIRE' : 'EXCEPTION_REVOKE', target: e.exceptionId, before: { status: e.status, expiresAt: e.expiresAt }, after: { status, revert: message }, reason, componentId: COMPONENT });
  ctx.emit('exception.reverted', `${e.featureId}@${e.featureVersion}`, { exceptionId: e.exceptionId, cause: status, featureId: e.featureId, featureVersion: e.featureVersion, message, expiresAt: e.expiresAt, requestedBy: e.requestedBy, approvedBy: e.approvals.map((a) => a.by) }, { componentId: COMPONENT });
  return next;
}

async function completeGx(ctx: SimWriteContext, e: ExceptionPolicy) {
  const all = await gxExceptions(ctx);
  for (const a of e.applications) {
    const p = await gxPolicy(ctx, a.policyId);
    if (!p.exceptionScope?.exceptionIds.includes(e.exceptionId)) continue;
    const remaining = all.filter((x) => x.exceptionId !== e.exceptionId && p.exceptionScope!.exceptionIds.includes(x.exceptionId) && exceptionActive(x, ctx.iso()));
    const narrow = remaining.length ? remaining.reduce((x, y) => RESTRICTION_CAP_BP[x.restriction] <= RESTRICTION_CAP_BP[y.restriction] ? x : y) : null;
    ctx.put('policy', p.policyId, { ...p, exceptionScope: narrow ? { exceptionIds: remaining.map((x) => x.exceptionId).sort(), restriction: narrow.restriction, capBasisPoints: RESTRICTION_CAP_BP[narrow.restriction] } : null });
  }
  ctx.put(GX, e.exceptionId, { ...e, status: 'COMPLETED', closedAt: ctx.iso() });
  gxLog(ctx, e.exceptionId, 'COMPLETED', { gates: e.gates }, true);
  ctx.audit({ action: 'EXCEPTION_COMPLETE', target: e.exceptionId, before: { status: 'ACTIVE' }, after: { status: 'COMPLETED', gates: e.gates }, reason: `PENDING Gate ${e.gates.join('·')} 모두 PASS — 해당 제한 범위 해제`, componentId: COMPONENT });
  ctx.emit('exception.completed', `${e.featureId}@${e.featureVersion}`, { exceptionId: e.exceptionId, featureId: e.featureId, featureVersion: e.featureVersion, gates: e.gates }, { componentId: COMPONENT });
}

export async function sweepGx(ctx: SimWriteContext) {
  if (ctx.req.name === 'stageRollout' && ctx.req.body?.basisPoints === 0) return; // Stopping never depends on an exception source.
  await hydrateGx(ctx);
  for (const row of await gxExceptions(ctx)) {
    const e = ctx.get<ExceptionPolicy>(GX, row.exceptionId) ?? row;
    if (e.status !== 'ACTIVE') continue;
    let completed = false;
    if (e.kind === 'GATE_PENDING') {
      try { const gates = await gxGateFacts(ctx, e.featureId, e.featureVersion); completed = !Object.keys(gates.unsigned).length && e.gates.every((g) => gates.latest[g] === 'PASS'); } catch { /* Unknown evidence cannot complete; expiry still reduces effect. */ }
    }
    if (completed) await completeGx(ctx, e);
    else if (exceptionDue(e, ctx.iso())) await closeGx(ctx, e, 'EXPIRED', `만료 일시 ${e.expiresAt} 경과`);
  }
}
