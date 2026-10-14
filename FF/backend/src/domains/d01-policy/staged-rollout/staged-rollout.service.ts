// 단계적 기능 배포 (D01-08) — 승인 범위 안에서 코호트 단계 조정(해시·승인 유지).
// 보고서 v1.1 FFG-LCY-009: 효력을 넓히는 사람 ≠ 배포한 사람, F2 이상은 Canary(≤ 5%)에서 시작해 관측 기간(24 h)·중단 기준(열린 기능·보안
// 이상 징후, 진행 중 차단)을 판정한 뒤 넓힌다(contracts judgeStageChange). 판정은 감사·이벤트에 남는다.
import { Inject, Injectable } from '@nestjs/common';
import { cohortBucket, effectiveBasisPoints, evaluateFlag, judgeStageChange, type Entitlement, type FlagResult, type Policy, type RolloutStageBody } from '@ff/contracts';
import { SafetyProfileService } from '../registry/safety-profile.service';
import { KillRepo } from '../../d03-safety/kill-switch/kill.repo';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { BaselineRepo, FeatureRepo, ProductRepo } from '../repos';


@Injectable()
@PlatformComponent('D01-08')
export class StagedRolloutService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
    private readonly profiles: SafetyProfileService,
    private readonly kills: KillRepo,
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
    const fClass = this.profiles.list(p.featureId).find((x) => x.version === p.featureVersion)?.fClass ?? null;
    // 중단 기준 — 이 Feature의 열린 기능·보안 이상 징후(D06-12)와 진행 중 차단(D03-03)
    const openAnomalies = this.db
      .all<{ anomaly_id: string }>("SELECT anomaly_id FROM anomaly WHERE feature_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED') AND kind IN ('FEATURE_FAULT', 'SECURITY', 'FIELD_SOTIF') ORDER BY anomaly_id", p.featureId)
      .map((r) => r.anomaly_id);
    const activeKills = this.kills.active().filter((k) => k.featureId === p.featureId).map((k) => k.killId);
    const since = p.stagedAt ?? p.deployedAt ?? p.approvedAt ?? p.createdAt;
    const j = judgeStageChange({ fClass, current, to: body.basisPoints, since, now: this.clock.iso(), actorId: actor.id, deployedBy: p.deployedBy ?? null, openAnomalies, activeKills });
    if (!j.ok) {
      const msg = j.blockers.map((b) => b.message).join('; ');
      this.audit.failed(actor, 'ROLLOUT_STAGE', policyId, msg, 'D01-08');
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
