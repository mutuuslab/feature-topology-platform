// 신뢰 기반 모듈 — 서명 키(PKI/KMS)와 소프트웨어 HSM(D06-10). Registry(안전 분류 확정 서명)·배포·차단이 함께 쓰므로
// 배포 모듈(DeliveryModule)과 정책 모듈(D01PolicyModule) 아래에 둔다(순환 의존 방지).
import { Module } from '@nestjs/common';
import { HsmController, HsmService } from './hsm.service';
import { PkiController, PkiService } from './pki.service';

@Module({
  controllers: [PkiController, HsmController],
  providers: [PkiService, HsmService],
  exports: [PkiService, HsmService],
})
export class TrustModule {}
