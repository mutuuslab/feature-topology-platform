// 초안 삭제 공용 서비스(F0, 결정 D2 (b)) — 판정은 @ff/contracts rules/draft-deletion. 도메인은 자기 사실(상태·승인 횟수·참조)과 행 삭제 함수를 넘긴다.
//  · 지울 수 있으면 한 트랜잭션에서: 도메인 행 삭제 → 묘비(deletion_tombstone, 마지막 모습·사유) → 감사 <대상>_DRAFT_DELETE → 이벤트 <대상>.draft.deleted
//  · 못 지우면 409 CONFLICT + 코드(DRAFT_NOT_DRAFT·DRAFT_HAS_APPROVAL·DRAFT_REFERENCED)·대안(폐기·미사용 표시)·참조 목록, 감사 FAILED
//  · ID 재사용 금지: 만들 때 assertIdFree, 일련번호는 nextId(남은 기록 + 묘비 중 최대 다음)
import { Inject, Injectable } from '@nestjs/common';
import { draftDeletion, draftDeletionAudit, draftDeletionEvent, nextSequentialId, tombstoneBlocker, type DeletionTombstone, type DraftFacts } from '@ff/contracts';
import type { Actor } from './actor';
import { AuditService } from './audit.service';
import { Clock } from './clock';
import { DB, type Db } from './db';
import { DomainError } from './errors';
import { EventService } from './event.service';

@Injectable()
export class DraftDeletionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  /** 그 대상의 묘비 ID 목록 */
  tombstones(entity: string): string[] {
    return this.db.all<{ record_id: string }>('SELECT record_id FROM deletion_tombstone WHERE entity = ? ORDER BY record_id', entity).map((r) => r.record_id);
  }

  /** 묘비 상세 — 최근 순 */
  list(entity?: string): DeletionTombstone[] {
    const rows = entity
      ? this.db.all<{ doc: string }>('SELECT doc FROM deletion_tombstone WHERE entity = ? ORDER BY deleted_at DESC, record_id', entity)
      : this.db.all<{ doc: string }>('SELECT doc FROM deletion_tombstone ORDER BY deleted_at DESC, entity, record_id');
    return rows.map((r) => JSON.parse(r.doc) as DeletionTombstone);
  }

  /** 지운 ID로 만들려 하면 409 */
  assertIdFree(entity: string, id: string): void {
    const why = tombstoneBlocker(id, this.db.get('SELECT 1 FROM deletion_tombstone WHERE entity = ? AND record_id = ?', entity, id) ? [id] : []);
    if (why) throw new DomainError('CONFLICT', why, { code: 'ID_TOMBSTONED', entity, id });
  }

  /** 다음 일련번호 ID — 남은 기록과 묘비 중 가장 큰 번호 다음 */
  nextId(entity: string, prefix: string, width: number, existing: readonly string[]): string {
    return nextSequentialId(prefix, width, existing, this.tombstones(entity));
  }

  /**
   * 초안 삭제 — 판정을 통과하면 remove()로 도메인 행을 지우고 묘비·감사·이벤트를 같은 트랜잭션에 남긴다.
   * entity는 kebab-case(감사·이벤트 이름이 여기서 나온다), snapshot은 묘비에 남길 마지막 모습
   */
  deleteDraft(actor: Actor, x: { entity: string; recordId: string; facts: DraftFacts; snapshot: unknown; reason: string; remove: () => void; componentId: string }): DeletionTombstone {
    const action = draftDeletionAudit(x.entity);
    const verdict = draftDeletion(x.facts);
    if (verdict.ok === false) {
      this.audit.failed(actor, action, x.recordId, verdict.message, x.componentId);
      throw new DomainError('CONFLICT', verdict.message, { code: verdict.code, alternative: verdict.alternative, references: verdict.references ?? [] });
    }
    const t: DeletionTombstone = { entity: x.entity, recordId: x.recordId, deletedBy: actor.id, deletedAt: this.clock.iso(), reason: x.reason };
    return this.db.tx(() => {
      x.remove();
      this.db.run('INSERT INTO deletion_tombstone (entity, record_id, deleted_by, deleted_at, reason, doc) VALUES (?, ?, ?, ?, ?, ?)', t.entity, t.recordId, t.deletedBy, t.deletedAt, t.reason, JSON.stringify({ ...t, snapshot: x.snapshot }));
      this.audit.record(actor, action, x.recordId, { before: x.snapshot, reason: x.reason, componentId: x.componentId });
      this.events.publish(draftDeletionEvent(x.entity), x.recordId, { entity: t.entity, recordId: t.recordId, by: t.deletedBy, reason: t.reason }, { componentId: x.componentId, correlationId: actor.correlationId });
      return t;
    });
  }
}
