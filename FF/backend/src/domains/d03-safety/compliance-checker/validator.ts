// D03-01 컴플라이언스 룰 체커 — 안전 등급·사용 권한 상품(플랫폼 기본 규칙) + 등록 룰(레지스트리, FR-CRC-002)
// 규칙은 @ff/contracts validateCompliance 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다. 룰 목록·대상 지역·CAL·시각은 레지스트리가 채운다.
import { Injectable } from '@nestjs/common';
import { validateCompliance, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';
import { ComplianceRuleService } from './compliance-rule.service';

@Injectable()
@PlatformComponent('D03-01')
export class ComplianceCheckerService implements PolicyValidator {
  readonly componentId = 'D03-01';
  constructor(private readonly rules: ComplianceRuleService) {}

  /** at — 판정 시점(배포 시점 재판정은 배포 요청 시각). 승인·유효 기간 안의 룰만 판정에 넣는다 */
  check(input: ValidationInput, at?: string): Promise<ValidatorResult> | ValidatorResult {
    return validateCompliance({ ...input, compliance: this.rules.registryFor(input.feature, at) });
  }
}
