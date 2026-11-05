// Feature DB 모듈(D01-01 확장, docs/30-data-model/30-95) — 기준 기능 정보 읽기·변경 요청·시드.
// 저장소는 내보낸다: Feature 등록(연결 색인 갱신·연결 필수)과 수명주기(연결 행 상태로 승인 막음)가 같이 쓴다.
import { Module } from '@nestjs/common';
import { RefdbChangeController } from './refdb-change.controller';
import { RefdbChangeService } from './refdb-change.service';
import { RefdbExportService } from './export-refdb.service';
import { RefdbReadController } from './refdb-read.controller';
import { RefdbReadService } from './refdb-read.service';
import { RefdbRepository } from './refdb.repository';
import { RefdbSeed } from './refdb-seed';
import { RefdbRequestAddController } from './request-add.controller';
import { RefdbRequestAddService } from './request-add.service';
import { RefdbReviewAlertService } from './review-alert.service';

@Module({
  // 추가 요청(POST /api/refdb/requests)은 등록 담당 컨트롤러(request-add) — 변경 요청 컨트롤러보다 먼저 등록한다
  controllers: [RefdbReadController, RefdbRequestAddController, RefdbChangeController],
  providers: [RefdbRepository, RefdbReadService, RefdbChangeService, RefdbSeed, RefdbRequestAddService, RefdbExportService, RefdbReviewAlertService],
  exports: [RefdbRepository],
})
export class RefdbModule {}
