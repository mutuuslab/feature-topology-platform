// 분류 계층 L0~L5·브랜드·적용 지역 코드 모듈(TX, B7 (b)) — Feature·정책·상품·Baseline 저장소는 D01에서, Feature DB 분류는 상태 없는 저장소를 여기서도 만든다(RefdbModule과 순환 없이)
import { Module } from '@nestjs/common';
import { D01PolicyModule } from '../d01-policy.module';
import { RefdbRepository } from '../refdb/refdb.repository';
import { GlobalScopeService } from './global-scope.service';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyRepo } from './taxonomy.repo';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [D01PolicyModule],
  controllers: [TaxonomyController],
  providers: [TaxonomyRepo, TaxonomyService, GlobalScopeService, RefdbRepository],
  exports: [TaxonomyService, GlobalScopeService],
})
export class TaxonomyModule {}
