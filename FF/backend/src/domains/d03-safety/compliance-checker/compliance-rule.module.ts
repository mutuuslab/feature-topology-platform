// 컴플라이언스 룰 레지스트리(D03-01) — 서비스·컨트롤러·데모 시드. 검증 계열(D06)이 이 모듈을 가져와 배포 검증에 쓴다
import { Module } from '@nestjs/common';
import { D01PolicyModule } from '../../d01-policy/d01-policy.module';
import { ComplianceRuleController, ComplianceRuleService, ComplianceValidationController } from './compliance-rule.service';
import { ComplianceRuleSeeder } from './compliance-rule.seed';

@Module({
  imports: [D01PolicyModule],
  controllers: [ComplianceRuleController, ComplianceValidationController],
  providers: [ComplianceRuleService, ComplianceRuleSeeder],
  exports: [ComplianceRuleService],
})
export class ComplianceRuleModule {}
