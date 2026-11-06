// Flag 코드 연결·대사·통제 모듈(20-97) — 대사(FlagCoverageService)·저장소(FlagCodeStore)는 Lifecycle 출시 관문이 쓰므로 D01 모듈에 있고,
// 여기는 API·GitHub 어댑터·승인 시 계획/PR·시연 시드를 둔다.
import { Module } from '@nestjs/common';
import { TrustModule } from '../../d06-qsec/pki-kms/trust.module';
import { D01PolicyModule } from '../d01-policy.module';
import { RefdbRepository } from '../refdb/refdb.repository';
import { FlagCodeController } from './flag-code.controller';
import { FlagCodeSeeder } from './flag-code.seed';
import { FlagCodeService } from './flag-code.service';
import { GithubAdapter } from './github.adapter';

@Module({
  imports: [D01PolicyModule, TrustModule],
  controllers: [FlagCodeController],
  providers: [FlagCodeService, FlagCodeSeeder, GithubAdapter, RefdbRepository],
  exports: [FlagCodeService, GithubAdapter],
})
export class FlagCodeModule {}
