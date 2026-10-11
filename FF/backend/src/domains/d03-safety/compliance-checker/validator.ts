// D03-01 컴플라이언스 룰 체커 — 안전 등급·사용 권한 상품
// 규칙은 @ff/contracts validateCompliance 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다.
import { Injectable } from '@nestjs/common';
import { validateCompliance, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';

@Injectable()
@PlatformComponent('D03-01')
export class ComplianceCheckerService implements PolicyValidator {
  readonly componentId = 'D03-01';
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult {
    return validateCompliance(input);
  }
}
