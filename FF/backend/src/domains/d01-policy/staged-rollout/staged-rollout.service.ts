// 단계적 기능 배포 (D01-08) — 승인 범위 안에서 코호트 단계 조정(해시·승인 유지).
// 보고서 v1.1 FFG-LCY-009: 효력을 넓히는 사람 ≠ 배포한 사람, F2 이상은 Canary(≤ 5%)에서 시작해 관측 기간(24 h)·중단 기준(열린 기능·보안
// 이상 징후, 진행 중 차단)을 판정한 뒤 넓힌다(contracts judgeStageChange). 판정은 감사·이벤트에 남는다.
import { Inject, Injectable } from '@nestjs/common';
import { cohortBucket, effectiveBasisPoints, evaluateFlag, exceptionActive, judgeStageChange, stopCriteriaCheck, type Entitlement, type ExceptionPolicy, type FlagResult, type Policy, type RolloutStageBody } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { BaselineRepo, FeatureRepo, ProductRepo } from '../repos';
import { GateDecisionService } from '../topology/gate-decision.service';
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
    private readonly decisions: GateDecisionService,
  ) {}

  /**
   * 배포된 정책의 단계 조정 — 승인 범위(rollout) 안에서만, 해시·승인은 그대로. 멈추기(0%)는 중단 기준 충족 여부를 기록만 하고 언제나 허용
   * @req FR-ROL-002-008
   */
  stage(actor: Actor, policyId: string, body: RolloutStageBody) {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}을(를) 찾을 수 없습니다.`);
    if (p.status !== 'DEPLOYED') throw new DomainError('GUARD_FAILED', `배포된 정책만 단계를 바꿀 수 있습니다 (현재 ${p.status}).`);
    const ceiling = effectiveBasisPoints({ ...p, stageBasisPoints: null });
    if (body.basisPoints > ceiling) {
      this.audit.failed(actor, 'ROLLOUT_STAGE', policyId, `승인 범위 ${ceiling / 100}% 초과 요청 ${body.basisPoints / 100}%`, 'D01-08');
      throw new DomainError('GUARD_FAILED', `승인된 배포 범위(${ceiling / 100}%)를 넘을 수 없습니다 — 정책을 새로 승인받으세요.`);
    }
    // GX — 예외(Gate PENDING·임시 우회)로 연 배포는 그 제한 범위(제한 배포·Pilot)를 넘겨 넓히지 않는다. 줄이기·멈추기는 그대로
    if (p.exceptionScope && body.basisPoints > p.exceptionScope.capBasisPoints) {
      const msg = `예외 ${p.exceptionScope.exceptionIds.join(', ')}의 제한 범위(${p.exceptionScope.capBasisPoints / 100}%)를 넘을 수 없습니다 — Gate를 통과하거나 예외가 끝난 뒤 넓히세요.`;
      this.audit.failed(actor, 'ROLLOUT_STAGE', policyId, msg, 'D01-08');
      throw new DomainError('GUARD_FAILED', msg, { exceptionScope: p.exceptionScope });
    }
    const current = effectiveBasisPoints(p);
    // 재개도 효력 확대다. 이전 배포의 cap만으로 만료·회수된 예외나 신뢰를 잃은 Gate를 다시 적용하지 않는다. 줄이기·멈추기는 항상 가능하다.
    if (body.basisPoints > current) {
      const unsigned = Object.entries(this.decisions.unsigned(p.featureId, p.featureVersion));
      if (unsigned.length) {
        const message = 'Gate 결정의 서명·무결성을 확인할 수 없습니다 — 판정 근거를 확인한 뒤 다시 넓히세요.';
        this.audit.failed(actor, 'ROLLOUT_STAGE', policyId, message, 'D01-08');
        throw new DomainError('GUARD_FAILED', message, { rule: 'FFG-LCY-001', blockers: unsigned.map(([ref, reason]) => ({ code: 'GATE_UNSIGNED', message: reason, ref })) });
      }
      if (p.exceptionScope) {
        const inactive = p.exceptionScope.exceptionIds.filter((id) => {
          const row = this.db.get<{ doc: string }>('SELECT doc FROM exception_policy WHERE exception_id = ?', id);
          const e = row ? JSON.parse(row.doc) as ExceptionPolicy : null;
          return !e || !exceptionActive(e, this.clock.iso()) || e.featureId !== p.featureId || e.featureVersion !== p.featureVersion || (e.policyId !== null && e.policyId !== p.policyId);
        });
        if (!p.exceptionScope.exceptionIds.length || inactive.length) {
          const message = '배포에 사용한 예외가 더 이상 유효하지 않습니다 — 유효한 근거로 다시 배포한 뒤 넓히세요.';
          this.audit.failed(actor, 'ROLLOUT_STAGE', policyId, message, 'D01-08');
          throw new DomainError('GUARD_FAILED', message, { code: 'EXCEPTION_INACTIVE', exceptionIds: inactive });
        }
      }
    }
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
    // 배포 중단(멈추기 0%) — 중단 기준 충족 여부를 확인해 기록·표시만 한다. 중단은 언제나 허용하고, 미충족 중단은 사유(필수 칸)를 남긴다
    const stop = body.basisPoints === 0 && current > 0 ? stopCriteriaCheck({ openAnomalies, activeKills, abort: (this.expansion.sources(p).canary?.breached ?? []).map((m) => `사전 등록 중단 기준 초과 ${m}`) }) : null;
    return this.db.tx(() => {
      const next: Policy = { ...p, stageBasisPoints: body.basisPoints, stagedAt: this.clock.iso() };
      this.policies.update(next);
      this.audit.record(actor, 'ROLLOUT_STAGE', policyId, { before: { stage: p.stageBasisPoints }, after: { stage: body.basisPoints, kind: j.kind, fClass, criteria: j.criteria, ...(stop ? { stopCriteria: { met: stop.met, reasons: stop.reasons } } : {}) }, reason: body.reason, componentId: 'D01-08' });
      this.events.publish('rollout.staged', policyId, { flagKey: p.flagKey, from: p.stageBasisPoints, to: body.basisPoints, kind: j.kind, criteria: j.criteria }, { componentId: 'D01-08', correlationId: actor.correlationId });
      return stop ? { ...next, stopCriteria: stop } : next;
    });
  }
}
