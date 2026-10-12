import { Module } from '@nestjs/common';
import { D01PolicyModule } from './domains/d01-policy/d01-policy.module';
import { PolicyModule } from './domains/d01-policy/policy-store/policy.module';
import { D04OpsModule } from './domains/d04-ops/d04-ops.module';
import { D05ExtModule } from './domains/d05-ext/d05-ext.module';
import { D06QsecModule } from './domains/d06-qsec/d06-qsec.module';
import { DeliveryModule } from './domains/delivery.module';
import { OpsLoopModule } from './domains/ops-loop.module';
import { KernelModule } from './kernel/kernel.module';

// 도메인 모듈(d01-policy … d06-qsec)은 단계별로 추가한다 — PROGRESS.md 참고.
@Module({
  imports: [KernelModule, D01PolicyModule, D06QsecModule, PolicyModule, DeliveryModule, OpsLoopModule, D04OpsModule, D05ExtModule],
})
export class AppModule {}
