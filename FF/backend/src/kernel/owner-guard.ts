// Feature Owner 인가 가드(F0, D-GAP-1) — 역할 검사(RolesGuard) 다음, 서비스에서 그 기록의 소유자 본인인지 본다.
// 판정·문구는 @ff/contracts ownerOnlyBlocker. 막히면 감사 DENIED + 403. 뒤 묶음(정책·단계 정책·지원 조건·타겟·Variant·분류)이 쓴다.
import { ownerOnlyBlocker } from '@ff/contracts';
import type { Actor } from './actor';
import type { AuditService } from './audit.service';
import { DomainError } from './errors';

export function assertRecordOwner(audit: AuditService, actor: Actor, rec: { ownerId?: string | null }, x: { action: string; target: string; what?: string; componentId?: string }): void {
  const why = ownerOnlyBlocker(rec, actor.id, x.what);
  if (!why) return;
  audit.denied(actor, x.action, x.target, why, x.componentId);
  throw new DomainError('FORBIDDEN', why, { ownerId: rec.ownerId ?? null });
}
