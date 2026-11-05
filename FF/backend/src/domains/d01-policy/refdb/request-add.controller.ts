// Feature DB 추가 요청 API(contracts ROUTES requestRefAdd, 30-95 §6.4) — 등록 화면 "Feature DB에 없음 → 요청".
// 응답의 ref(요청 중 행)를 바로 대표로 연결해 Feature를 등록할 수 있다.
import { Body, Controller, Post } from '@nestjs/common';
import { RequestRefAddBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { RefdbRequestAddService } from './request-add.service';

@Controller('api/refdb')
export class RefdbRequestAddController {
  constructor(private readonly svc: RefdbRequestAddService) {}

  @Post('requests')
  @Roles('FEATURE_AUTHOR', 'REFDB_ADMIN')
  @AuditAction('REFDB_ADD_REQUEST')
  requestAdd(@CurrentActor() actor: Actor, @Body(new ZodPipe(RequestRefAddBody)) body: RequestRefAddBody) {
    return this.svc.requestAdd(actor, body);
  }
}
