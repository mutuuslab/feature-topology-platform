// 수신자 지정 알림 (D04-04 이벤트 이력 추적) — 플랫폼 이벤트가 기록되는 같은 트랜잭션에서 contracts 규칙표(NOTIFICATION_RULES)로
// 알림을 만들고 수신자 키·제외 계정을 저장한다. Web 알림은 계정별 목록·읽음, 이메일은 계정 설정에 따라 모의 발송 기록(실 메일 서버 연동 없음).
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import {
  accountKeys,
  accountOf,
  DEFAULT_EMAIL,
  EMAIL_LOCKED,
  emailEnabled,
  HUMAN_ROLES,
  NOTIFICATION_ACCOUNTS,
  NOTIFICATION_RULES,
  NotificationCategory,
  NotificationPrefsBody,
  NotificationReadAllBody,
  receives,
  recipientKey,
  type Notification,
  type NotificationContext,
  type NotificationCategory as Category,
} from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
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
    private readonly audit: AuditService,
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
    this.db.run('INSERT INTO notification (notification_id, event_seq, category, severity, created_at, doc) VALUES (?, ?, ?, ?, ?, ?)', n.notificationId, n.eventSeq, n.category, n.severity, n.createdAt, JSON.stringify(n));
    for (const k of new Set(n.recipients.map(recipientKey))) this.db.run('INSERT INTO notification_recipient (notification_id, rkey) VALUES (?, ?)', n.notificationId, k);
    for (const u of new Set(n.exclude)) this.db.run('INSERT INTO notification_exclude (notification_id, user_id) VALUES (?, ?)', n.notificationId, u);
    // 이메일 — 디렉터리 계정 중 받는 사람, 계정 설정(승인 요청·긴급은 항상)
    for (const a of NOTIFICATION_ACCOUNTS) {
      if (!a.email || !receives(n, a) || !emailEnabled(n, this.prefsOf(a.id))) continue;
      this.db.run('INSERT INTO notification_email (notification_id, user_id, address, subject, status, at) VALUES (?, ?, ?, ?, ?, ?)', n.notificationId, a.id, a.email, `[FF] ${n.title}`, 'SENT', n.createdAt);
    }
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
    const n = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notification')!.n;
    return `NTF-${String(n + 1).padStart(5, '0')}`;
  }

  private prefsOf(userId: string): Partial<Record<Category, boolean>> | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM notification_pref WHERE user_id = ?', userId);
    return r ? JSON.parse(r.doc).email : null;
  }

  /** 계정이 받는 알림 — 개인·역할·팀 수신자, 제외 계정은 빼고, 최신 순 */
  inbox(actor: Actor, q: { unread?: boolean; category?: Category; limit?: number } = {}): { items: InboxItem[]; unread: number; byCategory: Record<string, number> } {
    const a = accountOf(actor.id, actor.role);
    const keys = accountKeys(a).filter((k) => k !== 'team:*');
    const anyTeam = a.teams === '*' ? 1 : 0;
    const visible = `EXISTS (SELECT 1 FROM notification_recipient x WHERE x.notification_id = n.notification_id AND (x.rkey IN (${keys.map(() => '?').join(',')}) OR (? = 1 AND x.rkey LIKE 'team:%')))
      AND NOT EXISTS (SELECT 1 FROM notification_exclude e WHERE e.notification_id = n.notification_id AND e.user_id = ?)`;
    const base = [...keys, anyTeam, a.id];
    const rows = this.db.all<{ doc: string; read_at: string | null }>(
      `SELECT n.doc, (SELECT r.at FROM notification_read r WHERE r.notification_id = n.notification_id AND r.user_id = ?) AS read_at
         FROM notification n WHERE ${visible}${q.category ? ' AND n.category = ?' : ''} ORDER BY n.event_seq DESC`,
      a.id,
      ...base,
      ...(q.category ? [q.category] : []),
    );
    const all = rows.map((r) => ({ ...(JSON.parse(r.doc) as Notification), readAt: r.read_at }));
    const unreadItems = all.filter((x) => !x.readAt);
    const byCategory: Record<string, number> = {};
    for (const x of unreadItems) byCategory[x.category] = (byCategory[x.category] ?? 0) + 1;
    const items = (q.unread ? unreadItems : all).slice(0, Math.min(q.limit ?? 100, 500));
    return { items, unread: unreadItems.length, byCategory };
  }

  read(actor: Actor, id: string) {
    const visible = this.inbox(actor, { limit: 500 }).items.find((x) => x.notificationId === id);
    if (!visible) throw new DomainError('NOT_FOUND', `${id} 알림을 찾을 수 없습니다(받는 사람이 아닙니다).`);
    if (!visible.readAt) this.db.run('INSERT OR IGNORE INTO notification_read (notification_id, user_id, at) VALUES (?, ?, ?)', id, actor.id, this.clock.iso());
    return { notificationId: id, readAt: visible.readAt ?? this.clock.iso() };
  }

  readAll(actor: Actor, category?: Category) {
    const unread = this.inbox(actor, { unread: true, category, limit: 500 }).items;
    const at = this.clock.iso();
    this.db.tx(() => {
      for (const n of unread) this.db.run('INSERT OR IGNORE INTO notification_read (notification_id, user_id, at) VALUES (?, ?, ?)', n.notificationId, actor.id, at);
    });
    return { read: unread.length };
  }

  preferences(actor: Actor) {
    const saved = this.prefsOf(actor.id);
    const email = Object.fromEntries(NotificationCategory.options.map((c) => [c, EMAIL_LOCKED.includes(c) ? true : (saved?.[c] ?? DEFAULT_EMAIL[c])])) as Record<Category, boolean>;
    return { userId: actor.id, email, locked: EMAIL_LOCKED, address: accountOf(actor.id).email || null };
  }

  savePreferences(actor: Actor, body: NotificationPrefsBody) {
    const locked = EMAIL_LOCKED.filter((c) => body.email[c] === false);
    if (locked.length) throw new DomainError('VALIDATION', `승인 요청·긴급 차단 알림 메일은 끌 수 없습니다: ${locked.join(', ')}`);
    const before = this.preferences(actor).email;
    const email = { ...before, ...body.email };
    this.db.tx(() => {
      this.db.run('INSERT INTO notification_pref (user_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at', actor.id, JSON.stringify({ email }), this.clock.iso());
      this.audit.record(actor, 'NOTIFICATION_PREFS', actor.id, { before: { email: before }, after: { email }, componentId: 'D04-04' });
    });
    return this.preferences(actor);
  }

  /** 이메일 발송 기록 — 자기 것만(감사 조회자는 전체) */
  emails(actor: Actor, limit = 100) {
    const all = actor.role === 'AUDITOR';
    const rows = this.db.all<any>(`SELECT * FROM notification_email ${all ? '' : 'WHERE user_id = ?'} ORDER BY id DESC LIMIT ${Math.min(limit, 500)}`, ...(all ? [] : [actor.id]));
    return { items: rows.map((r) => ({ id: r.id, notificationId: r.notification_id, userId: r.user_id, address: r.address, subject: r.subject, status: r.status, at: r.at })) };
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

  @Get('preferences')
  preferences(@CurrentActor() actor: Actor) {
    return this.n.preferences(actor);
  }

  @Post('preferences')
  @Roles(...HUMAN_ROLES)
  savePreferences(@CurrentActor() actor: Actor, @Body(new ZodPipe(NotificationPrefsBody)) body: NotificationPrefsBody) {
    return this.n.savePreferences(actor, body);
  }

  @Get('emails')
  emails(@CurrentActor() actor: Actor, @Query('limit') limit?: string) {
    return this.n.emails(actor, limit ? Number(limit) || 100 : 100);
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

