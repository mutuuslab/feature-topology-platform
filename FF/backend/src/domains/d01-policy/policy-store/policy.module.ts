// 정책 저장·버전 관리(D01-06)와 PoC ③ 런타임 API — 검증 계열(D06)과 Registry(D01)를 함께 쓰므로 별도 모듈.
import { Module } from '@nestjs/common';
import { D06QsecModule } from '../../d06-qsec/d06-qsec.module';
import { DeliveryModule } from '../../delivery.module';
import { D01PolicyModule } from '../d01-policy.module';
import { PolicyController, RuntimeController } from './policy.controller';
import { PolicyService } from './policy.service';
import { UnleashGateway } from '../../../adapters/unleash/unleash.client';
import { UnleashController, UnleashSyncService } from './unleash-sync.service';

@Module({
  imports: [D01PolicyModule, D06QsecModule, DeliveryModule],
  controllers: [PolicyController, RuntimeController, UnleashController],
  providers: [PolicyService, UnleashGateway, UnleashSyncService],
})
export class PolicyModule {}
