// 배포 안전성 검증 (D03-02) — 분야별 검증 결과를 보수적으로 종합(GO/HOLD/BLOCKED)하고,
// 승인·배포 직전 P0 publishCheck로 자기 승인·내용 변경(해시)·검증 미완을 막는다.
import { Injectable } from '@nestjs/common';
import { deploySafety, publishCheck, type Policy, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { ValidationRun } from '../../d01-policy/policy-repos';

@Injectable()
@PlatformComponent('D03-02')
export class DeploySafetyService {
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
    return { eligible: r.eligible, reasons: r.reasons.map((x) => KO[x] ?? x), codes: r.reasons };
  }
}
