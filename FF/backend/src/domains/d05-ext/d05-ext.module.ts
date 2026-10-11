// 05. 시스템 연계·확장 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { D01PolicyModule } from '../d01-policy/d01-policy.module';
import { OfrepController, OfrepService } from './api-gateway/ofrep.controller';

@Module({
  imports: [D01PolicyModule],
  controllers: [OfrepController],
  providers: [OfrepService],
})
export class D05ExtModule {}
