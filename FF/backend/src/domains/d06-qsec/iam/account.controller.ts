// 계정 상태(D06-09, F0 D-GAP-1) — 목록은 누구나 조회, 비활성·재활성은 시스템 관리자만(사유). 상태 판정·기록은 kernel/account-directory.
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AccountStatusBody, SYSTEM_ADMIN_ROLES } from '@ff/contracts';
import { AccountDirectory } from '../../../kernel/account-directory';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { ZodPipe } from '../../../kernel/zod.pipe';

@Controller('api/accounts')
export class AccountController {
  constructor(private readonly accounts: AccountDirectory) {}

  @Get()
  list() {
    return { items: this.accounts.list() };
  }

  @Post(':id/deactivate')
  @Roles(...SYSTEM_ADMIN_ROLES)
  deactivate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(AccountStatusBody)) body: AccountStatusBody) {
    return this.accounts.deactivate(actor, id, body);
  }

  @Post(':id/reactivate')
  @Roles(...SYSTEM_ADMIN_ROLES)
  reactivate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(AccountStatusBody)) body: AccountStatusBody) {
    return this.accounts.reactivate(actor, id, body);
  }
}
