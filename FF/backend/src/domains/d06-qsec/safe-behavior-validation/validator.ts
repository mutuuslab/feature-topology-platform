// D06-06 안전 동작 검증 — G4 Control Gate
// 규칙은 @ff/contracts validateSafeBehavior 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다.
import { Injectable } from '@nestjs/common';
import { validateSafeBehavior, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';

@Injectable()
@PlatformComponent('D06-06')
export class SafeBehaviorValidationService implements PolicyValidator {
  readonly componentId = 'D06-06';
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult {
    return validateSafeBehavior(input);
  }
}
