import { GX_SOURCE_SCHEMA, GX_SOURCE_TTL_MS, RESTRICTION_CAP_BP, effectiveBasisPoints, exceptionWaiver, gxFeatureFacts, jcs, validateCompliance, type ExceptionCheckId, type ExceptionDeploySources, type ExceptionPolicy, type Policy, type ValidationInput } from '@ff/contracts';
import { oddCompileBlockers, publishCandidates } from '../../../../contracts/src/rules/ads-publish';
import type { SimReadContext, SimWriteContext } from './types';
import { SimError } from './engine';
import { verifyNativeGateAttestation } from './gate-signatures';
import { GX, gxExceptions, gxFeature, gxGateFacts, gxLog, gxRelease, gxScope, gxSnapshot, gxSourceFailure, validateActiveGx } from './gx-state';

const hash = async (value: unknown) => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jcs(value))))].map((b) => b.toString(16).padStart(2, '0')).join('');
const COMPONENT = 'D03-02';

export async function gxDeploySources(ctx: SimReadContext, policy: Policy): Promise<ExceptionDeploySources['payload']> {
  let source = await ctx.snapshot<ExceptionDeploySources>('policyExceptionSources', { id: policy.policyId });
  // Browser-created revisions may reuse captured technical facts for the same Feature and Flag.
  // They still need their own local approval/hash; the fact attestation is never an approval.
  if (!source && ctx.get('policy', policy.policyId)) {
    const list = await gxSnapshot<{ items: Policy[] }>(ctx, 'listPolicies');
    if (!Array.isArray(list.items)) return gxSourceFailure('listPolicies');
    for (const row of list.items.filter((p) => p.featureId === policy.featureId && p.featureVersion === policy.featureVersion && p.flagKey === policy.flagKey)) {
      source = await ctx.snapshot<ExceptionDeploySources>('policyExceptionSources', { id: row.policyId });
      if (source) break;
    }
  }
  if (!source?.payload || !source.signature) return gxSourceFailure(`policyExceptionSources ${policy.policyId}`);
  const p = source.payload, now = ctx.now().getTime();
  if (p.schema !== GX_SOURCE_SCHEMA || !Number.isFinite(Date.parse(p.observedAt)) || !Number.isFinite(Date.parse(p.validUntil)) || Date.parse(p.observedAt) > now + 60_000 || Date.parse(p.validUntil) <= now || Date.parse(p.validUntil) <= Date.parse(p.observedAt) || Date.parse(p.validUntil) - Date.parse(p.observedAt) > GX_SOURCE_TTL_MS || p.policy?.featureId !== policy.featureId || p.policy?.featureVersion !== policy.featureVersion || p.policy?.flagKey !== policy.flagKey) throw new SimError('GUARD_FAILED', '예외 배포 원천의 판·시각·정책 귀속이 유효하지 않습니다.');
  if (!await verifyNativeGateAttestation(ctx, p, source.signature)) throw new SimError('GUARD_FAILED', '예외 배포 원천 사실의 서명을 검증하지 못했습니다.');
  const original = await gxSnapshot<{ policy: Policy }>(ctx, 'policyDetail', { id: p.policy.policyId });
  if (!original.policy || original.policy.policyId !== p.policy.policyId || original.policy.revision !== p.policy.revision || original.policy.contentHash !== p.policy.contentHash) return gxSourceFailure('policyExceptionSources policy revision/contentHash');
  const facts = { policy: p.policy, feature: p.feature, compliance: p.compliance, flagCode: p.flagCode, ads: p.ads };
  if (await hash(facts) !== p.sourceRevision) return gxSourceFailure('policyExceptionSources sourceRevision');
  const detail = await gxFeature(ctx, policy.featureId, policy.featureVersion);
  if (jcs(gxFeatureFacts(detail.feature)) !== jcs(p.feature)) return gxSourceFailure('policyExceptionSources Feature facts changed');
  if (!Array.isArray(p.compliance?.rules) || !Array.isArray(p.ads?.settings) || !Array.isArray(p.ads?.sets) || !Array.isArray(p.ads?.baselines) || !Array.isArray(p.ads?.vehicles) || typeof p.flagCode?.connected !== 'boolean' || !p.flagCode.row) return gxSourceFailure('policyExceptionSources incomplete facts');
  return p;
}

export async function gxActiveKills(ctx: SimReadContext, featureId: string) {
  const source = await gxSnapshot<{ items: unknown[] }>(ctx, 'killRequests');
  if (!Array.isArray(source.items)) return gxSourceFailure('killRequests source');
  const view = await ctx.read<any>('killRequests');
  if (!Array.isArray(view?.items)) return gxSourceFailure('killRequests');
  for (const k of view.items) if (!Array.isArray(k.featureIds) || !Array.isArray(k.vins)) return gxSourceFailure('killRequests scope');
  return view.items.filter((k: any) => k.featureIds.includes(featureId) && k.status === 'ACTIVE' && ['SAFETY', 'SECURITY', 'REGULATORY', 'OPERATIONAL'].includes(k.reasonCategory ?? 'SAFETY') && k.vins.some((v: string) => !(k.restoredVins ?? []).includes(v)));
}

/** Same checks and waiver order as native deploy. Missing facts never become an empty success. */
export async function gxForDeploy(ctx: SimWriteContext, policy: Policy, input: ValidationInput) {
  const sources = await gxDeploySources(ctx, policy);
  const release = await gxRelease(ctx, policy);
  const active = (await gxExceptions(ctx)).filter((e) => validateActiveGx(e, ctx.iso()));
  const used = new Map<string, ExceptionPolicy>();
  for (const id of release.exceptionIds) {
    const e = active.find((x) => x.exceptionId === id);
    if (!e) ctx.fail('GUARD_FAILED', '배포에 사용한 예외의 2인 승인·만료 근거가 유효하지 않습니다.');
    used.set(id, e!);
  }
  const waive = (check: ExceptionCheckId, ruleIds?: string[]) => {
    const e = exceptionWaiver(active, { featureId: policy.featureId, featureVersion: policy.featureVersion, policyId: policy.policyId, check, ruleIds }, ctx.iso());
    if (e) used.set(e.exceptionId, e);
    return !!e;
  };
  const refuse = (message: string, details?: unknown): never => ctx.fail('GUARD_FAILED', message, details, { action: 'POLICY_DEPLOY', target: policy.policyId, reason: message, componentId: COMPONENT });
  const compliance = validateCompliance({ ...input, compliance: { ...sources.compliance, at: ctx.iso() } });
  const unmet = compliance.findings.filter((f) => f.result === 'FAIL');
  const ids = [...new Set(unmet.map((f) => f.ruleId).filter((id): id is string => !!id))];
  if (compliance.result === 'FAIL' && (!ids.length || unmet.some((f) => !f.ruleId) || !waive('COMPLIANCE_RULE', ids))) refuse('배포 시점 컴플라이언스 룰을 충족하지 않습니다.', { findings: unmet });
  const row = sources.flagCode.row;
  if (sources.flagCode.connected) {
    if (row.flagKey !== policy.flagKey || row.featureId !== policy.featureId || row.version !== policy.featureVersion) return gxSourceFailure('Flag code source attribution');
    const waiverActive = row.waiver?.state === 'APPROVED' && Date.parse(row.waiver.expiresAt) > ctx.now().getTime();
    const findings = row.findings.filter((f) => f.severity === 'BLOCKER' || f.status === 'PR_OPEN');
    if (!waiverActive && findings.length && !waive('FLAG_CODE')) refuse('Flag 코드 연결 출시 관문을 충족하지 않습니다.', { blockers: findings });
  }
  const compile = oddCompileBlockers({ flagKey: policy.flagKey, settings: sources.ads.settings, profile: sources.ads.profile });
  const candidates = publishCandidates({ adsScope: true, fClass: sources.ads.fClass as any, sets: sources.ads.sets, baselines: sources.ads.baselines, approvedOddProfileId: sources.ads.profile?.profileId ?? null, classification: sources.ads.classification, now: ctx.now().getTime() }, sources.ads.vehicles);
  const ads = [...compile, ...(sources.ads.enforced ? candidates.blockers : [])];
  if (ads.length && !waive('ADS_PUBLISH')) refuse('ADS 발행 조건을 충족하지 않습니다.', { blockers: ads });
  if (!release.allowed) refuse(release.message, { release, rule: 'unsignedGates' in release ? 'FFG-LCY-001' : 'FR-RDD-001-006' });
  return {
    release,
    used: () => [...used.keys()].sort(),
    cap: () => used.size ? Math.min(...[...used.values()].map((e) => RESTRICTION_CAP_BP[e.restriction])) : null,
    apply: async (next: Policy, prior: Policy | undefined): Promise<Policy> => {
      if (!used.size) return next;
      const entries = [...used.values()], narrow = entries.reduce((a, e) => RESTRICTION_CAP_BP[e.restriction] < RESTRICTION_CAP_BP[a.restriction] ? e : a);
      const cap = RESTRICTION_CAP_BP[narrow.restriction];
      const scoped: Policy = { ...next, exceptionScope: { exceptionIds: entries.map((e) => e.exceptionId).sort(), restriction: narrow.restriction as 'LIMITED' | 'PILOT', capBasisPoints: cap } };
      for (const e of entries) {
        const latest = ctx.get<ExceptionPolicy>(GX, e.exceptionId) ?? e;
        const application = { policyId: next.policyId, flagKey: next.flagKey, at: ctx.iso(), by: ctx.actor.id, prior: prior && prior.policyId !== next.policyId ? { policyId: prior.policyId, stageBasisPoints: prior.stageBasisPoints ?? null } : null, capBasisPoints: cap };
        ctx.put(GX, e.exceptionId, { ...latest, provenance: 'LOCAL_SIMULATION', applications: [...latest.applications, application] });
        gxLog(ctx, e.exceptionId, 'APPLIED', { policyId: next.policyId, prior: application.prior, capBasisPoints: cap });
        ctx.audit({ action: 'EXCEPTION_APPLY', target: e.exceptionId, after: { policyId: next.policyId, stage: next.stageBasisPoints, capBasisPoints: cap, prior: application.prior }, reason: gxScope(e), componentId: COMPONENT });
      }
      return scoped;
    },
  };
}

export async function gxStageGuard(ctx: SimWriteContext, policy: Policy, target: number) {
  if (target === 0) return; // Stop is always available, even with unavailable/invalid signature evidence.
  if (policy.exceptionScope && target > policy.exceptionScope.capBasisPoints) ctx.fail('GUARD_FAILED', '예외의 제한 범위를 넘을 수 없습니다.', { exceptionScope: policy.exceptionScope });
  if (target <= effectiveBasisPoints(policy)) return;
  const gates = await gxGateFacts(ctx, policy.featureId, policy.featureVersion);
  if (Object.keys(gates.unsigned).length) ctx.fail('GUARD_FAILED', 'Gate 결정의 서명·무결성을 확인할 수 없습니다.', { rule: 'FFG-LCY-001', unsignedGates: gates.unsigned });
  if (policy.exceptionScope) {
    const all = await gxExceptions(ctx);
    const inactive = policy.exceptionScope.exceptionIds.filter((id) => !all.some((e) => e.exceptionId === id && validateActiveGx(e, ctx.iso()) && e.featureId === policy.featureId && e.featureVersion === policy.featureVersion && (e.policyId === null || e.policyId === policy.policyId)));
    if (!policy.exceptionScope.exceptionIds.length || inactive.length) ctx.fail('GUARD_FAILED', '배포에 사용한 예외가 더 이상 유효하지 않습니다.', { code: 'EXCEPTION_INACTIVE', exceptionIds: inactive });
  }
}
