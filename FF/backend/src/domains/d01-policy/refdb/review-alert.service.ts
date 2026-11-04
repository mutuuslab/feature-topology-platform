// Feature DB 출처 정기 점검 알림(30-95 §8.5, 엑셀 15_DB운영 5절) — ref_source.nextReviewAt이 지난 출처를 Feature DB 관리자 화면 알림으로(메일 없음, D-RD-7).
// 업무 절차 SLA 기한 초과(ProcedureService.sweep)와 같은 방식: 주기 타이머가 훑고, 시험은 sweep()을 직접 부른다(FF_SCHEDULER=manual이면 타이머 없음).
// 한 출처의 한 점검 주기(= 그 nextReviewAt 값)에 한 번만 — 이미 낸 알림 이벤트(같은 출처·같은 점검일)가 있으면 다시 내지 않는다.
// 출처를 다시 확인해 다음 점검일이 바뀌면 새 주기로 본다. 이벤트 이력(outbox)이 표시 역할을 하므로 따로 표를 두지 않는다.
// 점검 기록(record, POST /api/refdb/sources/reviews, DB 관리자)이 확인일·다음 점검일을 바꾼다 — 기한 목록(due)에서 빠지고 다음 주기 알림은 새 날짜로(업무 절차 FPW.14-A05).
import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { REFDB_REVIEW_DUE_EVENT, type RecordSourceReviewBody, type RefSource } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { RefdbRepository } from './refdb.repository';

const COMPONENT = 'D01-01';
const SYSTEM: Actor = { id: 'system:refdb-review', role: 'SYSTEM', correlationId: '' };
/** 하루 한 번이면 충분하지만 재시작·시계 차이를 감안해 한 시간마다 본다(이미 알린 주기는 다시 알리지 않는다) */
export const REVIEW_SWEEP_MS = 3_600_000;

export interface ReviewDue {
  sourceId: string;
  title: string;
  nextReviewAt: string;
}

@Injectable()
export class RefdbReviewAlertService implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: RefdbRepository,
    private readonly events: EventService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  onModuleInit() {
    if (process.env.FF_SCHEDULER === 'manual') return;
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch {
        // 한 주기의 실패가 서버를 죽이지 않게 — 다음 주기에 다시 본다
      }
    }, REVIEW_SWEEP_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 지금 기한이 지난 출처(알림 여부와 무관) — 다음 점검일 오름차순 */
  due(): ReviewDue[] {
    const today = this.clock.iso().slice(0, 10);
    return this.repo
      .sources()
      .filter((s) => !!s.nextReviewAt && s.nextReviewAt.slice(0, 10) <= today)
      .map((s) => ({ sourceId: s.sourceId, title: s.title, nextReviewAt: s.nextReviewAt! }))
      .sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt) || a.sourceId.localeCompare(b.sourceId));
  }

  private notified(sourceId: string, nextReviewAt: string): boolean {
    return this.events.list({ type: REFDB_REVIEW_DUE_EVENT, aggregate: sourceId, limit: 1000 }).some((e) => (e.payload as { nextReviewAt?: string })?.nextReviewAt === nextReviewAt);
  }

  /** 정기 점검 기록 — 고른 출처의 확인일(비우면 오늘)·다음 점검일을 바꾸고 출처마다 감사를 남긴다 */
  record(actor: Actor, body: RecordSourceReviewBody): { items: RefSource[] } {
    const today = this.clock.iso().slice(0, 10);
    const checkedAt = body.checkedAt ?? today;
    if (checkedAt > today) throw new DomainError('VALIDATION', `확인일(${checkedAt})은 오늘(${today}) 뒤일 수 없습니다.`, { field: 'checkedAt' });
    if (body.nextReviewAt <= checkedAt) throw new DomainError('VALIDATION', '다음 점검일은 확인일보다 뒤여야 합니다.', { field: 'nextReviewAt' });
    const byId = new Map(this.repo.sources().map((s) => [s.sourceId, s]));
    const unknown = body.sourceIds.filter((id) => !byId.has(id));
    if (unknown.length) throw new DomainError('NOT_FOUND', `출처 ${unknown.join(', ')}이(가) Feature DB 출처 표에 없습니다.`, { sourceIds: unknown });
    return this.db.tx(() => {
      const items = body.sourceIds.map((id) => {
        const before = byId.get(id)!;
        const next: RefSource = { ...before, checkedAt, nextReviewAt: body.nextReviewAt };
        this.repo.updateSource(next);
        this.audit.record(actor, 'REFDB_SOURCE_REVIEW', id, { before: { checkedAt: before.checkedAt, nextReviewAt: before.nextReviewAt }, after: { checkedAt, nextReviewAt: body.nextReviewAt }, reason: body.note, componentId: COMPONENT });
        this.events.publish('refdb.source.reviewed', id, { sourceId: id, checkedAt, nextReviewAt: body.nextReviewAt, by: actor.id }, { componentId: COMPONENT, correlationId: actor.correlationId });
        return next;
      });
      return { items };
    });
  }

  /** 기한 지난 출처를 훑어 아직 알리지 않은 주기만 알림 이벤트를 낸다 — 낸 수 */
  sweep(): number {
    let n = 0;
    const byId = new Map(this.repo.sources().map((s) => [s.sourceId, s]));
    for (const d of this.due()) {
      if (this.notified(d.sourceId, d.nextReviewAt)) continue;
      const s = byId.get(d.sourceId)!;
      this.db.tx(() => {
        this.events.publish(REFDB_REVIEW_DUE_EVENT, d.sourceId, { sourceId: d.sourceId, title: s.title, publisher: s.publisher, checkedAt: s.checkedAt, nextReviewAt: d.nextReviewAt }, { componentId: COMPONENT });
        this.audit.record(SYSTEM, 'REFDB_SOURCE_REVIEW_DUE', d.sourceId, { after: { nextReviewAt: d.nextReviewAt }, reason: `출처 정기 점검 기한 ${d.nextReviewAt} 지남`, componentId: COMPONENT });
      });
      n++;
    }
    return n;
  }
}
