import { Module } from '@nestjs/common';
import { D01PolicyModule } from './domains/d01-policy/d01-policy.module';
import { KernelModule } from './kernel/kernel.module';

// 도메인 모듈(d01-policy … d06-qsec)은 단계별로 추가한다 — PROGRESS.md 참고.
@Module({
  imports: [KernelModule, D01PolicyModule],
})
export class AppModule {}
