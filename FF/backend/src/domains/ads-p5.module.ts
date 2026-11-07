// ADS 구성 마감(P5) — 발행 미리보기·캠페인 역조회(ADS-BE09·BE10·BE17), 출고 실물 구성 대조(ORC-UI08), OTA 설치 계약(ADS-OTA01), 수명주기 격리(ADS-LC01·LC02)
import { Module } from '@nestjs/common';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { DeliveryModule } from './delivery.module';
import { AdsPublishController } from './d06-qsec/secure-deploy/ads-publish.controller';
import { EolController, EolService } from './d05-ext/data-sync/eol.service';
import { OtaInstallController, OtaInstallService } from '../adapters/ota/ota-install.service';
import { SupportDrillController, SupportDrillService } from './d01-policy/registry/support-drill.service';

@Module({
  imports: [D01PolicyModule, DeliveryModule],
  controllers: [AdsPublishController, EolController, OtaInstallController, SupportDrillController],
  providers: [EolService, OtaInstallService, SupportDrillService],
  exports: [EolService, OtaInstallService],
})
export class AdsP5Module {}
