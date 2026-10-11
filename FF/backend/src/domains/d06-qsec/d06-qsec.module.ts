// 06·03·04 검증 계열 — 분야별 검증 8종(병렬)·검증 이력(D06-04)·배포 안전성(D03-02).
// 검증기는 각 컴포넌트 디렉터리에 있고, POLICY_VALIDATORS 토큰으로 묶어 ValidationService가 병렬 실행한다.
import { Module } from '@nestjs/common';
import { D01PolicyModule } from '../d01-policy/d01-policy.module';
import { ComplianceCheckerService } from '../d03-safety/compliance-checker/validator';
import { DeploySafetyService } from '../d03-safety/deploy-safety/deploy-safety.service';
import { QualityGateService } from '../d04-ops/quality-gate/validator';
import { ChangeImpactValidationService } from './change-impact-validation/validator';
import { IntegrationValidationService } from './integration-validation/validator';
import { PolicyValidationService } from './policy-validation/validator';
import { SafeBehaviorValidationService } from './safe-behavior-validation/validator';
import { SafetyReqTraceService } from './safety-req-trace/validator';
import { ScenarioValidationService } from './scenario-validation/validator';
import { POLICY_VALIDATORS, ValidationService } from './validation-history/validation.service';

const VALIDATORS = [
  PolicyValidationService,
  ComplianceCheckerService,
  ScenarioValidationService,
  SafeBehaviorValidationService,
  IntegrationValidationService,
  ChangeImpactValidationService,
  QualityGateService,
  SafetyReqTraceService,
];

@Module({
  imports: [D01PolicyModule],
  providers: [
    ...VALIDATORS,
    { provide: POLICY_VALIDATORS, useFactory: (...vs: unknown[]) => vs, inject: VALIDATORS },
    ValidationService,
    DeploySafetyService,
  ],
  exports: [ValidationService, DeploySafetyService],
})
export class D06QsecModule {}
