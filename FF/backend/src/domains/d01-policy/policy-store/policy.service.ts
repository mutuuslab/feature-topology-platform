// 정책 저장·버전 관리 (D01-06) — PoC ② 정책 작성 → 분야별 검증(8종 병렬) → 배포 안전성 → 승인 → (서버) 배포.
// 승인은 P0 publishCheck: 작성자≠승인자, 검증한 내용(해시)=지금 내용, 마지막 판정 GO. 승인되면 Feature의 Control Point 정책
// 커버리지가 올라가 Lifecycle DEVELOPING→VERIFIED 자동 전이 조건이 채워질 수 있다(같은 트랜잭션).
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { LIFECYCLE_RANK, type CreatePolicyBody, type Policy, type PolicyDecisionBody, type UpdatePolicyBody } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { DeploySafetyService } from '../../d03-safety/deploy-safety/deploy-safety.service';
import { ValidationService } from '../../d06-qsec/validation-history/validation.service';
import { PolicyRepo, policyHash, type ValidationRun } from '../policy-repos';
import { LifecycleService } from '../registry/lifecycle.service';
import { FeatureRepo } from '../repos';

const EDITABLE = ['DRAFT', 'VALIDATED', 'REJECTED'] as const;

@Injectable()
@PlatformComponent('D01-06')
export class PolicyService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly validation: ValidationService,
    private readonly safety: DeploySafetyService,
    private readonly lifecycle: LifecycleService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  /** PoC 시나리오 시드 — FEAT-00022(전방 안전거리 3단계) Control Point 2개의 배포 정책 (체험권 CAT-00019 필요) */
  onModuleInit() {
    if (process.env.FF_SEED === 'none' || this.policies.all().length) return;
    const f = this.features.get('FEAT-00022', '1.0.0');
    if (!f) return;
    const at = '2026-10-01T00:00:00.000Z';
    const seed = (cp: 'Signal' | 'Parameter', flagKey: string, description: string): Policy => {
      const p: Policy = {
        policyId: this.policies.nextId(),
        revision: 1,
        status: 'DEPLOYED',
        contentHash: '',
        createdBy: 'usr-author',
        createdAt: at,
        approvedBy: 'usr-approver',
        approvedAt: at,
        lastValidationId: null,
        stageBasisPoints: null,
        featureId: f.featureId,
        featureVersion: f.version,
        controlPoint: cp,
        flagKey,
        description,
        enabled: true,
        safeDefault: false,
        entitlementCatalogId: 'CAT-00019',
        strategies: [],
        rollout: { mode: 'ALL', basisPoints: 10000, salt: 'FF-COHORT-SALT-1' },
      };
      return { ...p, contentHash: policyHash(p) };
    };
    this.db.tx(() => {
      this.policies.insert(seed('Signal', 'care_00022_signal', '전방 거리 단계(정상·주의·위험) 판정 신호 활성화'));
      this.policies.insert(seed('Parameter', 'care_00022_param', '위험 단계 감속 요청 파라미터 활성화'));
    });
  }

  list(q: { featureId?: string; status?: string; flagKey?: string } = {}) {
    return this.policies
      .all()
      .filter((p) => !q.featureId || p.featureId === q.featureId)
      .filter((p) => !q.status || p.status === q.status)
      .filter((p) => !q.flagKey || p.flagKey === q.flagKey);
  }

  require(id: string): Policy {
    const p = this.policies.get(id);
    if (!p) throw new DomainError('NOT_FOUND', `${id}을(를) 찾을 수 없습니다.`);
    return p;
  }

  detail(id: string, actor?: Actor) {
    const p = this.require(id);
    const runs = this.policies.runs(id);
    const last = p.lastValidationId ? this.policies.run(p.lastValidationId) : undefined;
    const hash = policyHash(p);
    const f = this.features.get(p.featureId, p.featureVersion);
    return {
      policy: p,
      feature: f ? { featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, asil: f.asil, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, controlPoints: f.controlPoints } : null,
      hashMatchesValidation: !!last && last.contentHash === hash,
      lastRun: last ?? null,
      runs,
      approval: this.safety.approvable(p, last, actor?.id ?? '', hash),
    };
  }

  create(actor: Actor, body: CreatePolicyBody): Policy {
    const f = this.features.get(body.featureId, body.featureVersion);
    if (!f) throw new DomainError('NOT_FOUND', `${body.featureId} ${body.featureVersion}이(가) Registry에 없습니다.`);
    if (LIFECYCLE_RANK[f.lifecycle] < LIFECYCLE_RANK.APPROVED || ['DEPRECATED', 'RETIRED'].includes(f.lifecycle))
      throw new DomainError('GUARD_FAILED', `${f.lifecycle} Feature에는 정책을 등록할 수 없습니다 (APPROVED~RELEASED).`);
    return this.db.tx(() => {
      const p: Policy = {
        ...body,
        policyId: this.policies.nextId(),
        revision: 1,
        status: 'DRAFT',
        contentHash: '',
        createdBy: actor.id,
        createdAt: this.clock.iso(),
        approvedBy: null,
        approvedAt: null,
        lastValidationId: null,
        stageBasisPoints: null,
      };
      p.contentHash = policyHash(p);
      this.policies.insert(p);
      this.audit.record(actor, 'POLICY_CREATE', p.policyId, { after: p, componentId: 'D01-06' });
      this.events.publish('policy.created', p.policyId, { policyId: p.policyId, flagKey: p.flagKey, featureId: p.featureId }, { componentId: 'D01-06', correlationId: actor.correlationId });
      return p;
    });
  }

  update(actor: Actor, id: string, body: UpdatePolicyBody): Policy {
    const p = this.require(id);
    if (!(EDITABLE as readonly string[]).includes(p.status)) {
      this.audit.failed(actor, 'POLICY_UPDATE', id, `${p.status} 정책 수정 시도`, 'D01-06');
      throw new DomainError('IMMUTABLE', `${p.status} 정책은 수정할 수 없습니다. 새 정책을 만들어 검증·승인을 다시 받으세요.`);
    }
    return this.db.tx(() => {
      const next: Policy = { ...p, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)), status: 'DRAFT', revision: p.revision + 1 } as Policy;
      next.contentHash = policyHash(next);
      this.policies.update(next);
      this.audit.record(actor, 'POLICY_UPDATE', id, { before: { revision: p.revision, contentHash: p.contentHash }, after: { revision: next.revision, contentHash: next.contentHash }, componentId: 'D01-06' });
      return next;
    });
  }

  /** PoC ② 분야별 검증 — 8종 병렬 → 검증 이력 → 배포 안전성 판정 */
  async validate(actor: Actor, id: string) {
    const p = this.require(id);
    if (!(EDITABLE as readonly string[]).includes(p.status)) throw new DomainError('CONFLICT', `${p.status} 정책은 다시 검증하지 않습니다.`);
    const results = await this.validation.run(p);
    const safety = this.safety.decide(results);
    return this.db.tx(() => {
      const run: ValidationRun = {
        runId: this.policies.nextRunId(),
        policyId: p.policyId,
        policyRevision: p.revision,
        contentHash: policyHash(p),
        decision: safety.decision,
        reasons: safety.reasons,
        at: this.clock.iso(),
        by: actor.id,
        results,
      };
      this.policies.insertRun(run);
      const next: Policy = { ...p, status: safety.decision === 'GO' ? 'VALIDATED' : 'DRAFT', lastValidationId: run.runId };
      this.policies.update(next);
      this.audit.record(actor, 'POLICY_VALIDATE', id, { after: { runId: run.runId, decision: run.decision }, reason: safety.reasons.join('; ') || undefined, componentId: 'D06-04' });
      this.events.publish('policy.validated', id, { runId: run.runId, decision: run.decision, results: results.map((r) => ({ componentId: r.componentId, result: r.result })) }, { componentId: 'D06-04', correlationId: actor.correlationId });
      return { policy: next, run };
    });
  }

  decide(actor: Actor, id: string, body: PolicyDecisionBody) {
    const p = this.require(id);
    const action = `POLICY_${body.decision}`;
    if (!(EDITABLE as readonly string[]).includes(p.status)) throw new DomainError('CONFLICT', `${p.status} 정책은 결정 대상이 아닙니다.`);
    if (body.decision === 'APPROVE') {
      const last = p.lastValidationId ? this.policies.run(p.lastValidationId) : undefined;
      const ok = this.safety.approvable(p, last, actor.id, policyHash(p));
      if (!ok.eligible) {
        this.audit.failed(actor, action, id, ok.reasons.join('; '), 'D03-02');
        throw new DomainError(ok.codes.includes('SELF_APPROVAL') ? 'SEPARATION_OF_DUTY' : 'GUARD_FAILED', `승인할 수 없습니다: ${ok.reasons.join(' / ')}`, { blockers: ok.reasons });
      }
    }
    return this.db.tx(() => {
      const next: Policy = body.decision === 'APPROVE' ? { ...p, status: 'APPROVED', approvedBy: actor.id, approvedAt: this.clock.iso() } : { ...p, status: 'REJECTED' };
      this.policies.update(next);
      this.audit.record(actor, action, id, { before: { status: p.status }, after: { status: next.status }, reason: body.reason, componentId: 'D01-06' });
      this.events.publish(body.decision === 'APPROVE' ? 'policy.approved' : 'policy.rejected', id, { policyId: id, featureId: p.featureId, controlPoint: p.controlPoint }, { componentId: 'D01-06', correlationId: actor.correlationId });
      // Control Point 정책 커버리지가 채워지면 Feature가 VERIFIED로 자동 전이할 수 있다
      const f = this.features.get(p.featureId, p.featureVersion);
      const feature = body.decision === 'APPROVE' && f ? this.lifecycle.autoAdvance(f, actor.correlationId) : f;
      return { policy: next, feature: feature ? { featureId: feature.featureId, version: feature.version, lifecycle: feature.lifecycle } : null };
    });
  }

  /** 서버 배포 — 이 flagKey의 평가 기준을 이 정책으로 바꾼다(이전 배포본은 RETIRED). 차량 전달(서명·OTA)은 보안 배포(P8). */
  deploy(actor: Actor, id: string, reason: string) {
    const p = this.require(id);
    if (p.status !== 'APPROVED') {
      this.audit.failed(actor, 'POLICY_DEPLOY', id, `${p.status} 정책 배포 시도`, 'D01-06');
      throw new DomainError('GUARD_FAILED', `승인된(APPROVED) 정책만 배포할 수 있습니다 (현재 ${p.status}).`);
    }
    if (p.contentHash !== policyHash(p)) throw new DomainError('GUARD_FAILED', '승인 이후 정책 내용이 바뀌었습니다 (해시 불일치).');
    return this.db.tx(() => {
      const prev = this.policies.deployed(p.flagKey);
      if (prev && prev.policyId !== p.policyId) {
        this.policies.update({ ...prev, status: 'RETIRED' });
        this.audit.record(actor, 'POLICY_RETIRE', prev.policyId, { before: { status: 'DEPLOYED' }, after: { status: 'RETIRED' }, reason: `${p.policyId}로 대체`, componentId: 'D01-06' });
      }
      const next: Policy = { ...p, status: 'DEPLOYED' };
      this.policies.update(next);
      this.audit.record(actor, 'POLICY_DEPLOY', id, { before: { status: 'APPROVED' }, after: { status: 'DEPLOYED', contentHash: p.contentHash }, reason, componentId: 'D01-06' });
      this.events.publish('policy.deployed', id, { policyId: id, flagKey: p.flagKey, contentHash: p.contentHash, replaced: prev?.policyId ?? null }, { componentId: 'D01-06', correlationId: actor.correlationId });
      return next;
    });
  }

  history(policyId?: string) {
    return this.validation.history(policyId);
  }
}
