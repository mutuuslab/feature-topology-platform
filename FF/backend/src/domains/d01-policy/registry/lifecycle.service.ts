// Feature Lifecycle 전이 — 규칙은 contracts(rules/lifecycle)의 표, 여기서는 실행·원자성·감사만 맡는다.
// 상세설계서: 상태 전이와 Audit은 한 트랜잭션 / 실패한 승인도 기록 / RELEASED는 읽기 전용, 역전이 대신 새 Version.
import { Inject, Injectable } from '@nestjs/common';
import {
  autoTransition,
  evaluateTransition,
  nextTransitions,
  ROLE_LABEL,
  type Blocker,
  type FeatureVersionRow,
  type GateStatus,
  type Lifecycle,
  type TransitionContext,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { PolicyRepo } from '../policy-repos';
import { BaselineRepo, FeatureRepo, GateRepo, TopologyRepo } from '../repos';
import { GateDecisionService } from '../topology/gate-decision.service';
import { ReharaRepo } from '../topology/rehara.repo';
import { TopologyService } from '../topology/topology.service';
import { ReleaseSignoffService } from './release-signoff.service';

export const SYSTEM_ACTOR = (correlationId: string): Actor => ({ id: 'system:registry', role: 'SYSTEM', correlationId });

export interface TransitionOption {
  to: Lifecycle;
  ko: string;
  auto: boolean;
  roles: string[];
  blockers: Blocker[];
}

@Injectable()
@PlatformComponent('D01-01')
export class LifecycleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly topology: TopologyRepo,
    private readonly baselines: BaselineRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly topologyService: TopologyService,
    private readonly policies: PolicyRepo,
    private readonly decisions: GateDecisionService,
    private readonly signoffs: ReleaseSignoffService,
    private readonly rehara: ReharaRepo,
  ) {}

  require(featureId: string, version: string): FeatureVersionRow {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    return f;
  }

  context(f: FeatureVersionRow, extra: Partial<TransitionContext> = {}): TransitionContext {
    const latest = this.gates.latest(f.featureId, f.version);
    const latestGates = Object.fromEntries(Object.entries(latest).map(([g, r]) => [g, r!.status])) as Partial<Record<string, GateStatus>>;
    return {
      latestGates,
      // FFG-LCY-001 — 서명된 Decision Record가 없는 Gate PASS는 전이 근거가 아니다
      unsignedGates: this.decisions.unsigned(f.featureId, f.version),
      dependencies: this.topology.outgoing(f.featureId, f.version),
      // Control Point 중 승인·배포 정책이 있는 수 (정책 저장소 D01-06)
      policyCoverage: this.policies.coverage(f.featureId, f.version),
      createdBy: this.features.meta(f.featureId, f.version).createdBy,
      // 보고서 6.1 G7 — Feature Owner의 Release Sign-off(현재 G8·G9 판정에 묶인 유효 서명만)
      releaseSignoff: f.lifecycle === 'VERIFIED' ? this.signoffs.current(f.featureId, f.version) : null,
      // FFP-F007 — 열린 재-HARA 요청은 출시 전이를 막는다(Gate PASS 뒤에 열린 것도)
      openRehara: this.rehara.open(f.featureId, f.version).map((r) => ({ requestId: r.requestId, condition: r.condition, detail: r.detail })),
      ...extra,
    };
  }

  /** 현재 상태에서 가능한 전이와 각각의 막힌 사유 (화면의 스테퍼·버튼 상태) */
  options(f: FeatureVersionRow, actor?: Actor): TransitionOption[] {
    return nextTransitions(f.lifecycle).map((r) => ({
      to: r.to,
      ko: r.ko,
      auto: r.auto,
      roles: r.roles.map((x) => ROLE_LABEL[x]),
      blockers: evaluateTransition(f, r.to, this.context(f, actor && !r.auto ? { actor, reason: 'preview' } : {})).blockers,
    }));
  }

  /** 사람이 실행하는 전이 */
  transition(actor: Actor, featureId: string, version: string, to: Lifecycle, reason: string): FeatureVersionRow {
    const f = this.require(featureId, version);
    const { rule, blockers } = evaluateTransition(f, to, this.context(f, { actor, reason }));
    const action = `FEATURE_TRANSITION ${f.lifecycle}→${to}`;
    const target = `${featureId}@${version}`;
    if (rule?.auto && actor.role !== 'SYSTEM') {
      this.audit.failed(actor, action, target, '자동 전이는 직접 실행할 수 없습니다', 'D01-01');
      throw new DomainError('CONFLICT', `${rule.ko}은(는) 조건이 갖춰지면 시스템이 자동으로 전이합니다.`, { blockers });
    }
    if (blockers.length) {
      const reasonText = blockers.map((b) => b.message).join('; ');
      this.audit.failed(actor, action, target, reasonText, 'D01-01');
      const code = blockers.some((b) => b.code === 'SEPARATION_OF_DUTY') ? 'SEPARATION_OF_DUTY' : blockers.some((b) => b.code === 'ROLE') ? 'FORBIDDEN' : 'GUARD_FAILED';
      throw new DomainError(code, `전이할 수 없습니다: ${reasonText}`, { blockers });
    }
    return this.db.tx(() => {
      const next = this.apply(actor, f, to, reason);
      return this.autoAdvance(next, actor.correlationId);
    });
  }

  /** 자동 전이를 조건이 허락하는 만큼 연쇄 적용한다. 반드시 tx 안에서 호출. */
  autoAdvance(f: FeatureVersionRow, correlationId: string): FeatureVersionRow {
    let cur = f;
    for (let i = 0; i < 4; i++) {
      const rule = autoTransition(cur, this.context(cur));
      if (!rule) break;
      cur = this.apply(SYSTEM_ACTOR(correlationId), cur, rule.to, `자동 전이: ${rule.ko}`);
    }
    return cur;
  }

  private apply(actor: Actor, f: FeatureVersionRow, to: Lifecycle, reason: string): FeatureVersionRow {
    const next: FeatureVersionRow = { ...f, lifecycle: to };
    this.features.update(next);
    // Baseline은 Lifecycle을 제외하고 불변 — Lifecycle만 따라간다.
    if (f.baselineId) {
      const bl = this.baselines.get(f.baselineId);
      if (bl) this.baselines.setLifecycle(bl.baselineId, { ...bl.snapshot, lifecycle: to });
    }
    // 원천 Lifecycle이 바뀌면 관계 판정이 달라질 수 있다 (예: 승인되면 미판정 → PASS)
    this.topologyService.rejudgeOutgoing(next, actor.correlationId);
    const target = `${f.featureId}@${f.version}`;
    this.audit.record(actor, `FEATURE_TRANSITION ${f.lifecycle}→${to}`, target, { before: { lifecycle: f.lifecycle }, after: { lifecycle: to }, reason, componentId: 'D01-01' });
    this.events.publish(
      'feature.lifecycle.changed',
      target,
      { featureId: f.featureId, version: f.version, from: f.lifecycle, to, by: actor.id, auto: actor.role === 'SYSTEM', reason },
      { componentId: 'D01-01', correlationId: actor.correlationId },
    );
    return next;
  }
}
