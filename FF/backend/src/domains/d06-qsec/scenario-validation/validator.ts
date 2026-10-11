// D06-03 차량 시나리오 검증 — 데모 Fleet 평가
// 규칙은 @ff/contracts validateScenario 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다.
import { Injectable } from '@nestjs/common';
import { validateScenario, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';

@Injectable()
@PlatformComponent('D06-03')
export class ScenarioValidationService implements PolicyValidator {
  readonly componentId = 'D06-03';
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult {
    return validateScenario(input);
  }
}
