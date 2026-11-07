// 단계적 기능 배포 (D01-08) — 승인 범위 안에서 코호트 단계 조정(해시·승인 유지).
// 보고서 v1.1 FFG-LCY-009: 효력을 넓히는 사람 ≠ 배포한 사람, F2 이상은 Canary(≤ 5%)에서 시작해 관측 기간(24 h)·중단 기준(열린 기능·보안
// 이상 징후, 진행 중 차단)을 판정한 뒤 넓힌다(contracts judgeStageChange). 판정은 감사·이벤트에 남는다.
import { Inject, Injectable } from '@nestjs/common';
import { cohortBucket, effectiveBasisPoints, evaluateFlag, judgeStageChange, type Entitlement, type FlagResult, type Policy, type RolloutStageBody } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { BaselineRepo, FeatureRepo, ProductRepo } from '../repos';
import { PolicyExpansionService } from './expansion.service';


@Injectable()
@PlatformComponent('D01-08')
export class StagedRolloutService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
    private readonly expansion: PolicyExpansionService,
  ) {}

  /** 배포된 정책의 단계 조정 — 승인 범위(rollout) 안에서만, 해시·승인은 그대로 */
  stage(actor: Actor, policyId: string, body: RolloutStageBody) {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}을(를) 찾을 수 없습니다.`);
    if (p.status !== 'DEPLOYED') throw new DomainError('GUARD_FAILED', `배포된 정책만 단계를 바꿀 수 있습니다 (현재 ${p.status}).`);
    const ceiling = effectiveBasisPoints({ ...p, stageBasisPoints: null });
    if (body.basisPoints > ceiling) {
      this.audit.failed(actor, 'ROLLOUT_STAGE', policyId, `승인 범위 ${ceiling / 100}% 초과 요청 ${body.basisPoints / 100}%`, 'D01-08');
      throw new DomainError('GUARD_FAILED', `승인된 배포 범위(${ceiling / 100}%)를 넘을 수 없습니다 — 정책을 새로 승인받으세요.`);
    }
    const current = effectiveBasisPoints(p);
    // 단계 기준 사실(안전 분류·관측 시작·열린 이상 징후·진행 중 차단)과 확대 판정 근거(Canary 신선도·사전 등록 중단 기준, 축별 근거) — 정책 상세 패널과 같은 사실·
    // 같은 규칙(judgeExpansion, 통합 D-INT-4). 근거는 넓힐 때만 읽는다. 모델 점수는 넣지 않는다(INV-17)
    const { fClass, since, openAnomalies, activeKills } = this.expansion.stageFacts(p);
    const expansion = body.basisPoints > current ? this.expansion.sources(p) : null;
    const j = judgeStageChange({ fClass, current, to: body.basisPoints, since, now: this.clock.iso(), actorId: actor.id, deployedBy: p.deployedBy ?? null, openAnomalies, activeKills, expansion });
    if (!j.ok) {
      const msg = j.blockers.map((b) => b.message).join('; ');
      this.audit.failed(actor, 'ROLLOUT_STAGE', policyId, msg, 'D01-08');
      // 중단 기준 충족(열린 이상 징후·진행 중 차단, 사전 등록 중단 기준 초과) = 배포 중단 필요 — 판정 이벤트로 Owner·배포 요청자에게 알린다(FR-DSV-003-005).
      // 지표 지연(STALE_DATA)은 판단 보류라 넓히기만 막고 중단 알림은 보내지 않는다
      const stop = j.blockers.filter((b) => b.code === 'STOP_CRITERIA' || b.code === 'ABORT_CRITERIA');
      if (stop.length)
        this.db.tx(() => this.events.publish('rollout.halt-required', policyId, { policyId, flagKey: p.flagKey, featureId: p.featureId, current, to: body.basisPoints, reasons: stop.map((b) => b.message), openAnomalies, activeKills, requestedBy: actor.id }, { componentId: 'D01-08', correlationId: actor.correlationId }));
      throw new DomainError(j.blockers.some((b) => b.code === 'SAME_AS_DEPLOYER') ? 'SEPARATION_OF_DUTY' : 'GUARD_FAILED', `단계를 넓힐 수 없습니다: ${msg}`, { judgement: j });
    }
    return this.db.tx(() => {
      const next: Policy = { ...p, stageBasisPoints: body.basisPoints, stagedAt: this.clock.iso() };
      this.policies.update(next);
      this.audit.record(actor, 'ROLLOUT_STAGE', policyId, { before: { stage: p.stageBasisPoints }, after: { stage: body.basisPoints, kind: j.kind, fClass, criteria: j.criteria }, reason: body.reason, componentId: 'D01-08' });
      this.events.publish('rollout.staged', policyId, { flagKey: p.flagKey, from: p.stageBasisPoints, to: body.basisPoints, kind: j.kind, criteria: j.criteria }, { componentId: 'D01-08', correlationId: actor.correlationId });
      return next;
    });
  }
}
