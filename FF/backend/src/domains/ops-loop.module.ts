// 운영 되먹임 모듈 (PoC ⑥ → ①) — 이상 징후 대응(D06-12) → 긴급 차단 → 품질 피드백(D04-06) → 새 Version 재검증.
// 다른 모듈과는 이벤트로만 묶인다(차량 보고·회신·차단·Gate 판정 이벤트를 구독) — 서비스 의존 순환이 없다.
import { Module } from '@nestjs/common';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { FeedbackController, FeedbackService } from './d04-ops/quality-feedback/feedback.service';
import { AnomalyController, AnomalyRepo, AnomalyService } from './d06-qsec/anomaly-response/anomaly.service';
import { PublicationRepo } from './d06-qsec/secure-deploy/publication.repo';

@Module({
  imports: [D01PolicyModule],
  controllers: [AnomalyController, FeedbackController],
  providers: [AnomalyRepo, AnomalyService, FeedbackService, PublicationRepo],
  exports: [AnomalyService, FeedbackService],
})
export class OpsLoopModule {}
