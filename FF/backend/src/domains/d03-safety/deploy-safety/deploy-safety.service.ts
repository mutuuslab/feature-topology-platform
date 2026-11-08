// 배포 안전성 검증 (D03-02) — 분야별 검증 결과를 보수적으로 종합(GO/HOLD/BLOCKED)하고,
// 승인·배포 직전 P0 publishCheck로 자기 승인·내용 변경(해시)·검증 미완을 막는다.
import { Injectable } from '@nestjs/common';
import { complianceMarketOf, deploySafety, publishCheck, type Policy, type ValidatorResult } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import type { ValidationRun } from '../../d01-policy/policy-repos';
import { ValidationService } from '../../d06-qsec/validation-history/validation.service';
import { ComplianceRuleService } from '../compliance-checker/compliance-rule.service';
import { ComplianceCheckerService } from '../compliance-checker/validator';

@Injectable()
@PlatformComponent('D03-02')
export class DeploySafetyService {
  constructor(
    private readonly validation: ValidationService,
    private readonly compliance: ComplianceCheckerService,
    private readonly rules: ComplianceRuleService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * 배포 시점 컴플라이언스 재판정 — 승인된 정책이라도 배포 시각 기준으로 승인·유효 기간 안의 룰을 다시 판정한다(만료 룰은 빠지고,
   * 승인 뒤 새로 적용되는 룰도 본다). 미충족이면 차단 사유(룰 ID·항목)를 기록하고 막는다. 결과는 통과·차단 모두 검증 결과에 남는다.
   * @req FR-CRC-001-018, FR-CRC-002-003, FR-CRC-002-005, FR-CRC-002-007
   */
  complianceAtDeploy(actor: Actor, policy: Policy): DomainError | null {
    const input = this.validation.input(policy);
    const result = this.compliance.check(input, this.clock.iso()) as ValidatorResult;
    const view = this.rules.recordDeployCheck(actor, policy, complianceMarketOf(input.feature.country), result);
    if (result.result !== 'FAIL') return null;
    const msg = view.unmet.map((u) => u.message).join(' · ');
    this.audit.failed(actor, 'POLICY_DEPLOY', policy.policyId, `컴플라이언스 룰 미충족 — ${msg}`, 'D03-01');
    return new DomainError('GUARD_FAILED', `배포 시점 컴플라이언스 룰을 충족하지 않습니다 — 새 정책으로 다시 검증·승인하세요: ${msg}`, { findings: view.unmet, checkId: view.checkId });
  }

  /** Same registry facts as complianceAtDeploy, without recording a check or changing a decision. */
  exceptionSources(policy: Policy) {
    return this.rules.registryFor(this.validation.input(policy).feature, this.clock.iso());
  }

  decide(results: ValidatorResult[]) {
    return deploySafety(results);
  }

  /** 승인 적격성 — 마지막 검증이 GO이고, 검증한 내용과 지금 내용이 같으며, 승인자가 작성자가 아니어야 한다 */
  approvable(policy: Policy, run: ValidationRun | undefined, approver: string, currentHash: string) {
    const r = publishCheck({
      allowedRole: true,
      author: policy.createdBy,
      approver,
      candidateHash: currentHash,
      approvedHash: run?.contentHash ?? '',
      sourceRevision: policy.revision,
      approvedSourceRevision: run?.policyRevision ?? -1,
      qualityPassed: run?.decision === 'GO',
      authorizationValid: true,
      supported: true,
      maintenance: false,
      sequence: policy.revision,
      highestSequence: policy.revision - 1,
    });
    const KO: Record<string, string> = {
      SELF_APPROVAL: '정책 작성자는 승인할 수 없습니다',
      HASH_MISMATCH: '검증 이후 정책 내용이 바뀌었습니다 — 다시 검증하세요',
      SOURCE_DRIFT: '검증한 정책 개정본과 다릅니다 — 다시 검증하세요',
      APPROVAL_INCOMPLETE: `배포 안전성 판정이 GO가 아닙니다 (${run?.decision ?? '검증 안 함'})`,
    };
    // 사유는 사실 하나씩(담당자 웨이브 P2-6) — 검증한 적이 없으면 "검증하지 않았다" 한 문장(내용이 바뀌었다·개정본이 다르다는 틀린 말을 붙이지 않는다),
    // 검증 뒤 내용·개정본이 바뀌었으면 "다시 검증" 한 문장(그때의 판정 결과는 더 이상 근거가 아니다)
    const stale = r.reasons.some((x) => x === 'HASH_MISMATCH' || x === 'SOURCE_DRIFT');
    const facts = [
      ...(r.reasons.includes('SELF_APPROVAL') ? [KO.SELF_APPROVAL] : []),
      ...(!run ? ['아직 배포 안전성 검증을 하지 않았습니다 — 먼저 분야별 검증을 실행하세요'] : stale ? [KO.HASH_MISMATCH] : r.reasons.includes('APPROVAL_INCOMPLETE') ? [KO.APPROVAL_INCOMPLETE] : []),
      ...r.reasons.filter((x) => !KO[x]),
    ];
    return { eligible: r.eligible, reasons: facts, codes: r.reasons };
  }
}
