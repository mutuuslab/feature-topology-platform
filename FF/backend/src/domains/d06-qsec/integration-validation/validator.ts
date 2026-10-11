// D06-02 시스템 연동 검증 — Function→SW→ECU 기준정보 일치
// 규칙은 @ff/contracts validateIntegration 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다.
import { Injectable } from '@nestjs/common';
import { validateIntegration, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';

@Injectable()
@PlatformComponent('D06-02')
export class IntegrationValidationService implements PolicyValidator {
  readonly componentId = 'D06-02';
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult {
    return validateIntegration(input);
  }
}
