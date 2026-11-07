// Legacy 연계 설정(D05-03, FR-LGCY-001-001~005) — 기존 운영 시스템마다 한 건(시스템 코드 유일). 등록·수정하면 설정에서 데이터 브리지를 구성하고
// (contracts legacyBridge — 유형·방향·IF·규칙 묶음·주기), 활성 배치·파일 브리지는 주기마다(또는 수동으로) 해외공장 주문을 가져와 변환한다.
// 활성 연계는 지우지 않는다(422). 변환 규칙 등록·수정(FR-LGCY-001-006)과 Legacy↔SDV 메시지 받기(D05-07, FR-SDVI-001-002)도 여기서 받는다.
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, OnApplicationBootstrap, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateLegacyLinkBody,
  CreateLegacyRuleBody,
  DeleteLegacyLinkBody,
  LEGACY_BRIDGE_RUNNERS,
  LEGACY_LINK_EDITORS,
  LEGACY_MESSAGE_FORMATS,
  LEGACY_RULE_EDITORS,
  legacyBridge,
  legacyLinkProblems,
  LegacyMessageBody,
  legacyRunDue,
  legacyToSdv,
  RunLegacyBridgeBody,
  UpdateLegacyLinkBody,
  UpdateLegacyRuleBody,
  type LegacyLinkConfig,
  type LegacyLinkView,
  type LegacyMessageLogView,
  type LegacyRule,
} from '@ff/contracts';
import { z } from 'zod';
import { ExternalSystems } from '../../../adapters/if-mocks/external-systems';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { singleQuery } from '../../../kernel/paging';
import { Scheduler } from '../../../kernel/scheduler';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../../d01-policy/repos';
import { appendLegacyMessage, legacyMessages } from '../legacy-sdv/legacy-message-log';
import { LegacyService } from './legacy.service';
import { effectiveLegacyRules } from './legacy-rules';

/** 주기 실행을 맡는 시스템 행위자 */
const BRIDGE_ACTOR = (correlationId: string): Actor => ({ id: 'system:legacy-bridge', role: 'SYSTEM', correlationId });
const HOUR_MS = 3_600_000;

const configOf = (l: LegacyLinkView): LegacyLinkConfig => ({ system: l.system, name: l.name, kind: l.kind, endpoint: l.endpoint, bridgeType: l.bridgeType, schedule: l.schedule, plant: l.plant, status: l.status, note: l.note });

@Injectable()
@PlatformComponent('D05-03')
export class LegacyLinkService implements OnApplicationBootstrap {
  private readonly log = new Logger('LegacyBridge');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly legacy: LegacyService,
  ) {}

  /** 매시 주기 점검 — 시험(FF_SCHEDULER=manual)은 runDue()를 직접 부른다 */
  onApplicationBootstrap() {
    if (this.scheduler.manual) return;
    const tick = () => {
      try {
        const ran = this.runDue();
        if (ran.length) this.log.log(`주기 브리지 실행 ${ran.join(', ')}`);
      } catch (e) {
        this.log.error(`주기 브리지 점검 실패: ${(e as Error).message}`);
      }
      this.scheduler.after(HOUR_MS, tick);
    };
    this.scheduler.after(60_000, tick);
  }

  /**
   * 설정 목록 — 등록 순. 없으면 빈 목록
   * @req FR-LGCY-001-002
   */
  list(): LegacyLinkView[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM legacy_link ORDER BY link_id').map((r) => JSON.parse(r.doc));
  }

  private get(linkId: string): LegacyLinkView {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM legacy_link WHERE link_id = ?', linkId);
    if (!r) throw new DomainError('NOT_FOUND', `연계 설정 ${linkId}을(를) 찾을 수 없습니다.`);
    return JSON.parse(r.doc);
  }

  private check(c: LegacyLinkConfig) {
    const problems = legacyLinkProblems(c);
    if (problems.length) throw new DomainError('VALIDATION', `연계 설정을 저장할 수 없습니다 — ${problems.join(' · ')}`, { problems });
  }

  private save(l: LegacyLinkView) {
    this.db.run('UPDATE legacy_link SET status = ?, doc = ? WHERE link_id = ?', l.status, JSON.stringify(l), l.linkId);
  }

  /**
   * 등록 — 같은 시스템이면 저장하지 않고 409. 설정에서 브리지를 구성한다
   * @req FR-LGCY-001-001, FR-LGCY-001-005
   */
  create(actor: Actor, body: CreateLegacyLinkBody): LegacyLinkView {
    const c: LegacyLinkConfig = { system: body.system, name: body.name, kind: body.kind, endpoint: body.endpoint, bridgeType: body.bridgeType, schedule: body.schedule, plant: body.plant, status: body.status, note: body.note };
    this.check(c);
    return this.db.tx(() => {
      const dup = this.db.get<{ link_id: string }>('SELECT link_id FROM legacy_link WHERE system = ?', c.system);
      if (dup) throw new DomainError('CONFLICT', `${c.system} 시스템의 연계 설정이 이미 있습니다(${dup.link_id}). 기존 설정을 수정하세요.`, { linkId: dup.link_id });
      const n = (this.db.get<{ n: number | null }>('SELECT max(CAST(substr(link_id, 5) AS INTEGER)) AS n FROM legacy_link')?.n ?? 0) + 1;
      const now = this.clock.iso();
      const l: LegacyLinkView = { linkId: `LNK-${String(n).padStart(4, '0')}`, ...c, version: 1, bridge: legacyBridge(c), createdBy: actor.id, createdAt: now, updatedBy: actor.id, updatedAt: now, lastRun: null };
      this.db.run('INSERT INTO legacy_link (link_id, system, status, doc) VALUES (?, ?, ?, ?)', l.linkId, l.system, l.status, JSON.stringify(l));
      this.audit.record(actor, 'LEGACY_LINK_CREATE', l.linkId, { after: c, componentId: 'D05-03' });
      this.events.publish('legacy.link.created', l.linkId, { linkId: l.linkId, system: l.system, bridge: l.bridge, status: l.status }, { componentId: 'D05-03', correlationId: actor.correlationId });
      return l;
    });
  }

  /**
   * 수정 — 바뀐 항목만, 브리지를 다시 구성하고 버전을 올린다. 없는 설정 404
   * @req FR-LGCY-001-003, FR-LGCY-001-005
   */
  update(actor: Actor, linkId: string, body: UpdateLegacyLinkBody): LegacyLinkView {
    return this.db.tx(() => {
      const cur = this.get(linkId);
      const { reason, ...patch } = body;
      const next: LegacyLinkConfig = { ...configOf(cur), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      this.check(next);
      const changed = (Object.keys(next) as (keyof LegacyLinkConfig)[]).filter((k) => next[k] !== configOf(cur)[k]);
      if (!changed.length) throw new DomainError('VALIDATION', '바뀐 항목이 없습니다.');
      const l: LegacyLinkView = { ...cur, ...next, version: cur.version + 1, bridge: legacyBridge(next), updatedBy: actor.id, updatedAt: this.clock.iso() };
      this.save(l);
      const pick = (o: LegacyLinkConfig) => Object.fromEntries(changed.map((k) => [k, o[k]]));
      this.audit.record(actor, 'LEGACY_LINK_UPDATE', linkId, { before: pick(configOf(cur)), after: pick(next), reason, componentId: 'D05-03' });
      this.events.publish('legacy.link.updated', linkId, { linkId, system: l.system, changed, version: l.version, status: l.status }, { componentId: 'D05-03', correlationId: actor.correlationId });
      return l;
    });
  }

  /**
   * 삭제 — 활성 연계는 거부(422), 비활성만 지운다
   * @req FR-LGCY-001-004
   */
  remove(actor: Actor, linkId: string, reason: string) {
    const cur = this.get(linkId);
    if (cur.status === 'ACTIVE') {
      const msg = `활성 상태인 연계 설정은 삭제할 수 없습니다(${cur.system}). 먼저 연계를 중지(비활성)한 뒤 삭제하세요.`;
      this.audit.failed(actor, 'LEGACY_LINK_DELETE', linkId, msg, 'D05-03');
      throw new DomainError('GUARD_FAILED', msg, { linkId, status: cur.status });
    }
    return this.db.tx(() => {
      this.db.run('DELETE FROM legacy_link WHERE link_id = ?', linkId);
      this.audit.record(actor, 'LEGACY_LINK_DELETE', linkId, { before: configOf(cur), reason, componentId: 'D05-03' });
      this.events.publish('legacy.link.deleted', linkId, { linkId, system: cur.system }, { componentId: 'D05-03', correlationId: actor.correlationId });
      return { linkId, deleted: true as const };
    });
  }

  /**
   * 브리지 실행 — 활성 배치·파일 브리지(해외공장 ERP): IF-12 주문 가져오기 → 변환 규칙 해석. 결과·실패를 최근 실행에 남긴다
   * @req FR-LGCY-001-005
   */
  run(actor: Actor, linkId: string): LegacyLinkView {
    const cur = this.get(linkId);
    if (cur.bridge.type === 'REALTIME') throw new DomainError('GUARD_FAILED', `${cur.system}은(는) 실시간 브리지입니다 — 상대 시스템이 메시지를 보낼 때 변환합니다(POST /api/legacy-sdv/messages).`);
    if (cur.status !== 'ACTIVE') throw new DomainError('GUARD_FAILED', `${cur.system} 연계가 비활성입니다 — 활성으로 바꾼 뒤 실행하세요.`);
    const at = this.clock.iso();
    try {
      const r = this.legacy.importOrders(actor, cur.plant!);
      const l: LegacyLinkView = { ...cur, lastRun: { at, status: 'SUCCEEDED', orders: r.orders.length, unresolved: r.unresolved, reason: null, by: actor.id } };
      this.db.tx(() => {
        this.save(l);
        this.audit.record(actor, 'LEGACY_BRIDGE_RUN', linkId, { after: { bridgeId: cur.bridge.bridgeId, orders: r.orders.length, unresolved: r.unresolved }, componentId: 'D05-03' });
      });
      return l;
    } catch (err) {
      // 실패 — 가져오기가 오류 이력(연계 오류)을 남겼다. 설정의 최근 실행에 사유·시각을 남긴다(가져온 것은 없다)
      const reason = (err as Error).message;
      this.db.tx(() => this.save({ ...cur, lastRun: { at, status: 'FAILED', orders: 0, unresolved: [], reason, by: actor.id } }));
      this.audit.failed(actor, 'LEGACY_BRIDGE_RUN', linkId, reason, 'D05-03');
      throw err;
    }
  }

  /** 주기가 된 활성 배치·파일 브리지를 돌린다 — 실행한 설정 ID(실패도 포함) */
  runDue(): string[] {
    const now = this.clock.iso();
    const due = this.list().filter((l) => legacyRunDue(l, now));
    for (const l of due) {
      try {
        this.run(BRIDGE_ACTOR(`legacy-bridge-${l.linkId}-${now}`), l.linkId);
      } catch {
        // 실패는 최근 실행·오류 이력에 남았다 — 다음 설정을 계속
      }
    }
    return due.map((l) => l.linkId);
  }

  /** 받은 메시지를 보낼 수 있는 활성 실시간 연계 */
  activeRealtime(system: string): LegacyLinkView | undefined {
    return this.list().find((l) => l.system === system && l.status === 'ACTIVE' && l.bridge.type === 'REALTIME');
  }
}

@Injectable()
@PlatformComponent('D05-03')
export class LegacyRuleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly ext: ExternalSystems,
    private readonly features: FeatureRepo,
  ) {}

  private needFeature(featureId: string) {
    if (!this.features.versions(featureId).length) throw new DomainError('VALIDATION', `${featureId}은(는) 등록된 Feature가 아닙니다.`, { featureId });
  }

  private put(r: LegacyRule) {
    this.db.run('INSERT INTO legacy_transform_rule (legacy_code, system, feature_id, doc) VALUES (?, ?, ?, ?) ON CONFLICT(legacy_code) DO UPDATE SET system = excluded.system, feature_id = excluded.feature_id, doc = excluded.doc', r.legacyCode, r.system, r.featureId, JSON.stringify(r));
  }

  /**
   * 규칙 등록 — 같은 코드(기본·등록)는 409, 대상 Feature 실재
   * @req FR-LGCY-001-006
   */
  create(actor: Actor, body: CreateLegacyRuleBody): LegacyRule {
    this.needFeature(body.featureId);
    return this.db.tx(() => {
      if (effectiveLegacyRules(this.db, this.ext.legacyMappings()).some((m) => m.legacyCode === body.legacyCode))
        throw new DomainError('CONFLICT', `${body.legacyCode} 변환 규칙이 이미 있습니다 — 수정하세요.`, { legacyCode: body.legacyCode });
      const r: LegacyRule = { legacyCode: body.legacyCode, system: body.system, description: body.description, featureId: body.featureId, note: body.note, source: 'REGISTERED', version: 1, updatedBy: actor.id, updatedAt: this.clock.iso() };
      this.put(r);
      this.audit.record(actor, 'LEGACY_RULE_CREATE', r.legacyCode, { after: { system: r.system, featureId: r.featureId, description: r.description, note: r.note }, reason: body.reason, componentId: 'D05-03' });
      this.events.publish('legacy.rule.changed', r.legacyCode, { legacyCode: r.legacyCode, featureId: r.featureId, version: r.version }, { componentId: 'D05-03', correlationId: actor.correlationId });
      return r;
    });
  }

  /**
   * 규칙 수정 — 기본 규칙은 같은 코드의 등록 규칙으로 덮어쓴다. 없는 코드 404
   * @req FR-LGCY-001-006
   */
  update(actor: Actor, code: string, body: UpdateLegacyRuleBody): LegacyRule {
    if (body.featureId) this.needFeature(body.featureId);
    return this.db.tx(() => {
      const cur = effectiveLegacyRules(this.db, this.ext.legacyMappings()).find((m) => m.legacyCode === code);
      if (!cur) throw new DomainError('NOT_FOUND', `${code} 변환 규칙을 찾을 수 없습니다.`);
      const next: LegacyRule = {
        ...cur,
        description: body.description ?? cur.description,
        featureId: body.featureId ?? cur.featureId,
        note: body.note === undefined ? cur.note : body.note,
        source: 'REGISTERED',
        version: cur.version + 1,
        updatedBy: actor.id,
        updatedAt: this.clock.iso(),
      };
      const keys = (['description', 'featureId', 'note'] as const).filter((k) => next[k] !== cur[k]);
      if (!keys.length) throw new DomainError('VALIDATION', '바뀐 항목이 없습니다.');
      this.put(next);
      const pick = (o: LegacyRule) => Object.fromEntries(keys.map((k) => [k, o[k]]));
      this.audit.record(actor, 'LEGACY_RULE_UPDATE', code, { before: { ...pick(cur), source: cur.source, version: cur.version }, after: { ...pick(next), version: next.version }, reason: body.reason, componentId: 'D05-03' });
      this.events.publish('legacy.rule.changed', code, { legacyCode: code, featureId: next.featureId, version: next.version }, { componentId: 'D05-03', correlationId: actor.correlationId });
      return next;
    });
  }
}

@Injectable()
@PlatformComponent('D05-07')
export class LegacyMessageService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly ext: ExternalSystems,
    private readonly features: FeatureRepo,
    private readonly links: LegacyLinkService,
  ) {}

  /**
   * 레거시 메시지 받기 → SDV 형식 변환. 보낸 시스템은 활성 실시간 연계여야 한다. 실패도 사유·시각을 기록하고 결과로 돌려준다
   * @req FR-SDVI-001-002
   */
  receive(actor: Actor, msg: LegacyMessageBody): LegacyMessageLogView {
    const at = this.clock.iso();
    const base = { at, direction: 'LEGACY_TO_SDV' as const, system: msg.system, vin: msg.vin, formatIn: msg.format, actorId: actor.id };
    const link = this.links.activeRealtime(msg.system);
    const r = link
      ? legacyToSdv(msg, this.ext.legacyVehicles().find((v) => v.vin === msg.vin), [...new Set(this.features.all().map((f) => f.featureId))])
      : ({ ok: false, reason: `${msg.system}은(는) 활성 실시간 연계 설정이 아닙니다 — 연계 설정을 등록·활성화한 시스템의 메시지만 받습니다` } as const);
    if (r.ok === false) {
      this.audit.failed(actor, 'LEGACY_MESSAGE_CONVERT', `${msg.system}:${msg.vin}`, r.reason, 'D05-07');
      return appendLegacyMessage(this.db, { ...base, formatOut: null, status: 'FAILED', reason: r.reason, output: null });
    }
    return this.db.tx(() => {
      this.audit.record(actor, 'LEGACY_MESSAGE_CONVERT', `${msg.system}:${msg.vin}`, { after: { features: r.message.features.map((f) => `${f.featureId}=${f.state}`) }, componentId: 'D05-07' });
      return appendLegacyMessage(this.db, { ...base, formatOut: 'SDV-FEATURE-STATE-1', status: 'CONVERTED', reason: null, output: r.message });
    });
  }

  list(q: { vin?: string; status?: string; limit?: number }) {
    return legacyMessages(this.db, q);
  }
}

@Controller('api/legacy')
export class LegacyLinkController {
  constructor(
    private readonly links: LegacyLinkService,
    private readonly rules: LegacyRuleService,
  ) {}

  @Get('links')
  list() {
    return { items: this.links.list() };
  }

  @Post('links')
  @Roles(...LEGACY_LINK_EDITORS)
  @AuditAction('LEGACY_LINK_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateLegacyLinkBody)) body: CreateLegacyLinkBody) {
    return this.links.create(actor, body);
  }

  @Patch('links/:id')
  @Roles(...LEGACY_LINK_EDITORS)
  @AuditAction('LEGACY_LINK_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(UpdateLegacyLinkBody)) body: UpdateLegacyLinkBody) {
    return this.links.update(actor, id, body);
  }

  @Delete('links/:id')
  @HttpCode(200)
  @Roles(...LEGACY_LINK_EDITORS)
  @AuditAction('LEGACY_LINK_DELETE')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(DeleteLegacyLinkBody)) body: z.infer<typeof DeleteLegacyLinkBody>) {
    return this.links.remove(actor, id, body.reason);
  }

  @Post('links/:id/run')
  @HttpCode(200)
  @Roles(...LEGACY_BRIDGE_RUNNERS)
  @AuditAction('LEGACY_BRIDGE_RUN')
  run(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RunLegacyBridgeBody)) _body: unknown) {
    return this.links.run(actor, id);
  }

  @Post('mappings')
  @Roles(...LEGACY_RULE_EDITORS)
  @AuditAction('LEGACY_RULE_CREATE')
  createRule(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateLegacyRuleBody)) body: CreateLegacyRuleBody) {
    return this.rules.create(actor, body);
  }

  @Patch('mappings/:code')
  @Roles(...LEGACY_RULE_EDITORS)
  @AuditAction('LEGACY_RULE_UPDATE')
  updateRule(@CurrentActor() actor: Actor, @Param('code') code: string, @Body(new ZodPipe(UpdateLegacyRuleBody)) body: UpdateLegacyRuleBody) {
    return this.rules.update(actor, code, body);
  }
}

@Controller('api/legacy-sdv')
export class LegacyMessageController {
  constructor(private readonly svc: LegacyMessageService) {}

  @Get('formats')
  formats() {
    return { formats: LEGACY_MESSAGE_FORMATS };
  }

  @Get('messages')
  list(@Query('vin') vin?: unknown, @Query('status') status?: unknown, @Query('limit') limit?: unknown) {
    const l = singleQuery(limit, 'limit');
    return { items: this.svc.list({ vin: singleQuery(vin, 'vin') || undefined, status: singleQuery(status, 'status') || undefined, limit: l ? Number(l) : undefined }) };
  }

  @Post('messages')
  @HttpCode(200)
  @Roles('OPERATOR', 'VARIANT_OWNER', 'SYSTEM')
  @AuditAction('LEGACY_MESSAGE_CONVERT')
  receive(@CurrentActor() actor: Actor, @Body(new ZodPipe(LegacyMessageBody)) body: LegacyMessageBody) {
    return this.svc.receive(actor, body);
  }
}
