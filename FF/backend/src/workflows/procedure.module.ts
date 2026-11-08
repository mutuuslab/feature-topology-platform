// 업무 절차 실행 모듈 — 활동 완료 서버 저장·검토함·SLA. 서명은 HSM(TrustModule), 저장·감사·이벤트는 커널을 쓴다.
import { Module } from '@nestjs/common';
import { TrustModule } from '../domains/d06-qsec/pki-kms/trust.module';
import { ProcedureController, ProcedureService } from './procedure.service';
import { WorkflowExecutionController } from './workflow-execution.controller';
import { WorkflowExecutionService } from './workflow-execution.service';

@Module({
  imports: [TrustModule],
  controllers: [ProcedureController, WorkflowExecutionController],
  providers: [ProcedureService, WorkflowExecutionService],
  exports: [ProcedureService],
})
export class ProcedureModule {}
