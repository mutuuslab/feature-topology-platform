// D04-02 품질 기준 검증 — G5·TMS 증적(IF-09)
// 규칙은 @ff/contracts validateQuality 하나 — 화면 미리보기·백엔드 실행이 같은 결과를 낸다.
import { Injectable } from '@nestjs/common';
import { validateQuality, type ValidationInput, type ValidatorResult } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import type { PolicyValidator } from '../../d06-qsec/validation-history/validation.service';

@Injectable()
@PlatformComponent('D04-02')
export class QualityGateService implements PolicyValidator {
  readonly componentId = 'D04-02';
  check(input: ValidationInput): Promise<ValidatorResult> | ValidatorResult {
    return validateQuality(input);
  }
}
