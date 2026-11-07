// 확대 판정(D01-08, 통합 D-INT-4) — Canary 관측(Lake 규칙 ①, TL-UI02·B01·B02), 축별 근거(ADS-BE12), 단계 기준(FFG-LCY-009 — 관측 기간·열린 이상 징후·진행 중 차단)을
// contracts judgeExpansion 하나로 판정한다. 단계 조정 거부(staged-rollout.service)와 정책 상세 '확대 판정' 패널(GET /api/policies/:id/expansion)이 같은 근거·같은 규칙을 읽는다.
import { Controller, Get, Inject, Injectable, Param } from '@nestjs/common';
import { CANARY_MAX_BP, CANARY_OBSERVE_MS, effectiveBasisPoints, judgeExpansion, stageCriteriaApply, type ExpansionSources, type FClass, type Policy, type PolicyExpansionView } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { KillRepo } from '../../d03-safety/kill-switch/kill.repo';
import { PolicyRepo } from '../policy-repos';
import { SafetyProfileService } from '../registry/safety-profile.service';
import { AdsExpansionService } from './ads-expansion.service';
import { CanaryService } from './canary.service';

/** 단계 기준의 사실 — 안전 분류·지금 범위가 시작된 시각·중단 기준(열린 기능·보안 이상 징후, 진행 중 차단) */
export interface StageFacts {
  fClass: FClass | null;
  since: string;
  openAnomalies: string[];
  activeKills: string[];
}

@Injectable()
@PlatformComponent('D01-08')
export class PolicyExpansionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly policies: PolicyRepo,
    private readonly profiles: SafetyProfileService,
    private readonly kills: KillRepo,
    private readonly canary: CanaryService,
    private readonly ads: AdsExpansionService,
  ) {}

  /** 단계 기준 사실 — 이 Feature의 열린 기능·보안 이상 징후(D06-12)와 진행 중 차단(D03-03) */
  stageFacts(p: Policy): StageFacts {
    const fClass = this.profiles.list(p.featureId).find((x) => x.version === p.featureVersion)?.fClass ?? null;
    const openAnomalies = this.db
      .all<{ anomaly_id: string }>("SELECT anomaly_id FROM anomaly WHERE feature_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED') AND kind IN ('FEATURE_FAULT', 'SECURITY', 'FIELD_SOTIF') ORDER BY anomaly_id", p.featureId)
      .map((r) => r.anomaly_id);
    const activeKills = this.kills.active().filter((k) => k.featureId === p.featureId).map((k) => k.killId);
    return { fClass, since: p.stagedAt ?? p.deployedAt ?? p.approvedAt ?? p.createdAt, openAnomalies, activeKills };
  }

  /** 확대 판정 근거 — Canary 관측과 축별 근거. 모델 점수는 넣지 않는다(INV-17) */
  private read(p: Policy) {
    const canary = this.canary.observe(p);
    const evidence = this.ads.evidence(p);
    const lagMinutes = canary?.freshness.lagSeconds == null ? null : Math.round(canary.freshness.lagSeconds / 60);
    const sources: ExpansionSources = {
      canary: canary && { verdict: canary.verdict, lagMinutes, breached: canary.breached, registered: canary.criteria.registered },
      evidence: evidence && { result: evidence.result, metrics: evidence.metrics, frozen: evidence.frozen, assumed: evidence.assumed },
    };
    return { canary, evidence, sources };
  }

  /** 단계 조정 판정 입력 — judgeStageChange가 단계 기준을 붙여 같은 규칙(judgeExpansion)으로 판정한다 */
  sources(p: Policy): ExpansionSources {
    return this.read(p).sources;
  }

  view(policyId: string): PolicyExpansionView {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}을(를) 찾을 수 없습니다.`);
    const { canary, evidence, sources } = this.read(p);
    const f = this.stageFacts(p);
    const current = effectiveBasisPoints(p);
    const ceiling = effectiveBasisPoints({ ...p, stageBasisPoints: null });
    const observedMs = Math.max(0, this.clock.now().getTime() - new Date(f.since).getTime());
    // 다음 확대가 Canary 범위를 넘을 수 있을 때 단계 기준을 본다 — 단계 조정 거부와 같은 기준
    const stage = { fClass: f.fClass, current, beyondCanary: ceiling > CANARY_MAX_BP && current < ceiling, observedMs, openAnomalies: f.openAnomalies, activeKills: f.activeKills };
    return {
      policyId,
      featureId: p.featureId,
      featureVersion: p.featureVersion,
      decision: judgeExpansion({ ...sources, stage }),
      canary,
      evidence,
      stage: { fClass: f.fClass, current, ceiling, applies: stageCriteriaApply(stage), observedMs, requiredMs: CANARY_OBSERVE_MS, openAnomalies: f.openAnomalies, activeKills: f.activeKills },
    };
  }
}

@Controller('api/policies')
export class PolicyExpansionController {
  constructor(private readonly svc: PolicyExpansionService) {}

  @Get(':id/expansion')
  view(@Param('id') id: string) {
    return this.svc.view(id);
  }
}
