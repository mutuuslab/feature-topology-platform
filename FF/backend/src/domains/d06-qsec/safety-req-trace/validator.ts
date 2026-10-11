// D06-07 안전 요구사항 추적 — 요구사항·G2·G7
// 규칙은 @ff/contracts validateSafetyTrace 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다.
import { Injectable } from '@nestjs/common';
import { validateSafetyTrace, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';

@Injectable()
@PlatformComponent('D06-07')
export class SafetyReqTraceService implements PolicyValidator {
  readonly componentId = 'D06-07';
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult {
    return validateSafetyTrace(input);
  }
}
