// 롤백 (D03-04 이전 상태 복구) — 배포된 정책을 예전에 배포했던 정책 버전으로 되돌린다. 규칙·판정은 contracts/src/rules/rollback.ts.
// 배포 ID = 정책 배포가 만든 POLICY 게시본. 실행은 늘 재검증부터(fail-closed): 복구 기준 버전이 배포 완료·검증 GO·운영 승인·서명된 배포 산출물을
// 갖추고, 긴급 차단이 없고, 적용 범위가 배포 대상 전부를 덮어야 한다. 통과하면 같은 트랜잭션에서 지금 정책을 RETIRED, 복구 기준 정책을 DEPLOYED로
// 바꾸고 그 내용(같은 해시)을 새 순번으로 다시 서명해 내보낸다(이전 게시본을 그대로 재전송하면 차량의 재전송 방지에 걸린다).
// 실행 상태: RUNNING → 롤백 게시본이 닫히면 CONFIRMED는 COMPLETED/SUCCESS, 그 밖은 FAILED/FAILURE(사유·시점).
// 자동 롤백은 승인된 Rollback Plan만 — 계획이 묶인 배포의 게시본 실패율이 기준을 넘거나 등록 DTC가 범위 안 차량에서 보고되면 실행한다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import {
  conditionText,
  CreateRollbackPlanBody,
  CreateRollbackRequestBody,
  dtcTrigger,
  failureRateTrigger,
  LIFECYCLE_RANK,
  policyChangeLog,
  recoveryBlockers,
  ROLLBACK_APPROVER_ROLES,
  ROLLBACK_BLOCKER,
  ROLLBACK_REQUEST_ROLES,
  ROLLBACK_TARGET_LABEL,
  RollbackDecisionBody,
  RollbackPreviewBody,
  scopeBlockers,
  scopeText,
  targetTypeBlockers,
  vehicleGroups,
  vehicleInScope,
  versionText,
  HUMAN_ROLES,
  PolicyRollbackBody,
  RollbackScope,
  type Policy,
  type PolicyVersionRef,
  type Publication,
  type RollbackBlocker,
  type RollbackDecision,
  type RollbackExecution,
  type RollbackPlan,
  type RollbackRequest,
  type RollbackTargetType,
  type RollbackTrigger,
} from '@ff/contracts';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService, type PlatformEvent } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo, PolicyRepo, policyHash } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';
import { PublicationRepo } from '../../d06-qsec/secure-deploy/publication.repo';
import { SecureDeployService } from '../../d06-qsec/secure-deploy/secure-deploy.service';
import { KillService } from '../kill-switch/kill.service';
import { RollbackRepo } from './rollback.repo';

const AUTO: Actor = { id: 'system:rollback', role: 'SYSTEM', correlationId: 'auto-rollback' };
const ref = (p: Policy): PolicyVersionRef => ({ policyId: p.policyId, revision: p.revision, contentHash: p.contentHash, featureId: p.featureId, featureVersion: p.featureVersion });
const typesText = (ts: readonly RollbackTargetType[]) => ts.map((t) => ROLLBACK_TARGET_LABEL[t]).join(', ');

interface Assessment {
  deploymentId: string;
  deployment: { publicationId: string; status: string; createdAt: string; createdBy: string; targets: number } | null;
  current: Policy | null;
  recovery: Policy | null;
  sourceArtifactId: string | null;
  blockers: { code: RollbackBlocker; message: string }[];
  applicable: boolean;
  impact: { features: { featureId: string; version: string | null; name: string; role: 'TARGET' | 'DEPENDENT' }[]; flagKeys: string[] };
  vehicleGroups: ReturnType<typeof vehicleGroups>;
  vins: string[];
  targets: string[];
}

@Injectable()
@PlatformComponent('D03-04')
export class RollbackService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly repo: RollbackRepo,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly fleet: FleetRepo,
    private readonly publications: PublicationRepo,
    private readonly deploy: SecureDeployService,
    private readonly kills: KillService,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  /** 발행 훅 — 롤백 게시본이 닫히면 실행을 마무리하고, 자동 롤백 조건을 본다. 훅 안에서는 기록만 하고 이벤트는 커밋 뒤에 낸다 */
  onModuleInit() {
    this.events.onPublish((ev) => this.onEvent(ev));
  }

  private later(fn: () => void) {
    if (this.db.inTransaction) this.db.afterCommit(fn);
    else queueMicrotask(fn);
  }

  private onEvent(ev: PlatformEvent) {
    const p = (ev.payload ?? {}) as Record<string, any>;
    if (ev.type === 'publication.closed' && p.kind === 'POLICY') {
      const x = this.repo.executionByArtifact(String(p.publicationId));
      if (x && x.status === 'RUNNING') this.finish(x, String(p.status), Number(p.confirmed ?? 0), Number(p.denominator ?? 0));
      for (const plan of this.repo.plans({ deploymentId: String(p.publicationId), status: 'APPROVED' })) {
        const t = failureRateTrigger(plan.conditions, Number(p.confirmed ?? 0), Number(p.denominator ?? 0));
        if (t) this.later(() => this.autoExecute(plan.planId, t));
      }
    }
    if (ev.type === 'vehicle.status.accepted' && Array.isArray(p.dtc) && p.dtc.length) {
      for (const plan of this.repo.plans({ featureId: String(p.featureId), status: 'APPROVED' })) {
        const pub = this.publications.get(plan.deploymentId);
        const v = typeof p.vin === 'string' ? this.fleet.vehicle(p.vin) : undefined;
        if (!pub || !v || !pub.payload.targets.includes(v.vin) || !vehicleInScope(v, plan.featureId, plan.scope)) continue;
        const t = dtcTrigger(plan.conditions, v.vin, p.dtc);
        if (t) this.later(() => this.autoExecute(plan.planId, t));
      }
    }
  }

  // ─── 배포·복구 후보 ───────────────────────────────────────

  private latestPublication(policyId: string): Publication | undefined {
    return this.publications
      .list({ kind: 'POLICY' })
      .filter((x) => x.payload.policy?.policyId === policyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.publicationId.localeCompare(a.publicationId))[0];
  }

  private featureDeployable(p: Policy) {
    const f = this.features.get(p.featureId, p.featureVersion);
    return !!f && LIFECYCLE_RANK[f.lifecycle] >= LIFECYCLE_RANK.APPROVED && !['DEPRECATED', 'RETIRED', 'DECOMMISSIONED'].includes(f.lifecycle);
  }

  /** 복구 기준 버전 판정 사실 — 검증 GO(같은 해시)·배포 산출물(최신 게시본·서명)·Feature 상태 */
  private recoveryFacts(candidate: Policy | undefined, current: Policy) {
    const pub = candidate ? this.latestPublication(candidate.policyId) : undefined;
    return {
      artifactId: pub?.publicationId ?? null,
      blockers: recoveryBlockers({
        policy: candidate ? { policyId: candidate.policyId, flagKey: candidate.flagKey, status: candidate.status, contentHash: candidate.contentHash, approvedBy: candidate.approvedBy, deployedAt: candidate.deployedAt ?? null } : null,
        current: { policyId: current.policyId, flagKey: current.flagKey, contentHash: current.contentHash },
        validatedGo: !!candidate && this.policies.runs(candidate.policyId).some((r) => r.decision === 'GO' && r.contentHash === candidate.contentHash),
        artifact: pub ? { status: pub.status, signatureValid: this.deploy.detail(pub.publicationId).verification.valid } : null,
        featureDeployable: !!candidate && this.featureDeployable(candidate),
        // 배포와 같은 무결성 검사 — 저장된 내용의 해시가 승인·검증한 해시와 같아야 한다(RD-FN-02)
        contentIntact: !candidate || policyHash(candidate) === candidate.contentHash,
      }),
    };
  }

  /** 복구 가능 버전 목록(FR-RBK-004-004) — 같은 flag의 다른 정책, 복구 가능한 것 먼저 */
  candidates(current: Policy) {
    return this.policies
      .byFlag(current.flagKey)
      .filter((p) => p.policyId !== current.policyId)
      .map((p) => {
        const f = this.recoveryFacts(p, current);
        return { ...ref(p), status: p.status, deployedAt: p.deployedAt ?? null, deployedBy: p.deployedBy ?? null, approvedBy: p.approvedBy, artifactId: f.artifactId, eligible: !f.blockers.length, blockers: f.blockers.map((code) => ({ code, message: ROLLBACK_BLOCKER[code] })) };
      })
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.deployedAt ?? '').localeCompare(a.deployedAt ?? ''));
  }

  /** 롤백 대상 배포 — flag마다 지금 배포된 정책과 그 최신 배포 산출물 */
  deployments() {
    return {
      items: this.policies
        .all()
        .filter((p) => p.status === 'DEPLOYED')
        .map((p) => {
          const pub = this.latestPublication(p.policyId);
          const f = this.features.get(p.featureId, p.featureVersion);
          const candidates = this.candidates(p);
          return {
            deploymentId: pub?.publicationId ?? null,
            flagKey: p.flagKey,
            controlPoint: p.controlPoint,
            feature: { featureId: p.featureId, version: p.featureVersion, name: f?.name ?? p.featureId },
            deployed: ref(p),
            deployedBy: p.deployedBy ?? null,
            deployedAt: p.deployedAt ?? null,
            publication: pub ? { status: pub.status, confirmed: pub.confirmed, denominator: pub.denominator, createdAt: pub.createdAt } : null,
            candidates: candidates.length,
            eligible: candidates.filter((c) => c.eligible).length,
            plans: this.repo.plans({ deploymentId: pub?.publicationId ?? '-' }).filter((x) => x.status === 'APPROVED').length,
          };
        }),
    };
  }

  private requireDeployment(deploymentId: string) {
    const pub = this.publications.get(deploymentId);
    if (!pub || pub.kind !== 'POLICY' || !pub.payload.policy) throw new DomainError('NOT_FOUND', `${deploymentId} — ${ROLLBACK_BLOCKER.DEPLOYMENT_NOT_FOUND}`);
    const policy = this.policies.get(pub.payload.policy.policyId);
    if (!policy) throw new DomainError('NOT_FOUND', `${deploymentId} — ${ROLLBACK_BLOCKER.DEPLOYMENT_NOT_FOUND}`);
    return { pub, policy };
  }

  /** 배포 ID 기준 조회(FR-RBK-004-003) — Feature·배포 버전·적용 범위·정책 변경 이력·배포 이력·복구 가능 버전. SW 변경 이력은 OTA(IF-05) 원천 */
  deployment(deploymentId: string) {
    const { pub, policy } = this.requireDeployment(deploymentId);
    const f = this.features.get(policy.featureId, policy.featureVersion);
    const current = this.policies.deployed(policy.flagKey);
    const history = this.publications
      .list({ kind: 'POLICY' })
      .filter((x) => x.payload.flagKey === policy.flagKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((x) => ({ publicationId: x.publicationId, policyId: x.payload.policy?.policyId ?? null, revision: x.payload.policy?.revision ?? null, contentHash: x.payload.policy?.contentHash ?? null, status: x.status, confirmed: x.confirmed, denominator: x.denominator, createdAt: x.createdAt, createdBy: x.createdBy, rollback: this.repo.executionByArtifact(x.publicationId)?.executionId ?? null }));
    return {
      deploymentId,
      current: !!current && current.policyId === policy.policyId && this.latestPublication(policy.policyId)?.publicationId === deploymentId,
      feature: { featureId: policy.featureId, version: policy.featureVersion, name: f?.name ?? policy.featureId, ownerId: f?.ownerId ?? null, scope: f ? { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim } : null },
      deployed: { ...ref(policy), flagKey: policy.flagKey, controlPoint: policy.controlPoint, status: policy.status, deployedBy: policy.deployedBy ?? null, deployedAt: policy.deployedAt ?? null },
      publication: { status: pub.status, confirmed: pub.confirmed, denominator: pub.denominator, targets: pub.payload.targets.length, createdAt: pub.createdAt },
      policyChanges: policyChangeLog(this.policies.revisions(policy.policyId)),
      deploymentHistory: history,
      swHistory: { available: false, note: 'SW 변경 이력의 원천은 OTA(IF-05) — 이 플랫폼에는 없습니다 (결정 대기 D7)' },
      candidates: current ? this.candidates(current) : [],
      plans: this.repo.plans({ deploymentId }),
      requests: this.repo.requests({ deploymentId }),
    };
  }

  /**
   * 롤백 재검증·영향 산출(FR-RBK-002-003·003-001~003) — 기록하지 않는다.
   * 영향 Feature = 복구 기준 Feature + 이를 REQUIRES하는 Feature, 영향 차량 = 배포 대상 중 적용 범위 안, 롤백 범위 = 그 차량(배포 대상 전부여야 함)
   */
  assess(deploymentId: string, recoveryPolicyId: string, scope: RollbackScope, targetTypes: readonly RollbackTargetType[] = ['POLICY_VERSION']): Assessment {
    const blockers: RollbackBlocker[] = [...targetTypeBlockers(targetTypes)];
    const pub = this.publications.get(deploymentId);
    const policy = pub?.kind === 'POLICY' && pub.payload.policy ? this.policies.get(pub.payload.policy.policyId) : undefined;
    const recovery = this.policies.get(recoveryPolicyId) ?? null;
    if (!pub || !policy) blockers.push('DEPLOYMENT_NOT_FOUND');
    const current = policy ? this.policies.deployed(policy.flagKey) : undefined;
    let sourceArtifactId: string | null = null;
    if (policy && (!current || current.policyId !== policy.policyId || this.latestPublication(policy.policyId)?.publicationId !== deploymentId)) blockers.push('DEPLOYMENT_NOT_CURRENT');
    if (current) {
      const f = this.recoveryFacts(recovery ?? undefined, current);
      sourceArtifactId = f.artifactId;
      blockers.push(...f.blockers);
    }
    const featureOf = recovery ?? current ?? policy;
    let impact: Assessment['impact'] = { features: [], flagKeys: [] };
    if (featureOf) {
      try {
        const pv = this.kills.preview(featureOf.featureId, featureOf.featureVersion);
        impact = {
          features: [{ featureId: featureOf.featureId, version: featureOf.featureVersion, name: pv.feature.name, role: 'TARGET' }, ...pv.dependents.map((d) => ({ featureId: d.featureId, version: d.version, name: d.name, role: 'DEPENDENT' as const }))],
          flagKeys: pv.flagKeys,
        };
        if (pv.activeKill) blockers.push('KILL_ACTIVE');
      } catch {
        blockers.push('FEATURE_NOT_DEPLOYABLE');
      }
    }
    const targets = pub?.payload.targets ?? [];
    const vehicles = this.fleet.vehicles().filter((v) => targets.includes(v.vin) && !!featureOf && vehicleInScope(v, featureOf.featureId, scope));
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

  preview(body: RollbackPreviewBody) {
    const a = this.assess(body.deploymentId, body.recovery.policyId, body.scope);
    return { ...a, current: a.current ? ref(a.current) : null, recovery: a.recovery ? ref(a.recovery) : null };
  }

  // ─── Rollback Plan ───────────────────────────────────────

  private checkApprovers(actor: Actor, approvers: string[], action: string, target: string) {
    if (approvers.includes(actor.id)) {
      this.audit.failed(actor, action, target, '요청자를 승인대상자로 지정', 'D03-04');
      throw new DomainError('SEPARATION_OF_DUTY', '요청자는 승인대상자가 될 수 없습니다.');
    }
    return [...new Set(approvers)];
  }

  private refuse(actor: Actor, action: string, target: string, a: Assessment): never {
    const msg = a.blockers.map((b) => b.message).join(' · ');
    this.audit.failed(actor, action, target, msg, 'D03-04');
    throw new DomainError('GUARD_FAILED', `롤백할 수 없습니다: ${msg}`, { blockers: a.blockers });
  }

  createPlan(actor: Actor, body: CreateRollbackPlanBody): RollbackPlan {
    const approvers = this.checkApprovers(actor, body.approvers, 'ROLLBACK_PLAN_CREATE', body.deploymentId);
    const a = this.assess(body.deploymentId, body.recovery.policyId, body.scope, body.targetTypes);
    if (!a.applicable) this.refuse(actor, 'ROLLBACK_PLAN_CREATE', body.deploymentId, a);
    return this.db.tx(() => {
      const plan: RollbackPlan = {
        planId: this.repo.nextPlanId(),
        deploymentId: body.deploymentId,
        featureId: a.current!.featureId,
        flagKey: a.current!.flagKey,
        deployed: ref(a.current!),
        targetTypes: body.targetTypes,
        conditions: body.conditions,
        recovery: ref(a.recovery!),
        scope: body.scope,
        approvers,
        requestedBy: actor.id,
        requestedAt: this.clock.iso(),
        note: body.note ?? null,
        status: 'REQUESTED',
        decision: null,
        executionId: null,
      };
      this.repo.insertPlan(plan);
      this.audit.record(actor, 'ROLLBACK_PLAN_CREATE', plan.planId, { after: plan, componentId: 'D03-04' });
      this.events.publish('rollback.plan.requested', plan.planId, { ...this.notice(plan), planId: plan.planId, conditions: conditionText(plan.conditions) }, { componentId: 'D03-04', correlationId: actor.correlationId });
      return plan;
    });
  }

  private notice(x: RollbackPlan | RollbackRequest) {
    return {
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
    };
  }

  private decision(actor: Actor, x: RollbackPlan | RollbackRequest, body: RollbackDecisionBody, action: string, id: string): RollbackDecision {
    if (x.status !== 'REQUESTED') throw new DomainError('CONFLICT', `${id}은(는) ${x.status} — 승인 대기 상태가 아닙니다.`);
    if (actor.id === x.requestedBy) {
      this.audit.failed(actor, action, id, '요청자 본인 승인 시도', 'D03-04');
      throw new DomainError('SEPARATION_OF_DUTY', '요청자는 승인할 수 없습니다.');
    }
    if (!x.approvers.includes(actor.id)) {
      this.audit.failed(actor, action, id, `지정 승인대상자 아님 (${x.approvers.join(', ')})`, 'D03-04');
      throw new DomainError('FORBIDDEN', `지정된 승인대상자(${x.approvers.join(', ')})만 승인·반려할 수 있습니다.`);
    }
    return { decision: body.decision, by: actor.id, role: actor.role, at: this.clock.iso(), comment: body.comment };
  }

  decidePlan(actor: Actor, id: string, body: RollbackDecisionBody): RollbackPlan {
    const plan = this.requirePlan(id);
    const d = this.decision(actor, plan, body, 'ROLLBACK_PLAN_DECIDE', id);
    return this.db.tx(() => {
      const next: RollbackPlan = { ...plan, status: d.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decision: d };
      this.repo.updatePlan(next);
      this.audit.record(actor, 'ROLLBACK_PLAN_DECIDE', id, { before: { status: plan.status }, after: { status: next.status, decision: d }, reason: body.comment, componentId: 'D03-04' });
      this.events.publish('rollback.plan.decided', id, { planId: id, decision: d.decision, by: actor.id, featureId: plan.featureId }, { componentId: 'D03-04', correlationId: actor.correlationId });
      return next;
    });
  }

  requirePlan(id: string): RollbackPlan {
    const p = this.repo.plan(id);
    if (!p) throw new DomainError('NOT_FOUND', `Rollback Plan ${id}을(를) 찾을 수 없습니다.`);
    return p;
  }

  plans(q: { deploymentId?: string; status?: string }) {
    return { items: this.repo.plans(q) };
  }

  // ─── 수동 롤백 ───────────────────────────────────────────

  createRequest(actor: Actor, body: CreateRollbackRequestBody): RollbackRequest {
    const approvers = this.checkApprovers(actor, body.approvers, 'ROLLBACK_REQUEST', body.deploymentId);
    const a = this.assess(body.deploymentId, body.recovery.policyId, body.scope, body.targetTypes);
    if (!a.applicable) this.refuse(actor, 'ROLLBACK_REQUEST', body.deploymentId, a);
    return this.db.tx(() => {
      const r: RollbackRequest = {
        requestId: this.repo.nextRequestId(),
        deploymentId: body.deploymentId,
        featureId: a.current!.featureId,
        flagKey: a.current!.flagKey,
        deployed: ref(a.current!),
        targetTypes: body.targetTypes,
        recovery: ref(a.recovery!),
        scope: body.scope,
        reason: body.reason,
        approvers,
        requestedBy: actor.id,
        requestedAt: this.clock.iso(),
        status: 'REQUESTED',
        decision: null,
        executionId: null,
      };
      this.repo.insertRequest(r);
      this.audit.record(actor, 'ROLLBACK_REQUEST', r.requestId, { after: r, reason: body.reason, componentId: 'D03-04' });
      this.events.publish('rollback.requested', r.requestId, { ...this.notice(r), requestId: r.requestId, reason: r.reason }, { componentId: 'D03-04', correlationId: actor.correlationId });
      return r;
    });
  }

  requireRequest(id: string): RollbackRequest {
    const r = this.repo.request(id);
    if (!r) throw new DomainError('NOT_FOUND', `수동 롤백 요청 ${id}을(를) 찾을 수 없습니다.`);
    return r;
  }

  requests(q: { deploymentId?: string; status?: string }) {
    return { items: this.repo.requests(q) };
  }

  decideRequest(actor: Actor, id: string, body: RollbackDecisionBody): RollbackRequest {
    const r = this.requireRequest(id);
    const d = this.decision(actor, r, body, 'ROLLBACK_REQUEST_DECIDE', id);
    return this.db.tx(() => {
      const next: RollbackRequest = { ...r, status: d.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decision: d };
      this.repo.updateRequest(next);
      this.audit.record(actor, 'ROLLBACK_REQUEST_DECIDE', id, { before: { status: r.status }, after: { status: next.status, decision: d }, reason: body.comment, componentId: 'D03-04' });
      this.events.publish('rollback.request.decided', id, { requestId: id, decision: d.decision, by: actor.id, featureId: r.featureId }, { componentId: 'D03-04', correlationId: actor.correlationId });
      return next;
    });
  }

  /** 승인된 수동 롤백만 실행한다(FR-RBK-004-007). 이미 실행한 요청은 409 — 실행 기록을 알려 준다(두 번 되돌리지 않는다, RD-FN-02) */
  executeRequest(actor: Actor, id: string): RollbackExecution {
    const r = this.requireRequest(id);
    if (r.status === 'EXECUTED') {
      this.audit.failed(actor, 'ROLLBACK_EXECUTE', id, `이미 실행한 요청 (${r.executionId})`, 'D03-04');
      throw new DomainError('CONFLICT', `이미 실행한 롤백 요청입니다 — 실행 기록 ${r.executionId}.`, { executionId: r.executionId });
    }
    if (r.status !== 'APPROVED') {
      this.audit.failed(actor, 'ROLLBACK_EXECUTE', id, `${r.status} 요청 실행 시도`, 'D03-04');
      throw new DomainError('GUARD_FAILED', `승인된 요청만 실행할 수 있습니다 (지금 ${r.status}).`);
    }
    return this.execute(actor, { mode: 'MANUAL', source: r, trigger: { kind: 'MANUAL', detail: r.reason } });
  }

  // ─── 실행 ────────────────────────────────────────────────

  /** 자동 롤백 — 커밋 뒤에 실행. 이미 실행한 계획(TRIGGERED)이나 반려된 계획은 건너뛴다 */
  private autoExecute(planId: string, trigger: RollbackTrigger) {
    const plan = this.repo.plan(planId);
    if (!plan || plan.status !== 'APPROVED') return;
    this.execute({ ...AUTO, correlationId: `auto-rollback:${planId}` }, { mode: 'AUTO', source: plan, trigger });
  }

  private execute(actor: Actor, run: { mode: 'AUTO' | 'MANUAL'; source: RollbackPlan | RollbackRequest; trigger: RollbackTrigger }): RollbackExecution {
    const src = run.source;
    const plan = 'planId' in src ? src : null;
    const a = this.assess(src.deploymentId, src.recovery.policyId, src.scope, src.targetTypes);
    return this.db.tx(() => {
      const now = this.clock.iso();
      const x: RollbackExecution = {
        executionId: this.repo.nextExecutionId(),
        mode: run.mode,
        planId: plan?.planId ?? null,
        requestId: plan ? null : (src as RollbackRequest).requestId,
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
      // 재검증 실패 — 아무것도 바꾸지 않고 실패로 남긴다
      if (!a.applicable) {
        const failed: RollbackExecution = { ...x, status: 'FAILED', result: 'FAILURE', failureReason: a.blockers.map((b) => b.message).join(' · '), failedAt: now, finishedAt: now };
        this.repo.insertExecution(failed);
        this.markSource(src, failed.executionId);
        this.audit.record(actor, 'ROLLBACK_EXECUTE', failed.executionId, { after: { status: 'FAILED', blockers: a.blockers.map((b) => b.code) }, reason: `${run.trigger.detail} — 재검증 실패`, componentId: 'D03-04' });
        this.events.publish('rollback.failed', failed.executionId, this.resultNotice(failed), { componentId: 'D03-04', correlationId: actor.correlationId });
        return failed;
      }
      const current = a.current!;
      const recovery = a.recovery!;
      this.policies.update({ ...current, status: 'RETIRED' });
      this.audit.record(actor, 'POLICY_RETIRE', current.policyId, { before: { status: 'DEPLOYED' }, after: { status: 'RETIRED' }, reason: `롤백 ${x.executionId} — ${recovery.policyId}로 복구`, componentId: 'D03-04' });
      const restored: Policy = { ...recovery, status: 'DEPLOYED', deployedBy: actor.id, deployedAt: now };
      this.policies.update(restored);
      this.audit.record(actor, 'POLICY_DEPLOY', recovery.policyId, { before: { status: recovery.status }, after: { status: 'DEPLOYED', contentHash: recovery.contentHash }, reason: `롤백 ${x.executionId} (${run.trigger.detail})`, componentId: 'D03-04' });
      const pub = this.deploy.publishPolicy(restored, actor);
      const running: RollbackExecution = { ...x, status: 'RUNNING', artifactId: pub.publicationId };
      this.repo.insertExecution(running);
      this.markSource(src, running.executionId);
      this.audit.record(actor, 'ROLLBACK_EXECUTE', running.executionId, { before: { policyId: current.policyId, contentHash: current.contentHash }, after: { policyId: recovery.policyId, contentHash: recovery.contentHash, artifactId: pub.publicationId }, reason: run.trigger.detail, componentId: 'D03-04' });
      this.events.publish('policy.deployed', recovery.policyId, { policyId: recovery.policyId, flagKey: recovery.flagKey, contentHash: recovery.contentHash, replaced: current.policyId, publicationId: pub.publicationId, reason: `롤백 ${running.executionId}` }, { componentId: 'D03-04', correlationId: actor.correlationId });
      this.events.publish('rollback.started', running.executionId, { executionId: running.executionId, featureId: running.featureId, artifactId: pub.publicationId, mode: run.mode }, { componentId: 'D03-04', correlationId: actor.correlationId });
      return this.repo.execution(running.executionId) ?? running;
    });
  }

  private markSource(src: RollbackPlan | RollbackRequest, executionId: string) {
    if ('planId' in src) this.repo.updatePlan({ ...src, status: 'TRIGGERED', executionId });
    else this.repo.updateRequest({ ...src, status: 'EXECUTED', executionId });
  }

  /** 롤백 게시본이 닫힘 — 전부 확인이면 완료·성공, 그 밖은 실패(사유·시점). 훅 안이라 기록만 하고 이벤트는 커밋 뒤에 */
  private finish(x: RollbackExecution, status: string, confirmed: number, denominator: number) {
    const now = this.clock.iso();
    const ok = status === 'CONFIRMED';
    const next: RollbackExecution = ok
      ? { ...x, status: 'COMPLETED', result: 'SUCCESS', finishedAt: now }
      : { ...x, status: 'FAILED', result: 'FAILURE', failureReason: `롤백 배포 산출물 ${x.artifactId} ${status} — 차량 확인 ${confirmed}/${denominator}`, failedAt: now, finishedAt: now };
    this.repo.updateExecution(next);
    this.later(() =>
      this.db.tx(() => {
        this.audit.record(AUTO, 'ROLLBACK_RESULT', next.executionId, { after: { status: next.status, result: next.result }, reason: next.failureReason ?? undefined, componentId: 'D03-04' });
        this.events.publish(ok ? 'rollback.completed' : 'rollback.failed', next.executionId, this.resultNotice(next), { componentId: 'D03-04' });
      }),
    );
  }

  private resultNotice(x: RollbackExecution) {
    return {
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
    };
  }

  // ─── 이력 ────────────────────────────────────────────────

  /** 롤백 이력 조회(FR-RBK-005-002) */
  history(q: { deploymentId?: string; featureId?: string; planId?: string; requestId?: string; targetType?: string; vin?: string; status?: string; result?: string; from?: string; to?: string }) {
    return {
      items: this.repo
        .executions()
        .filter((x) => !q.deploymentId || x.deploymentId === q.deploymentId)
        .filter((x) => !q.featureId || x.featureId === q.featureId)
        .filter((x) => !q.planId || x.planId === q.planId)
        .filter((x) => !q.requestId || x.requestId === q.requestId)
        .filter((x) => !q.targetType || x.targetTypes.includes(q.targetType as RollbackTargetType))
        .filter((x) => !q.vin || x.vins.includes(q.vin))
        .filter((x) => !q.status || x.status === q.status)
        .filter((x) => !q.result || x.result === q.result)
        .filter((x) => !q.from || x.startedAt >= q.from)
        .filter((x) => !q.to || x.startedAt <= q.to),
    };
  }

  // ─── 정책 기준 이력·되돌리기 (RD-FN-02) ────────────────────

  /**
   * 정책 상세의 버전·배포 이력 — 이 정책의 flag(Control Point)로 지금까지 배포된 버전(서명 게시본)·각 정책 버전의 상태와
   * 되돌릴 수 있는지(재검증 결과)·진행 중인 되돌리기 요청·실행 기록. deploymentId는 되돌리기 요청의 기준(expectedDeploymentId)이다.
   */
  policyHistory(policyId: string) {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}을(를) 찾을 수 없습니다.`);
    const current = this.policies.deployed(p.flagKey) ?? null;
    const currentPub = current ? this.latestPublication(current.policyId) : undefined;
    const deployments = this.publications
      .list({ kind: 'POLICY' })
      .filter((x) => x.payload.flagKey === p.flagKey)
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
        rollbackExecutionId: this.repo.executionByArtifact(x.publicationId)?.executionId ?? null,
      }));
    const eligibility = new Map((current ? this.candidates(current) : []).map((c) => [c.policyId, c]));
    const versions = this.policies
      .byFlag(p.flagKey)
      .map((v) => {
        const c = eligibility.get(v.policyId);
        return {
          ...ref(v),
          status: v.status,
          description: v.description,
          approvedBy: v.approvedBy,
          deployedAt: v.deployedAt ?? null,
          deployedBy: v.deployedBy ?? null,
          current: !!current && v.policyId === current.policyId,
          rollback: c ? { eligible: c.eligible, blockers: c.blockers } : null,
        };
      })
      .sort((a, b) => (b.deployedAt ?? '').localeCompare(a.deployedAt ?? '') || b.policyId.localeCompare(a.policyId));
    const requests = currentPub ? this.repo.requests({ deploymentId: currentPub.publicationId }) : [];
    const executions = this.repo.executions().filter((x) => x.flagKey === p.flagKey);
    return {
      policyId,
      flagKey: p.flagKey,
      deploymentId: currentPub?.publicationId ?? null,
      current: current ? ref(current) : null,
      deployments,
      versions,
      requests,
      executions,
    };
  }

  /**
   * 정책 상세에서 되돌리기 요청 — 수동 롤백 요청과 같은 재검증·승인(지정 승인대상자)·실행·감사를 거친다.
   * 412: 화면이 본 배포(expectedDeploymentId)가 지금 배포가 아니다. 409: 이 배포에 진행 중인 되돌리기 요청이 이미 있다.
   */
  requestPolicyRollback(actor: Actor, policyId: string, body: PolicyRollbackBody): RollbackRequest {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}을(를) 찾을 수 없습니다.`);
    const current = this.policies.deployed(p.flagKey);
    const pub = current ? this.latestPublication(current.policyId) : undefined;
    if (!current || !pub) {
      this.audit.failed(actor, 'ROLLBACK_REQUEST', policyId, `${p.flagKey} 지금 배포 없음`, 'D03-04');
      throw new DomainError('GUARD_FAILED', `${p.flagKey}에는 지금 배포된 정책이 없습니다 — 되돌릴 배포가 없습니다.`);
    }
    if (body.expectedDeploymentId !== pub.publicationId) {
      this.audit.failed(actor, 'ROLLBACK_REQUEST', pub.publicationId, `기준 배포 ${body.expectedDeploymentId} ≠ 지금 배포 ${pub.publicationId}`, 'D03-04');
      throw new DomainError('PRECONDITION_FAILED', `화면을 연 뒤 배포가 바뀌었습니다(지금 ${pub.publicationId}) — 이력을 새로 보고 다시 고르세요.`, { deploymentId: pub.publicationId });
    }
    const open = this.repo.requests({ deploymentId: pub.publicationId }).find((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');
    if (open) {
      this.audit.failed(actor, 'ROLLBACK_REQUEST', pub.publicationId, `진행 중인 요청 ${open.requestId}`, 'D03-04');
      throw new DomainError('CONFLICT', `이 배포에는 진행 중인 되돌리기 요청 ${open.requestId}(${open.status})이 있습니다 — 그 요청을 승인·실행하거나 반려한 뒤 다시 요청하세요.`, { requestId: open.requestId });
    }
    return this.createRequest(actor, {
      deploymentId: pub.publicationId,
      targetTypes: ['POLICY_VERSION'],
      recovery: body.recovery,
      scope: RollbackScope.parse({ featureIds: [current.featureId] }),
      reason: body.reason,
      approvers: body.approvers,
    });
  }

  execution(id: string) {
    const x = this.repo.execution(id);
    if (!x) throw new DomainError('NOT_FOUND', `롤백 실행 ${id}을(를) 찾을 수 없습니다.`);
    return x;
  }
}

@Controller('api/rollbacks')
export class RollbackController {
  constructor(private readonly s: RollbackService) {}

  @Get('deployments')
  deployments() {
    return this.s.deployments();
  }

  @Get('deployments/:deploymentId')
  deployment(@Param('deploymentId') id: string) {
    return this.s.deployment(id);
  }

  @Post('preview')
  @HttpCode(200)
  @Roles(...HUMAN_ROLES)
  preview(@Body(new ZodPipe(RollbackPreviewBody)) body: RollbackPreviewBody) {
    return this.s.preview(body);
  }

  @Get()
  history(@Query() q: Record<string, string>) {
    return this.s.history(q);
  }

  @Get(':id')
  execution(@Param('id') id: string) {
    return this.s.execution(id);
  }
}

/** 정책 상세의 버전·배포 이력과 되돌리기 요청 (RD-FN-02) — 승인·실행은 /api/rollback-requests/:id/decision·execute */
@Controller('api/policies')
export class PolicyHistoryController {
  constructor(private readonly s: RollbackService) {}

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.s.policyHistory(id);
  }

  @Post(':id/rollback')
  @Roles(...ROLLBACK_REQUEST_ROLES)
  @AuditAction('ROLLBACK_REQUEST')
  rollback(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(PolicyRollbackBody)) body: PolicyRollbackBody) {
    return this.s.requestPolicyRollback(actor, id, body);
  }
}

@Controller('api/rollback-plans')
export class RollbackPlanController {
  constructor(private readonly s: RollbackService) {}

  @Get()
  list(@Query('deploymentId') deploymentId?: string, @Query('status') status?: string) {
    return this.s.plans({ deploymentId, status });
  }

  @Post()
  @Roles(...ROLLBACK_REQUEST_ROLES)
  @AuditAction('ROLLBACK_PLAN_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateRollbackPlanBody)) body: CreateRollbackPlanBody) {
    return this.s.createPlan(actor, body);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.s.requirePlan(id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Roles(...ROLLBACK_APPROVER_ROLES)
  @AuditAction('ROLLBACK_PLAN_DECIDE')
  decide(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RollbackDecisionBody)) body: RollbackDecisionBody) {
    return this.s.decidePlan(actor, id, body);
  }
}

@Controller('api/rollback-requests')
export class RollbackRequestController {
  constructor(private readonly s: RollbackService) {}

  @Get()
  list(@Query('deploymentId') deploymentId?: string, @Query('status') status?: string) {
    return this.s.requests({ deploymentId, status });
  }

  @Post()
  @Roles(...ROLLBACK_REQUEST_ROLES)
  @AuditAction('ROLLBACK_REQUEST')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateRollbackRequestBody)) body: CreateRollbackRequestBody) {
    return this.s.createRequest(actor, body);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.s.requireRequest(id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Roles(...ROLLBACK_APPROVER_ROLES)
  @AuditAction('ROLLBACK_REQUEST_DECIDE')
  decide(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RollbackDecisionBody)) body: RollbackDecisionBody) {
    return this.s.decideRequest(actor, id, body);
  }

  @Post(':id/execute')
  @HttpCode(200)
  @Roles(...ROLLBACK_REQUEST_ROLES)
  @AuditAction('ROLLBACK_EXECUTE')
  execute(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(z.object({}).strict())) _b: object) {
    return this.s.executeRequest(actor, id);
  }
}
