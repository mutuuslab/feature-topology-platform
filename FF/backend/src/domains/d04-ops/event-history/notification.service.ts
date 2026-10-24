// 수신자 지정 알림 (D04-04 이벤트 이력 추적) — 플랫폼 이벤트가 기록되는 같은 트랜잭션에서 contracts 규칙표(NOTIFICATION_RULES)로
// 알림을 만들고 수신자 키·제외 계정을 저장한다. 채널은 화면(Web) 알림만 — 계정별 목록·읽음(사용자 결정 D-RD-7: 메일 없음).
// 끄는 설정이 없으므로 승인 요청·긴급(CRITICAL)을 포함한 모든 알림이 받는 사람 목록에 항상 남는다.
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import {
  accountKeys,
  accountOf,
  HUMAN_ROLES,
  NOTIFICATION_RULES,
  NotificationCategory,
  NotificationReadAllBody,
  recipientKey,
  type Notification,
  type NotificationContext,
  type NotificationCategory as Category,
} from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService, type PlatformEvent } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { KillRepo } from '../../d03-safety/kill-switch/kill.repo';
import { PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';

export interface InboxItem extends Notification {
  readAt: string | null;
}

@Injectable()
@PlatformComponent('D04-04')
export class NotificationService implements OnModuleInit {
  constructor(
    private readonly events: EventService,
    private readonly clock: Clock,
    private readonly features: FeatureRepo,
    private readonly policies: PolicyRepo,
    private readonly kills: KillRepo,
    @Inject(DB) private readonly db: Db,
  ) {}

  onModuleInit() {
    this.events.onPublish((ev) => this.fanout(ev));
  }

  /** 이벤트 → 알림(규칙이 있으면) — 이벤트와 같은 트랜잭션 */
  fanout(ev: PlatformEvent): Notification | null {
    const rule = NOTIFICATION_RULES[ev.type];
    if (!rule) return null;
    const draft = rule.build(this.context(ev, rule.needs));
    if (!draft) return null;
    const n: Notification = { ...draft, notificationId: this.nextId(), eventSeq: ev.seq, eventType: ev.type, aggregate: ev.aggregate, createdAt: ev.at };
    this.touched();
    this.db.run('INSERT INTO notification (notification_id, event_seq, category, severity, created_at, doc) VALUES (?, ?, ?, ?, ?, ?)', n.notificationId, n.eventSeq, n.category, n.severity, n.createdAt, JSON.stringify(n));
    for (const k of new Set(n.recipients.map(recipientKey))) this.db.run('INSERT INTO notification_recipient (notification_id, rkey) VALUES (?, ?)', n.notificationId, k);
    for (const u of new Set(n.exclude)) this.db.run('INSERT INTO notification_exclude (notification_id, user_id) VALUES (?, ?)', n.notificationId, u);
    return n;
  }

  private context(ev: PlatformEvent, needs: string[]): NotificationContext {
    const p = (ev.payload ?? {}) as Record<string, any>;
    const ctx: NotificationContext = { event: { seq: ev.seq, type: ev.type, at: ev.at, aggregate: ev.aggregate, payload: p } };
    let featureId: string | undefined = p.featureId;
    let version: string | undefined;
    if (needs.includes('policy')) {
      const pol = this.policies.get(p.policyId ?? ev.aggregate);
      ctx.policy = pol ? { policyId: pol.policyId, flagKey: pol.flagKey, controlPoint: pol.controlPoint, featureId: pol.featureId, featureVersion: pol.featureVersion, createdBy: pol.createdBy, approvedBy: pol.approvedBy, deployedBy: pol.deployedBy ?? null } : null;
      if (pol) [featureId, version] = [pol.featureId, pol.featureVersion];
    }
    if (needs.includes('kill')) {
      const k = this.kills.get(p.killId ?? ev.aggregate);
      ctx.kill = k
        ? {
            killId: k.killId,
            featureId: k.featureId,
            featureIds: k.featureIds,
            flagKeys: k.flagKeys,
            vins: k.vins,
            reason: k.reason,
            reasonCategory: k.reasonCategory,
            reasonCode: k.reasonCode,
            requestedBy: k.requestedBy,
            requestedAt: k.requestedAt,
            approvals: (k.approvals ?? []).map((a) => ({ approverId: a.approverId })),
            restoreRequest: k.restoreRequest ? { requestedBy: k.restoreRequest.requestedBy, requestedAt: k.restoreRequest.requestedAt, reason: k.restoreRequest.reason, approvals: k.restoreRequest.approvals.map((a) => ({ approverId: a.approverId })) } : null,
          }
        : null;
      if (k) [featureId, version] = [k.featureId, k.featureVersion];
    }
    if (needs.includes('feature')) {
      if (!featureId && ev.aggregate.includes('@')) [featureId, version] = ev.aggregate.split('@');
      const f = featureId ? (version ? this.features.get(featureId, version) : this.features.versions(featureId).at(-1)) : undefined;
      ctx.feature = f ? { featureId: f.featureId, version: f.version, name: f.name, ownerId: f.ownerId } : null;
    }
    return ctx;
  }

  private nextId() {
    // 추가만 하는 표(삭제·수정 트리거로 막힘)라 rowid 최댓값 = 행 수 — count(*)는 알림 수만큼 훑는다(이벤트마다 불림)
    const n = this.db.get<{ n: number | null }>('SELECT max(rowid) AS n FROM notification')!.n ?? 0;
    return `NTF-${String(n + 1).padStart(5, '0')}`;
  }

  /** 계정이 볼 수 있는 알림 조건(SQL) — 개인·역할·팀 수신자, 제외 계정은 뺀다 */
  private visibility(actor: Actor): { userId: string; where: string; inWhere: string; params: (string | number)[] } {
    const a = accountOf(actor.id, actor.role);
    const keys = accountKeys(a).filter((k) => k !== 'team:*');
    const anyTeam = a.teams === '*' ? 1 : 0;
    const where = `EXISTS (SELECT 1 FROM notification_recipient x WHERE x.notification_id = n.notification_id AND (x.rkey IN (${keys.map(() => '?').join(',')}) OR (? = 1 AND x.rkey LIKE 'team:%')))
      AND NOT EXISTS (SELECT 1 FROM notification_exclude e WHERE e.notification_id = n.notification_id AND e.user_id = ?)`;
    const inWhere = `n.notification_id IN (SELECT x.notification_id FROM notification_recipient x WHERE x.rkey IN (${keys.map(() => '?').join(',')}) OR (? = 1 AND x.rkey LIKE 'team:%'))
      AND NOT EXISTS (SELECT 1 FROM notification_exclude e WHERE e.notification_id = n.notification_id AND e.user_id = ?)`;
    return { userId: a.id, where, inWhere, params: [...keys, anyTeam, a.id] };
  }

  /** 계정이 받는 알림 — 개인·역할·팀 수신자, 제외 계정은 빼고, 최신 순.
   *  안 읽음 수·범주별 집계는 SQL로 세고, 본문(doc)은 돌려줄 limit건만 읽는다 — 전체를 읽어 JSON으로 풀면 알림 10만 건에서
   *  요청 하나가 이벤트 루프를 수 초 막았다(출시 준비 RD-P2-01 부하 시험, docs/20-architecture/20-92-performance.md) */
  inbox(actor: Actor, q: { unread?: boolean; category?: Category; limit?: number } = {}): { items: InboxItem[]; unread: number; byCategory: Record<string, number> } {
    const v = this.visibility(actor);
    const cat = q.category ? ' AND n.category = ?' : '';
    const catParams = q.category ? [q.category] : [];
    const unreadClause = 'NOT EXISTS (SELECT 1 FROM notification_read r WHERE r.notification_id = n.notification_id AND r.user_id = ?)';
    const { unread, byCategory } = this.unreadCounts(actor, v, q.category);
    const limit = Math.min(Math.max(Math.floor(q.limit ?? 100), 0), 500);
    const rows = this.db.all<{ doc: string; read_at: string | null }>(
      `SELECT n.doc, (SELECT r.at FROM notification_read r WHERE r.notification_id = n.notification_id AND r.user_id = ?) AS read_at
         FROM notification n WHERE ${v.where}${cat}${q.unread ? ` AND ${unreadClause}` : ''} ORDER BY n.event_seq DESC LIMIT ?`,
      v.userId,
      ...v.params,
      ...catParams,
      ...(q.unread ? [v.userId] : []),
      limit,
    );
    const items = rows.map((r) => ({ ...(JSON.parse(r.doc) as Notification), readAt: r.read_at }));
    return { items, unread, byCategory };
  }

  /** 안 읽음 수·범주별 집계 — 알림이 늘거나 읽음이 바뀔 때만 다시 센다(rev). 같은 계정·역할의 반복 조회(알림 종·화면)는 캐시에서.
   *  다시 셀 때는 수신자 색인에서 알림 ID를 먼저 고른다(IN). 그래도 볼 수 있는 알림 수에 비례한다 — 볼 수 있는 알림 5만 건이면
   *  한 번 세는 데 약 0.3 s(남은 한계, docs/20-architecture/20-92-performance.md). 트랜잭션 안에서는 캐시하지 않는다 */
  private rev = 0;
  private counts = new Map<string, { rev: number; unread: number; byCategory: Record<string, number> }>();
  private unreadCounts(actor: Actor, v: ReturnType<NotificationService['visibility']>, category?: Category): { unread: number; byCategory: Record<string, number> } {
    const key = `${v.userId}|${actor.role}|${category ?? ''}`;
    const hit = this.counts.get(key);
    if (hit?.rev === this.rev) return { unread: hit.unread, byCategory: { ...hit.byCategory } };
    const rows = this.db.all<{ category: string; k: number }>(
      `SELECT n.category AS category, count(*) AS k FROM notification n WHERE ${v.inWhere}${category ? ' AND n.category = ?' : ''}
         AND NOT EXISTS (SELECT 1 FROM notification_read r WHERE r.notification_id = n.notification_id AND r.user_id = ?) GROUP BY n.category ORDER BY n.category`,
      ...v.params,
      ...(category ? [category] : []),
      v.userId,
    );
    const byCategory: Record<string, number> = {};
    let unread = 0;
    for (const c of rows) {
      byCategory[c.category] = c.k;
      unread += c.k;
    }
    if (!this.db.inTransaction) {
      if (this.counts.size > 1000) this.counts.clear();
      this.counts.set(key, { rev: this.rev, unread, byCategory: { ...byCategory } });
    }
    return { unread, byCategory };
  }
  /** 알림·읽음이 바뀌었다 — 집계 캐시 무효화 */
  private touched() {
    this.rev++;
    this.counts.clear();
  }

  /** 계정이 볼 수 있는 알림 하나 — 없거나 받는 사람이 아니면 undefined */
  private visibleOne(actor: Actor, id: string): InboxItem | undefined {
    const v = this.visibility(actor);
    const r = this.db.get<{ doc: string; read_at: string | null }>(
      `SELECT n.doc, (SELECT r.at FROM notification_read r WHERE r.notification_id = n.notification_id AND r.user_id = ?) AS read_at FROM notification n WHERE n.notification_id = ? AND ${v.where}`,
      v.userId,
      id,
      ...v.params,
    );
    return r ? { ...(JSON.parse(r.doc) as Notification), readAt: r.read_at } : undefined;
  }

  read(actor: Actor, id: string) {
    const visible = this.visibleOne(actor, id);
    if (!visible) throw new DomainError('NOT_FOUND', `${id} 알림을 찾을 수 없습니다(받는 사람이 아닙니다).`);
    if (!visible.readAt) {
      this.touched();
      this.db.run('INSERT OR IGNORE INTO notification_read (notification_id, user_id, at) VALUES (?, ?, ?)', id, actor.id, this.clock.iso());
    }
    return { notificationId: id, readAt: visible.readAt ?? this.clock.iso() };
  }

  readAll(actor: Actor, category?: Category) {
    const unread = this.inbox(actor, { unread: true, category, limit: 500 }).items;
    const at = this.clock.iso();
    this.touched();
    this.db.tx(() => {
      for (const n of unread) this.db.run('INSERT OR IGNORE INTO notification_read (notification_id, user_id, at) VALUES (?, ?, ?)', n.notificationId, actor.id, at);
    });
    return { read: unread.length };
  }
}

@Controller('api/notifications')
export class NotificationController {
  constructor(private readonly n: NotificationService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query('unread') unread?: string, @Query('category') category?: string, @Query('limit') limit?: string) {
    const c = category ? NotificationCategory.safeParse(category) : null;
    if (c && !c.success) throw new DomainError('VALIDATION', `알 수 없는 알림 범주입니다: ${category}`);
    return this.n.inbox(actor, { unread: unread === '1' || unread === 'true', category: c?.data, limit: limit ? Number(limit) || 100 : 100 });
  }

  @Post('read-all')
  @Roles(...HUMAN_ROLES)
  readAll(@CurrentActor() actor: Actor, @Body(new ZodPipe(NotificationReadAllBody)) body: NotificationReadAllBody) {
    return this.n.readAll(actor, body.category);
  }

  @Post(':id/read')
  @Roles(...HUMAN_ROLES)
  read(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.n.read(actor, id);
  }
}

