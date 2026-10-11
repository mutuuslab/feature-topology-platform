// D06-05 변경 영향 검증 — 필요 Feature 성숙도·영향 상품
// 규칙은 @ff/contracts validateChangeImpact 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다.
import { Injectable } from '@nestjs/common';
import { validateChangeImpact, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';

@Injectable()
@PlatformComponent('D06-05')
export class ChangeImpactValidationService implements PolicyValidator {
  readonly componentId = 'D06-05';
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult {
    return validateChangeImpact(input);
  }
}
