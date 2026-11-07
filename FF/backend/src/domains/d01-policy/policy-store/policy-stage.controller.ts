// 정책 생애주기 값 대응표·단계별 조회(P10, D01-06 · FR-PVER-003-001) — 명세 단계값(Draft·Review·Approved·Deployed·Monitored)에서 골라 정책을 찾는다.
import { Controller, Get, Query } from '@nestjs/common';
import { POLICY_SPEC_STAGE_LABEL, POLICY_SPEC_STAGE_STATUSES, POLICY_SPEC_STAGES, policySpecStage, type PolicySpecStage } from '@ff/contracts';
import { DomainError } from '../../../kernel/errors';
import { PolicyRepo } from '../policy-repos';

@Controller('api/policy-stages')
export class PolicyStageController {
  constructor(private readonly policies: PolicyRepo) {}

  @Get()
  list(@Query('stage') stage?: string, @Query('featureId') featureId?: string) {
    if (stage && !(POLICY_SPEC_STAGES as readonly string[]).includes(stage)) throw new DomainError('VALIDATION', `알 수 없는 정책 생애주기 값입니다: ${stage} (${POLICY_SPEC_STAGES.join('·')})`, { field: 'stage' });
    const all = this.policies.all().filter((p) => !featureId || p.featureId === featureId).map((p) => ({ policyId: p.policyId, flagKey: p.flagKey, featureId: p.featureId, featureVersion: p.featureVersion, status: p.status, stage: policySpecStage(p) }));
    return {
      stages: POLICY_SPEC_STAGES.map((s) => ({ stage: s, label: POLICY_SPEC_STAGE_LABEL[s], statuses: POLICY_SPEC_STAGE_STATUSES[s], count: all.filter((p) => p.stage === s).length })),
      stage: (stage as PolicySpecStage | undefined) ?? null,
      items: stage ? all.filter((p) => p.stage === stage) : all,
    };
  }
}
