// D06-01 정책 검증 — 형식·제어점·충돌
// 규칙은 @ff/contracts validatePolicy 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다.
import { Injectable } from '@nestjs/common';
import { validatePolicy, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';

@Injectable()
@PlatformComponent('D06-01')
export class PolicyValidationService implements PolicyValidator {
  readonly componentId = 'D06-01';
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult {
    return validatePolicy(input);
  }
}
